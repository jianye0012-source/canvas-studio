#!/usr/bin/env node
// Browser QA for the stage's HDR environment (stage.lighting.hdr, hdrRotation,
// hdrIntensity, hdrBackground), measured on the frames the export path renders:
// - every lighting preset without an HDR renders the frame it rendered before
//   (md5 of the PNG, compared against HDR_QA_BASELINE when given);
// - a generated .hdr with one bright sun spot loads through the Light panel's
//   own file input and is listed in inspect_studio's catalogue;
// - the clay's lit side follows the sun as hdrRotation turns it;
// - hdrBackground shows the map (its sun where the light comes from), exposure
//   scales it in exports, and it survives a reload and a project save/open;
// - capture_frame, the contact sheet and the video export show it;
// - the built-in environments render (PNGs for review); studio is unchanged after.
// Evidence script; not in the manifest. Run:
//   QA_URL=http://127.0.0.1:<vite>/app/ CDP_PORT=<cdp> COZYCLAY_LIVE_PORT=<live> HDR_QA_OUT=<dir> \
//     node tools/qa-browser.mjs -- node test/qa-stage-hdr-browser.mjs
// HDR_QA_PHASE=presets stops after the preset hashes (to record a baseline on
// an older build); HDR_QA_LABEL names the files (default "after").
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectStudio, HDR_PAGE_HELPERS } from "./qa-stage-hdr-harness.mjs";
import { encodeRgbe, sunSpotMap } from "./hdr-fixture.mjs";

const out = process.env.HDR_QA_OUT || null, label = process.env.HDR_QA_LABEL || "after", livePort = process.env.COZYCLAY_LIVE_PORT;
const CLI = fileURLToPath(new URL("../bin/cozyclay.mjs", import.meta.url));
if (out) mkdirSync(out, { recursive: true });
const studio = await connectStudio(Number(process.env.CDP_PORT || 9222));
const { evaluate, act, sleep, waitFor, expect } = studio;
const PRESETS = ["studio", "day", "overcast", "golden", "dusk", "night", "interior", "stage"];
const aim = (pos, at, fovDeg) => {
	const d = [at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]];
	return { pos: { x: pos[0], y: pos[1], z: pos[2] }, yaw: Math.atan2(-d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), fovDeg };
};
const save = (name, dataUrl) => {
	const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
	if (out) writeFileSync(join(out, `${name}.png`), bytes);
	return createHash("md5").update(bytes).digest("hex");
};
const view = aim([2.3, 1.25, 3.3], [0.25, 0.85, 0], 40);
const ready = () => waitFor("!!window.__cozyclay?.runStudioAction && !!window.__cozyclay?.rigA", 60000);

expect("the studio is ready", await ready());
await sleep(1200);
const ids = await evaluate("window.__cozyclay.objects.map((o) => o.id)");
if (ids.length) await act("object.remove", { ids });
await act("object.add", { kind: "cylinder", placement: { x: 0.65, z: -0.2, rot: -30 } });
await sleep(800);

