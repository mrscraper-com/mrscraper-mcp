#!/usr/bin/env node

import { parseArgs } from "node:util";

import "dotenv/config";

import { googleSerpSyncApi } from "../src/api.js";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      token: { type: "string" },
      query: { type: "string", default: "iphone 17" },
      region: { type: "string" },
      language: { type: "string" },
      page: { type: "string" },
      format: { type: "string", default: "json" },
      "render-js": { type: "boolean", default: false },
      timeout: { type: "string", default: "120" },
    },
  });
  const token =
    values.token?.trim() ||
    process.env.MRSCRAPER_API_KEY?.trim() ||
    process.env.MRSCRAPER_API_TOKEN?.trim();
  if (!token) {
    console.error("Set MRSCRAPER_API_KEY or pass --token.");
    return 2;
  }
  if (values.format !== "json" && values.format !== "html") {
    console.error("--format must be json or html.");
    return 2;
  }
  const page = values.page === undefined ? null : Number(values.page);
  const timeout = Number(values.timeout);
  if (
    (page !== null && (!Number.isInteger(page) || page < 1)) ||
    !Number.isInteger(timeout) ||
    timeout < 1
  ) {
    console.error("--page and --timeout must be positive integers.");
    return 2;
  }
  const result = await googleSerpSyncApi({
    token,
    queryOrUrl: values.query,
    region: values.region || null,
    language: values.language || null,
    page,
    format: values.format,
    renderJs: values["render-js"],
    timeout,
  });
  console.log(JSON.stringify(result, null, 2));
  return result.error ||
    (result.status_code !== null && result.status_code >= 400)
    ? 1
    : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
