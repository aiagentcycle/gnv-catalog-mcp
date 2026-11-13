// Runs every *.test.js in this one process: `npm test`.
//
// `node --test test/*.test.js` starts one child process per file and parses its output in a parent
// runner. On Node 18 that parent sometimes never exits although every test passed (seen on 18.19:
// the same file run directly finished 40 out of 40 times, through the runner it hung about 1 in 6).
// One process needs no parent runner, behaves the same on Node 18, 22 and 24, and still exits with
// code 1 when a test fails.
import { readdirSync } from "node:fs";

const dir = new URL(".", import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith(".test.js")).sort();
if (files.length === 0) throw new Error("no test files found");
for (const name of files) await import(new URL(name, dir).href);