// 1. Presets without an HDR: the export frame's md5, per preset.
const hashes = {};
for (const preset of PRESETS) {
	await act("stage.applyLighting", { preset });
	await sleep(600);
	hashes[preset] = save(`${label}-${preset}`, await evaluate(`window.__cozyclay.captureFraming(${JSON.stringify(view)})`));
}
console.log(`preset md5 (${label}): ${JSON.stringify(hashes)}`);
if (out) writeFileSync(join(out, `${label}-hashes.json`), `${JSON.stringify(hashes, null, "\t")}\n`);
if (process.env.HDR_QA_BASELINE) {
	const before = JSON.parse(readFileSync(process.env.HDR_QA_BASELINE, "utf8"));
	for (const preset of PRESETS) expect(`${preset} renders pixel-identical to the baseline`, before[preset] === hashes[preset], `${before[preset]} vs ${hashes[preset]}`);
}
if (process.env.HDR_QA_PHASE === "presets") studio.finish("qa-stage-hdr");
if (!livePort) throw new Error("the HDR phase reads the document through the live hub: set COZYCLAY_LIVE_PORT");
const live = (args) => JSON.parse(execFileSync(process.execPath, [CLI, "live", ...args, "--live-port", livePort], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const lighting = () => live(["inspect", "--scope", "scene"]).document.stage.lighting;
const frame = (framing, points = {}, radius = 10) => evaluate(`window.__hdrQa.frame(${JSON.stringify(framing)}, ${JSON.stringify(points)}, ${radius})`);
const state = () => evaluate("window.__hdrQa.state()");

// 2. The test map: one sun (radiance 40, 6 deg wide) at azimuth 0 (+x), 12 deg up, written as a real .hdr
// and loaded through the Light panel's own file input.
const sunMap = sunSpotMap({ width: 1024, height: 512, az: 0, el: 12, radius: 6, sun: 40 });
const hdrPath = join(out ?? tmpdir(), "qa-sun-test.hdr");
writeFileSync(hdrPath, encodeRgbe(sunMap.width, sunMap.height, sunMap.rgb));
await evaluate(HDR_PAGE_HELPERS);
await act("stage.applyLighting", { preset: "stage" });
await act("stage.set", { keyLight: { intensity: 0 }, lighting: { ao: 0 } });
await evaluate(`document.querySelector('[data-node-id="light"] button')?.click(), true`);
expect("selecting the Light shows the HDR controls", await waitFor("document.querySelector('[data-testid=\"hdr-environment\"]')?.offsetParent != null", 10000));
const { root } = await studio.send("DOM.getDocument", { depth: -1, pierce: true });
const { nodeId } = await studio.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-testid=\"hdr-file\"]" });
// A file over the limit is refused with a sentence, and nothing changes.
const hugePath = join(out ?? tmpdir(), "qa-too-big.hdr");
writeFileSync(hugePath, Buffer.concat([Buffer.from("#?RADIANCE\n\n-Y 4 +X 4\n"), Buffer.alloc(33 * 1048576)]));
await studio.send("DOM.setFileInputFiles", { nodeId, files: [hugePath] });
expect("a 33 MB file is refused with the limit", await waitFor("(document.querySelector('[data-testid=\"hdr-environment\"] [role=alert]')?.textContent ?? '').includes('at most 32 MB')", 10000),
	await evaluate("document.querySelector('[data-testid=\"hdr-environment\"] [role=alert]')?.textContent ?? null"));
