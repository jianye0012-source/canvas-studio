#!/usr/bin/env node
// Browser QA for grab/release on a group: the left hand grabs the cup group (an Empty with its
// body and handle) off the table and lifts it. The compiled take holds one track, on the group
// root; the renderer draws the parts riding it, so the cup body's world position rises while the
// table stays put.
//
// QA_URL=http://127.0.0.1:5193/app/ CDP_PORT=9313 node tools/qa-browser.mjs -- node test/motion3/qa-motion3-grab-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.env.CDP_PORT || 9222);
const out = process.env.QA_OUT || "/tmp/cozyclay3-grab";
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
const waitFor = async (expression, ms = 60_000) => {
	for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await evaluate(expression).catch(() => false)) return true; await new Promise(r => setTimeout(r, 250)); }
	return false;
};
await send("Runtime.enable");

assert.ok(await waitFor("Boolean(window.__cozyclay?.rigA && window.__cozyclay.runStudioAction)"), "Studio never exposed a rig");
const first = await evaluate(`(async () => {
	let doc = await window.__cozyclayProject.export();
	while (typeof doc === "string") doc = JSON.parse(doc);
	const find = node => { if (!node || typeof node !== "object") return null; if (Array.isArray(node.characters) && node.characters[0]?.model) return node.characters[0];
		for (const v of Object.values(node)) { const hit = find(v); if (hit) return hit; } return null; };
	const c = find(doc); return c && { id: c.id, model: c.model, x: c.x ?? 0, z: c.z ?? 0 };
})()`);
const act = (id, args) => evaluate(`(async () => { const r = await window.__cozyclay.runStudioAction(${JSON.stringify(id)}, ${JSON.stringify(args)}); return r && { ok: r.ok, affectedIds: r.affectedIds, output: r.output ?? null, error: r.error ?? null }; })()`);

// The cup scene (test/motion3/fixtures/cup-scene.mjs), in front of the character.
const ids = {};
async function add(kind, name, parent, set) {
	const added = await act("object.add", { kind, name, ...(parent ? { parent: ids[parent] } : {}), placement: { x: set.x, z: set.z } });
	assert.ok(added?.ok, `could not add ${name}: ${JSON.stringify(added)}`);
	ids[name] = added.affectedIds[0];
	const updated = await act("object.update", { id: ids[name], patch: set });
	assert.ok(updated?.ok, `could not place ${name}: ${JSON.stringify(updated)}`);
}
await add("empty", "Table", null, { x: 0, y: 0, z: 1 });
await add("cube", "Table Top", "Table", { x: 0, y: 0.71, z: 1, scaleX: 1.2, scaleY: 0.04, scaleZ: 0.8 });
await add("empty", "Cup", "Table", { x: 0.2, y: 0.75, z: 0.85 });
await add("cylinder", "Cup Body", "Cup", { x: 0.2, y: 0.75, z: 0.85, scaleX: 0.08, scaleY: 0.1, scaleZ: 0.08 });
await add("cube", "Cup Handle", "Cup", { x: 0.268, y: 0.77, z: 0.85, scaleX: 0.012, scaleY: 0.06, scaleZ: 0.015 });

const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 100,
	use: [{ skill: "standIdle", args: { at: [0.15, 0.3], heading: 0 }, f0: 0 }],
	props: { grip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: { fingers: [0, 0, 0] } } },
	anchors: { cupHandle: { kind: "object", object: ids["Cup Handle"], local: [0, 0.03, 0] } },
	fits: [{ side: "l", anchor: "cupHandle", effector: { prop: "grip", point: "fingers" } }],
	keys: [{ f: 10, set: { pitch: 0, armw_l: 0, w_cupHandle_l: 0 } }, { f: 30, set: { pitch: 25, armw_l: 1, w_cupHandle_l: 1, hand_l: [0.3, 1, 0.7] } },
		{ f: 36, set: { w_cupHandle_l: 1, pitch: 25, hand_l: [0.3, 1, 0.7] } }, { f: 60, set: { w_cupHandle_l: 0, pitch: 10, hand_l: [0.3, 1.2, 0.6] } }, { f: 99, set: {} }],
	objects: { [ids.Cup]: { prop: "grip", grab: 34, release: 80 } } };
const compiled = await act("motion.compile", { characterId: first.id, spec });
console.log("compile", JSON.stringify(compiled?.output ?? compiled?.error).slice(0, 400));
assert.ok(compiled?.ok, "motion.compile refused");

const world = async f => {
	await evaluate(`window.__cozyclay.setFrame(${f})`);
	const body = JSON.stringify(ids["Cup Body"]);
	assert.ok(await waitFor(`window.__cclayPropWorld?.[${body}]?.frame === ${f}`, 5000), `cup body not drawn at frame ${f}`);
	const w = await evaluate(`Object.fromEntries(${JSON.stringify(Object.entries(ids))}.map(([n, id]) => [n, window.__cclayPropWorld[id] ?? null]))`);
	const shot = await send("Page.captureScreenshot", { format: "png" });
	await writeFile(`${out}/grab-${String(f).padStart(3, "0")}.png`, Buffer.from(shot.data, "base64"));
	return w;
};
const at0 = await world(0), at70 = await world(70), at90 = await world(90);
for (const [f, w] of [[0, at0], [70, at70], [90, at90]]) console.log(`frame ${f}: ${Object.entries(w).map(([n, p]) => `${n} y ${p?.y?.toFixed(3)}`).join(", ")}`);
const rise = n => at70[n].y - at0[n].y;
assert.ok(Math.abs(at0["Cup Body"].y - 0.75) < 1e-3, `the cup body starts on the table (y ${at0["Cup Body"].y})`);
assert.ok(rise("Cup Body") >= 0.1, `the cup body rose only ${rise("Cup Body")} m`);
assert.ok(rise("Cup Handle") >= 0.1 && rise("Cup") >= 0.1, "the handle and the Empty marker rise with the group");
assert.ok(Math.abs(rise("Table Top")) < 1e-6 && Math.abs(rise("Table")) < 1e-6, "the table stays put");
assert.ok(Math.abs(at90["Cup Body"].y - at70["Cup Body"].y) < 0.2 && at90["Cup Body"].y > at0["Cup Body"].y + 0.1, "after release the cup stays where the hand let go");
assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
console.log(`PASS the grabbed cup group rises ${rise("Cup Body").toFixed(3)} m on the renderer`);
ws.close();
