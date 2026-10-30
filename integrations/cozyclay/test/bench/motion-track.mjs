// The interaction bench's measuring tape (docs/qa/agent-bench.md, S6-S10): a project document the agent
// left behind -> its installed take compiled again in Node (the same compileSpec and motionScene the Studio
// runs), read through the same paths goals and probes read (object-pose.js objectBoxesAt, refs.js
// landmark:mouth, qa/geometry.js sdBox and solePoints). No model opinion enters a measurement.
//
// A track answers per absolute frame f:
//   frames                      the compiled frames, in order
//   hand(f, "l" | "r")          [palm, thumb tip, index tip, middle tip, ring tip, pinky tip]
//   palm(f, side)               the palm (between the wrist and the middle knuckle)
//   sole(f, side)               [heel, ball, tip] on the skin's sole
//   joint(f, bone)              a joint position
//   forward(f)                  the hips' forward direction, flattened to the floor
//   mouth(f)                    the mouth landmark
//   boxes(id, f)                the oriented boxes of a body or a group at f ([{ pos, R, half }], base pivot)
// plus qa (the compile's QA: ok, total, groups) and spec (the installed spec).
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { objectBoxesAt } from "../../src/motion3/object-pose.js";
import { refPoint } from "../../src/motion3/refs.js";
import { sdBox, solePoints } from "../../src/motion3/qa/geometry.js";

