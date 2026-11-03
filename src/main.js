import dns from "node:dns";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { CatalogError } from "./errors.js";
import { createFeed } from "./feed.js";
import { createKnowledge } from "./knowledge.js";
import { createOptions } from "./options.js";
import { createPages } from "./pages.js";
import { createServer } from "./server.js";
import { createCatalogApi } from "./tools.js";

function absent(value) {
  return value == null || value === "";
}

// Configuratie uit de omgeving. Geen geheimen: deze server leest alleen publieke feeds.
export function readConfig(env = process.env) {
  const rawOrigin = absent(env.GNV_CATALOG_ORIGIN) ? "https://goodnaturevibe.com" : env.GNV_CATALOG_ORIGIN;
  let url;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new CatalogError("bad_origin", "GNV_CATALOG_ORIGIN is geen URL", 500);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new CatalogError("bad_origin", "GNV_CATALOG_ORIGIN moet een kale https-origin zijn", 500);
  }
  const port = absent(env.GNV_CATALOG_PORT) ? 8325 : Number(env.GNV_CATALOG_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new CatalogError("bad_port", "GNV_CATALOG_PORT is ongeldig", 500);
  }
  const bind = absent(env.GNV_CATALOG_BIND) ? "127.0.0.1" : env.GNV_CATALOG_BIND;
  if (bind !== "127.0.0.1") throw new CatalogError("bad_bind", "GNV_CATALOG_BIND mag alleen 127.0.0.1 zijn", 500);
  return {
    origin: url.origin,
    allowHosts: [url.hostname],
    port,
    bind,
    logFile: absent(env.GNV_CATALOG_LOG) ? null : env.GNV_CATALOG_LOG,
  };
}

export function createRuntime(config, fetchImpl = fetch) {
  const shared = { origin: config.origin, allowHosts: config.allowHosts, fetchImpl };
  const pages = createPages(shared);
  const feed = createFeed(shared);
  const knowledge = createKnowledge({ ...shared, pages });
  const options = createOptions(shared);
  const api = createCatalogApi({ feed, options, knowledge, pages, origin: config.origin });
  const stats = () => ({ catalog: feed.stats(), knowledge: knowledge.stats() });
  return { api, stats };
}

export async function start(env = process.env, fetchImpl = fetch) {
  // Uitgaand verkeer naar de shop via IPv4, zodat de shop-firewall de server herkent.
  dns.setDefaultResultOrder("ipv4first");
  if (typeof net.setDefaultAutoSelectFamily === "function") net.setDefaultAutoSelectFamily(false);
  const config = readConfig(env);
  const runtime = createRuntime(config, fetchImpl);
  const server = createServer({ api: runtime.api, bind: config.bind, port: config.port, logFile: config.logFile, stats: runtime.stats });
  await server.listen();
  console.error(`gnv-catalog listening ${config.bind}:${config.port}`);
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      server.close().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 3_000).unref();
    });
  }
  return server;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry === import.meta.url) {
  start().catch((error) => {
    console.error(error?.code || "start_failed");
    process.exit(1);
  });
}
