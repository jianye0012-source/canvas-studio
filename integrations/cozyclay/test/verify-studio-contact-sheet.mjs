#!/usr/bin/env node
// verify_result visual "contact_sheet": one image of 6 frames sampled across
// the range, each shot frame box-downscaled and tiled 3x2 row-major. The pure
// pieces live in src/studio-contact-sheet.js; the agent binding
// (src/studio-app-binding.js) hands every visual to src/studio-motion-visual.js,
// which wires the export render and the PNG encoder, so both are pinned
// against the source.
import { readFileSync } from "node:fs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
async function check(name, run) {
	try { await run(); } catch (error) { expect(name, false, error?.message ?? String(error)); }
}

const sheet = await import("../src/studio-contact-sheet.js").catch(error => ({ loadError: error }));
expect("src/studio-contact-sheet.js loads", !sheet.loadError, sheet.loadError?.message);

check("sampling", () => {
	const whole = sheet.sampleContactSheetFrames("whole_clip", 240);
	const gaps = whole.slice(1).map((frame, i) => frame - whole[i]);
	expect("whole clip of 240 frames samples 6 frames from 0 to 239", whole.length === 6 && whole[0] === 0 && whole[5] === 239, JSON.stringify(whole));
	expect("whole clip samples are evenly spaced", gaps.every(gap => Math.abs(gap - 239 / 5) < 1), JSON.stringify(gaps));
	expect("no range is the whole clip", JSON.stringify(sheet.sampleContactSheetFrames(undefined, 240)) === JSON.stringify(whole));
	const explicit = sheet.sampleContactSheetFrames({ startFrame: 24, endFrameExclusive: 72 }, 240);
	expect("an explicit range samples its first and last frame", explicit.length === 6 && explicit[0] === 24 && explicit[5] === 71, JSON.stringify(explicit));
	const short = sheet.sampleContactSheetFrames({ startFrame: 10, endFrameExclusive: 14 }, 240);
	expect("a 4-frame range uses each frame once", JSON.stringify(short) === "[10,11,12,13]", JSON.stringify(short));
});

check("box downscale", () => {
	// 4x2 RGBA: each 2x2 block averages to one output pixel.
	const source = new Uint8Array([
		0, 0, 0, 255, 100, 40, 8, 255, 10, 20, 30, 255, 30, 40, 50, 255,
		200, 80, 16, 255, 100, 40, 8, 255, 50, 60, 70, 255, 70, 80, 90, 255,
	]);
	const out = sheet.boxDownscaleRgba(source, 4, 2, 2, 1);
	expect("each output pixel is the mean of its source box", JSON.stringify([...out]) === JSON.stringify([100, 40, 8, 255, 40, 50, 60, 255]), JSON.stringify([...out]));
	const same = sheet.boxDownscaleRgba(source, 4, 2, 4, 2);
	expect("an unscaled pass keeps every pixel", JSON.stringify([...same]) === JSON.stringify([...source]));
});

check("3x2 tiling", () => {
	const tile = value => new Uint8Array([value, value, value, 255]);
	const pixels = ({ data, width, height }) => Array.from({ length: width * height }, (_, i) => data[i * 4]);
	const topDown = sheet.tileRgba([1, 2, 3, 4, 5, 6].map(tile), 1, 1, { columns: 3, rows: 2 });
	expect("tiles land row-major, 3 columns by 2 rows", topDown.width === 3 && topDown.height === 2 && JSON.stringify(pixels(topDown)) === "[1,2,3,4,5,6]", JSON.stringify(pixels(topDown)));
	// WebGL read-back rows run bottom-up: the first row of tiles is the last block.
	const bottomUp = sheet.tileRgba([1, 2, 3, 4, 5, 6].map(tile), 1, 1, { columns: 3, rows: 2, bottomUp: true });
	expect("bottom-up tiling puts the first row of tiles last in the buffer", JSON.stringify(pixels(bottomUp)) === "[4,5,6,1,2,3]", JSON.stringify(pixels(bottomUp)));
	const partial = sheet.tileRgba([1, 2, 3, 4].map(tile), 1, 1, { columns: 3, rows: 2 });
	expect("empty cells are opaque black", JSON.stringify([...partial.data.subarray(16)]) === "[0,0,0,255,0,0,0,255]", JSON.stringify([...partial.data]));
});

check("contact sheet", () => {
	// The renderer reuses one read-back buffer, as the WebGL capture does.
	const width = 2400, height = 100, buffer = new Uint8Array(width * height * 4), rendered = [];
	const render = frame => { rendered.push(frame); buffer.fill(frame); return { data: buffer, width, height }; };
	const frames = [0, 48, 96, 143, 191, 239];
	const result = sheet.buildContactSheet(frames, render);
	expect("every sampled frame renders once, in order", JSON.stringify(rendered) === JSON.stringify(frames), JSON.stringify(rendered));
	expect("the sheet's longest side is at most 1600 px", Math.max(result.width, result.height) <= 1600 && result.width >= 1590, `${result.width}x${result.height}`);
	const tileWidth = result.width / 3, tileHeight = result.height / 2;
	expect("the sheet is 3 tiles wide and 2 high at the frame's aspect", Number.isInteger(tileWidth) && Number.isInteger(tileHeight) && Math.abs(tileWidth / tileHeight - width / height) < 1, `${result.width}x${result.height}`);
	const at = (column, row) => result.data[(((1 - row) * tileHeight) * result.width + column * tileWidth) * 4];
	const placed = [at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1)];
	expect("each tile shows its own frame, row-major from the top", JSON.stringify(placed) === JSON.stringify(frames), JSON.stringify(placed));
});

