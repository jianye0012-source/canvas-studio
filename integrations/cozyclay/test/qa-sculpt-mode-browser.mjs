#!/usr/bin/env node
// Browser QA for Sculpt mode (#739): key 5 opens the isolated turntable with the
// Sculpt panel; a sculpt placed through the editor bus is the only object the
// sculpt camera draws; Place in scene returns to Stage with the sculpt selected,
// and one undo puts it back where it stood. No agent turn runs here.
// Run through tools/qa-browser.mjs with QA_URL pointing at `/app/`.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.CDP_PORT || 9222);
const out = process.env.QA_OUT || join(tmpdir(), "cozyclay-qa-sculpt-mode");
// sculpt-mode.js SCULPT_LAYER: only the sculpt camera sees this layer.
const SCULPT_LAYER = 6;
const recipe = JSON.parse(await readFile(new URL("./fixtures/sculpt-snorlax.json", import.meta.url), "utf8"));
await mkdir(out, { recursive: true });
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
const waitForPageLoad = (timeoutMs = 30000) => new Promise((resolve, reject) => {
	let settled = false;
	const finish = (error) => {
		if (settled) return;
		settled = true;
		ws.removeEventListener("message", onMessage);
		clearTimeout(timer);
		if (error) reject(error);
		else resolve();
	};
	const onMessage = (event) => {
		if (JSON.parse(event.data).method === "Page.loadEventFired") finish();
	};
	const timer = setTimeout(() => finish(new Error("timed out waiting for the QA page to load")), timeoutMs);
	ws.addEventListener("message", onMessage);
});
const evaluate = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
	return result.result.value;
};
const reload = async () => {
	const loaded = waitForPageLoad();
	await send("Page.reload", { ignoreCache: true });
	await loaded;
};
// DOM conditions settle on a mutation; scene-graph conditions (layers, records
// read through the QA hook) settle on a rendered frame. Both are bounded.
const waitFor = (condition, timeoutMs = 15000) => evaluate(`new Promise((resolve) => {
	let settled = false;
	const finish = (value) => {
		if (settled) return;
		settled = true;
		observer.disconnect();
		clearTimeout(timer);
		resolve(value);
	};
	const check = () => {
		let value = false;
		try { value = Boolean(${condition}); } catch {}
		if (value) finish(true);
	};
	const observer = new MutationObserver(check);
	observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
	const timer = setTimeout(() => finish(false), ${timeoutMs});
	check();
})`);
const waitForFrame = (condition, timeoutMs = 15000) => evaluate(`new Promise((resolve) => {
	const deadline = performance.now() + ${timeoutMs};
	const tick = () => {
		let value = false;
		try { value = Boolean(${condition}); } catch {}
		if (value) return resolve(true);
		if (performance.now() > deadline) return resolve(false);
		requestAnimationFrame(tick);
	};
	tick();
})`);
const screenshot = async (name) => {
	const result = await send("Page.captureScreenshot", { format: "png" });
	const path = join(out, name);
	await writeFile(path, Buffer.from(result.data, "base64"));
	console.log(`SCREENSHOT ${path}`);
	return path;
};
const KEY_CODES = { Digit5: ["5", 53], KeyZ: ["z", 90] };
const press = async (code, { ctrl = false } = {}) => {
	const [key, windowsVirtualKeyCode] = KEY_CODES[code];
	const modifiers = ctrl ? 2 : 0;
	await evaluate("document.activeElement?.blur?.()");
	await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key, windowsVirtualKeyCode, modifiers });
	await send("Input.dispatchKeyEvent", { type: "keyUp", code, key, windowsVirtualKeyCode, modifiers });
};
const click = (selector) => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`);
const mode = () => evaluate("document.querySelector('[data-workflow-mode]')?.dataset.workflowMode ?? null");
const record = (id) => evaluate(`(() => { const row = (window.__cozyclay?.objects ?? []).find((object) => object.id === ${JSON.stringify(id)}); return row ? { x: row.x, y: row.y, z: row.z, rot: row.rot, renderer: row.renderer } : null; })()`);
const pastDepth = () => evaluate("window.__sceneHistory?.().past ?? null");
// The render-level truth of the isolated view: which scene objects have meshes
// on the sculpt layer, and whether a camera that sees only that layer exists.
const sculptLayerExpr = `(() => {
	let root = window.__cozyclay?.editorCam;
	while (root?.parent) root = root.parent;
	if (!root?.isScene) return null;
	const onLayer = {};
	let cameras = 0;
	root.traverse((node) => {
		if (node.isCamera && node.layers.mask === ${1 << SCULPT_LAYER}) cameras += 1;
		const id = node.userData?.sceneObjectId;
		if (!id) return;
		let on = false;
		node.traverse((child) => { if (child.isMesh && child.layers.isEnabled(${SCULPT_LAYER})) on = true; });
		onLayer[id] = Boolean(onLayer[id] || on);
	});
	return { onLayer, cameras };
})()`;
const near = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 1e-6;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let failures = 0;
const expect = (name, condition, detail = "") => {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
};

await reload();
expect("the editor opens", await waitFor("!document.querySelector('.v2-start-screen') && !!document.querySelector('.timeline') && !!window.__cozyclay?.runStudioAction", 30000));

// A bystander object: it must drop out of the sculpt camera's picture.
const cubeId = await evaluate("window.__cozyclay.sceneObject.place({ kind: 'cube', x: 1.5, z: 0 }).id");
expect("a bystander cube is placed", Boolean(cubeId) && await waitForFrame(`(window.__cozyclay.objects ?? []).some((object) => object.id === ${JSON.stringify(cubeId)})`), String(cubeId));

// --- 5 opens Sculpt mode, empty ---------------------------------------------
await press("Digit5");
expect("key 5 enters Sculpt mode", await waitFor("document.querySelector('[data-workflow-mode]')?.dataset.workflowMode === 'sculpt'"), await mode());
expect("the Sculpt panel renders", await waitFor("!!document.querySelector('[data-testid=sculpt-panel]')"));
expect("the reference drop zone is empty", await waitFor("!!document.querySelector('[data-testid=sculpt-dropzone]') && !document.querySelector('[data-testid=sculpt-reference]')"));
expect("the viewport shows the new-sculpt hint", await waitFor("!!document.querySelector('[data-testid=sculpt-empty]')"));
expect("Place in scene is disabled with no sculpt", await evaluate("document.querySelector('[data-testid=sculpt-place]')?.disabled === true"));
await screenshot("sculpt-mode-01-empty.png");

// --- A sculpt through the editor bus, then targeted by selection -------------
const depthBeforeSculpt = await pastDepth();
const sculptId = await evaluate(`(() => {
	const receipt = window.__cozyclay.runStudioAction("object.sculpt", { recipe: ${JSON.stringify(recipe)}, name: "QA Snorlax" });
	return receipt?.affectedIds?.[0] ?? null;
})()`);
expect("object.sculpt creates the fixture sculpt", Boolean(sculptId), await evaluate("document.querySelector('[role=status]')?.textContent ?? ''"));
expect("the sculpt is a sculpt record", await waitForFrame(`(window.__cozyclay.objects ?? []).find((object) => object.id === ${JSON.stringify(sculptId)})?.renderer === "sculpt"`));
expect("object.sculpt is one undo step", (await pastDepth()) === depthBeforeSculpt + 1, `${depthBeforeSculpt} -> ${await pastDepth()}`);
await evaluate(`window.__cozyclay.runStudioAction("view.select", { selection: { kind: "object", id: ${JSON.stringify(sculptId)} } })`);
expect("selecting the sculpt retargets the turntable", await waitFor("!document.querySelector('[data-testid=sculpt-empty]') && document.querySelector('[data-testid=sculpt-place]')?.disabled === false"));
expect("selection keeps Sculpt mode", (await mode()) === "sculpt", await mode());

// --- Isolation, read from the rendered scene graph ---------------------------
const isolated = await waitForFrame(`(() => {
	const layer = ${sculptLayerExpr};
	return layer && layer.cameras >= 1 && layer.onLayer[${JSON.stringify(sculptId)}] === true && layer.onLayer[${JSON.stringify(cubeId)}] === false;
})()`);
const layerState = await evaluate(sculptLayerExpr);
expect("a sculpt camera sees only the sculpt layer", (layerState?.cameras ?? 0) >= 1, JSON.stringify(layerState));
expect("only the sculpt is on the sculpt layer", isolated && Object.entries(layerState?.onLayer ?? {}).every(([id, on]) => on === (id === sculptId)), JSON.stringify(layerState));
await screenshot("sculpt-mode-02-isolated.png");

// --- Place in scene ----------------------------------------------------------
const before = await record(sculptId);
const depthBeforePlace = await pastDepth();
expect("Place in scene is clickable", await click("[data-testid=sculpt-place]"));
expect("Place in scene returns to Stage", await waitFor("document.querySelector('[data-workflow-mode]')?.dataset.workflowMode === 'scene'"), await mode());
expect("the sculpt is selected", await waitFor(`document.querySelector('.hierarchy-row-wrap.selected')?.dataset.nodeId === ${JSON.stringify(`object:${sculptId}`)}`), await evaluate("document.querySelector('.hierarchy-row-wrap.selected')?.dataset.nodeId ?? null"));
expect("the sculpt is still in the scene", await waitForFrame(`(window.__cozyclay.objects ?? []).some((object) => object.id === ${JSON.stringify(sculptId)})`));
const placed = await record(sculptId);
expect("the sculpt stands on the ground", near(placed?.y, 0), JSON.stringify(placed));
expect("the sculpt moved in front of the scene camera", !(near(placed?.x, before?.x) && near(placed?.z, before?.z)), `${JSON.stringify(before)} -> ${JSON.stringify(placed)}`);
expect("Place in scene is one undo step", (await pastDepth()) === depthBeforePlace + 1, `${depthBeforePlace} -> ${await pastDepth()}`);
const stageLayer = await waitForFrame(`(() => { const layer = ${sculptLayerExpr}; return layer && layer.cameras === 0 && !Object.values(layer.onLayer).some(Boolean); })()`);
expect("leaving Sculpt mode takes the sculpt layer off", stageLayer, JSON.stringify(await evaluate(sculptLayerExpr)));
await screenshot("sculpt-mode-03-placed.png");

// --- Undo restores the previous placement -------------------------------------
await press("KeyZ", { ctrl: true });
const restored = await waitForFrame(`(() => { const row = (window.__cozyclay.objects ?? []).find((object) => object.id === ${JSON.stringify(sculptId)}); return row && Math.abs(row.x - ${before?.x ?? 0}) < 1e-6 && Math.abs(row.z - ${before?.z ?? 0}) < 1e-6 && Math.abs((row.y ?? 0) - ${before?.y ?? 0}) < 1e-6; })()`);
expect("undo restores the previous placement", restored, `${JSON.stringify(before)} vs ${JSON.stringify(await record(sculptId))}`);
expect("undo keeps the sculpt", (await record(sculptId))?.renderer === "sculpt");
expect("undo steps back one entry", (await pastDepth()) === depthBeforePlace, `${depthBeforePlace} vs ${await pastDepth()}`);
await screenshot("sculpt-mode-04-undo.png");

ws.close();
if (failures > 0) {
	console.error(`\n${failures} sculpt-mode check(s) failed`);
	process.exit(1);
}
console.log("\nAll sculpt-mode checks passed");
