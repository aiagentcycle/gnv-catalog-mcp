import { CatalogError } from "./errors.js";
import { assertEgress } from "./hosts.js";
import { eurosToCents } from "./money.js";
import { STORES } from "./stores.js";
import { htmlToText } from "./text.js";
import { fetchUpstream } from "./upstream.js";
import { USER_AGENT } from "./version.js";

const PUBLIC_FIELDS = ["sku", "name", "price_cents", "price_max_cents", "currency", "availability", "store", "product_type", "path", "description_text", "categories", "brand"];

function present(row, asOf) {
  const product = { as_of: asOf, source: "llms-feed" };
  for (const field of PUBLIC_FIELDS) product[field] = row[field];
  return product;
}

function safePath(rawUrl, originHost) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.hostname !== originHost) return null;
  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//") || url.pathname.includes("..")) return null;
  if (/\/(rest|graphql|admin|checkout|customer)(\/|$)/.test(url.pathname)) return null;
  return url.pathname;
}

function plainList(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => (typeof item === "string" ? item : item?.name))
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim().slice(0, 80))
    .slice(0, 12);
}

function mapRow(raw, originHost) {
  return {
    sku: raw.sku,
    name: raw.name,
    price_cents: eurosToCents(raw.price),
    price_max_cents: raw.price_max == null ? null : eurosToCents(raw.price_max),
    currency: raw.currency,
    availability: raw.availability,
    store: raw.store,
    product_type: raw.product_type,
    path: safePath(raw.url, originHost),
    description_text: htmlToText(raw.description ?? "").slice(0, 800),
    categories: plainList(raw.categories),
    brand: typeof raw.brand === "string" ? raw.brand.slice(0, 80) : null,
  };
}

// Catalogusfeed /llms-catalog-{store}.ljson van de shop, 10 minuten in het geheugen.
export function createFeed({ origin, allowHosts, fetchImpl = fetch, now = () => Date.now(), ttlMs = 600_000 }) {
  const cache = new Map();

  async function load(store) {
    if (!STORES.includes(store)) {
      throw new CatalogError("store_denied", "store staat niet in de catalogusset", 403);
    }
    const hit = cache.get(store);
    if (hit && now() - hit.at < ttlMs) return hit.rows;
    const url = new URL(`/llms-catalog-${store}.ljson`, origin);
    assertEgress(url.toString(), allowHosts);
    const originHost = url.hostname;
    const { response, text } = await fetchUpstream(fetchImpl, url, {
      headers: { accept: "application/x-ndjson, application/json", "user-agent": USER_AGENT },
    }, 1_000_000);
    if (response.status >= 300 && response.status < 400) {
      throw new CatalogError("egress_denied", "redirect wordt niet gevolgd", 502);
    }
    const ok = typeof response.ok === "boolean" ? response.ok : response.status >= 200 && response.status < 300;
    if (!ok || /^\s*</.test(text)) {
      throw new CatalogError("feed_unavailable", "catalogusfeed is niet leesbaar", 502);
    }
    const rows = [];
    let dropped = 0;
    let seen = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      seen += 1;
      try {
        const row = mapRow(JSON.parse(line), originHost);
        if (row.store === store && row.path) rows.push(row);
        else if (row.store === store) dropped += 1;
      } catch {
        dropped += 1;
      }
    }
    // Niet stil: een feed waar alles uit wegvalt (verkeerde host, prijzen weg) moet in het journal staan.
    if (dropped > 0) console.error(`feed_rows_dropped store=${store} kept=${rows.length} dropped=${dropped} of=${seen}`);
    if (rows.length === 0) console.error(`feed_empty store=${store} rows=${seen}`);
    cache.set(store, { at: now(), rows });
    return rows;
  }

  return {
    async search(store, query, asOf) {
      const needle = String(query ?? "").trim().toLowerCase();
      const rows = await load(store);
      return rows
        .filter((row) => `${row.name} ${row.sku} ${row.description_text} ${(row.categories ?? []).join(" ")}`.toLowerCase().includes(needle))
        .slice(0, 20)
        .map((row) => present(row, asOf));
    },
    async get(store, sku, asOf) {
      const rows = await load(store);
      const found = rows.find((row) => row.sku === sku);
      return found ? present(found, asOf) : null;
    },
    // Voor /healthz: alleen wat al in de cache staat, nooit een fetch.
    stats() {
      const out = {};
      for (const [store, hit] of cache) out[store] = { rows: hit.rows.length, loaded_at: new Date(hit.at).toISOString() };
      return out;
    },
  };
}
