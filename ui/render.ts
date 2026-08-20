export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function link(href: string, text: string): HTMLAnchorElement {
  const anchor = element("a", "ms-link", text || href);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  return anchor;
}

export function root(): HTMLElement {
  const existing = document.getElementById("mrscraper-root");
  if (existing) return existing;
  const created = element("div");
  created.id = "mrscraper-root";
  document.body.append(created);
  return created;
}

export function empty(message: string): HTMLElement {
  return element("p", "ms-empty", message);
}

export function table(headers: string[], rows: string[][]): HTMLTableElement {
  const node = element("table", "ms-table");
  const head = element("thead");
  const headRow = element("tr");
  for (const header of headers)
    headRow.append(element("th", undefined, header));
  head.append(headRow);
  node.append(head);

  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr");
    for (const cell of row) tr.append(element("td", undefined, cell));
    body.append(tr);
  }
  node.append(body);
  return node;
}

export function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function mount(
  build: (data: Record<string, unknown>) => Node,
): (data: Record<string, unknown>) => void {
  return (data) => {
    const container = root();
    container.replaceChildren(build(data));
  };
}
