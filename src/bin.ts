#!/usr/bin/env node

import "dotenv/config";

import { run } from "./runtime.js";

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
