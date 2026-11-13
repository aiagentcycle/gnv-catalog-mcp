import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createRuntime, readConfig } from "../src/main.js";
import { createServer, MAX_BODY } from "../src/server.js";
import { TOOLS } from "../src/tools.js";
import { VERSION } from "../src/version.js";
import { fakeShop } from "./fixtures.js";
import { validate } from "./json-schema.js";

let server;
let port;
let dir;
let logFile;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "gnv-catalog-test-"));
  logFile = join(dir, "tools.jsonl");
  const { fetchImpl } = fakeShop();
  const runtime = createRuntime(readConfig({}), fetchImpl);
  server = createServer({ api: runtime.api, port: 0, logFile, stats: runtime.stats });
  port = (await server.listen()).port;
});

after(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

function request({ method = "GET", path = "/", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    // agent: false = one connection per request; the timeout turns a hang into a failing test instead of a stuck CI job.
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false, timeout: 10_000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`request timed out: ${method} ${path}`)));
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function rpc(message, headers = {}) {
  const res = await request({
    method: "POST",
    path: "/mcp",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(message),
  });
  return { ...res, json: res.body.length ? JSON.parse(res.body.toString("utf8")) : null };
}

function toolJson(reply) {
  return JSON.parse(reply.json.result.content[0].text);
}

test("GET /mcp geeft 405 met Allow: POST", async () => {
  const res = await request({ path: "/mcp" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, "POST");
});

test("initialize, ping en tools/list", async () => {
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(init.status, 200);
  assert.equal(init.json.result.protocolVersion, "2025-03-26");
  assert.equal(init.json.result.serverInfo.name, "gnv-catalog");
  assert.deepEqual(init.json.result.capabilities, { tools: { listChanged: false } });
  const unknownVersion = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(unknownVersion.json.result.protocolVersion, "2025-11-25");
  assert.deepEqual((await rpc({ jsonrpc: "2.0", id: 3, method: "ping" })).json.result, {});
  const list = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list" });
  assert.equal(list.json.result.tools.length, 6);
  assert.ok(list.json.result.tools.every((tool) => tool.annotations.readOnlyHint === true));
});

test("notificatie krijgt 202 zonder body; onbekende methode en kapotte JSON geven een JSON-RPC-fout", async () => {
  const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  assert.equal(note.body.length, 0);
  const unknown = await rpc({ jsonrpc: "2.0", id: 5, method: "resources/list" });
  assert.equal(unknown.json.error.code, -32601);
  const invalid = await rpc({ id: 6, method: "ping" });
  assert.equal(invalid.json.error.code, -32600);
  const batch = await rpc([{ jsonrpc: "2.0", id: 7, method: "ping" }]);
  assert.equal(batch.json.error.code, -32600);
  const broken = await request({ method: "POST", path: "/mcp", headers: { "content-type": "application/json" }, body: "{kapot" });
  assert.equal(broken.status, 400);
  assert.equal(JSON.parse(broken.body).error.code, -32700);
});

test("tools/call: echte aanroepen via de nep-shop", async () => {
  const search = await rpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "gnv_catalog_search", arguments: { query: "olie" } } });
  assert.equal(search.json.result.isError, false);
  assert.deepEqual(toolJson(search).products.map((row) => row.sku), ["2200"]);
  const knowledge = await rpc({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "gnv_knowledge_search" } });
  assert.equal(toolJson(knowledge).items.length, 2);
  const profile = await rpc({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "gnv_profile", arguments: {} } });
  assert.equal(toolJson(profile).name, "Good Nature Vibe");
  const missing = await rpc({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "gnv_product", arguments: { sku: "9999" } } });
  assert.equal(missing.json.result.isError, true);
  assert.equal(toolJson(missing).code, "unknown_sku");
});

