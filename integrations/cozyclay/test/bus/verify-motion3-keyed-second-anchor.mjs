#!/usr/bin/env node
// The second hand on a keyed carry through an object anchor (barbell session 02263581, calls 7 and 10): the right
// hand carries a bar whose keys lift it and the left hand reachGrips an object anchor on the same bar. The keyed
// carry's grab offset (object-keys.js attach) solves the grab frame without the keys, and the left hand's anchor
// read the bar there through that same offset: the compile overflowed the stack. While the grab frame is solved
// the bar is where the offset puts it (its scene pose), so the left hand rides the bar like any object anchor;
// and a chain of object reads that still loops is refused as a spec error, not a stack overflow.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { refPoint } from "../../src/motion3/refs.js";
import { objectPoseAt } from "../../src/motion3/object-pose.js";
import { objectFrame } from "../../src/motion3/compiler/anchors.js";
import { add, apply, dist } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const refusal = run => { try { run(); return ""; } catch (error) { return `${error.name}: ${error.message}`; } };

const rec = (id, renderer, x, y, z, s, extra = {}) => ({ id, name: id, renderer, x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX: s[0], scaleY: s[1], scaleZ: s[2], footprint: { width: 1, depth: 1 }, height: 1, ...extra });
// A bar (an Empty with a shaft and two plates) at chest height in front of the character.
const RECORDS = [
	rec("bar", "empty", 0, 1.0, 0.45, [1, 1, 1], { footprint: { width: 0, depth: 0 }, height: 0 }),
	rec("shaft", "cube", 0, 1.0, 0.45, [1.2, 0.03, 0.03], { parent: "bar" }),
	rec("plateL", "cube", 0.5, 0.85, 0.45, [0.03, 0.3, 0.3], { parent: "bar" }),
	rec("plateR", "cube", -0.5, 0.85, 0.45, [0.03, 0.3, 0.3], { parent: "bar" }),
];
const sk = skeletonFor("y-bot-tpose"), scene = motionScene(RECORDS), Q = [0, 0, 0, 1];
const LEFT = [0.22, 0.015, 0], RIGHT = [-0.22, 0.015, 0];
const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 70,
	anchors: { lHold: { kind: "object", object: "bar", local: LEFT }, rHold: { kind: "object", object: "bar", local: RIGHT } },
	keys: [{ f: 0, set: { root: [0, 0.98, 0] } }],
	use: [{ skill: "reachGrip", f0: 0, args: { anchor: "rHold", side: "r", reach: 10, hold: 50 } },
		{ skill: "reachGrip", f0: 0, args: { anchor: "lHold", side: "l", reach: 10, hold: 50 } }],
	objects: { bar: { prop: "rHoldGrip", grab: 12, release: 60, keys: [{ f: 12, pos: [0, 1.0, 0.45], rot: Q }, { f: 40, pos: [0, 1.2, 0.42], rot: Q }, { f: 60, pos: [0, 1.2, 0.42], rot: Q }] } } };

let r = null;
const thrown = refusal(() => { r = compileSpec(spec, { sk, scene }); });
expect("a keyed carry with the other hand on an object anchor on it compiles (no stack overflow)", !thrown && !!r, thrown);
if (r) {
	const out = r.out, frames = Array.from({ length: out.frames.length }, (_, i) => i + (out.f0 ?? 0)), held = frames.filter(f => f >= 12 && f <= 60);
	const lHoldAt = f => { const p = objectPoseAt(out, "bar", f); return add(p.pos, apply(p.R, LEFT)); };
	const worst = (fs, fn) => Math.max(...fs.map(fn));
	expect("anchor:lHold is the bar point where QA and probes see the bar, every frame (< 1 mm)", worst(frames, f => dist(refPoint(out, f, "anchor:lHold"), lHoldAt(f))) < 1e-3, worst(frames, f => dist(refPoint(out, f, "anchor:lHold"), lHoldAt(f))));
	expect("the bar is lifted (it rides its keys)", lHoldAt(60)[1] - lHoldAt(12)[1] > 0.15, `${lHoldAt(12)} -> ${lHoldAt(60)}`);
	const fingers = f => dist(refPoint(out, f, "prop:lHoldGrip.fingers"), lHoldAt(f));
	expect("the left fingers stay on the lifted bar while it is held (< 3 cm)", worst(held, fingers) < 0.03, worst(held, fingers));
	expect("no REACH for the left arm", !r.qa.groups.some(g => g.kind === "REACH" && /arm_miss_l/.test(g.subject)), JSON.stringify(r.qa.groups.filter(g => g.kind === "REACH").map(g => g.subject)));
}

// A chain of object reads that keeps solving the frame it reads (a loop) is refused, never a stack overflow.
const ctx = { spec: { anchors: {} }, scene, objectsAt: () => ({}), objectHand: () => "r" }, a = { kind: "object", object: "bar", local: [0, 0, 0] };
ctx.objectPose = () => objectFrame(ctx, a, "lHold", { s: null, diag: { frame: 3 }, c: {} }, "l");
const loop = refusal(() => objectFrame(ctx, a, "lHold", { s: null, diag: { frame: 3 }, c: {} }, "l"));
expect("an anchor/carry loop is a MOTION_SPEC_INVALID naming the anchor, not a RangeError", /^Error: MOTION_SPEC_INVALID: anchor "lHold" on "bar" at f3 .*loop/.test(loop), loop);
expect("the refusal leaves no read open", (ctx.nest ?? 0) === 0, ctx.nest);

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("PASS keyed second-hand object anchor");
