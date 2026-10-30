#!/usr/bin/env node
// Browser QA for take v3 persistence: compile a walk through the real Studio action, export
// the project, clear the take, open the export again and reload the page; each time the take
// must replay with the same rendered bones. Undo/redo of the compile is checked as well.
//
// QA_URL=http://127.0.0.1:5193/app/ CDP_PORT=9336 npm run qa:browser -- node test/qa-take-v3-persist-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { skeletonFor } from "../src/motion3/rigs/index.js";

const port = Number(process.env.CDP_PORT || 9222);
const out = process.env.QA_OUT || "/tmp/cozyclay3-take-persist";
await mkdir(out, { recursive: true });
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map(), pageErrors = [];
ws.onmessage = event => {
	const m = JSON.parse(event.data);
	if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
	if (!m.id || !pending.has(m.id)) return;
	const item = pending.get(m.id); pending.delete(m.id);
	if (m.error) item.reject(new Error(JSON.stringify(m.error))); else item.resolve(m.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
	const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
	return r.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (expression, ms = 60_000) => {
	for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await evaluate(expression).catch(() => false)) return true; await sleep(250); }
	return false;
};
await send("Runtime.enable");
await send("Page.enable");

const ready = "Boolean(window.__cozyclay?.rigA && window.__cozyclay.runStudioAction && window.__cozyclayProject?.export)";
assert.ok(await waitFor(ready), "Studio never exposed a rig");
const exportProject = () => evaluate("window.__cozyclayProject.export('take-v3-persist')");
const firstCharacter = doc => {
	const find = node => { if (!node || typeof node !== "object") return null; if (Array.isArray(node.characters) && node.characters[0]?.model) return node.characters[0];
		for (const v of Object.values(node)) { const hit = find(v); if (hit) return hit; } return null; };
	return find(doc);
};
let doc = await exportProject();
while (typeof doc === "string") doc = JSON.parse(doc);
const first = firstCharacter(doc);
assert.ok(first, "no character in the open scene");
const act = (id, args) => evaluate(`(async () => { const r = await window.__cozyclay.runStudioAction(${JSON.stringify(id)}, ${JSON.stringify(args)}); return r && { ok: r.ok, receiptId: r.receiptId ?? null, output: r.output ?? null }; })()`);
const sk = skeletonFor(first.model), I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
const [x, y, z] = [first.x ?? 0, first.y ?? 0, first.z ?? 0];
const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 140,
	keys: [{ f: 0, set: { root: [x, y + P[I.Hips][1] - 0.01, z], yaw: 0, foot_l: [x + 0.09, y + ank, z - 0.03], foot_r: [x - 0.09, y + ank, z + 0.03], fyaw_l: 0, fyaw_r: 0 } }],
	generators: [{ type: "walk", f0: 6, steps: 4, heading: [0, 30] }] };
const compiled = await act("motion.compile", { characterId: first.id, spec });
assert.ok(compiled?.ok, "motion.compile was refused");
const hasTake = "window.__cozyclay.motion?.schema === 'cozyclay.take.v3'";
assert.ok(await waitFor(hasTake, 20_000), "the take never became the visible motion");

const BONES = ["Hips", "LeftFoot", "RightHand", "Head"], FRAMES = [0, 50, 100, 139];
async function rendered() {
	const rows = {};
	for (const f of FRAMES) {
		await evaluate(`window.__cozyclay.setFrame(${f})`);
		await waitFor(`window.__cozyclay.tlFrame === ${f}`, 5000);
		await sleep(150);
		rows[f] = await evaluate(`(() => { const rig = window.__cozyclay.rigA, out = {}, v = rig.position.clone();
			for (const name of ${JSON.stringify(BONES)}) { let hit = null; rig.traverse(o => { if (!hit && o.isBone && o.name.replace(/^mixamorig:?/, '') === name) hit = o; }); out[name] = hit ? hit.getWorldPosition(v.clone()).toArray() : null; }
			return out; })()`);
	}
	return rows;
}
const worstDrift = (a, b) => Math.max(...FRAMES.flatMap(f => BONES.map(n => Math.hypot(...a[f][n].map((v, i) => v - b[f][n][i])))));
const baseline = await rendered();
assert.ok(Math.hypot(baseline[139].Hips[0] - baseline[0].Hips[0], baseline[139].Hips[2] - baseline[0].Hips[2]) > 1, "the walk should travel a metre or more");

// Undo removes the take; redo brings the same one back.
assert.ok((await act("edit.undo", {}))?.ok, "undo refused");
assert.ok(await waitFor(`!(${hasTake})`, 10_000), "undo left the take installed");
assert.ok((await act("edit.redo", {}))?.ok, "redo refused");
assert.ok(await waitFor(hasTake, 10_000), "redo did not restore the take");
const redone = await rendered();
console.log(`undo/redo: worst bone drift ${(worstDrift(redone, baseline) * 100).toFixed(3)} cm`);
assert.ok(worstDrift(redone, baseline) < 0.001, "redo changed the bones");

// The export carries the source (spec), never the baked arrays.
let saved = await exportProject();
const raw = saved;
while (typeof saved === "string") saved = JSON.parse(saved);
const savedTake = firstCharacter(saved).motionTake;
assert.equal(savedTake?.schema, "cozyclay.take.v3", "the export has no motionTake");
assert.equal(JSON.stringify(savedTake.spec), JSON.stringify(spec), "the export keeps the spec as compiled");
console.log(`export: motionTake ${JSON.stringify(savedTake).length} bytes`);

// Clear, then open the export again.
assert.ok((await act("motion.clear", { characterId: first.id }))?.ok, "motion.clear refused");
assert.ok(await waitFor(`!(${hasTake})`, 10_000), "motion.clear left the take");
const opened = await evaluate(`window.__cozyclayProject.open(${JSON.stringify(raw)}).then(r => r?.ok ?? r)`);
assert.ok(opened, "project open refused");
assert.ok(await waitFor(`${ready} && ${hasTake}`, 30_000), "the opened project has no take v3");
const reopened = await rendered();
console.log(`open: worst bone drift ${(worstDrift(reopened, baseline) * 100).toFixed(3)} cm`);
assert.ok(worstDrift(reopened, baseline) < 0.001, "the opened take does not replay the same bones");

// A page reload restores the autosaved session with the take.
await sleep(2500);
await send("Page.reload");
await sleep(1000);
assert.ok(await waitFor(`${ready} && ${hasTake}`, 60_000), "the reloaded session has no take v3");
const reloaded = await rendered();
console.log(`reload: worst bone drift ${(worstDrift(reloaded, baseline) * 100).toFixed(3)} cm`);
assert.ok(worstDrift(reloaded, baseline) < 0.001, "the reloaded take does not replay the same bones");
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(`${out}/reloaded-frame-139.png`, Buffer.from(shot.data, "base64"));
assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
console.log(`PASS take v3 survives undo/redo, export -> open and reload; page errors ${pageErrors.length}; screenshot ${out}/reloaded-frame-139.png`);
ws.close();
