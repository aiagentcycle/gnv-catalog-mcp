import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogError } from "../src/errors.js";
import { createFeed } from "../src/feed.js";
import { createKnowledge } from "../src/knowledge.js";
import { createRuntime, readConfig } from "../src/main.js";
import { createPages } from "../src/pages.js";
import { fakeShop, ORIGIN } from "./fixtures.js";

const ALLOW = ["goodnaturevibe.com"];
const AS_OF = "2026-11-03T12:00:00.000Z";

test("catalogusfeed: rijen, prijzen in centen, tekst zonder html, vreemde host en kapotte regel vallen weg", async () => {
  const { fetchImpl, calls } = fakeShop();
  const feed = createFeed({ origin: ORIGIN, allowHosts: ALLOW, fetchImpl });
  const all = await feed.search("nl", "", AS_OF);
  assert.deepEqual(all.map((row) => row.sku), ["1100", "2200"]);
  const zink = all[0];
  assert.deepEqual(zink, {
    as_of: AS_OF,
    source: "llms-feed",
    sku: "1100",
    name: "Zinkoxide",
    price_cents: 1250,
    price_max_cents: null,
    currency: "EUR",
    availability: "in_stock",
    store: "nl",
    product_type: "simple",
    path: "/zinkoxide",
    description_text: "Zink",
    categories: ["Grondstoffen"],
    brand: "GNV",
  });
  assert.equal(all[1].price_max_cents, 2495);
  assert.equal(all[1].description_text, "Koudgeperste olie & meer");
  assert.deepEqual(all[1].categories, ["Oliën", "Huidverzorging"]);
  assert.deepEqual((await feed.search("nl", "OLIE", AS_OF)).map((row) => row.sku), ["2200"]);
  assert.deepEqual((await feed.search("nl", "grondstoffen", AS_OF)).map((row) => row.sku), ["1100"]);
  assert.equal((await feed.get("nl", "1100", AS_OF)).name, "Zinkoxide");
  assert.equal(await feed.get("nl", "9999", AS_OF), null);
  // Eén fetch dankzij de cache, zonder redirects te volgen.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://goodnaturevibe.com/llms-catalog-nl.ljson");
  assert.equal(calls[0].redirect, "manual");
  assert.match(calls[0].ua, /^GNV-Catalog-MCP\//);
  assert.equal(feed.stats().nl.rows, 2);
});

test("catalogusfeed: cache verloopt na 10 minuten", async () => {
  const { fetchImpl, calls } = fakeShop();
  let clock = 0;
  const feed = createFeed({ origin: ORIGIN, allowHosts: ALLOW, fetchImpl, now: () => clock });
  await feed.search("nl", "", AS_OF);
  clock = 599_000;
  await feed.search("nl", "", AS_OF);
  assert.equal(calls.length, 1);
  clock = 600_001;
  await feed.search("nl", "", AS_OF);
  assert.equal(calls.length, 2);
});

test("catalogusfeed: onbekende store, html-antwoord, redirect en egress buiten de allowlist", async () => {
  const { fetchImpl } = fakeShop();
  const feed = createFeed({ origin: ORIGIN, allowHosts: ALLOW, fetchImpl });
  await assert.rejects(feed.search("xx", "", AS_OF), (error) => error instanceof CatalogError && error.code === "store_denied");
  await assert.rejects(feed.search("de", "", AS_OF), (error) => error.code === "feed_unavailable");
  const redirecting = createFeed({ origin: ORIGIN, allowHosts: ALLOW, fetchImpl: async () => new Response("", { status: 302, headers: { location: "https://evil.example/" } }) });
  await assert.rejects(redirecting.search("nl", "", AS_OF), (error) => error.code === "egress_denied");
  const elsewhere = createFeed({ origin: "https://evil.example", allowHosts: ALLOW, fetchImpl });
  await assert.rejects(elsewhere.search("nl", "", AS_OF), (error) => error.code === "egress_denied");
});

test("kennisfeed: alleen CMSPage en BlogPost, 404-pagina valt weg, zoeken en type-filter", async () => {
  const { fetchImpl } = fakeShop();
  const pages = createPages({ origin: ORIGIN, allowHosts: ALLOW, fetchImpl });
  const knowledge = createKnowledge({ origin: ORIGIN, allowHosts: ALLOW, fetchImpl, pages });
  const all = await knowledge.search("nl", "", undefined, AS_OF);
  assert.deepEqual(all.map((row) => row.id), ["12", "34"]);
  assert.deepEqual(all[0], {
    id: "12",
    type: "CMSPage",
    title: "Over ons",
    path: "/over-ons",
    description_text: "Wie we zijn",
    updated_at: "2026-10-01T10:00:00Z",
    as_of: AS_OF,
    source: "llms-content",
    untrusted: true,
  });
  assert.deepEqual((await knowledge.search("nl", "olie", undefined, AS_OF)).map((row) => row.id), ["34"]);
  assert.deepEqual((await knowledge.search("nl", "", "BlogPost", AS_OF)).map((row) => row.id), ["34"]);
  await assert.rejects(knowledge.search("nl", "", "Product", AS_OF), (error) => error.code === "bad_type");
  assert.equal(knowledge.stats().nl.rows, 2);
});

test("kennis: volledige tekst van de publieke pagina, terugval op de feedtekst", async () => {
  const { fetchImpl } = fakeShop();
  const pages = createPages({ origin: ORIGIN, allowHosts: ALLOW, fetchImpl });
  const knowledge = createKnowledge({ origin: ORIGIN, allowHosts: ALLOW, fetchImpl, pages });
  const page = await knowledge.get("nl", "12", AS_OF);
  assert.equal(page.source, "public-page");
  assert.match(page.text, /Good Nature Vibe is een winkel\./);
  assert.doesNotMatch(page.text, /voet|<footer/);
  assert.equal(page.untrusted, true);
  const post = await knowledge.get("nl", "34", AS_OF);
  assert.equal(post.source, "llms-content");
  assert.equal(post.text, "Welke olie past bij jou?");
  await assert.rejects(knowledge.get("nl", "999", AS_OF), (error) => error.code === "unknown_content");
  await assert.rejects(knowledge.get("nl", "../x", AS_OF), (error) => error.code === "bad_id");
});

test("api: de zes publieke leestools geven het verwachte resultaat", async () => {
  const { fetchImpl } = fakeShop();
  const { api, stats } = createRuntime(readConfig({}), fetchImpl);
  const search = await api.gnv_catalog_search({ query: "olie" });
  assert.equal(search.source, "llms-feed");
  assert.deepEqual(search.products.map((row) => row.sku), ["2200"]);
  assert.ok(search.as_of);

  const product = await api.gnv_product({ sku: "2200" });
  assert.equal(product.text_source, "public-page");
  assert.match(product.text, /^Jojoba olie is een vloeibare was\./);
  assert.doesNotMatch(product.text, /magento-init|spConfig|voet/);
  assert.equal(product.untrusted, true);
  assert.deepEqual(product.choices, [
    { sku: "2200-50", label: "50 ml", optionId: 93, optionValue: 7 },
    { sku: "2200-100", label: "100 ml", optionId: 93, optionValue: 8 },
  ]);
  const simple = await api.gnv_product({ sku: "1100" });
  assert.equal(simple.text_source, "llms-feed");
  assert.deepEqual(simple.choices, []);
  await assert.rejects(api.gnv_product({ sku: "9999" }), (error) => error.code === "unknown_sku");
  await assert.rejects(api.gnv_product({ sku: "../etc" }), (error) => error.code === "bad_sku");
  await assert.rejects(api.gnv_catalog_search({ store: "xx" }), (error) => error.code === "store_denied");

  const list = await api.gnv_knowledge_search({});
  assert.equal(list.source, "llms-content");
  assert.equal(list.items.length, 2);
  assert.equal((await api.gnv_knowledge({ id: "12" })).title, "Over ons");

  const profile = await api.gnv_profile({});
  assert.equal(profile.name, "Good Nature Vibe");
  assert.equal(profile.website, "https://goodnaturevibe.com");
  assert.deepEqual(profile.stores, ["nl", "en", "fr", "es", "de"]);
  assert.equal(profile.source, "merchant-profile");
  assert.equal(profile.capabilities.checkout, "not-on-this-server");
  assert.equal(profile.capabilities.selfRegistration, false);
  assert.equal("commerce_mcp" in profile.capabilities, false);
  const contact = await api.gnv_contact({});
  assert.deepEqual(Object.keys(contact), ["name", "website", "path", "as_of", "source"]);
  assert.equal(contact.path, "/contact");

  assert.equal(stats().catalog.nl.rows, 2);
  assert.equal(stats().knowledge.nl.rows, 2);
});

test("config: alleen 127.0.0.1, https-origin en een geldige poort", () => {
  const config = readConfig({});
  assert.deepEqual(config, { origin: "https://goodnaturevibe.com", allowHosts: ["goodnaturevibe.com"], port: 8325, bind: "127.0.0.1", logFile: null });
  assert.throws(() => readConfig({ GNV_CATALOG_BIND: "0.0.0.0" }), (error) => error.code === "bad_bind");
  assert.throws(() => readConfig({ GNV_CATALOG_ORIGIN: "http://goodnaturevibe.com" }), (error) => error.code === "bad_origin");
  assert.throws(() => readConfig({ GNV_CATALOG_ORIGIN: "https://goodnaturevibe.com/nl" }), (error) => error.code === "bad_origin");
  assert.throws(() => readConfig({ GNV_CATALOG_PORT: "80" }), (error) => error.code === "bad_port");
  assert.equal(readConfig({ GNV_CATALOG_PORT: "9000", GNV_CATALOG_LOG: "/tmp/x.jsonl" }).port, 9000);
});
