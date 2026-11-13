import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const paths = [
  ".mcp.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".grok-plugin/plugin.json",
];

test("portable plugin manifests only connect to the public read-only catalog", () => {
  const mcp = load(".mcp.json");
  assert.deepEqual(mcp, {
    mcpServers: {
      "gnv-catalog": {
        type: "http",
        url: "https://catalog-mcp.goodnaturevibe.com/mcp",
      },
    },
  });

  const claude = load(".claude-plugin/plugin.json");
  const grok = load(".grok-plugin/plugin.json");
  const marketplace = load(".claude-plugin/marketplace.json");
  assert.equal(claude.name, "gnv-catalog-mcp");
  assert.equal(grok.name, "gnv-catalog-mcp");
  assert.equal(claude.license, "MIT");
  assert.equal(grok.license, "MIT");
  assert.deepEqual(marketplace.plugins, [
    {
      name: "gnv-catalog-mcp",
      source: "./",
      description: claude.description,
    },
  ]);
  assert.ok(existsSync(resolve(root, claude.icon)));
});

// Every file that carries the release version. A release bump rewrites the first version match in each.
const VERSION_FILES = [
  "package.json",
  "deploy/server.json",
  "gemini-extension.json",
  ".claude-plugin/plugin.json",
  ".grok-plugin/plugin.json",
  "lhm.plugin.json",
];

test("all version files carry VERSION from src/version.js, as their first version field", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const firstMatch = /(__version__ = |VERSION = |"version": *|\bversion: *)"([^"]*)"/;
  for (const path of VERSION_FILES) {
    assert.equal(load(path).version, VERSION, path);
    assert.equal(firstMatch.exec(readFileSync(resolve(root, path), "utf8"))?.[2], VERSION, `${path}: first match`);
  }
  assert.equal(firstMatch.exec(readFileSync(resolve(root, "src/version.js"), "utf8"))?.[2], VERSION);
});

test("plugin manifests contain no secret or private commerce configuration", () => {
  const text = paths.map((path) => readFileSync(resolve(root, path), "utf8")).join("\n").toLowerCase();
  for (const forbidden of [
    "com.goodnaturevibe/" + "commerce",
    "commerce-mcp." + "goodnaturevibe.com",
    '"headers"',
    '"env"',
    '"command"',
    "api_" + "key",
    "pass" + "word",
    "to" + "ken",
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});
