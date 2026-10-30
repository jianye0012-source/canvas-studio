#!/usr/bin/env node
import assert from "node:assert/strict";
import { visibleViewOffset } from "../src/viewport-visible-rect.js";

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const offset = visibleViewOffset({
	canvas: rect(0, 0, 1440, 900),
	leftColumn: rect(0, 0, 240, 900),
	rightColumn: rect(1160, 0, 280, 900),
	topbar: rect(0, 0, 1440, 72),
	dock: rect(0, 618, 1440, 282),
}, 16 / 9);

assert.deepEqual(offset, {
	fullWidth: 1440,
	fullHeight: 900,
	x: 20,
	y: 105,
	width: 1440,
	height: 900,
});
assert.equal(visibleViewOffset({
	canvas: rect(0, 0, 100, 100),
	leftColumn: rect(0, 0, 60, 100),
	rightColumn: rect(40, 0, 60, 100),
}, 1), null);
console.log("PASS viewport visible rectangle");
