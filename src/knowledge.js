import { CatalogError } from "./errors.js";
import { assertEgress } from "./hosts.js";
import { STORES } from "./stores.js";
import { htmlToText } from "./text.js";
import { fetchUpstream } from "./upstream.js";
import { USER_AGENT } from "./version.js";

const TYPES = new Set(["CMSPage", "BlogPost"]);

function sitePath(rawUrl, originHost) {
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

function dropped(row) {
  const title = row.title.trim().toLowerCase();
  return title === "404 not found" || title === "tests" || row.path.endsWith("/pagina-niet-gevonden") || row.path.endsWith("/tests");
}

function mapRow(raw, originHost) {
  const path = sitePath(raw.url, originHost);
  if (!path || !TYPES.has(raw.type) || raw.store == null) return null;
  const row = {
    id: String(raw.id),
    type: raw.type,
    title: String(raw.title ?? "").slice(0, 200),
    path,
    description_text: htmlToText(raw.description ?? "").slice(0, 800),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at.slice(0, 40) : null,
    store: raw.store,
  };
  if (!/^[0-9]{1,12}$/.test(row.id) || dropped(row)) return null;
  return row;
}

// Kennisfeed /llms-content-{store}.ljson (CMS-pagina's en blogartikelen), 10 minuten in het geheugen.
export function createKnowledge({ origin, allowHosts, pages, fetchImpl = fetch, now = () => Date.now(), ttlMs = 600_000 }) {
  const cache = new Map();

  async function load(store) {
    if (!STORES.includes(store)) throw new CatalogError("store_denied", "store staat niet in de catalogusset", 403);
    const hit = cache.get(store);
    if (hit && now() - hit.at < ttlMs) return hit.rows;
    const url = new URL(`/llms-content-${store}.ljson`, origin);
    assertEgress(url.toString(), allowHosts);
    const { response, text } = await fetchUpstream(fetchImpl, url, {
      headers: { accept: "application/x-ndjson, application/json", "user-agent": USER_AGENT },
    }, 1_000_000);
    if (response.status >= 300 && response.status < 400) {
      throw new CatalogError("egress_denied", "redirect wordt niet gevolgd", 502);
    }
    const ok = typeof response.ok === "boolean" ? response.ok : response.status >= 200 && response.status < 300;
    if (!ok || /^\s*</.test(text)) {
      throw new CatalogError("feed_unavailable", "kennisfeed is niet leesbaar", 502);
    }
    const rows = [];
    let dropped = 0;
    let seen = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      seen += 1;
      try {
        // Bewust gefilterde rijen (ander type, 404-pagina) tellen niet; alleen onleesbare rijen.
        const row = mapRow(JSON.parse(line), url.hostname);
        if (row) rows.push(row);
      } catch {
        dropped += 1;
      }
    }
    if (dropped > 0) console.error(`knowledge_rows_dropped store=${store} kept=${rows.length} dropped=${dropped} of=${seen}`);
    if (rows.length === 0) console.error(`knowledge_empty store=${store} rows=${seen}`);
    cache.set(store, { at: now(), rows });
    return rows;
  }

  return {
    async search(store, query, type, asOf) {
      if (type && !TYPES.has(type)) throw new CatalogError("bad_type", "type is CMSPage of BlogPost", 400);
      const needle = String(query ?? "").trim().toLowerCase().slice(0, 80);
      const rows = await load(store);
      const items = rows
        .filter((row) => !type || row.type === type)
        .filter((row) => !needle || `${row.title} ${row.description_text}`.toLowerCase().includes(needle))
        .slice(0, 100)
        .map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          path: row.path,
          description_text: row.description_text,
          updated_at: row.updated_at,
          as_of: asOf,
          source: "llms-content",
          untrusted: true,
        }));
      return items;
    },
    async get(store, id, asOf) {
      if (!/^[0-9]{1,12}$/.test(String(id ?? ""))) throw new CatalogError("bad_id", "kennis-id is ongeldig", 400);
      const rows = await load(store);
      const row = rows.find((item) => item.id === String(id));
      if (!row) throw new CatalogError("unknown_content", "pagina of artikel staat niet in de feed", 404);
      let text = row.description_text;
      let truncated = false;
      let source = "llms-content";
      try {
        const page = await pages.text(row.path);
        if (page.text) {
          text = page.text;
          truncated = page.truncated;
          source = "public-page";
        }
      } catch {
        source = "llms-content";
      }
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        path: row.path,
        updated_at: row.updated_at,
        text,
        truncated,
        as_of: asOf,
        source,
        untrusted: true,
      };
    },
    // Voor /healthz: alleen wat al in de cache staat, nooit een fetch.
    stats() {
      const out = {};
      for (const [store, hit] of cache) out[store] = { rows: hit.rows.length, loaded_at: new Date(hit.at).toISOString() };
      return out;
    },
  };
}