test("tools/call met een onbekende tool geeft een JSON-RPC-fout", async () => {
  const reply = await rpc({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "gnv_not_a_tool", arguments: {} } });
  assert.equal(reply.status, 200);
  assert.equal(reply.json.id, 20);
  assert.equal(reply.json.error.code, -32602);
  assert.equal(reply.json.result, undefined);
});

const SEARCH = { name: "gnv_catalog_search", arguments: { query: "olie" } };

test("initialize without protocolVersion negotiates 2025-11-25 with title, icons, websiteUrl and description", async () => {
  const init = await rpc({ jsonrpc: "2.0", id: 80, method: "initialize", params: { capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(init.status, 200);
  assert.equal(init.json.result.protocolVersion, "2025-11-25");
  const info = init.json.result.serverInfo;
  assert.equal(info.title, "Good Nature Vibe Catalog");
  assert.equal(info.websiteUrl, "https://goodnaturevibe.com");
  assert.equal(info.icons[0].mimeType, "image/png");
  assert.match(info.description, /read-only/);
  assert.deepEqual(init.json.result.capabilities, { tools: { listChanged: false } });
});

// One test per supported version: a client that negotiated it and sends it as header.
for (const [version, structured] of [["2025-11-25", true], ["2025-06-18", true], ["2025-03-26", false], ["2024-11-05", false]]) {
  test(`protocol ${version}: initialize, tools/list and tools/call`, async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 81, method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    assert.equal(init.json.result.protocolVersion, version);
    assert.equal("description" in init.json.result.serverInfo, version === "2025-11-25");
    const header = { "mcp-protocol-version": version };
    assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, header)).status, 202);
    const list = await rpc({ jsonrpc: "2.0", id: 82, method: "tools/list" }, header);
    assert.equal(list.json.result.tools.length, 6);
    assert.equal(list.json.result.tools.every((tool) => "outputSchema" in tool), structured);
    const call = await rpc({ jsonrpc: "2.0", id: 83, method: "tools/call", params: SEARCH }, header);
    assert.equal(call.status, 200);
    assert.equal(call.json.result.isError, false);
    assert.deepEqual(toolJson(call).products.map((row) => row.sku), ["2200"]);
    if (structured) {
      assert.deepEqual(call.json.result.structuredContent, toolJson(call));
      const schema = list.json.result.tools.find((tool) => tool.name === "gnv_catalog_search").outputSchema;
      assert.deepEqual(validate(schema, call.json.result.structuredContent), []);
    } else {
      // Exactly the 0.1 answer: text content only.
      assert.deepEqual(Object.keys(call.json.result), ["content", "isError"]);
      assert.deepEqual(list.json.result.tools.map((tool) => tool.name), TOOLS.map((tool) => tool.name));
    }
  });
}

test("no MCP-Protocol-Version header: treated as 2025-03-26", async () => {
  const list = await rpc({ jsonrpc: "2.0", id: 84, method: "tools/list" });
  assert.ok(list.json.result.tools.every((tool) => !("outputSchema" in tool)));
  const call = await rpc({ jsonrpc: "2.0", id: 85, method: "tools/call", params: SEARCH });
  assert.equal(call.json.result.structuredContent, undefined);
});

test("unsupported or invalid MCP-Protocol-Version header gives 400", async () => {
  for (const value of ["1999-01-01", "2026-07-28", "latest", ""]) {
    for (const message of [
      { jsonrpc: "2.0", id: 86, method: "ping" },
      { jsonrpc: "2.0", id: 87, method: "tools/list" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]) {
      const res = await rpc(message, { "mcp-protocol-version": value });
      assert.equal(res.status, 400, `${value} ${message.method}`);
      assert.equal(res.json.error.code, -32600);
      assert.deepEqual(res.json.error.data.supported, ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
    }
    // initialize negotiates the version in its body, so a client that already sends a (newer) header
    // there is not turned away; it gets the newest version this server supports.
    const init = await rpc({ jsonrpc: "2.0", id: 89, method: "initialize", params: { protocolVersion: "2026-07-28" } }, { "mcp-protocol-version": value });
    assert.equal(init.status, 200, `${value} initialize`);
    assert.equal(init.json.result.protocolVersion, "2025-11-25");
  }
  // Origin and method checks come first.
  assert.equal((await request({ path: "/mcp", headers: { "mcp-protocol-version": "1999-01-01" } })).status, 405);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 88, method: "ping" }, { origin: "https://evil.example", "mcp-protocol-version": "1999-01-01" })).status, 403);
});

