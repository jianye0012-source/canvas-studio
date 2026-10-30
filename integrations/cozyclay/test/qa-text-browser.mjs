#!/usr/bin/env node
// Browser QA for the text object (src/text/): one object.add puts "CozyClay" on the side of a
// box, flat; the same words stand solid beside it; Korean words stand flat. Every picture is
// the shot render the agent's captures use. Each text adds pixels inside its own measured box.
//
// Run: `COZYCLAY_LIVE_PORT=6153 node tools/dev-full.mjs --host 127.0.0.1 --port 5313` in one
// shell, then `QA_URL=http://127.0.0.1:5313/app/ CDP_PORT=9513 node tools/qa-browser.mjs -- node test/qa-text-browser.mjs`
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const cdpPort = Number(process.env.CDP_PORT || 9222), theme = process.env.QA_THEME || "light";
const out = process.env.QA_OUT || "/tmp/cozyclay-text-qa";
await mkdir(out, { recursive: true });
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("/app/")) ?? targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), pageErrors = [];
ws.onmessage = (event) => {
	const m = JSON.parse(event.data);
	if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
	if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
	const r = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;
	if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
	return r?.result?.value;
};
const waitFor = async (label, expression, ms = 60000) => {
	for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await evaluate(expression).catch(() => false)) return; await new Promise((r) => setTimeout(r, 250)); }
	throw new Error(`timed out waiting for ${label}`);
};
await send("Runtime.enable");
await evaluate(`localStorage.setItem("cozyclay.theme.v1", ${JSON.stringify(theme)}); location.reload()`);
await new Promise((r) => setTimeout(r, 1500));
await waitFor("the studio QA hook", "Boolean(window.__cozyclay?.runStudioAction && window.__cozyclay.captureFraming)");

const act = (id, args) => evaluate(`(async () => { const r = await window.__cozyclay.runStudioAction(${JSON.stringify(id)}, ${JSON.stringify(args)}); return r && { ok: r.ok !== false, affectedIds: r.affectedIds, message: r.message }; })()`);
const aim = (pos, at, fovDeg) => {
	const d = [at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]];
	return { pos: { x: pos[0], y: pos[1], z: pos[2] }, yaw: Math.atan2(-d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), fovDeg };
};
const capture = (framing) => evaluate(`(async () => {
	await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))));
	return window.__cozyclay.captureFraming(${JSON.stringify(framing)});
})()`);
/** Pixels that differ between two captures: how many, and their bounding box. */
const diff = (shown, hidden) => evaluate(`(async () => {
	const pixels = async (url) => { const image = new Image(); image.src = url; await image.decode(); const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
		const g = c.getContext("2d"); g.drawImage(image, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
	const [a, b] = await Promise.all([pixels(${JSON.stringify(shown)}), pixels(${JSON.stringify(hidden)})]);
	let count = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
	for (let i = 0; i < a.data.length; i += 4) {
		if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) < 9) continue;
		const x = (i / 4) % a.width, y = Math.floor(i / 4 / a.width);
		count += 1; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
	}
	return { count, box: count ? [minX, minY, maxX, maxY] : null };
})()`);

const ids = await evaluate("window.__cozyclay.objects.map((o) => o.id)");
if (ids.length) assert.ok((await act("object.remove", { ids })).ok, "clear the set");
// a cargo box 4 m long (along z), 2 m tall, its +x side at x = 1
const box = await act("object.add", { kind: "cube", name: "Cargo box", placement: { x: 0, z: 0 } });
assert.ok(box.ok, box.message);
assert.ok((await act("object.update", { id: box.affectedIds[0], patch: { scaleX: 2, scaleY: 2, scaleZ: 4, color: "#8aa1b1" } })).ok);
// one action: the words on the box's +x side, 5 mm off the face, facing +x (rot 90)
const logo = await act("object.add", { kind: "text", name: "Logo", text: { value: "CozyClay", size: 0.5 }, placement: { x: 1.005, y: 0.7, z: 0, rot: 90 } });
assert.ok(logo.ok, logo.message);
const solid = await act("object.add", { kind: "text", name: "Solid", text: { value: "CozyClay", size: 0.35, depth: 0.08 }, placement: { x: 2.2, y: 0, z: 1.2, rot: 90 } });
assert.ok(solid.ok, solid.message);
const korean = await act("object.add", { kind: "text", name: "Korean", text: { value: "코지클레이\n프리비즈", size: 0.25, align: "left" }, placement: { x: 2.2, y: 0, z: -1.4, rot: 90 } });
assert.ok(korean.ok, korean.message);
const rows = await evaluate("window.__cozyclay.objects.filter((o) => o.renderer === 'text').map((o) => ({ id: o.id, name: o.name, text: o.text, footprint: o.footprint, height: o.height }))");
const report = { theme, texts: rows };

const framing = aim([7.5, 1.6, 0], [1, 1, 0], 45);
const all = await capture(framing);
await writeFile(`${out}/text-all.png`, Buffer.from(all.split(",")[1], "base64"));
for (const [name, added] of [["logo", logo], ["solid", solid], ["korean", korean]]) {
	const id = added.affectedIds[0];
	await act("object.update", { id, patch: { hidden: true } });
	const hidden = await capture(framing);
	await act("object.update", { id, patch: { hidden: false } });
	report[name] = await diff(all, hidden);
	assert.ok(report[name].count > 2000, `${name} draws pixels (${report[name].count})`);
}
// a close-up of the logo on the box side
const close = await capture(aim([4.2, 1.1, 0], [1, 0.95, 0], 40));
await writeFile(`${out}/text-logo.png`, Buffer.from(close.split(",")[1], "base64"));
// the words change in place and the box follows them
const logoId = logo.affectedIds[0];
assert.ok((await act("object.set", { ops: [{ id: logoId, set: { text: { value: "CozyClay Studio" } } }] })).ok);
report.longer = await evaluate(`window.__cozyclay.objects.find((o) => o.id === ${JSON.stringify(logoId)}).footprint`);
assert.ok(report.longer.width > rows.find((r) => r.id === logoId).footprint.width);
report.pageErrors = pageErrors;
assert.deepEqual(pageErrors, []);
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();
