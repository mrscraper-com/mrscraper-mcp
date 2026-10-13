#!/usr/bin/env node

import { parseArgs } from "node:util";

import "dotenv/config";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { TOOL_NAMES } from "../src/config.js";

function printJson(label: string, value: unknown): void {
  console.log(`\n== ${label} ==`);
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: "http://127.0.0.1:8000/mcp" },
      token: { type: "string" },
      "call-tool": { type: "string" },
      args: { type: "string", default: "{}" },
    },
  });
  let argumentsValue: unknown;
  try {
    argumentsValue = JSON.parse(values.args);
  } catch (error) {
    console.error(`Invalid JSON passed to --args: ${String(error)}`);
    return 2;
  }
  if (
    !argumentsValue ||
    typeof argumentsValue !== "object" ||
    Array.isArray(argumentsValue)
  ) {
    console.error("--args must decode to a JSON object.");
    return 2;
  }

  const token =
    values.token?.trim() ||
    process.env.MRSCRAPER_API_KEY?.trim() ||
    process.env.MRSCRAPER_API_TOKEN?.trim();
  console.log(`Testing MCP target: ${values.target}`);
  const transport = new StreamableHTTPClientTransport(new URL(values.target), {
    authProvider: token ? { token: async () => token } : undefined,
  });
  const client = new Client({ name: "mrscraper-smoke-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    await client.ping();
    console.log("ping: ok");
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    printJson("tools", names);
    if (
      JSON.stringify([...names].sort()) !==
      JSON.stringify([...TOOL_NAMES].sort())
    ) {
      throw new Error(
        "Expected only scraperAPI and webSearch. Rebuild or restart the server.",
      );
    }

    if (values["call-tool"]) {
      const name = values["call-tool"];
      if (!names.includes(name)) {
        console.error(
          `Tool ${JSON.stringify(name)} is not exposed by this server.`,
        );
        return 2;
      }
      const args = argumentsValue as Record<string, unknown>;
      const timeout =
        typeof args.timeout === "number" && args.timeout > 0
          ? args.timeout
          : name === "scraperAPI"
            ? 120
            : 600;
      const result = await client.callTool(
        {
          name,
          arguments: args,
        },
        {
          timeout: (timeout + (name === "scraperAPI" ? 30 : 0) + 15) * 1000,
        },
      );
      printJson(`tool result: ${name}`, {
        structuredContent: result.structuredContent,
        content: result.content,
        isError: result.isError || false,
      });
      return result.isError ? 1 : 0;
    }
    return 0;
  } finally {
    await client.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
