// Measured, not judged (output.observations.near): how close each hand and foot comes to the scene
// objects. A hand is its palm and its five fingertips, a foot its sole (geometry.js solePoints);
// every scene body is a box at its pose that frame (object-pose.js: carried, hinged or still).
// Per frame the nearest body within FAR m names its top group (the object) and the body (the
// part); consecutive frames near the same object make a run, and the RUNS closest runs are kept,
// in frame order. gap is the signed distance to the box (sdBox), < 0 inside. No run: nothing
// within FAR m. A hand is not measured against what it carries (it is on it), and a follow
// record (it rides the body) is none of these objects.
// Why: a hand meant to strum floated 20 cm in front of a guitar with QA clean (session df388a9b),
// and a toe went 4 cm into a stair's edge during a swing (session e7edb718); no other answer said so.
import { sdBox, solePoints } from "./geometry.js";
import { objectPoseAt, handOf } from "../object-pose.js";
import { isFollow } from "../carried.js";
import { add, apply, dist, len, scale } from "../compiler/math.js";

const FAR = 0.3, RUNS = 2, TIPS = ["Thumb4", "Index4", "Middle4", "Ring4", "Pinky4"];
const r3 = v => Math.round(v * 1000) / 1000;

export const NEAR_UNITS = "near: hand (palm, fingertips), foot (sole) to the nearest object within 0.3 m (top group; part: the body at the closest frame), 2 closest runs; gap [min, f, max, f] m, < 0 inside"

/** The effector points of a solved pose s: { hand_l, hand_r, foot_l, foot_r } -> [point, ...]. */
function effectorPoints(sk, s) {
	const I = sk.index, out = {};
	for (const [S, k] of [["Left", "l"], ["Right", "r"]]) {
		const palm = scale(add(s.P[I[`${S}Hand`]], s.P[I[`${S}HandMiddle1`]]), 0.5);
		out[`hand_${k}`] = [palm, ...TIPS.map(t => s.P[I[`${S}Hand${t}`]]).filter(Boolean)];
		out[`foot_${k}`] = Object.values(solePoints(sk, s, S));
	}
	return out;
}

/** True while a spec.objects entry over body `id` (its own or a group's) hides it at absolute frame f. */
const hiddenAt = (out, id, f) => [id, ...(out.ctx.scene.objects[id].ancestors ?? [])]
	.some(k => { const o = out.ctx.spec.objects?.[k]; return o?.visible && !((out.baked?.[o.visible]?.[f] ?? 0) > 0.5); });

/** The scene bodies at absolute frame f as boxes with their top group, the hand carrying them and a bounding sphere; follow records left out. */
function boxesAt(out, f) {
	const { scene, spec } = out.ctx, boxes = [];
	for (const [id, o] of Object.entries(scene?.objects ?? {})) {
		const up = o.ancestors ?? [];
		if ([id, ...up].some(k => isFollow(spec.objects?.[k])) || hiddenAt(out, id, f)) continue;
		const pose = objectPoseAt(out, id, f);
		if (!pose) continue;
		const box = { pos: pose.pos, R: pose.R, half: o.half };
		boxes.push({ id, root: up[up.length - 1] ?? id, hand: handOf(out, id, f), box, c: add(box.pos, apply(box.R, [0, o.half[1], 0])), r: len(o.half) });
	}
	return boxes;
}

/** Nearest box to a point set: [root, part, gap] within FAR, else null; the boxes hand `side` carries are left out. */
function nearest(points, boxes, side) {
	const c = scale(points.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / points.length), spread = Math.max(...points.map(p => dist(p, c)));
	let best = null;
	for (const b of boxes) {
		if (side && b.hand === side) continue;
		if (dist(c, b.c) - b.r - spread > (best ? best[2] : FAR)) continue;
		const gap = Math.min(...points.map(p => sdBox(p, b.box)));
		if (gap <= FAR && (!best || gap < best[2])) best = [b.root, b.id, gap];
	}
	return best;
}

/** Runs of frames with the same nearest object -> the RUNS closest, in frame order. */
function runsOf(rows, f0) {
	const runs = [];
	rows.forEach((row, i) => {
		const last = runs[runs.length - 1];
		if (!row) return;
		const [root, part, gap] = row, f = i + f0;
		if (last && last.object === root && last.frames[1] === f - 1) {
			last.frames[1] = f;
			if (gap < last.gap[0]) { last.gap[0] = gap; last.gap[1] = f; last.part = part; }
			if (gap > last.gap[2]) { last.gap[2] = gap; last.gap[3] = f; }
		} else runs.push({ object: root, part, frames: [f, f], gap: [gap, f, gap, f] });
	});
	return runs.sort((a, b) => a.gap[0] - b.gap[0]).slice(0, RUNS).sort((a, b) => a.frames[0] - b.frames[0])
		.map(({ object, part, frames, gap }) => ({ object, ...(part !== object ? { part } : {}), frames, gap: [r3(gap[0]), gap[1], r3(gap[2]), gap[3]] }));
}

/**
 * observeNear(sk, out) -> { hand_l?, hand_r?, foot_l?, foot_r? } (null when nothing is within FAR m
 * of any of them, or the scene has no bodies). Frames are absolute (out.f0 added).
 */
export function observeNear(sk, out) {
	if (!Object.keys(out.ctx.scene?.objects ?? {}).length) return null;
	const f0 = out.f0 ?? 0, rows = { hand_l: [], hand_r: [], foot_l: [], foot_r: [] };
	out.frames.forEach(({ s }, i) => {
		const f = i + f0, boxes = boxesAt(out, f), pts = effectorPoints(sk, s);
		for (const k of Object.keys(rows)) {
			// a hand is on what it carries: measure it against everything else
			rows[k].push(nearest(pts[k], boxes, k.startsWith("hand_") ? k.slice(-1) : null));
		}
	});
	const near = Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, runsOf(r, f0)]).filter(([, r]) => r.length));
	return Object.keys(near).length ? near : null;
}
