#!/usr/bin/env node
// Browser QA for the held-object gizmo. A bat (an upright cylinder record, 0.84 m) is carried
// lying down by the right hand of a compiled take. Selected, its gizmo must stand on the bat the
// renderer draws: the gizmo pivot within a few pixels of the bat's projected centre at three
// frames. Then a move drag on the held bat previews live, and on release keys its motion
// (motion.keyObject): the take recompiles, the bat stays where it was put and the hand follows.
// The end-to-end part needs motion.keyObject (lane J2); without it the run prints SKIP for that
// part, unless QA_REQUIRE_KEYOBJECT=1.
//
// QA_URL=http://127.0.0.1:5221/app/ CDP_PORT=9371 node tools/qa-browser.mjs -- node test/motion3/qa-motion3-held-gizmo-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.env.CDP_PORT || 9222);
const out = process.env.QA_OUT || "/tmp/cozyclay3-held-gizmo";
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
	for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await evaluate(expression).catch(() => false)) return true; await sleep(200); }
	return false;
};
const shot = async name => writeFile(`${out}/${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1, buttons: type === "mouseReleased" ? 0 : 1 });
const key = async code => {
	await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: code.slice(3).toLowerCase() });
	await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: code.slice(3).toLowerCase() });
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
const act = (id, args) => evaluate(`(async () => { const r = await window.__cozyclay.runStudioAction(${JSON.stringify(id)}, ${JSON.stringify(args)}); return r && { ok: r.ok, affectedIds: r.affectedIds, output: r.output ?? null }; })()`);

// The bat: an upright 0.84 m cylinder record, authored off to the side.
const added = await act("object.add", { kind: "cylinder", name: "Bat", placement: { x: 1.2, z: 1.2 } });
assert.ok(added?.ok, `could not add the bat: ${JSON.stringify(added)}`);
const bat = added.affectedIds[0];
assert.ok((await act("object.update", { id: bat, patch: { y: 0, scaleX: 0.06, scaleY: 0.84, scaleZ: 0.06 } }))?.ok, "could not size the bat");
// A door on a hinge at its edge, keyed on the "door" channel.
const doorAdded = await act("object.add", { kind: "cube", name: "Door", placement: { x: -1.2, z: 0.6 } });
assert.ok(doorAdded?.ok, "could not add the door");
const door = doorAdded.affectedIds[0];
assert.ok((await act("object.update", { id: door, patch: { y: 0, scaleX: 0.05, scaleY: 1.2, scaleZ: 0.9 } }))?.ok, "could not size the door");

// Carried by the right hand from frame 0, its length along the palm's lateral axis (lying down).
const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 96,
	use: [{ skill: "standIdle", args: { at: [first.x, first.z], heading: 0 }, f0: 0 }],
	props: { bat: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { grip: [0, 0, 0] } } },
	keys: [{ f: 0, set: { armw_r: 1, hand_r: [-0.35, 1.05, 0.35], door: 0 } }, { f: 40, set: { armw_r: 1, hand_r: [-0.15, 1.45, 0.3] } }, { f: 80, set: { armw_r: 1, hand_r: [0.1, 1.15, 0.3] } }, { f: 95, set: {} }],
	objects: { [bat]: { prop: "bat", at: [0, 0, 0], along: [0, 1, 0] }, [door]: { pivot: [-1.2, 0, 1.05], axis: [0, 1, 0], channel: "door" } } };
const compiled = await act("motion.compile", { characterId: first.id, spec });
console.log("compile", JSON.stringify(compiled?.output?.qa ?? compiled).slice(0, 300));
assert.ok(compiled?.ok, "motion.compile refused");

// Select the bat, editor view, rotate tool (its rings all sit on the gizmo pivot).
const selected = await act("view.select", { selection: { kind: "object", id: bat } });
assert.ok(selected?.ok, `could not select the bat: ${JSON.stringify(selected)}`);
assert.ok(await waitFor("(window.__gizmoHandles?.().length ?? 0) > 0", 10_000), "no gizmo on the selected bat");
await evaluate("document.activeElement?.blur?.()");
await key("KeyE");
assert.ok(await waitFor("window.__gizmoHandles().some(h => h.axis === 'screen')", 5000), "the rotate tool did not come up");

/** The gizmo pivot and the drawn bat's centre, both in screen pixels, at frame f. */
const measure = async f => {
	await evaluate(`window.__cozyclay.setFrame(${f})`);
	const id = JSON.stringify(bat);
	assert.ok(await waitFor(`window.__cclayPropWorld?.[${id}]?.frame === ${f} && window.__heldGizmo?.id === ${id}`, 5000), `bat not drawn at frame ${f}`);
	await sleep(150);
	return evaluate(`(() => {
		const handles = window.__gizmoHandles();
		const pivot = handles.find(h => h.axis === "x");
		const cam = window.__cozyclay.activeCam, w = window.__cclayPropWorld[${id}];
		const rect = document.querySelector(".vp-main").getBoundingClientRect();
		const q = cam.quaternion.clone().set(w.quat.x, w.quat.y, w.quat.z, w.quat.w);
		const centre = cam.position.clone().set(0, 0.42, 0).applyQuaternion(q).add(cam.position.clone().set(w.x, w.y, w.z));
		const world = centre.toArray();
		cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
		const ndc = centre.project(cam);
		const screen = { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
		const old = cam.position.clone().set(w.x, w.y + 0.42, w.z).project(cam);
		return { pivot, screen, world, gizmoWorld: window.__heldGizmo.pose.centre, kind: window.__heldGizmo.kind, picked: window.__objectPick(pivot.x, pivot.y),
			oldScreen: { x: rect.left + (old.x + 1) / 2 * rect.width, y: rect.top + (1 - old.y) / 2 * rect.height } };
	})()`);
};
for (const f of [10, 40, 75]) {
	const m = await measure(f);
	await shot(`placement-${f}`);
	const px = Math.hypot(m.pivot.x - m.screen.x, m.pivot.y - m.screen.y);
	const oldPx = Math.hypot(m.oldScreen.x - m.screen.x, m.oldScreen.y - m.screen.y);
	const worldGap = Math.hypot(...m.world.map((v, i) => v - m.gizmoWorld[i]));
	console.log(`frame ${f}: gizmo (${m.pivot.x.toFixed(1)}, ${m.pivot.y.toFixed(1)}) bat centre (${m.screen.x.toFixed(1)}, ${m.screen.y.toFixed(1)}) -> ${px.toFixed(2)} px; world gap ${(worldGap * 1000).toFixed(2)} mm; old placement ${oldPx.toFixed(1)} px off; kind ${m.kind}; pick at pivot ${m.picked}`);
	assert.ok(px <= 3, `frame ${f}: the gizmo is ${px.toFixed(2)} px from the bat's projected centre`);
	assert.ok(worldGap < 0.002, `frame ${f}: the gizmo is ${worldGap} m from the bat centre`);
	assert.equal(m.kind, "held", `frame ${f}: the bat is in hand`);
}

// (b) The rotate rings turn the bat about its own centre and axes: grab the bat's own X ring,
// swing it, and the preview turns the bat while its centre stays put. Escape cancels the drag.
const F = 40;
await measure(F);
/** A screen point on the gizmo's own `axis` ring (the rings face the object's own axes). */
const ringPoint = axis => evaluate(`(() => {
	const cam = window.__cozyclay.activeCam, pose = window.__heldGizmo.pose, rect = document.querySelector(".vp-main").getBoundingClientRect();
	const centre = cam.position.clone().fromArray(pose.centre), q = cam.quaternion.clone().fromArray(pose.quat);
	const scale = Math.max(0.35, cam.position.distanceTo(centre) * 0.16) * 0.52;
	const local = t => ${JSON.stringify(axis)} === "x" ? [0, Math.cos(t), Math.sin(t)] : ${JSON.stringify(axis)} === "y" ? [Math.cos(t), 0, Math.sin(t)] : [Math.cos(t), Math.sin(t), 0];
	for (let a = 0; a < 360; a += 10) {
		const p = cam.position.clone().set(...local(a * Math.PI / 180)).multiplyScalar(scale).applyQuaternion(q).add(centre).project(cam);
		const x = rect.left + (p.x + 1) / 2 * rect.width, y = rect.top + (1 - p.y) / 2 * rect.height;
		if (window.__gizmoPick(x, y) === ${JSON.stringify(axis)}) return { x, y };
	}
	return null;
})()`);
const ring = await ringPoint("x");
assert.ok(ring, "no screen point picks the bat's own X ring");
const turnStart = await evaluate("structuredClone(window.__heldGizmo.pose)");
await mouse("mouseMoved", ring.x, ring.y);
await mouse("mousePressed", ring.x, ring.y);
for (let step = 1; step <= 6; step++) await mouse("mouseMoved", ring.x + step * 8, ring.y + step * 8);
await sleep(200);
const turning = await evaluate("structuredClone(window.__heldGizmo.pose)");
await shot("rotate-preview");
const centreDrift = Math.hypot(...turning.centre.map((v, i) => v - turnStart.centre[i]));
const turned = 2 * Math.acos(Math.min(1, Math.abs(turning.quat.reduce((s, v, i) => s + v * turnStart.quat[i], 0)))) * 180 / Math.PI;
console.log(`rotate preview: turned ${turned.toFixed(1)} deg, centre drift ${(centreDrift * 1000).toFixed(2)} mm`);
assert.ok(turned >= 5, "the ring drag did not turn the bat");
assert.ok(centreDrift < 0.002, "the bat turned about some other point than its centre");
await key("Escape");
await sleep(200);
const cancelled = await evaluate("structuredClone(window.__heldGizmo.pose)");
assert.ok(Math.hypot(...cancelled.quat.map((v, i) => v - turnStart.quat[i])) < 1e-6, "Escape did not drop the preview");
await mouse("mouseReleased", ring.x + 48, ring.y + 48);

// Move drag on the held bat: up the Y arrow. The bat previews live, then the release keys it.
await key("KeyW");
assert.ok(await waitFor("window.__gizmoHandles().some(h => h.axis === 'y') && !window.__gizmoHandles().some(h => h.axis === 'screen')", 5000), "the move tool did not come up");
await measure(F);
const id = JSON.stringify(bat);
const before = await evaluate(`({ bat: { ...window.__cclayPropWorld[${id}] }, centre: window.__heldGizmo.pose.centre })`);
const sample = async () => (await act("motion.sample", { characterId: first.id, frames: [F], bones: ["RightHand"] }))?.output?.frames?.[0]?.bones?.RightHand;
const handBefore = await sample();
const y = (await evaluate("window.__gizmoHandles()")).find(h => h.axis === "y");
await mouse("mouseMoved", y.x, y.y);
await mouse("mousePressed", y.x, y.y);
for (let step = 1; step <= 8; step++) await mouse("mouseMoved", y.x, y.y - step * 10);
await sleep(200);
const during = await evaluate(`({ ...window.__cclayPropWorld[${id}] })`);
await shot("drag-preview");
console.log(`drag preview: bat y ${before.bat.y.toFixed(3)} -> ${during.y.toFixed(3)}`);
assert.ok(during.y - before.bat.y > 0.05, `the bat did not follow the drag live (${before.bat.y} -> ${during.y})`);
await mouse("mouseReleased", y.x, y.y - 80);
const keyed = await waitFor(`(window.__cozyclay.motion?.spec?.objects?.[${id}]?.keys?.length ?? 0) > 0`, 15_000);
if (!keyed) {
	const skip = "SKIP end-to-end: no held-object key landed in the take (motion.keyObject from lane J2 is not available)";
	if (process.env.QA_REQUIRE_KEYOBJECT === "1") assert.fail(skip);
	console.log(skip);
} else {
	await evaluate(`window.__cozyclay.setFrame(${F + 1})`); await sleep(200);
	await measure(F);
	const after = await evaluate(`({ bat: { ...window.__cclayPropWorld[${id}] }, centre: window.__heldGizmo.pose.centre, keys: window.__cozyclay.motion.spec.objects[${id}].keys })`);
	const handAfter = await sample();
	await shot("after-key");
	const rise = after.bat.y - before.bat.y, handRise = handAfter[1] - handBefore[1];
	console.log(`keyed ${JSON.stringify(after.keys)}; bat rose ${rise.toFixed(3)} m (preview ${(during.y - before.bat.y).toFixed(3)}), hand rose ${handRise.toFixed(3)} m`);
	const gap = Math.hypot(after.bat.x - during.x, after.bat.y - during.y, after.bat.z - during.z);
	console.log(`keyed bat vs released preview: ${(gap * 1000).toFixed(1)} mm`);
	assert.ok(gap < 0.01, "the bat stays where the drag put it after the recompile");
	assert.ok(handRise > 0.05, "the hand follows the keyed bat");
}

// The hinged door: its own Y ring turns it about the hinge, and the release keys the angle.
if (keyed) {
	const H = 30, did = JSON.stringify(door);
	assert.ok((await act("view.select", { selection: { kind: "object", id: door } }))?.ok, "could not select the door");
	await evaluate(`window.__cozyclay.setFrame(${H})`);
	assert.ok(await waitFor(`window.__heldGizmo?.id === ${did} && window.__cclayPropWorld?.[${did}]?.frame === ${H}`, 5000), "the door gizmo is not on the drawn door");
	await key("KeyE");
	assert.ok(await waitFor("window.__gizmoHandles().some(h => h.axis === 'screen')", 5000), "the rotate tool did not come up");
	await sleep(200);
	assert.equal(await evaluate("window.__heldGizmo.kind"), "hinge");
	const yawOf = w => 2 * Math.atan2(w.quat.y, w.quat.w) * 180 / Math.PI;
	const doorBefore = await evaluate(`({ ...window.__cclayPropWorld[${did}] })`);
	const yRing = await ringPoint("y");
	assert.ok(yRing, "no screen point picks the door's Y ring");
	await mouse("mouseMoved", yRing.x, yRing.y);
	await mouse("mousePressed", yRing.x, yRing.y);
	for (let step = 1; step <= 6; step++) await mouse("mouseMoved", yRing.x + step * 12, yRing.y - step * 4);
	await sleep(200);
	const doorDuring = await evaluate(`({ ...window.__cclayPropWorld[${did}] })`);
	await mouse("mouseReleased", yRing.x + 72, yRing.y - 24);
	const doorKeyed = await waitFor(`(window.__cozyclay.motion?.spec?.keys ?? []).some(k => k.f === ${H} && k.set && "door" in k.set)`, 15_000);
	assert.ok(doorKeyed, "the door drag did not key the door channel");
	await evaluate(`window.__cozyclay.setFrame(${H + 1})`); await sleep(200);
	await evaluate(`window.__cozyclay.setFrame(${H})`);
	await waitFor(`window.__cclayPropWorld?.[${did}]?.frame === ${H}`, 5000); await sleep(200);
	const doorAfter = await evaluate(`({ ...window.__cclayPropWorld[${did}] })`);
	const angle = await evaluate(`window.__cozyclay.motion.spec.keys.find(k => k.f === ${H} && "door" in k.set).set.door`);
	await shot("door-after-key");
	const radius = w => Math.hypot(w.x + 1.2, w.z - 1.05);
	console.log(`door: yaw ${yawOf(doorBefore).toFixed(1)} -> preview ${yawOf(doorDuring).toFixed(1)} -> keyed ${yawOf(doorAfter).toFixed(1)} deg (door = ${angle}); hinge radius ${radius(doorAfter).toFixed(3)} m`);
	assert.ok(Math.abs(yawOf(doorDuring) - yawOf(doorBefore)) >= 5, "the ring drag did not turn the door");
	assert.ok(Math.abs(yawOf(doorAfter) - yawOf(doorDuring)) < 0.5, "the keyed door is not where the drag put it");
	assert.ok(Math.abs(radius(doorAfter) - 0.45) < 0.005, "the door left its hinge");
}
assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
console.log(`PASS the held bat's gizmo sits on the drawn bat at three frames; a drag previews live${keyed ? ", keys the bat (the hand follows) and keys the door hinge" : ""}`);
ws.close();