check("grids and sizes", () => {
	const grid = (frames, views) => { const g = sheet.sheetGrid(frames, views); return `${g.columns}x${g.rows}`; };
	expect("the shot camera keeps 3x2 for up to 6 frames, 4x2 for 7-8", grid(6, 0) === "3x2" && grid(2, 0) === "3x2" && grid(8, 0) === "4x2" && sheet.sheetGrid(6).layout === sheet.CONTACT_SHEET_LAYOUT && sheet.sheetGrid(7).layout === "4x2 row-major");
	expect("own views: one view is 3x2/4x2, or a strip for 1-3 frames; several views a row each", grid(6, 1) === "3x2" && grid(8, 1) === "4x2" && grid(3, 1) === "3x1" && grid(6, 2) === "6x2" && grid(8, 2) === "8x2" && sheet.sheetGrid(6, 2).layout === "6x2 row-major, a row per view");
	const sizes = [[6, 1], [8, 1], [3, 1], [1, 1], [6, 2], [8, 2], [1, 2]].map(([f, v]) => { const g = sheet.sheetGrid(f, v), side = sheet.viewTileSide(g); return [g.columns * side, g.rows * side]; });
	expect("own-view sheets have square tiles and stay within 1600x900", JSON.stringify(sizes) === "[[1350,900],[1600,800],[1599,533],[900,900],[1596,532],[1600,400],[450,900]]", JSON.stringify(sizes));
});

check("trail dots", () => {
	const data = new Uint8Array(9 * 9 * 4).fill(100), px = (x, y) => Array.from(data.subarray((y * 9 + x) * 4, (y * 9 + x) * 4 + 3));
	sheet.paintDots(data, 9, 9, [{ x: 4, y: 4, r: 1.5, color: [200, 0, 0] }, { x: 0, y: 8, r: 0.5, color: [0, 200, 0], alpha: 0.5 }]);
	expect("a solid dot takes its colour; a faint one blends", JSON.stringify(px(4, 4)) === "[200,0,0]" && JSON.stringify(px(5, 4)) === "[200,0,0]" && JSON.stringify(px(0, 8)) === "[50,150,50]" && JSON.stringify(px(7, 7)) === "[100,100,100]", JSON.stringify([px(4, 4), px(0, 8)]));
	const ringed = sheet.paintDots(new Uint8Array(21 * 21 * 4), 21, 21, [{ x: 10, y: 10, r: 4, color: [10, 20, 30], ring: true }, { x: 30, y: 30, r: 3, color: [1, 1, 1] }]);
	expect("a ringed dot has a white circle at r + 2; dots off the image are skipped", JSON.stringify(Array.from(ringed.subarray((10 * 21 + 16) * 4, (10 * 21 + 16) * 4 + 3))) === "[255,255,255]" && JSON.stringify(Array.from(ringed.subarray((10 * 21 + 10) * 4, (10 * 21 + 10) * 4 + 3))) === "[10,20,30]");
});

await check("verify_result schema", async () => {
	const { validateStudioCommand } = await import("../src/studio-agent-protocol.js");
	const ok = args => { try { return validateStudioCommand({ name: "verify_result", args: { checks: ["motion"], targets: ["char-a"], visual: "contact_sheet", ...args } }).args; } catch (error) { return error; } };
	expect("frames still default to even", ok({}).frames === "even");
	expect("frames take beats or up to 8 distinct frames", ok({ frames: "beats" }).frames === "beats" && JSON.stringify(ok({ frames: [3, 1] }).frames) === "[3,1]" && ok({ frames: [1, 2, 3, 4, 5, 6, 7, 8, 9] }) instanceof Error && ok({ frames: [2, 2] }) instanceof Error && ok({ frames: [] }) instanceof Error);
	expect("views take 1-2 distinct names", JSON.stringify(ok({ views: ["front", "top"] }).views) === '["front","top"]' && ok({ views: ["front", "side", "top"] }) instanceof Error && ok({ views: ["back"] }) instanceof Error && ok({ views: ["side", "side"] }) instanceof Error);
	expect("focus and trail take a ref or up to 3", ok({ views: ["side"], focus: "object:empty-2", trail: ["joint:LeftHand", "object:empty-2"] }).trail.length === 2 && ok({ focus: ["a", "b", "c", "d"] }) instanceof Error);
});

check("binding verify_result branch", () => {
	const app = readFileSync(new URL("../src/studio-app-binding.js", import.meta.url), "utf8");
	const start = app.indexOf('if (request.name === "verify_result") {');
	const branch = app.slice(start, app.indexOf("return result;", start));
	expect("verify_result branch is found", start > 0 && branch.length > 0);
	expect("verify_result no longer reports contact_sheet as unsupported", !branch.includes('unsupportedChecks.push("contact_sheet")'));
	expect("verify_result hands the visual to studio-motion-visual.js in one call", branch.includes("studioVisual(args,") && !branch.includes("buildContactSheet("));
	const visual = readFileSync(new URL("../src/studio-motion-visual.js", import.meta.url), "utf8");
	const sheetBranch = visual.slice(visual.indexOf('if (args.visual === "contact_sheet") {'), visual.indexOf('if (args.visual === "trace") {'));
	expect("the visual module builds the contact sheet through the module", sheetBranch.includes("buildContactSheet(") && sheetBranch.includes("sampleContactSheetFrames("));
	expect("even frames stay the default; beats only on frames: \"beats\"", sheetBranch.includes('if (args.frames === "beats")') && sheetBranch.includes("encodePng(sheet.data, sheet)"));
});

if (failures) process.exit(1);
console.log("all studio contact sheet checks PASS");
