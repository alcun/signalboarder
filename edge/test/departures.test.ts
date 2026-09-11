import { describe, expect, test } from "bun:test";

import { normaliseBoard, WIDTHS } from "../src/departures";

/**
 * These four files are the shared contract with the firmware.
 *
 * `alcun/signalboarder-device` holds byte-identical copies at
 * `firmware/signalboarder/test/fixtures/`, and `test_departures.cpp` runs them through
 * the physically proven C++ parser. Both suites assert the same mapping from
 * the same inputs, so a divergence fails a test rather than a board in a
 * hallway. **Change them in both repositories in the same sitting.**
 */
const FIXTURES = new URL("./fixtures/", import.meta.url);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await Bun.file(new URL(name, FIXTURES)).text());
}

async function rawFixture(name: string): Promise<string> {
  return Bun.file(new URL(name, FIXTURES)).text();
}

describe("normaliseBoard", () => {
  test("maps an on-time board the way the firmware does", async () => {
    const board = normaliseBoard("nbn", await fixture("on-time.json"), 2);

    expect(board).not.toBeNull();
    expect(board!.crs).toBe("NBN");
    expect(board!.station).toBe("New Brighton");
    expect(board!.services).toHaveLength(2);
    expect(board!.services[0]).toEqual({
      scheduled: "13:08",
      expected: "On time",
      destination: "Liverpool Central",
      platform: "2",
      disrupted: false,
    });
  });

  test("marks delayed and cancelled services disrupted", async () => {
    const board = normaliseBoard("GNW", await fixture("disrupted.json"), 2);

    // Delayed: expected is neither "On time" nor the scheduled time.
    expect(board!.services[0].expected).toBe("13:49");
    expect(board!.services[0].disrupted).toBe(true);
    // Cancelled.
    expect(board!.services[1].expected).toBe("Cancelled");
    expect(board!.services[1].disrupted).toBe(true);
  });

  test("an empty board is a board, not a failure", async () => {
    // The firmware parser reports "no train services" as an error, which is why
    // a quiet platform currently shows DATA ERROR. The edge does not repeat
    // that: a station with no more trains tonight is a correct answer.
    const board = normaliseBoard("NBN", await fixture("no-services.json"), 2);

    expect(board).not.toBeNull();
    expect(board!.station).toBe("New Brighton");
    expect(board!.services).toEqual([]);
  });

  test("malformed JSON never reaches the normaliser", async () => {
    const raw = await rawFixture("malformed.json");
    expect(() => JSON.parse(raw)).toThrow();
  });

  test("rejects a payload that is not a board", () => {
    expect(normaliseBoard("NBN", null, 2)).toBeNull();
    expect(normaliseBoard("NBN", "a string", 2)).toBeNull();
    expect(normaliseBoard("NBN", { something: "else" }, 2)).toBeNull();
  });

  test("honours the row count", async () => {
    const payload = await fixture("on-time.json");
    expect(normaliseBoard("NBN", payload, 1)!.services).toHaveLength(1);
    expect(normaliseBoard("NBN", payload, 10)!.services).toHaveLength(2);
  });

  test("bounds every string to the firmware's field widths", () => {
    const board = normaliseBoard(
      "NBN",
      {
        locationName: "L".repeat(80),
        trainServices: [
          {
            std: "13:08",
            etd: "E".repeat(40),
            platform: "P".repeat(20),
            isCancelled: false,
            destination: [{ locationName: "D".repeat(80) }],
          },
        ],
      },
      2,
    )!;

    expect(board.station.length).toBe(WIDTHS.station);
    expect(board.services[0].expected.length).toBe(WIDTHS.expected);
    expect(board.services[0].destination.length).toBe(WIDTHS.destination);
    expect(board.services[0].platform.length).toBe(WIDTHS.platform);
  });

  test("falls back the way the firmware does when fields are missing", () => {
    const board = normaliseBoard("NBN", { locationName: "Somewhere", trainServices: [{}] }, 2)!;

    expect(board.services[0]).toEqual({
      scheduled: "--:--",
      expected: "No report",
      destination: "Unknown",
      platform: "",
      // No report is neither "On time" nor "--:--", so it counts as disrupted.
      disrupted: true,
    });
  });
});
