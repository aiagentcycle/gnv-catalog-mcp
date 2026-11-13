import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogError } from "../src/errors.js";
import { fetchUpstream } from "../src/upstream.js";

const URL_ = "https://goodnaturevibe.com/llms-catalog-nl.ljson";

async function codeOf(fetchImpl) {
  try {
    await fetchUpstream(fetchImpl, URL_, {}, 1000);
  } catch (error) {
    assert.ok(error instanceof CatalogError, `expected a CatalogError, got ${error?.name}`);
    return error.code;
  }
  return null;
}

test("a network failure becomes upstream_unavailable, not a bare crash", async () => {
  const refused = async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  };
  assert.equal(await codeOf(refused), "upstream_unavailable");
});

test("a timeout stays upstream_timeout, also while the body is still coming in", async () => {
  const slow = async () => {
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  };
  assert.equal(await codeOf(slow), "upstream_timeout");
  const stalledBody = async () => ({
    body: {
      getReader: () => ({
        read: async () => {
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        },
        cancel: async () => {},
      }),
    },
  });
  assert.equal(await codeOf(stalledBody), "upstream_timeout");
});

test("a connection that drops halfway the body becomes upstream_unavailable", async () => {
  const dropped = async () => ({
    body: {
      getReader: () => ({
        read: async () => {
          throw new TypeError("terminated");
        },
        cancel: async () => {},
      }),
    },
  });
  assert.equal(await codeOf(dropped), "upstream_unavailable");
});

test("a too large answer keeps its own code", async () => {
  const big = async () => ({ text: async () => "x".repeat(2000) });
  assert.equal(await codeOf(big), "response_too_large");
});
