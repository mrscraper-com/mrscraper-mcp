export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function payload(output: Record<string, unknown>): unknown {
  return isRecord(output) && "data" in output ? output.data : output;
}

export function errorMessage(output: Record<string, unknown>): string | null {
  if (typeof output.error === "string" && output.error) return output.error;
  const status = output.status_code;
  if (typeof status === "number" && status >= 400) {
    return `The request failed with HTTP ${status}.`;
  }
  return null;
}

export function findRecords(value: unknown): Record<string, unknown>[] | null {
  const queue: unknown[] = [value];
  let steps = 0;

  while (queue.length && (steps += 1) < 200) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      const rows = current.filter(isRecord);
      if (rows.length) return rows;
      continue;
    }
    if (isRecord(current)) queue.push(...Object.values(current));
  }
  return null;
}

export function columnsOf(
  rows: Record<string, unknown>[],
  limit = 8,
): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

export function scalarEntries(
  value: unknown,
): Array<[string, string | number | boolean]> {
  if (!isRecord(value)) return [];
  return Object.entries(value).filter(
    (entry): entry is [string, string | number | boolean] =>
      typeof entry[1] === "string" ||
      typeof entry[1] === "number" ||
      typeof entry[1] === "boolean",
  );
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function asSearchResults(
  rows: Record<string, unknown>[],
): SearchResult[] {
  const pick = (row: Record<string, unknown>, keys: string[]): string => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return "";
  };

  const results = rows.map((row) => ({
    title: pick(row, ["title", "name", "heading"]),
    url: pick(row, ["link", "url", "href", "displayed_link"]),
    snippet: pick(row, ["snippet", "description", "summary", "text"]),
  }));
  return results.every((result) => result.url) ? results : [];
}
