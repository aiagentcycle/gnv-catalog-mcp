import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { aiCatalog, DESCRIPTION, REGISTRY_NAME, serverCard } from "../src/discovery.js";
import { CatalogError } from "../src/errors.js";
import { argHash, PROTOCOL_VERSIONS, SERVER_INFO, TOOLS, validateArgs } from "../src/tools.js";

const EXPECTED = ["gnv_catalog_search", "gnv_product", "gnv_knowledge_search", "gnv_knowledge", "gnv_profile", "gnv_contact"];
const byName = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool]));

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

test("precies de zes leestools, in vaste volgorde", () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), EXPECTED);
});

test("geen agentId, geen geheim, geen schrijvende tool", () => {
  for (const tool of TOOLS) {
    const props = Object.keys(tool.inputSchema.properties);
    assert.ok(!props.includes("agentId"), `${tool.name} heeft agentId`);
    assert.ok(!tool.inputSchema.required.includes("agentId"));
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.doesNotMatch(
      JSON.stringify(tool),
      /secret|agentId|checkout_place|cart_create|cart_update|order_create|payment_create/i,
    );
  }
});

test("titels, beschrijvingen en argumentdocumentatie zijn compleet", () => {
  for (const tool of TOOLS) {
    assert.ok(tool.title, `${tool.name} zonder titel`);
    assert.ok(tool.description.includes(" NL: "), `${tool.name} zonder NL-deel`);
    for (const [key, rule] of Object.entries(tool.inputSchema.properties)) {
      assert.ok((rule.description ?? "").length > 15, `${tool.name}.${key} zonder beschrijving`);
    }
  }
  assert.equal(byName.gnv_catalog_search.title, "Search the Good Nature Vibe catalog");
  assert.deepEqual(byName.gnv_product.inputSchema.required, ["sku"]);
  assert.deepEqual(byName.gnv_knowledge.inputSchema.required, ["id"]);
  assert.deepEqual(Object.keys(byName.gnv_profile.inputSchema.properties), []);
});

test("serverinfo en protocolversies", () => {
  assert.equal(SERVER_INFO.name, "gnv-catalog");
  assert.equal(SERVER_INFO.title, "Good Nature Vibe Catalog");
  assert.equal(SERVER_INFO.version, "0.1.0");
  assert.equal(SERVER_INFO.websiteUrl, "https://goodnaturevibe.com");
  assert.equal(SERVER_INFO.icons[0].src, "https://catalog-mcp.goodnaturevibe.com/icon-192.png");
  assert.deepEqual(PROTOCOL_VERSIONS, ["2025-06-18", "2025-03-26", "2024-11-05"]);
});

test("argumentvalidatie: onbekend, ontbrekend en verkeerd type", () => {
  const code = (fn) => {
    try {
      fn();
      return "ok";
    } catch (error) {
      assert.ok(error instanceof CatalogError);
      return error.code;
    }
  };
  assert.equal(code(() => validateArgs(byName.gnv_product, { sku: "1100" })), "ok");
  assert.equal(code(() => validateArgs(byName.gnv_product, { sku: "1100", agentId: "a" })), "bad_args");
  assert.equal(code(() => validateArgs(byName.gnv_product, {})), "bad_args");
  assert.equal(code(() => validateArgs(byName.gnv_product, { sku: "" })), "bad_args");
  assert.equal(code(() => validateArgs(byName.gnv_product, { sku: 1100 })), "bad_args");
  assert.equal(code(() => validateArgs(byName.gnv_catalog_search, [])), "bad_args");
  assert.equal(code(() => validateArgs(byName.gnv_catalog_search, null)), "bad_args");
  assert.equal(code(() => validateArgs(byName.gnv_profile, { store: "nl" })), "bad_args");
});

test("argHash is een sha256 zonder geheime velden", () => {
  assert.match(argHash({ query: "olie" }), /^[0-9a-f]{64}$/);
  assert.equal(argHash({ query: "olie", password: "x" }), argHash({ query: "olie" }));
  assert.notEqual(argHash({ query: "olie" }), argHash({ query: "zink" }));
});

test("deploy/server.json en deploy/ai-catalog.json passen bij de code", () => {
  const registry = readJson("../deploy/server.json");
  assert.equal(registry.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.equal(registry.name, REGISTRY_NAME);
  assert.equal(registry.title, SERVER_INFO.title);
  assert.equal(registry.description, DESCRIPTION);
  assert.ok(registry.description.length <= 100);
  assert.equal(registry.version, SERVER_INFO.version);
  assert.equal(registry.websiteUrl, SERVER_INFO.websiteUrl);
  assert.deepEqual(registry.icons, SERVER_INFO.icons);
  assert.deepEqual(registry.repository, { url: "https://github.com/aiagentcycle/gnv-catalog-mcp", source: "github" });
  assert.deepEqual(registry.remotes, [{ type: "streamable-http", url: "https://catalog-mcp.goodnaturevibe.com/mcp" }]);
  assert.deepEqual(readJson("../deploy/ai-catalog.json"), aiCatalog());
  assert.equal(readJson("../package.json").version, SERVER_INFO.version);
  const card = serverCard();
  assert.equal(card.name, REGISTRY_NAME);
  assert.equal(card.remotes[0].url, registry.remotes[0].url);
  assert.equal(card.remotes[0].headers, undefined);
});
