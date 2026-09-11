/**
 * Answer the four questions PLAN.md asks about the live API, in one run.
 *
 * Everything in phase 0 was built against Huxley-shaped fixtures. Huxley 2 is a
 * thin JSON wrapper over OpenLDBWS and the firmware's proven parser maps those
 * exact field names, so the shapes are expected to match. Expected is not
 * measured. This script measures.
 *
 *     bun run verify            # key from ~/.signalboarder-key or SIGNALBOARDER_LDBWS_KEY
 *     bun run verify LIV        # a different station
 *
 * It NEVER prints the key, and prints only the response shape plus a small
 * amount of real departure data, which is public timetable information.
 */

import { normaliseBoard } from "../src/departures";

const DEFAULT_URL =
  "https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepartureBoard";

const KEY_FILE = `${process.env.HOME}/.signalboarder-key`;

async function readKey(): Promise<string> {
  const fromEnv = process.env.SIGNALBOARDER_LDBWS_KEY?.trim();
  if (fromEnv) return fromEnv;

  const file = Bun.file(KEY_FILE);
  if (await file.exists()) {
    const value = (await file.text()).trim();
    if (value) return value;
  }

  console.error(`No key. Put it in ${KEY_FILE} (chmod 600) or set SIGNALBOARDER_LDBWS_KEY.`);
  process.exit(1);
}

const baseUrl = (process.env.SIGNALBOARDER_LDBWS_URL ?? DEFAULT_URL).replace(/\/$/, "");
const station = (process.argv[2] ?? "NBN").toUpperCase();
// Three letters, well formed, almost certainly not a station. This is the one
// that matters: it decides NO STATION FOUND versus DATA ERROR on both surfaces.
const nonsense = "QQZ";

const key = await readKey();

async function request(crs: string) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/${crs}`, {
    headers: { "x-apikey": key, accept: "application/json" },
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // Left null. The raw snippet below is then the useful part.
  }
  return { status: response.status, ms: Date.now() - started, text, payload };
}

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(22)} ${String(value)}`);
}

console.log(`\nbase url  ${baseUrl}`);
console.log(`key       present, ${key.length} characters, not shown\n`);

// 1 and 2: a real station, its status and its field names.
console.log(`--- ${station}`);
const real = await request(station);
line("status", `${real.status} in ${real.ms}ms`);

// Bail before the comparisons below. A rejected key returns the same status for
// every request, which would otherwise produce a confident and wrong verdict
// about how unknown stations are reported.
if (real.status === 401 || real.status === 403) {
  line("body", real.text.slice(0, 200).replace(/\s+/g, " "));
  console.log(
    "\n  The key was REJECTED, so nothing below would mean anything.\n" +
      "  Check it is the key for the public Live Departure Board product,\n" +
      "  not Staff Version, Service Details or Live Next Departures Board,\n" +
      "  and that the subscription is approved. Nothing else was tested.\n",
  );
  process.exit(1);
}

if (real.payload && typeof real.payload === "object") {
  const top = Object.keys(real.payload as object);
  line("top-level keys", top.join(", ") || "(none)");

  const services = (real.payload as { trainServices?: unknown }).trainServices;
  if (Array.isArray(services)) {
    line("trainServices", `${services.length} entries`);
    if (services[0] && typeof services[0] === "object") {
      line("service keys", Object.keys(services[0] as object).join(", "));
    }
  } else {
    line("trainServices", `NOT AN ARRAY: ${typeof services}`);
    console.log("\n  Field names differ from the fixtures. Only normaliseBoard changes.");
  }

  const board = normaliseBoard(station, real.payload, 3);
  console.log("\n  normalised:");
  if (!board) {
    console.log("  MAPPING FAILED. Compare the keys above with src/departures.ts.");
  } else {
    console.log(`  ${board.station} (${board.crs})`);
    for (const s of board.services) {
      console.log(
        `    ${s.scheduled}  ${s.destination.padEnd(30)} ${s.expected.padEnd(12)}` +
          `plat ${s.platform || "-"}  ${s.disrupted ? "DISRUPTED" : "ok"}`,
      );
    }
    if (board.services.length === 0) {
      console.log("    (no services: check this renders as a board, not an error)");
    }
  }
} else {
  line("body", real.text.slice(0, 300));
}

// 3: the one real guess in the codebase.
console.log(`\n--- ${nonsense}, a well-formed code that is not a station`);
const bad = await request(nonsense);
line("status", `${bad.status} in ${bad.ms}ms`);
line("body", bad.text.slice(0, 300).replace(/\s+/g, " ") || "(empty)");

console.log("\n--- verdict");
if (bad.status === 404) {
  console.log("  404 as assumed. src/providers.ts is correct, change nothing.");
} else if (bad.status === real.status) {
  console.log(
    `  SAME STATUS AS A REAL STATION (${bad.status}). The unknown-station case is\n` +
      "  in the BODY, not the status. src/providers.ts must detect it there, or a\n" +
      "  mistyped code shows DATA ERROR and traps the user. This is the blocker.",
  );
} else {
  console.log(
    `  ${bad.status}, not the assumed 404. Update the one status check in\n` +
      "  src/providers.ts createLdbwsProvider, and the table in README.md.",
  );
}

console.log("\nStill to confirm by hand: a station with no departures late at");
console.log("night returns an empty trainServices rather than an error.\n");
