/**
 * Turn the upstream station CSV into the compact list the picker searches.
 *
 * Run when the dataset is refreshed, not on every build. The output is checked
 * in, so a build never depends on the network:
 *
 *     node scripts/build-stations.mjs data/stations.csv public/stations.json
 *
 * The source lists only stations that can be queried through the National Rail
 * Darwin API, which is why this doubles as a validity check: a code that is not
 * in here cannot return a board, so the picker can say so without spending a
 * request. Provenance and the ODbL attribution requirement are in
 * data/README.txt.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , input = "data/stations.csv", output = "public/stations.json"] = process.argv;

const rows = readFileSync(input, "utf8").trim().split(/\r?\n/);
const header = rows.shift().split(",");
const nameAt = header.indexOf("stationName");
const crsAt = header.indexOf("crsCode");
if (nameAt < 0 || crsAt < 0) {
  console.error("Expected stationName and crsCode columns. Got:", header.join(", "));
  process.exit(1);
}

/**
 * Station names contain commas ("Ashford International (Kent)" does not, but
 * "Bourne End" style names are fine while a few genuinely do), so parse rather
 * than split. Minimal RFC 4180: quoted fields may contain commas and "" escapes.
 */
function parse(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        value += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      fields.push(value);
      value = "";
    } else {
      value += c;
    }
  }
  fields.push(value);
  return fields;
}

const seen = new Set();
const stations = [];

for (const row of rows) {
  const fields = parse(row);
  const name = (fields[nameAt] ?? "").trim();
  const crs = (fields[crsAt] ?? "").trim().toUpperCase();

  // A handful of upstream rows have no CRS. They cannot be queried, so they are
  // not stations as far as this product is concerned.
  if (!name || !/^[A-Z]{3}$/.test(crs)) continue;
  if (seen.has(crs)) continue;
  seen.add(crs);
  stations.push([name, crs]);
}

stations.sort((a, b) => a[0].localeCompare(b[0], "en-GB"));

// Pairs rather than objects: same information, roughly half the bytes, and the
// client turns them back into something readable in one line.
writeFileSync(output, JSON.stringify(stations));

const bytes = Buffer.byteLength(JSON.stringify(stations));
console.log(`${stations.length} stations -> ${output} (${(bytes / 1024).toFixed(1)}KB)`);
