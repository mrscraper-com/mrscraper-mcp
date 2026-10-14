#!/usr/bin/env node

import { parseArgs } from "node:util";

import { testTool } from "./test-tools.js";

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

try {
  const scraper = await testTool(
    "scraperAPI",
    { url: values.url },
    values.target,
  );
  if (scraper) {
    process.exitCode = scraper;
  } else {
    process.exitCode = await testTool(
      "webSearch",
      {
        url: values.query,
        raw: false,
        format: "json",
        region: "us",
        language: "en",
        page: 1,
      },
      values.target,
    );
  }
  if (!process.exitCode) {
    process.exitCode = await testTool("status", {}, values.target);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
