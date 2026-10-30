#!/usr/bin/env node
// Browser QA for the stage look's environment light (stage.lighting.envLight) and
// ambient occlusion (stage.lighting.ao), measured on the shot frame the export
// path renders (the frame capture_frame, contact sheets and video export draw):
// - the studio look installs neither and renders pixel-identical before and after;
// - golden hour: the environment map warms the clay (red minus blue on the chest);
// - night: the clay reads blue under the night map;
// - occlusion darkens the floor around the feet while open floor stays as it was.
// Evidence script; not in the manifest. Run:
//   QA_URL=http://127.0.0.1:<vite>/app/ CDP_PORT=<cdp> node tools/qa-browser.mjs -- node test/qa-stage-envao-browser.mjs
// With COZYCLAY_LIVE_PORT set it also asks verify_result for checks ["lighting"] (its look readback).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = Number(process.env.CDP_PORT || 9222);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === "page" && target.url.includes("/app/")) ?? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
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
const act = (id, args) => evaluate(`(async () => { const r = await window.__cozyclay.runStudioAction(${JSON.stringify(id)}, ${JSON.stringify(args)}); return { ok: r?.ok, receiptId: r?.receiptId }; })()`);
const aim = (pos, at, fovDeg) => {
	const d = [at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]];
	return { pos: { x: pos[0], y: pos[1], z: pos[2] }, yaw: Math.atan2(-d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), fovDeg };
};

expect("the studio is ready", await waitFor("!!window.__cozyclay?.runStudioAction && !!window.__cozyclay?.rigA", 60000));
await sleep(1200);

// In-page helpers: the shot frame through a framing, and mean colour in pixel windows
// around world points projected through the same camera (bone names or [x, y, z]).
await evaluate(`(() => {
	const studio = window.__cozyclay;
	const root = () => { let node = studio.editorCam; while (node.parent) node = node.parent; return node; };
	const bone = (name) => { let found = null; studio.rigA.traverse((o) => { if (!found && o.isBone && o.name === name) found = o; }); return found.getWorldPosition(found.position.clone()); };
	window.__envaoQa = {
		state: () => { const scene = root(); return { environment: !!scene.environment, intensity: scene.environmentIntensity, occlusion: Object.prototype.hasOwnProperty.call(scene, "onAfterRender") }; },
		async frame(framing, points, radius) {
			const url = framing ? studio.captureFraming(framing) : studio.captureWithReferences().dataUrl;
			const image = new Image(); image.src = url; await image.decode();
			const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
			const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
			const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
			let hash = 2166136261;
			for (let i = 0; i < data.length; i += 4) hash = Math.imul(hash ^ data[i] ^ (data[i + 1] << 8) ^ (data[i + 2] << 16), 16777619) >>> 0;
			const cam = studio.shotCam.clone();
			if (framing) {
				cam.clearViewOffset(); cam.position.set(framing.pos.x, framing.pos.y, framing.pos.z);
				cam.rotation.order = "YXZ"; cam.rotation.set(framing.pitch, framing.yaw, 0); cam.fov = framing.fovDeg;
			}
			cam.aspect = width / height; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
			const windows = Object.fromEntries(Object.entries(points ?? {}).map(([key, point]) => {
				const world = typeof point === "string" ? bone(point) : studio.rigA.position.clone().set(...point);
				const ndc = world.clone().project(cam), cx = Math.round(((ndc.x + 1) / 2) * width), cy = Math.round(((1 - ndc.y) / 2) * height);
				let r = 0, g = 0, b = 0, n = 0;
				for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
					const i = (y * width + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
				}
				return [key, { at: [cx, cy], rgb: [r / n, g / n, b / n], luma: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n }];
			}));
			return { hash, windows };
		},
		feet: () => ["mixamorigLeftToeBase", "mixamorigRightToeBase", "mixamorigLeftFoot", "mixamorigRightFoot"].map((name) => bone(name).toArray()),
	};
	return true;
})()`);
const frame = (framing, points = {}, radius = 18) => evaluate(`window.__envaoQa.frame(${JSON.stringify(framing)}, ${JSON.stringify(points)}, ${radius})`);
const state = () => evaluate("window.__envaoQa.state()");
const setLook = async (lighting) => { expect(`stage.set ${JSON.stringify(lighting)}`, (await act("stage.set", { lighting })).ok === true); await sleep(250); };

const ids = await evaluate("window.__cozyclay.objects.map((o) => o.id)");
if (ids.length) await act("object.remove", { ids });
await act("stage.applyLighting", { preset: "studio" });
await act("object.add", { kind: "cylinder", placement: { x: 0.65, z: -0.2, rot: -30 } });
await sleep(800);

