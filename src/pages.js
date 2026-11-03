import { CatalogError } from "./errors.js";
import { assertEgress } from "./hosts.js";
import { extractText } from "./text.js";
import { fetchUpstream } from "./upstream.js";
import { USER_AGENT } from "./version.js";

const BLOCKED = /\/(rest|graphql|admin|checkout|customer)(\/|$)/;

export function assertContentPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("..") || pathname.includes("\\") || pathname.includes("?") || pathname.includes("#")) {
    throw new CatalogError("path_denied", "dit paginapad is niet toegestaan", 403);
  }
  if (BLOCKED.test(pathname)) throw new CatalogError("path_denied", "dit paginapad is niet toegestaan", 403);
  return pathname;
}

// Platte tekst van een publieke pagina van de shop. Met ttl en begrensde cache.
export function createPages({ origin, allowHosts, fetchImpl = fetch, now = () => Date.now(), ttlMs = 600_000, maxEntries = 500 }) {
  const cache = new Map();
  return {
    async text(pathname) {
      assertContentPath(pathname);
      const hit = cache.get(pathname);
      if (hit && hit.at + ttlMs > now()) return hit.result;
      const url = new URL(pathname, origin);
      assertEgress(url.toString(), allowHosts);
      if (url.origin !== new URL(origin).origin) {
        throw new CatalogError("egress_denied", "egress buiten de allowlist", 403);
      }
      const { response, text: html } = await fetchUpstream(fetchImpl, url, {
        headers: { accept: "text/html", "user-agent": USER_AGENT },
      }, 1_500_000);
      if (response.status >= 300 && response.status < 400) {
        throw new CatalogError("egress_denied", "redirect wordt niet gevolgd", 502);
      }
      const ok = typeof response.ok === "boolean" ? response.ok : response.status >= 200 && response.status < 300;
      if (!ok || html.length > 1_500_000 || !/^\s*</.test(html)) {
        throw new CatalogError("page_unavailable", "pagina is niet leesbaar", 502);
      }
      if (/Just a moment|Attention Required|cf-browser-verification/i.test(html.slice(0, 1500)) && !html.includes("column main")) {
        throw new CatalogError("page_unavailable", "pagina is niet leesbaar", 502);
      }
      const result = extractText(html);
      if (!result.text) throw new CatalogError("page_unavailable", "pagina heeft geen tekst", 502);
      cache.delete(pathname);
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(pathname, { result, at: now() });
      return result;
    },
  };
}
