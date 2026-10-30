#!/usr/bin/env node
// Browser QA for the scene revision a motion install answers: the receipt's
// revision.after must be the revision the scene settles at, so the next write
// in the same agent script, admitted at revision.after, never meets STALE_SCENE.
// A longer take must still grow the timeline to fit it.
//
// COZYCLAY_LIVE_PORT=6017 npm run dev -- --port 5197
// COZYCLAY_LIVE_PORT=6017 QA_URL=http://127.0.0.1:5197/app/ CDP_PORT=9317 node tools/qa-browser.mjs -- node test/motion3/qa-motion3-revision-browser.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectController, discoverEndpoint } from "../../bin/live/client.mjs";
import { skeletonFor } from "../../src/motion3/rigs/index.js";

const cdpPort = Number(process.env.CDP_PORT || 9222), livePort = Number(process.env.COZYCLAY_LIVE_PORT || 5184);
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === "page" && t.webSocketDebuggerUrl).webSocketDebuggerUrl);
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
const waitFor = async (probe, ms = 60_000) => {
	for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) if (await probe().catch(() => false)) return true;
	return false;
};
await send("Runtime.enable");
assert.ok(await waitFor(() => evaluate("Boolean(window.__cozyclay?.rigA && window.__cozyclay.runStudioAction)")), "Studio never exposed a rig");

// The agent's door: the live hub, admitted with an explicit host and expectedRevision.
const controller = await connectController(discoverEndpoint(livePort));
let handle = null;
assert.ok(await waitFor(async () => (handle = (await controller.request({ type: "status" })).value?.editors?.[0]?.handle)), "no editor joined the live hub");
const command = async (name, args, timeoutMs = 30_000) => {
	const reply = await controller.request({ type: "cmd", name, args, workspaceHandle: handle, timeoutMs }, { timeoutMs });
	assert.equal(reply.ok, true, JSON.stringify(reply.error));
	return reply.value;
};
const inspect = () => command("inspect_studio", { scope: "selection" });
const action = async (id, args, expectedRevision, timeoutMs = 120_000) => {
	const { host } = await inspect();
	return command("run_action", { name: "run_action", args: { action: id, args }, commandId: randomUUID(), host, expectedRevision }, timeoutMs);
};
// Settled: the revision stops moving once React's effects after the commit have run.
const settledRevision = async () => {
	let last = (await inspect()).revision.scene;
	for (let still = 0; still < 6; await sleep(250)) { const now = (await inspect()).revision.scene; still = now === last ? still + 1 : 0; last = now; }
	return last;
};

const first = await evaluate(`(async () => {
	let doc = await window.__cozyclayProject.export();
	while (typeof doc === "string") doc = JSON.parse(doc);
	const find = node => { if (!node || typeof node !== "object") return null; if (Array.isArray(node.characters) && node.characters[0]?.model) return node.characters[0];
		for (const v of Object.values(node)) { const hit = find(v); if (hit) return hit; } return null; };
	const c = find(doc); return c && { id: c.id, model: c.model };
})()`);
assert.ok(first, "no character in the open scene");
const sk = skeletonFor(first.model), I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
const spec = frames => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames,
	keys: [{ f: 0, set: { root: [0, P[I.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.09, ank, -0.03], foot_r: [-0.09, ank, 0.03], fyaw_l: 0, fyaw_r: 0, armw_r: 0 } }],
	generators: [{ type: "walk", f0: 6, steps: 5, heading: [0, 35] }] });
const compile = (frames, expectedRevision) => action("motion.compile", { characterId: first.id, spec: spec(frames) }, expectedRevision);

const start = await settledRevision();
const timeline0 = await evaluate("window.__cozyclay.frameCount");
const r1 = await compile(150, start);
assert.equal(r1.ok, true, `first install refused: ${JSON.stringify(r1).slice(0, 400)}`);
const settled1 = await settledRevision();
console.log("install 1", JSON.stringify({ before: r1.revision.before, after: r1.revision.after, settled: settled1, timeline: await evaluate("window.__cozyclay.frameCount") }));
assert.equal(settled1, r1.revision.after, "the scene revision moved again after the install's receipt");

// The longer take the same script installs next, admitted at the receipt's revision.
const longer = Math.max(timeline0, 150) + 72;
const r2 = await compile(longer, r1.revision.after);
assert.notEqual(r2.code, "STALE_SCENE", "the second install met STALE_SCENE at the first receipt's revision.after");
assert.equal(r2.ok, true, `second install refused: ${JSON.stringify(r2).slice(0, 400)}`);
const settled2 = await settledRevision(), timeline2 = await evaluate("window.__cozyclay.frameCount");
console.log("install 2", JSON.stringify({ before: r2.revision.before, after: r2.revision.after, settled: settled2, timeline: timeline2, take: longer }));
assert.equal(settled2, r2.revision.after, "the scene revision moved again after the second install's receipt");
assert.ok(timeline2 >= longer, `the timeline (${timeline2}) does not fit the ${longer}-frame take`);

// A third write admitted at revision.after closes the loop, and a measurement admits at a stale one where it is declared readOnly.
const r3 = await action("character.move", { characterId: first.id, x: 0.25 }, r2.revision.after);
assert.equal(r3.ok, true, `write after install refused: ${JSON.stringify(r3).slice(0, 300)}`);
const qaRow = (await command("inspect_studio", { scope: "actions", ids: ["motion.qa"] })).actions?.[0];
if (qaRow?.readOnly) {
	const measured = await action("motion.qa", { characterId: first.id }, start);
	assert.equal(measured.ok, true, `readOnly motion.qa refused at a stale revision: ${JSON.stringify(measured).slice(0, 300)}`);
	console.log("motion.qa at a stale revision: ok");
} else console.log("motion.qa is not declared readOnly in this build; stale-revision read skipped");
assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
console.log("PASS install receipts answer the settled revision");
controller.close(); ws.close();
