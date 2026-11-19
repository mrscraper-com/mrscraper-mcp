#!/usr/bin/env node
import { parseArgs } from "node:util";
import { testTool } from "./test-tools.js";
import { TOOL_NAMES } from "../src/config.js";
const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://example.com" },
    query: { type: "string", default: "web scraping" },
    target: { type: "string" },
  },
});
let failed = 0;
for (const name of TOOL_NAMES) {
  try {
    failed += await testTool(
      name,
      name === "status"
        ? {}
        : name === "webSearch"
          ? { query: values.query, country: "us" }
          : { url: values.url },
      values.target,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    failed++;
  }
}
console.log(`${TOOL_NAMES.length - failed}/${TOOL_NAMES.length} passed`);
process.exitCode = failed ? 1 : 0;
