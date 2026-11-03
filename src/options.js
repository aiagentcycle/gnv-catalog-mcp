import { assertEgress } from "./hosts.js";
import { character } from "./text.js";
import { fetchUpstream } from "./upstream.js";
import { USER_AGENT } from "./version.js";

// Varianten (choices) van een configurable product, gelezen uit de publieke productpagina.

function decodeBasicEntities(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => character(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => character(Number(num)))
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function parseObject(decoded, marker) {
  const at = decoded.indexOf(marker);
  if (at < 0) return {};
  const start = marker.endsWith("{") ? at + marker.length - 1 : decoded.indexOf("{", at);
  if (start < 0) return {};
  let depth = 0;
  for (let i = start; i < decoded.length; i += 1) {
    const char = decoded[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(decoded.slice(start, i + 1));
        } catch {
          return {};
        }
      }
    }
  }
  return {};
}

function parseSwatches(html) {
  const options = [];
  const re = /<span>([^<]+)<\/span>\s*<input[^>]*name="super_attribute\[(\d+)\]"[^>]*value="(\d+)"/g;
  for (const match of html.matchAll(re)) {
    options.push({
      label: decodeBasicEntities(match[1]).trim(),
      optionId: Number(match[2]),
      optionValue: Number(match[3]),
    });
  }
  return options;
}

export function parseSellableChildren(html) {
  const decoded = decodeBasicEntities(html);
  const skus = parseObject(decoded, '"sku":{');
  const index = parseObject(decoded, '"index":{');
  const swatches = parseSwatches(html);
  const children = [];
  for (const [productId, sku] of Object.entries(skus)) {
    if (typeof sku !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(sku)) continue;
    const attrs = index[productId] && typeof index[productId] === "object" ? index[productId] : {};
    const [optionId, optionValue] = Object.entries(attrs)[0] ?? [];
    const swatch = swatches.find((item) => String(item.optionId) === String(optionId) && String(item.optionValue) === String(optionValue));
    children.push({
      sku,
      label: typeof swatch?.label === "string" ? swatch.label.slice(0, 80) : null,
      optionId: optionId == null ? null : Number(optionId),
      optionValue: optionValue == null ? null : Number(optionValue),
    });
  }
  return children;
}

export function createOptions({ origin, allowHosts, fetchImpl = fetch, now = () => Date.now(), ttlMs = 600_000, maxEntries = 500 }) {
  const cache = new Map();
  return {
    async children(pathname) {
      if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("..") || pathname.includes("\\")) {
        return [];
      }
      if (/\/(rest|graphql|admin|checkout|customer)(\/|$)/.test(pathname)) return [];
      const hit = cache.get(pathname);
      if (hit && hit.at + ttlMs > now()) return hit.parsed;
      const url = new URL(pathname, origin);
      if (url.origin !== new URL(origin).origin) return [];
      assertEgress(url.toString(), allowHosts);
      const { response, text } = await fetchUpstream(fetchImpl, url, {
        headers: { accept: "text/html", "user-agent": USER_AGENT },
      }, 1_000_000);
      if (response.status >= 300 && response.status < 400) return [];
      if (!response.ok || text.length > 1_000_000) return [];
      const parsed = parseSellableChildren(text);
      cache.delete(pathname);
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(pathname, { parsed, at: now() });
      return parsed;
    },
  };
}
