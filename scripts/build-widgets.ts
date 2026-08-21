import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const uiDir = fileURLToPath(new URL("../ui/", import.meta.url));
const outFile = fileURLToPath(
  new URL("../src/widgets/bundles.generated.ts", import.meta.url),
);

const ENTRIES = ["serp", "records", "status"] as const;

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [`${uiDir}${entry}.ts`],
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error(`esbuild produced nothing for ${entry}`);
  return output.text;
}

const styles = await readFile(`${uiDir}styles.css`, "utf8");
const bundles: Record<string, string> = {};
for (const entry of ENTRIES) bundles[entry] = await bundle(entry);

const module = `export const WIDGET_STYLES = ${JSON.stringify(styles)};

export const WIDGET_BUNDLES: Record<string, string> = ${JSON.stringify(bundles, null, 2)};
`;

await writeFile(outFile, module, "utf8");
console.log(
  `Bundled ${ENTRIES.length} widget(s) -> src/widgets/bundles.generated.ts`,
);
