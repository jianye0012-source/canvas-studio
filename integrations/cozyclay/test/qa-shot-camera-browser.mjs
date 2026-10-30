#!/usr/bin/env node
// Browser QA: after any frame_shot, the live shot view, verify_result "frame",
// verify_result "contact_sheet" and the video export show one camera for one
// frame. It replays a real agent turn through the live hub (shot.create,
// shot.setRange, frame_shot intent, frame_shot exact, playhead to 120,
// frame_shot exact) and records the pose the export path puts on the shot
// camera for every frame it renders. Evidence script; not in the manifest. Run:
//   COZYCLAY_LIVE_PORT=<hub> node tools/dev-full.mjs --host 127.0.0.1 --port <vite>
//   QA_URL=http://127.0.0.1:<vite>/app/ CDP_PORT=<cdp> COZYCLAY_LIVE_PORT=<hub> \
//     node tools/qa-browser.mjs -- node test/qa-shot-camera-browser.mjs
// QA_OUT=<dir> also writes the sheets and frames it looked at.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const port = Number(process.env.CDP_PORT || 9222);
const livePort = process.env.COZYCLAY_LIVE_PORT || "5184";
const out = process.env.QA_OUT || tmpdir();
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
if (!page) throw new Error("no page target on the QA browser");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (!message.id || !pending.has(message.id)) return;
	const { resolve, reject } = pending.get(message.id);
	pending.delete(message.id);
	if (message.error) reject(new Error(JSON.stringify(message.error)));
	else resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const id = nextId++;
	pending.set(id, { resolve, reject });
	ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
	return result.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (expression, timeoutMs = 30000) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await evaluate(expression).catch(() => false)) return true;
		await sleep(150);
	}
	return false;
};
let failures = 0;
const expect = (name, condition, detail = "") => {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
};
const cli = fileURLToPath(new URL("../bin/cozyclay.mjs", import.meta.url));
const live = (...args) => JSON.parse(execFileSync(process.execPath, [cli, "live", ...args, "--live-port", livePort], { encoding: "utf8", timeout: 120000 }));
const md5 = (path) => createHash("md5").update(readFileSync(path)).digest("hex");

// The export path poses the shot camera with position.set and puts it back with
// copy; the live rigs set it only when the playhead moves, which nothing does
// while a sheet or an export renders. So a recorder on that one call lists the
// export camera per rendered frame, in render order.
const record = `(() => { const cam = window.__cozyclay.shotCam; window.__qaPoses = [];
	if (!cam.position.__qaRecorder) { const set = cam.position.set; cam.position.set = function (x, y, z) { window.__qaPoses?.push([x, y, z]); return set.call(this, x, y, z); }; cam.position.__qaRecorder = true; }
	return true; })()`;
const poses = async () => { const list = await evaluate("window.__qaPoses"); await evaluate("window.__qaPoses = null"); return list; };
const livePose = () => evaluate("window.__cozyclay.shotCam.position.toArray()");
const near = (a, b) => a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < 1e-6);
const run = (action, args = {}) => { const receipt = live("run", action, "--args", JSON.stringify(args)); if (!receipt.ok) throw new Error(`${action}: ${JSON.stringify(receipt)}`); return receipt; };
const sheet = async (name, range = "0:265") => {
	await evaluate(record);
	// Six frames spread over the shot (the timeline runs on past it, into no shot).
	const value = live("verify", "--targets", "char-a", "--checks", "framing", "--range", range, "--visual", "contact_sheet", "--frames", "even", "--out", join(out, `${name}.png`));
	return { frames: value.visualRefs[0].frames, poses: await poses(), md5: md5(value.visual[0].path) };
};
const frame = async (name) => {
	const value = live("verify", "--targets", "char-a", "--checks", "framing", "--visual", "frame", "--out", join(out, `${name}.png`));
	return { md5: md5(value.visual[0].path), pose: await livePose() };
};

expect("the studio is ready", await waitFor("!!window.__cozyclay?.runStudioAction && !!window.__cozyclay?.rigA && !!window.__cozyclay?.shotCam", 60000));
live("status", "--wait");
await sleep(1000);