// 1. Studio: no map, no occlusion pass.
expect("studio sets no environment map and no occlusion hook", JSON.stringify(await state()) === JSON.stringify({ environment: false, intensity: 0, occlusion: false }), JSON.stringify(await state()));
const studio = await frame(null);

// 2. Golden hour: the map warms the clay; occlusion darkens the floor around the feet only.
await act("stage.applyLighting", { preset: "golden" });
await sleep(500);
const golden = await state();
expect("golden builds the environment map and installs the occlusion pass", golden.environment && golden.intensity > 0 && golden.occlusion, JSON.stringify(golden));
const view = aim([2.3, 1.25, 3.3], [0.25, 0.85, 0], 40);
const feet = await evaluate("window.__envaoQa.feet()");
const ground = feet.map(([x, , z]) => [x, 0.02, z]);
const centre = [ground.reduce((s, p) => s + p[0], 0) / ground.length, 0.02, ground.reduce((s, p) => s + p[2], 0) / ground.length];
const points = { chest: "mixamorigSpine1", thigh: "mixamorigHips", feet: centre, openFloor: [centre[0] - 1.6, 0.02, centre[2] + 0.4] };
await setLook({ envLight: 0, ao: 0 });
const flat = await frame(view, points);
await setLook({ envLight: 1, ao: 0 });
const lit = await frame(view, points);
await setLook({ envLight: 1, ao: 0.8 });
const occluded = await frame(view, points);
const warmth = (w) => w.rgb[0] - w.rgb[2];
console.log(`golden chest rgb: hemisphere ${flat.windows.chest.rgb.map(Math.round)} -> environment ${lit.windows.chest.rgb.map(Math.round)}`);
expect("golden: the environment map warms the clay (red minus blue on the chest rises)", warmth(lit.windows.chest) > warmth(flat.windows.chest) + 2, `${warmth(flat.windows.chest).toFixed(1)} -> ${warmth(lit.windows.chest).toFixed(1)}`);
const feetRatio = occluded.windows.feet.luma / lit.windows.feet.luma, openRatio = occluded.windows.openFloor.luma / lit.windows.openFloor.luma;
console.log(`occlusion: around the feet ${lit.windows.feet.luma.toFixed(1)} -> ${occluded.windows.feet.luma.toFixed(1)} (x${feetRatio.toFixed(3)}), open floor ${lit.windows.openFloor.luma.toFixed(1)} -> ${occluded.windows.openFloor.luma.toFixed(1)} (x${openRatio.toFixed(3)})`);
expect("occlusion darkens the floor around the feet", feetRatio < 0.95, feetRatio.toFixed(3));
expect("open floor keeps its brightness", Math.abs(openRatio - 1) < 0.005, openRatio.toFixed(4));

// 3. Night: the clay reads blue under the night map.
await act("stage.applyLighting", { preset: "night" });
await sleep(500);
const night = await frame(view, points);
const [r, , b] = night.windows.chest.rgb;
console.log(`night chest rgb ${night.windows.chest.rgb.map(Math.round)}`);
expect("night: the clay reads blue", b > r + 5, JSON.stringify(night.windows.chest.rgb));

const livePort = process.env.COZYCLAY_LIVE_PORT;
if (livePort) {
	const cli = fileURLToPath(new URL("../bin/cozyclay.mjs", import.meta.url));
	const verified = JSON.parse(execFileSync(process.execPath, [cli, "live", "verify", "--targets", "char-a", "--checks", "lighting", "--live-port", livePort], { encoding: "utf8" }));
	const lighting = verified.checks?.lighting;
	console.log(`verify_result lighting (night): ${JSON.stringify(lighting)}`);
	expect("verify_result reads the look back", JSON.stringify(lighting?.look) === JSON.stringify({ preset: "night", envLight: 1, ao: 0.8 }), JSON.stringify(lighting?.look));
}

// 4. Back to studio: both off again, the frame pixel-identical to the first one.
await act("stage.applyLighting", { preset: "studio" });
await sleep(500);
expect("studio takes the map and the pass off again", JSON.stringify(await state()) === JSON.stringify({ environment: false, intensity: 0, occlusion: false }), JSON.stringify(await state()));
const back = await frame(null);
expect("the studio frame is pixel-identical after env and occlusion were on", back.hash === studio.hash, `${back.hash} vs ${studio.hash}`);

ws.close();
if (failures) {
	console.log(`qa-stage-envao: ${failures} failure(s)`);
	process.exit(1);
}
console.log("qa-stage-envao: all checks passed");
