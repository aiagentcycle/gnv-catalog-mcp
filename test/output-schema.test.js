import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime, readConfig } from "../src/main.js";
import { TOOLS, toolResult } from "../src/tools.js";
import { fakeShop, ORIGIN } from "./fixtures.js";
import { validate } from "./json-schema.js";

const schemaOf = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.outputSchema]));

// What a client receives: structuredContent as it comes out of the JSON-RPC answer.
function structured(name, data) {
  const result = JSON.parse(JSON.stringify(toolResult(data, "2025-11-25")));
  assert.deepEqual(result.structuredContent, JSON.parse(result.content[0].text), name);
  return result.structuredContent;
}

function assertValid(name, data) {
  const errors = validate(schemaOf[name], structured(name, data));
  assert.deepEqual(errors, [], `${name}: ${errors.join("; ")}`);
}

test("validator: catches wrong types, missing fields, enums, items and closed objects", () => {
  const schema = {
    type: "object",
    required: ["a", "b"],
    properties: {
      a: { type: "integer" },
      b: { type: ["string", "null"] },
      c: { type: "array", items: { type: "string", enum: ["x", "y"] } },
      d: { type: "object", additionalProperties: false, properties: { e: { type: "boolean" } } },
    },
  };
  assert.deepEqual(validate(schema, { a: 1, b: null, c: ["x"], d: { e: true }, extra: 1 }), []);
  assert.equal(validate(schema, { a: 1.5, b: "s" }).length, 1);
  assert.equal(validate(schema, { a: 1 }).length, 1);
  assert.equal(validate(schema, { a: 1, b: 2 }).length, 1);
  assert.equal(validate(schema, { a: 1, b: "s", c: ["z", 3] }).length, 2);
  assert.equal(validate(schema, { a: 1, b: "s", d: { f: 1 } }).length, 1);
  assert.equal(validate(schema, []).length, 1);
  assert.deepEqual(validate({ type: "number" }, 3), []);
  assert.throws(() => validate({ type: "string", pattern: "x" }, "x"), /unsupported keyword pattern/);
});

test("all six tools: real output from the fake shop matches its outputSchema", async () => {
  const { fetchImpl } = fakeShop();
  const { api } = createRuntime(readConfig({}), fetchImpl);

  const search = await api.gnv_catalog_search({ query: "olie" });
  assert.equal(search.products.length, 1);
  assertValid("gnv_catalog_search", search);
  assertValid("gnv_catalog_search", await api.gnv_catalog_search({}));
  const empty = await api.gnv_catalog_search({ query: "geen-enkele-treffer" });
  assert.deepEqual(empty.products, []);
  assertValid("gnv_catalog_search", empty);

  const configurable = await api.gnv_product({ sku: "2200" });
  assert.equal(configurable.choices.length, 2);
  assertValid("gnv_product", configurable);
  const simple = await api.gnv_product({ sku: "1100" });
  assert.deepEqual(simple.choices, []);
  assert.equal(simple.price_max_cents, null);
  assertValid("gnv_product", simple);

  assertValid("gnv_knowledge_search", await api.gnv_knowledge_search({}));
  assertValid("gnv_knowledge_search", await api.gnv_knowledge_search({ type: "BlogPost" }));
  const none = await api.gnv_knowledge_search({ query: "geen-enkele-treffer" });
  assert.deepEqual(none.items, []);
  assertValid("gnv_knowledge_search", none);

  const page = await api.gnv_knowledge({ id: "12" });
  assert.equal(page.source, "public-page");
  assertValid("gnv_knowledge", page);
  // Blog post without a readable page: falls back to the feed text.
  const noPage = await api.gnv_knowledge({ id: "34" });
  assert.equal(noPage.source, "llms-content");
  assertValid("gnv_knowledge", noPage);

  assertValid("gnv_profile", await api.gnv_profile({}));
  assertValid("gnv_contact", await api.gnv_contact({}));
});

test("edge rows: missing fields become null, a row without a string sku is dropped, still valid", async () => {
  const rows = [
    { sku: "4400", price: 3, store: "nl", url: `${ORIGIN}/kaal` },
    { sku: 5500, name: "Numerieke sku", price: "1.00", store: "nl", url: `${ORIGIN}/numeriek` },
    { sku: "6600", name: { nl: "object" }, price: "2.00", price_max: "4.00", currency: 978, availability: null, store: "nl", product_type: "configurable", url: `${ORIGIN}/raar`, categories: "geen lijst", brand: 7 },
  ];
  const content = [{ id: 90, type: "BlogPost", title: "Zonder datum", url: `${ORIGIN}/blog/zonder-datum`, description: "", store: "nl" }];
  const base = fakeShop().fetchImpl;
  async function fetchImpl(url, options) {
    const path = new URL(String(url)).pathname;
    if (path === "/llms-catalog-nl.ljson") return new Response(rows.map((row) => JSON.stringify(row)).join("\n"), { status: 200 });
    if (path === "/llms-content-nl.ljson") return new Response(content.map((row) => JSON.stringify(row)).join("\n"), { status: 200 });
    return base(url, options);
  }
  const { api } = createRuntime(readConfig({}), fetchImpl);
  const all = await api.gnv_catalog_search({});
  assert.deepEqual(all.products.map((row) => row.sku), ["4400", "6600"]);
  assert.equal(all.products[0].name, null);
  assert.equal(all.products[0].brand, null);
  assert.deepEqual(all.products[1].categories, []);
  assertValid("gnv_catalog_search", all);
  // Configurable product whose page cannot be read: no choices, feed text.
  const odd = await api.gnv_product({ sku: "6600" });
  assert.deepEqual(odd.choices, []);
  assert.equal(odd.text_source, "llms-feed");
  assertValid("gnv_product", odd);
  const items = await api.gnv_knowledge_search({});
  assert.equal(items.items[0].updated_at, null);
  assertValid("gnv_knowledge_search", items);
  const post = await api.gnv_knowledge({ id: "90" });
  assert.equal(post.text, "");
  assertValid("gnv_knowledge", post);
});

test("structuredContent only for 2025-06-18 and newer", () => {
  assert.equal(toolResult({ products: [] }, "2025-03-26").structuredContent, undefined);
  assert.equal(toolResult({ products: [] }, "2024-11-05").structuredContent, undefined);
  assert.deepEqual(toolResult({ products: [] }, "2025-06-18").structuredContent, { products: [] });
});