const shotId = run("shot.create").affectedIds[0];
run("shot.setRange", { shotId, range: { startFrame: 0, endFrameExclusive: 265 } });
run("shot.frame", { shotId, subjectIds: ["char-a"], framing: { intent: { size: "medium-wide shot", view: "front three-quarter", level: "low", side: "left" } }, caption: "QA" });
await sleep(500);
const first = await sheet("sheet-intent");

const second = { position: { x: 1.5, y: 0.85, z: 2.3 }, lookAt: { x: 0, y: 0.6, z: 0 }, focalMm: 40 };
run("shot.frame", { shotId, subjectIds: ["char-a"], framing: { exact: second } });
await sleep(500);
const secondSheet = await sheet("sheet-exact-1");
expect("a reframe changes the contact sheet", secondSheet.md5 !== first.md5, `both ${first.md5}`);
expect("the contact sheet renders the second framing at every frame", secondSheet.poses.length === secondSheet.frames.length && secondSheet.poses.every((pose) => near(pose, [1.5, 0.85, 2.3])),
	JSON.stringify(secondSheet.poses));

run("view.update", { frame: 120, shotId, view: { lookThrough: true } });
await sleep(500);
const before = await frame("frame-120-exact-1");
expect("the live view at frame 120 stands where the second framing put it", near(before.pose, [1.5, 0.85, 2.3]), JSON.stringify(before.pose));

const third = { position: { x: 2.6, y: 1, z: 4 }, lookAt: { x: 0, y: 0.55, z: 0 }, focalMm: 35 };
run("shot.frame", { shotId, subjectIds: ["char-a"], framing: { exact: third } });
await sleep(500);
const thirdSheet = await sheet("sheet-exact-2");
const after = await frame("frame-120-exact-2");
expect("the live view and verify frame show the third framing", near(after.pose, [2.6, 1, 4]), JSON.stringify(after.pose));
expect("the contact sheet renders the third framing at every frame", thirdSheet.poses.length === thirdSheet.frames.length && thirdSheet.poses.every((pose) => near(pose, [2.6, 1, 4])),
	JSON.stringify(thirdSheet.poses));
expect("the third sheet differs from the second", thirdSheet.md5 !== secondSheet.md5, thirdSheet.md5);

// The video export, recorded the same way: one pose per encoded frame.
await evaluate(record);
const exported = await evaluate("window.__cozyclay.exportShotVideo({ download: false }).then((result) => ({ ok: !!result, frames: result?.frameCount ?? result?.frames ?? null }))");
const exportPoses = await poses();
expect("the video export ran", exported.ok && exportPoses.length >= 240, `${JSON.stringify(exported)} poses ${exportPoses.length}`);
expect("every exported frame uses the third framing (frames 10 and 200 included)", exportPoses.length > 200 && near(exportPoses[10], [2.6, 1, 4]) && near(exportPoses[200], [2.6, 1, 4]) && exportPoses.every((pose) => near(pose, [2.6, 1, 4])),
	JSON.stringify([exportPoses[10], exportPoses[200], exportPoses.find((pose) => !near(pose, [2.6, 1, 4]))]));
expect("the live view is unchanged by the export", near(await livePose(), [2.6, 1, 4]));

// A move: keyAtFrame adds a key, and the live view at any playhead stands where
// the export renders that frame (the keys drive it, not a manual override).
run("shot.frame", { shotId, subjectIds: ["char-a"], framing: { exact: { position: { x: -2, y: 1.4, z: 3 }, lookAt: { x: 0, y: 1, z: 0 }, focalMm: 50 } }, keyAtFrame: 200 });
for (const at of [120, 150]) {
	run("view.update", { frame: at, shotId });
	await sleep(500);
	const moving = await sheet(`sheet-move-${at}`, `${at}:${at + 1}`), pose = await livePose();
	expect(`on a move, the live view at frame ${at} is the pose the export renders there`, moving.poses.length > 0 && moving.poses.every((row) => near(row, pose)) && !near(pose, [2.6, 1, 4]) && !near(pose, [-2, 1.4, 3]),
		`${JSON.stringify(pose)} vs ${JSON.stringify(moving.poses)}`);
}
console.log(`sheets ${first.md5} ${secondSheet.md5} ${thirdSheet.md5}; frames ${before.md5} ${after.md5}; out ${out}`);

ws.close();
if (failures) {
	console.log(`qa-shot-camera: ${failures} failure(s)`);
	process.exit(1);
}
console.log("qa-shot-camera: all checks passed");
