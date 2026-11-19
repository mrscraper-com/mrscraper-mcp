#!/usr/bin/env node

import { parseArgs } from "node:util";

import { TOOL_NAMES } from "../src/config.js";
import { sampleArguments, testTool } from "./test-tools.js";

const { values } = parseArgs({
  options: {
    url: {
      type: "string",
      default: "https://www.scrapethissite.com/pages/simple/",
    },
    query: { type: "string", default: "MrScraper web scraping" },
    target: { type: "string" },
  },
});

let failed = 0;
for (const name of TOOL_NAMES) {
  try {
    failed += await testTool(
      name,
      sampleArguments(name, values.url, values.query),
      values.target,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    failed++;
  }
}
console.log(`${TOOL_NAMES.length - failed}/${TOOL_NAMES.length} tools passed`);
process.exitCode = failed ? 1 : 0;