const TIPS = ["Thumb4", "Index4", "Middle4", "Ring4", "Pinky4"];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const apply = (R, v) => [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The active scene of a project document (version 4/5 { scenes: { activeSceneId, scenes } } or a bare scene list). */
export function activeScene(doc) {
	const holder = doc?.scenes?.scenes ? doc.scenes : doc;
	const list = holder?.scenes ?? [];
	return list.find(s => s.id === holder.activeSceneId) ?? list[0] ?? null;
}

/** The character that carries an installed v3 take, or null. */
function takeCharacter(scene) {
	return (scene?.stage?.characters ?? []).find(c => c?.motionTake?.schema === "cozyclay.take.v3" && c.motionTake.spec) ?? null;
}

/**
 * doc -> a track over its installed take: { ok: true, ... } or { ok: false, reason } when there is
 * no take or the stored spec no longer compiles.
 */
export function trackOf(doc) {
	const scene = activeScene(doc), character = takeCharacter(scene);
	if (!character) return { ok: false, reason: "no installed take" };
	const sk = skeletonFor(character.motionTake.rig ?? character.model);
	if (!sk) return { ok: false, reason: `no rig for ${character.model}` };
	const objects = scene.objects ?? [];
	let r;
	try {
		r = compileSpec({ fps: 24, ...character.motionTake.spec }, { sk, scene: motionScene(objects) });
	} catch (error) {
		return { ok: false, reason: `the installed spec does not compile: ${String(error.message).slice(0, 300)}` };
	}
	return { ok: true, ...trackFromCompile(r, sk), spec: character.motionTake.spec, character: { id: character.id, x: character.x ?? 0, z: character.z ?? 0, rot: character.rot ?? 0 } };
}

/** A track over a compileSpec result (also used by the tests on hand-written specs). */
function trackFromCompile(r, sk) {
	const out = r.out, f0 = out.f0 ?? 0, I = sk.index;
	const s = f => out.frames[f - f0]?.s;
	const P = (f, bone) => s(f).P[I[bone]];
	const side = k => (k === "l" ? "Left" : "Right");
	const palm = (f, k) => mid(P(f, `${side(k)}Hand`), P(f, `${side(k)}HandMiddle1`));
	return {
		frames: out.frames.map((_, i) => f0 + i),
		qa: { ok: r.qa.ok, total: r.qa.total, groups: r.qa.groups },
		palm,
		hand: (f, k) => [palm(f, k), ...TIPS.map(t => P(f, `${side(k)}Hand${t}`)).filter(Boolean)],
		sole: (f, k) => Object.values(solePoints(sk, s(f), side(k))),
		joint: (f, bone) => P(f, bone),
		forward: f => { const v = apply(s(f).R[I.Hips], [0, 0, 1]), l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; },
		mouth: f => refPoint(out, f, "landmark:mouth"),
		boxes: (id, f) => objectBoxesAt(out, id, f) ?? [],
	};
}

// ---- primitives over boxes and points ------------------------------------------------------

/** Signed metres from point p to the nearest box (negative inside); Infinity with no boxes. */
const gap = (p, boxes) => boxes.reduce((m, b) => Math.min(m, sdBox(p, b)), Infinity);

/** The smallest gap from any of points to any of boxes. */
export const minGap = (points, boxes) => points.reduce((m, p) => Math.min(m, gap(p, boxes)), Infinity);

/** World AABB of boxes: { lo, hi }. */
function aabb(boxes) {
	const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
	for (const b of boxes) for (const x of [-1, 1]) for (const y of [0, 2]) for (const z of [-1, 1]) {
		const p = add(b.pos, apply(b.R, [x * b.half[0], y * b.half[1], z * b.half[2]]));
		for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
	}
	return { lo, hi };
}

/** The bottom-centre, top-centre and centre of boxes (as refs.js object:<id>.base / .top / .center). */
export function anchorPoints(boxes) {
	const { lo, hi } = aabb(boxes), c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
	return { base: [c[0], lo[1], c[2]], top: [c[0], hi[1], c[2]], center: c, lo, hi };
}

/** The eight corners of every box. */
export function corners(boxes) {
	return boxes.flatMap(b => [-1, 1].flatMap(x => [0, 2].flatMap(y => [-1, 1].map(z => add(b.pos, apply(b.R, [x * b.half[0], y * b.half[1], z * b.half[2]]))))));
}

/** Degrees between the X axes of two box rotations about the vertical (a hinge's opening). */
export function yawBetween(Ra, Rb) {
	const a = [Ra[0][0], Ra[2][0]], b = [Rb[0][0], Rb[2][0]];
	const d = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
	return Math.abs(d * 180 / Math.PI);
}

// ---- events over a track ------------------------------------------------------------------

/** The first frame of the track (from frame `from` on) where pred holds, or null. */
export function firstFrame(t, pred, from = -Infinity) {
	for (const f of t.frames) if (f >= from && pred(f)) return f;
	return null;
}

/** The smallest value of fn over the track's frames: { value, frame }. */
export function minOver(t, fn, frames = t.frames) {
	let best = { value: Infinity, frame: null };
	for (const f of frames) { const v = fn(f); if (v < best.value) best = { value: v, frame: f }; }
	return best;
}

/** The longest run of consecutive frames (from `from` on) where pred holds: { length, first }. */
export function longestRun(t, pred, from = -Infinity) {
	let best = { length: 0, first: null }, run = 0, start = null;
	for (const f of t.frames) {
		if (f >= from && pred(f)) { if (!run) start = f; run++; if (run > best.length) best = { length: run, first: start }; } else run = 0;
	}
	return best;
}

/** Displacement (m) of the base of `id` at frame f from where it is on the track's first frame. */
export function baseShift(t, id, f) {
	const a = anchorPoints(t.boxes(id, t.frames[0])).base, b = anchorPoints(t.boxes(id, f)).base;
	return dist(a, b);
}

/** Both hands' points. */
export const hands = (t, f) => [...t.hand(f, "l"), ...t.hand(f, "r")];

/** Both feet's sole points. */
export const soles = (t, f) => [...t.sole(f, "l"), ...t.sole(f, "r")];

/** How deep (m, positive inside) the deepest of points goes into boxes. */
export const depthInto = (points, boxes) => Math.max(0, -minGap(points, boxes));

const r3 = v => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);

/** One assertion result row. */
export const result = (id, kind, text, pass, value = null, frame = null, note = "") => ({ id, kind, text, pass: !!pass, value: r3(value), frame, ...(note ? { note } : {}) });
