import assert from "node:assert";
import test from "node:test";

import { METERS_PER_MILE, formatMiles, metersToMiles, milesToMeters } from "../lib/units";

test("metersToMiles and milesToMeters round-trip", () => {
  const miles = 10;
  const meters = milesToMeters(miles);

  assert.ok(Math.abs(meters - miles * METERS_PER_MILE) < 0.0001, "miles to meters matches constant");
  assert.ok(Math.abs(metersToMiles(meters) - miles) < 0.0001, "meters to miles returns original value");
});

test("formatMiles applies consistent decimal places", () => {
  assert.equal(formatMiles(3.14159, 2), "3.14");
  assert.equal(formatMiles(3.1, 3), "3.100");
});

test("progress calculation uses meters storage and miles display", () => {
  const goalMiles = 5;
  const goalMeters = milesToMeters(goalMiles);
  const activityTotalMeters = 8046.72;

  const progressPercent = (activityTotalMeters / goalMeters) * 100;
  const displayMiles = metersToMiles(activityTotalMeters);

  assert.ok(Math.abs(displayMiles - goalMiles) < 0.01, "display miles roughly equals goal miles");
  assert.ok(Math.abs(progressPercent - 100) < 0.1, "progress percent is approximately 100%");
});
