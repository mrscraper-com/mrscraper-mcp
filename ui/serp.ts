import { onToolOutput } from "./bridge.js";
import {
  asSearchResults,
  columnsOf,
  errorMessage,
  findRecords,
  payload,
} from "./data.js";
import { cell, element, empty, link, mount, table } from "./render.js";

const render = mount((output) => {
  const container = element("div", "ms-widget");
  container.append(element("h2", "ms-title", "Google results"));

  const failure = errorMessage(output);
  if (failure) {
    container.append(element("p", "ms-error", failure));
    return container;
  }

  const rows = findRecords(payload(output));
  if (!rows?.length) {
    container.append(empty("No results were returned for that search."));
    return container;
  }

  const results = asSearchResults(rows);
  if (!results.length) {
    const columns = columnsOf(rows);
    container.append(
      table(
        columns,
        rows.slice(0, 50).map((row) => columns.map((key) => cell(row[key]))),
      ),
    );
    return container;
  }

  const list = element("ol", "ms-results");
  for (const result of results.slice(0, 50)) {
    const item = element("li", "ms-result");
    item.append(link(result.url, result.title || result.url));
    item.append(element("div", "ms-url", result.url));
    if (result.snippet) {
      item.append(element("p", "ms-snippet", result.snippet));
    }
    list.append(item);
  }
  container.append(list);
  container.append(element("p", "ms-count", `${results.length} result(s)`));
  return container;
});

onToolOutput(render);