test("2025-11-25: errors stay errors; tool errors carry no structuredContent", async () => {
  const header = { "mcp-protocol-version": "2025-11-25" };
  const missing = await rpc({ jsonrpc: "2.0", id: 90, method: "tools/call", params: { name: "gnv_product", arguments: { sku: "9999" } } }, header);
  assert.equal(missing.json.result.isError, true);
  assert.equal(missing.json.result.structuredContent, undefined);
  assert.equal(toolJson(missing).code, "unknown_sku");
  // Input validation errors are tool execution errors (isError), not protocol errors.
  const bad = await rpc({ jsonrpc: "2.0", id: 91, method: "tools/call", params: { name: "gnv_product", arguments: { sku: 1100 } } }, header);
  assert.equal(bad.json.result.isError, true);
  assert.equal(toolJson(bad).code, "bad_args");
  // An unknown tool stays a JSON-RPC protocol error.
  const unknown = await rpc({ jsonrpc: "2.0", id: 92, method: "tools/call", params: { name: "gnv_not_a_tool", arguments: {} } }, header);
  assert.equal(unknown.json.error.code, -32602);
});

test("argumentvalidatie: agentId, onbekend argument, ontbrekend en verkeerd type", async () => {
  const cases = [
    { name: "gnv_catalog_search", arguments: { agentId: "agent-1" } },
    { name: "gnv_catalog_search", arguments: { query: "olie", foo: 1 } },
    { name: "gnv_product", arguments: {} },
    { name: "gnv_product", arguments: { sku: 1100 } },
    { name: "gnv_knowledge", arguments: { id: 12 } },
    { name: "gnv_catalog_search", arguments: "olie" },
  ];
  for (const [index, params] of cases.entries()) {
    const reply = await rpc({ jsonrpc: "2.0", id: 30 + index, method: "tools/call", params });
    assert.equal(reply.json.result.isError, true, JSON.stringify(params));
    assert.equal(toolJson(reply).code, "bad_args", JSON.stringify(params));
  }
});

test("Origin-guard: alleen op /mcp", async () => {
  const evil = { origin: "https://evil.example" };
  assert.equal((await rpc({ jsonrpc: "2.0", id: 40, method: "ping" }, evil)).status, 403);
  assert.equal((await request({ path: "/mcp", headers: evil })).status, 403);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 41, method: "ping" }, { origin: "https://goodnaturevibe.com" })).status, 200);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 42, method: "ping" }, { origin: "https://catalog-mcp.goodnaturevibe.com" })).status, 200);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 43, method: "ping" }, { origin: "http://localhost:8325" })).status, 200);
  assert.equal((await request({ path: "/llms.txt", headers: evil })).status, 200);
  assert.equal((await request({ path: "/healthz", headers: evil })).status, 200);
  assert.equal((await request({ path: "/mcp/server-card", headers: evil })).status, 200);
});

test("body-limiet: meer dan 64 KB geeft 413", async () => {
  const big = JSON.stringify({ jsonrpc: "2.0", id: 50, method: "ping", params: { pad: "x".repeat(MAX_BODY) } });
  const res = await request({ method: "POST", path: "/mcp", headers: { "content-type": "application/json" }, body: big });
  assert.equal(res.status, 413);
  const fits = JSON.stringify({ jsonrpc: "2.0", id: 51, method: "ping", params: { pad: "x".repeat(MAX_BODY - 200) } });
  assert.equal((await request({ method: "POST", path: "/mcp", headers: { "content-type": "application/json" }, body: fits })).status, 200);
});