await studio.send("DOM.setFileInputFiles", { nodeId, files: [hdrPath] });
expect("the loaded file lights the stage and is its backdrop", await waitFor("window.__hdrQa.state().environment && window.__hdrQa.state().background", 20000), JSON.stringify(await state()));
// (before any live command: the hub's inspect publishes the studio selection)
await evaluate(`document.querySelector('[data-node-id="light"] button')?.click(), true`);
await sleep(400);
if (out) writeFileSync(join(out, "light-panel-hdr.png"), Buffer.from((await studio.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
const fileId = lighting().hdr;
expect("the refusal clears once a file loads", !(await evaluate("!!document.querySelector('[data-testid=\"hdr-environment\"] [role=alert]')")));
expect("stage.lighting.hdr names the stored file", /^hdr-[0-9a-f]{32}$/.test(fileId ?? ""), fileId);
expect("loading under a look without sky light turns envLight on", lighting().envLight === 1);
const environments = live(["inspect", "--scope", "catalogue"]).environments ?? [];
console.log(`catalogue environments: ${JSON.stringify(environments.map(({ id, source, brightest, size }) => ({ id, source, brightest, size })))}`);
const listed = environments.find((entry) => entry.id === fileId);
expect("inspect_studio catalogue lists the loaded file and the built-ins", listed?.source === "file" && listed.name === "qa-sun-test.hdr" && environments.filter((entry) => entry.source === "builtin").length === 3, JSON.stringify(listed));
expect("the catalogue reads the file's sun direction (+x, 12 deg up)", listed && listed.brightest[0] > 0.95 && Math.abs(listed.brightest[2]) < 0.05, JSON.stringify(listed?.brightest));

// 3. The lit side follows the sun as hdrRotation turns it (front camera at +z; +x is screen right).
const front = aim([0, 1.15, 3.6], [0, 1.0, 0], 40);
const sides = await evaluate("window.__hdrQa.sides()");
const turns = {};
for (const rotation of [0, 90, 180, -90]) {
	await act("stage.set", { lighting: { hdrRotation: rotation, hdrBackground: false } });
	await sleep(400);
	const shot = await frame(front, sides);
	save(`hdr-rotation-${rotation}`, shot.url);
	turns[rotation] = Object.fromEntries(Object.entries(shot.windows).map(([key, window]) => [key, Number(window.luma.toFixed(1))]));
}
console.log(`lit side by hdrRotation (luma 0..255): ${JSON.stringify(turns)}`);
expect("rotation 0: the sun at +x lights the +x side", turns[0].plusX > turns[0].minusX + 15, JSON.stringify(turns[0]));
expect("rotation 180: the sun at -x lights the -x side", turns[180].minusX > turns[180].plusX + 15, JSON.stringify(turns[180]));
expect("rotation -90: +x turns to +z, the front is lit", turns[-90].chest > turns[90].chest + 15, `${turns[-90].chest} vs ${turns[90].chest}`);
expect("rotation 90: +x turns to -z, both sides alike", Math.abs(turns[90].plusX - turns[90].minusX) < 10, JSON.stringify(turns[90]));

// 4. The backdrop: at hdrRotation 70 the sun (+x turned 70 deg toward -z) stands right of the figure.
const D = Math.PI / 180, sunDir = [Math.cos(12 * D) * Math.cos(-70 * D), Math.sin(12 * D), Math.cos(12 * D) * Math.sin(-70 * D)];
const backdrop = { sky: { px: [300, 150] }, sun: sunDir.map((v, i) => [0, 1.15, 3.6][i] + 40 * v) };
await act("stage.set", { lighting: { hdrRotation: 70, hdrBackground: false } });
await sleep(400);
const plain = await frame(front, backdrop, 6);
await act("stage.set", { lighting: { hdrBackground: true } });
await sleep(400);
const shown = await frame(front, backdrop, 6);
save("hdr-background-on", shown.url);
save("hdr-background-off", plain.url);
console.log(`backdrop off ${JSON.stringify(plain.windows)} / on ${JSON.stringify(shown.windows)}`);
expect("off: the look's black sky", plain.windows.sky.luma < 3 && plain.windows.sun.luma < 3);
const [r, , b] = shown.windows.sky.rgb;
expect("on: the map's blue sky behind the set", b > r + 15 && b > 70 && b < 120, JSON.stringify(shown.windows.sky.rgb));
expect("on: its sun where the light comes from", shown.windows.sun.luma > 240, JSON.stringify(shown.windows.sun));
await act("stage.set", { lighting: { exposure: 2 } });
await sleep(300);
const exposed = await frame(front, backdrop, 6);
expect("exports scale the backdrop by exposure", exposed.windows.sky.rgb[2] > b * 1.25, `${b} -> ${exposed.windows.sky.rgb[2]}`);
await act("stage.set", { lighting: { exposure: 1 } });
await sleep(300);

// 5. It survives a reload, and a project save/open after the browser lost the file.
const kept = (await frame(front)).hash;
await sleep(1500);
const reloaded = async () => {
	await studio.send("Page.reload", { ignoreCache: false });
	await sleep(1000);
	expect("the studio is back", await ready());
	await evaluate(HDR_PAGE_HELPERS);
	return waitFor("window.__hdrQa.state().environment && window.__hdrQa.state().background", 20000);
};
expect("after a reload the file loads again from the asset store", await reloaded());
expect("the reloaded frame is pixel-identical", (await frame(front)).hash === kept);
const saved = await evaluate(`(async () => { const text = await window.__cozyclayProject.export("HDR QA"); window.__hdrQaSaved = text;
	const assets = JSON.parse(text).resources.assets; return assets.map(({ id, type, name }) => ({ id, type, name })); })()`);
expect("the saved project embeds the file", saved.some((asset) => asset.id === fileId && asset.type === "image/vnd.radiance"), JSON.stringify(saved));
const restored = await evaluate(`(async () => {
	const db = await new Promise((resolve, reject) => { const open = indexedDB.open("cozyclay.assets"); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
	await new Promise((resolve) => { const tx = db.transaction("images", "readwrite"); tx.objectStore("images").delete(${JSON.stringify(fileId)}); tx.oncomplete = resolve; });
	db.close();
	const result = await window.__cozyclayProject.open(window.__hdrQaSaved); return result.ok; })()`);
expect("the project opens after the file was deleted from the browser", restored === true);
expect("after open and reload the file is back in the asset store", await reloaded());
expect("and renders pixel-identical", (await frame(front)).hash === kept);

// 6. capture_frame, the contact sheet, the viewport and the video export draw it too.
await act("stage.applyLighting", { preset: "night", keep: ["lighting.hdr"] });
await act("stage.set", { lighting: { hdr: "builtin:night-street", hdrRotation: 0, hdrBackground: true } });
await sleep(800);
if (out) {
	live(["capture", "--out", join(out, "capture-frame-night-street.png")]);
	writeFileSync(join(out, "viewport-night-street.png"), Buffer.from((await studio.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
}
const verified = live(["verify", "--targets", "char-a", "--checks", "lighting", "--visual", "contact_sheet", "--out", join(out ?? tmpdir(), "contact-sheet-night-street.png")]);
console.log(`verify_result lighting look ${JSON.stringify(verified.checks?.lighting?.look)} meanLuma ${verified.checks?.lighting?.meanLuma}`);
expect("verify_result names the HDR and that it had loaded", verified.checks?.lighting?.look?.hdr === "builtin:night-street" && verified.checks.lighting.look.hdrLoaded === true, JSON.stringify(verified.checks?.lighting?.look));
await act("stage.applyLighting", { preset: "overcast" });
await act("stage.set", { lighting: { hdr: "builtin:overcast-field", hdrBackground: true } });
await sleep(800);
const corners = { topLeft: { fx: [0.04, 0.05] }, topRight: { fx: [0.96, 0.05] } };
const still = await evaluate(`window.__hdrQa.frame(null, ${JSON.stringify(corners)}, 6)`);
const video = await evaluate(`window.__hdrQa.video(${JSON.stringify(corners)}, 6)`).catch((error) => ({ error: error.message }));
console.log(`overcast field: shot still ${JSON.stringify(still.windows)}; video ${JSON.stringify(video)}`);
const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 14);
expect("the video export's first frame shows the same overcast backdrop as the shot still",
	video.frames > 0 && near(video.windows.topLeft.rgb, still.windows.topLeft.rgb) && near(video.windows.topRight.rgb, still.windows.topRight.rgb) && still.windows.topLeft.luma > 120, JSON.stringify({ still: still.windows, video }));

// 7. The built-ins under their matching looks (PNGs for review), then Remove and studio again.
for (const [hdr, preset] of [["builtin:night-street", "night"], ["builtin:overcast-field", "overcast"], ["builtin:studio-softbox", "studio"]]) {
	await act("stage.applyLighting", { preset });
	await act("stage.set", { lighting: { hdr, envLight: 1, hdrBackground: true } });
	await sleep(600);
	save(`builtin-${hdr.slice(8)}`, (await frame(view)).url);
}
await act("stage.set", { lighting: { hdr: null } });
await act("stage.applyLighting", { preset: "studio" });
await sleep(600);
expect("after Remove the studio look has no map and no HDR backdrop", JSON.stringify(await state()) === JSON.stringify({ environment: false, intensity: 0, rotation: 0, background: false, backgroundIntensity: 1 }), JSON.stringify(await state()));
const studioAgain = save(`${label}-studio-after-hdr`, await evaluate(`window.__cozyclay.captureFraming(${JSON.stringify(view)})`));
expect("the studio frame is pixel-identical to the one before any HDR", studioAgain === hashes.studio, `${studioAgain} vs ${hashes.studio}`);
studio.finish("qa-stage-hdr");
