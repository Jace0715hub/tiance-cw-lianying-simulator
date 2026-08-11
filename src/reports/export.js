const DEFAULT_COLUMNS = [
  "sequence",
  "tick",
  "frame",
  "timeMs",
  "seconds",
  "type",
  "action",
  "component",
  "amount",
  "rageBeforeCast",
  "rageAfterCost",
  "rageAfterResolution",
  "stacksBefore",
  "stacksAfter",
  "mounted",
  "thunder",
  "orange",
];

function csvCell(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function timelineToCsv(rows, columns = DEFAULT_COLUMNS) {
  const header = columns.map(csvCell).join(",");
  const body = rows.map((row) =>
    columns.map((column) => csvCell(row[column])).join(","),
  );
  return [header, ...body].join("\n");
}

export function timelineToJson(rows) {
  return JSON.stringify(rows, null, 2);
}
