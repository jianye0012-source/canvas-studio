#!/usr/bin/env node
// The Shot Camera card's focal-length scrub: the mm/FOV maths it writes
// through shotsDomain.changeLens, and the card wiring (slider role, no
// duplicated aspect in the header, one gesture per drag).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampMm, dragMm, fovDegToMm, formatMm, lensRange, mmToFovDeg, nextPrime, previousPrime } from "../src/shell/lens-scrub-math.js";
import { usedSensorHeightMm } from "../src/shot.js";

const sensor = usedSensorHeightMm("fullFrame", 16 / 9);
const range = lensRange(sensor);

// The range is the editor's 14-90° FOV range, kept strictly inside it.
assert.ok(mmToFovDeg(range.min, sensor) < 90 && mmToFovDeg(range.max, sensor) > 14, JSON.stringify(range));
assert.ok(range.min > 9 && range.max < 90, JSON.stringify(range));
// mm and FOV are inverse on the cropped filmback.
for (const mm of [12, 24, 35, 50, 80]) assert.ok(Math.abs(fovDegToMm(mmToFovDeg(mm, sensor), sensor) - mm) < 1e-9);
assert.equal(formatMm(fovDegToMm(45, sensor)), "24.4 mm");
assert.equal(formatMm(35), "35 mm");

// Drag: ~1 mm per 4 px, Shift fine (0.1×), Alt coarse, clamped.
assert.equal(dragMm(24, 40, {}, range), 34);
assert.equal(dragMm(24, -40, {}, range), 14);
assert.equal(dragMm(24, 40, { fine: true }, range), 25);
assert.ok(dragMm(24, 40, { coarse: true }, range) > 34);
assert.equal(dragMm(24, 10000, {}, range), range.max);
assert.equal(dragMm(24, -10000, {}, range), range.min);
assert.equal(clampMm(24.44, range), 24.4);

// Click: the next real prime in range, wrapping to the widest.
assert.equal(nextPrime(24.4, range), 28);
assert.equal(nextPrime(24, range), 28);
assert.equal(nextPrime(50, range), 14);
// The left arrow: the previous real prime, wrapping to the longest.
assert.equal(previousPrime(24.4, range), 24);
assert.equal(previousPrime(24, range), 18);
assert.equal(previousPrime(14, range), 50);

const scrub = readFileSync(new URL("../src/shell/lens-scrub.jsx", import.meta.url), "utf8");
assert.match(scrub, /role="slider"/);
assert.match(scrub, /aria-valuetext=/);
assert.match(scrub, /aria-valuemin=\{range\.min\}/);
assert.match(scrub, /shotsDomain\.beginGesture\(\)/, "a drag is one undo step");
assert.match(scrub, /shotsDomain\.changeLens\(/, "it writes through the toolbar's lens path");
assert.match(scrub, /Focal length — drag to change/);
const dock = readFileSync(new URL("../src/shell/BottomDock.jsx", import.meta.url), "utf8");
assert.match(dock, /<LensScrub [^>]*disabled=\{!shot\}/);
assert.doesNotMatch(dock, /focalMm\} mm · \{ratio\}/, "the header no longer repeats the aspect");
console.log("PASS verify-lens-scrub");
