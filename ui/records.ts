import { onToolOutput } from "./bridge.js";
import {
  columnsOf,
  errorMessage,
  findRecords,
  isRecord,
  payload,
  scalarEntries,
} from "./data.js";
import { cell, element, empty, mount, table } from "./render.js";

const MAX_ROWS = 100;

const render = mount((output) => {
  const container = element("div", "ms-widget");
  container.append(element("h2", "ms-title", "Extracted data"));

  const failure = errorMessage(output);
  if (failure) {
    container.append(element("p", "ms-error", failure));
    return container;
  }

  const data = payload(output);
  const rows = findRecords(data);

  if (rows?.length) {
    const columns = columnsOf(rows);
    container.append(
      table(
        columns,
        rows
          .slice(0, MAX_ROWS)
          .map((row) => columns.map((key) => cell(row[key]))),
      ),
    );
    container.append(
      element(
        "p",
        "ms-count",
        rows.length > MAX_ROWS
          ? `Showing ${MAX_ROWS} of ${rows.length} record(s)`
          : `${rows.length} record(s)`,
      ),
    );
    return container;
  }

  const entries = scalarEntries(isRecord(data) ? data : {});
  if (entries.length) {
    const list = element("dl", "ms-fields");
    for (const [key, value] of entries) {
      list.append(element("dt", undefined, key));
      list.append(element("dd", undefined, String(value)));
    }
    container.append(list);
    return container;
  }

  container.append(empty("Nothing was extracted from that page."));
  return container;
});

onToolOutput(render);