test("/healthz noemt versie en de feed-aantallen uit de cache", async () => {
  await rpc({ jsonrpc: "2.0", id: 60, method: "tools/call", params: { name: "gnv_catalog_search", arguments: {} } });
  const res = await request({ path: "/healthz" });
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.status, "ok");
  assert.equal(body.version, VERSION);
  assert.equal(body.feeds.catalog.nl.rows, 2);
  assert.equal(res.headers["cache-control"], "no-store");
});

test("Server Card en ai-catalog met juist type en CORS", async () => {
  const card = await request({ path: "/mcp/server-card" });
  assert.equal(card.status, 200);
  assert.equal(card.headers["content-type"], "application/mcp-server-card+json");
  assert.equal(card.headers["access-control-allow-origin"], "*");
  const parsed = JSON.parse(card.body);
  assert.equal(parsed.name, "com.goodnaturevibe/catalog");
  assert.equal(parsed.remotes[0].url, "https://catalog-mcp.goodnaturevibe.com/mcp");
  const wellKnown = await request({ path: "/.well-known/mcp/server-card.json" });
  assert.equal(wellKnown.status, 200);
  assert.equal(wellKnown.headers["content-type"], "application/mcp-server-card+json");
  assert.deepEqual(JSON.parse(wellKnown.body), parsed);
  for (const path of ["/mcp/server-card", "/.well-known/mcp/server-card.json"]) {
    const preflight = await request({ method: "OPTIONS", path, headers: { origin: "https://example.org", "access-control-request-method": "GET" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], "*");
  }
  const catalog = await request({ path: "/.well-known/ai-catalog.json" });
  assert.equal(catalog.headers["content-type"], "application/ai-catalog+json");
  assert.equal(JSON.parse(catalog.body).entries[0].url, "https://catalog-mcp.goodnaturevibe.com/.well-known/mcp/server-card.json");
});

test("llms.txt, robots.txt, icoon, redirect op / en 404 voor de rest", async () => {
  const llms = await request({ path: "/llms.txt" });
  assert.match(llms.headers["content-type"], /^text\/plain/);
  const text = llms.body.toString("utf8");
  assert.match(text, /https:\/\/catalog-mcp\.goodnaturevibe\.com\/mcp/);
  for (const name of ["gnv_catalog_search", "gnv_product", "gnv_knowledge_search", "gnv_knowledge", "gnv_profile", "gnv_contact"]) assert.ok(text.includes(name));
  assert.match((await request({ path: "/robots.txt" })).body.toString("utf8"), /User-agent: \*/);
  const icon = await request({ path: "/icon-192.png" });
  assert.equal(icon.headers["content-type"], "image/png");
  assert.deepEqual([...icon.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const root = await request({ path: "/" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.location, "https://goodnaturevibe.com");
  for (const path of ["/nope", "/mcp/", "/llms-full.txt", "/.env", "/static/icon-192.png", "/../src/main.js"]) {
    assert.equal((await request({ path })).status, 404, path);
  }
  assert.equal((await request({ method: "POST", path: "/llms.txt", body: "x" })).status, 405);
  assert.equal((await request({ method: "HEAD", path: "/healthz" })).status, 200);
});

test("log bevat alleen tool, uitkomst en argHash, nooit argumenten of IP's", async () => {
  await rpc({ jsonrpc: "2.0", id: 70, method: "tools/call", params: { name: "gnv_catalog_search", arguments: { query: "geheimzoekwoord" } } });
  const lines = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(lines.length > 0);
  const raw = readFileSync(logFile, "utf8");
  assert.doesNotMatch(raw, /geheimzoekwoord|127\.0\.0\.1|remote|"ip"/);
  const last = lines.at(-1);
  assert.equal(last.tool, "gnv_catalog_search");
  assert.equal(last.ok, true);
  assert.match(last.argHash, /^[0-9a-f]{64}$/);
});
