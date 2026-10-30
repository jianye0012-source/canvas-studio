// C4. The compiled motion as beats, for the agent (output.timeline) and the beats contact sheet.
// At most 12 entries, ordered by f[0]:
//   { beat: skill name | "walk" | "keys", src: "use[i]" | "generators[i]" | "keys",
//     f: [first, last] (inclusive, absolute frames),
//     end: { root: [x,y,z], yaw, hand_l: [x,y,z], hand_r: [x,y,z], on_l: ref | null, on_r: ref | null },
//     planted: { l: [[f0, f1], ...], r: [...] },   // at most 4 per foot
//     events: [{ f, object, event: "grab" | "release" | "show" | "hide" }] }
// Metres to 3 decimals, degrees to 1. Beats come from the skills expandUse ran (used), the
// generators, and the runs of keys no skill or generator covers; a retime (out.timeMap) moves
// them with the keys. end is the pose at f[1]: root = the Hips joint, hand_* = the wrists,
// on_* = the "object:<id>" that hand holds there (object-pose.js inHandAt), else the
// "anchor:<a>" whose w_<a>_<k> > 0.5 (the largest). planted = the heel or the ball below
// QA_LIMITS.plantH over the ground (the floor or an object's top, qa/ground.js) and still (a foot on its ball, heel up, is planted), for 3 frames or more (the first, the last and the longest others
// when there are more than 4). Events: grab/release when an object enters or leaves a hand,
// show/hide when a visibility channel (a carry's or a switch's `visible`, or any *_vis channel)
// crosses 0.5; `object` is the object id (one event per object the channel shows), or the
// channel's name when no object owns it.
import { QA_LIMITS } from "./qa/checks.js";
import { groundSole } from "./qa/ground.js";
import { inHandAt } from "./object-pose.js";

const MAX_BEATS = 12, PER_FOOT = 4, MIN_PLANT = 3, STILL_Y = 0.0005;
const r3 = v => Math.round(v * 1000) / 1000, r1 = v => Math.round(v * 10) / 10;
const vec = p => p.map(r3);

/** The beats' frame ranges before their poses are read: [{ beat, src, f }]. */
function beatsOf(out, used, spec) {
	const last = out.frameCount - 1, map = out.timeMap ?? (f => f);
	const beats = used.map((u, i) => ({ beat: u.skill, src: `use[${i}]`, f: [u.f0, u.end ?? u.f0] }));
	(spec.generators ?? []).forEach((g, i) => beats.push({ beat: g.type, src: `generators[${i}]`, f: [g.f0, g.f0 + 16 + (g.steps ?? 8) * (g.period ?? 20) + 18] }));
	const covered = f => beats.some(b => f >= b.f[0] && f <= b.f[1]);
	const loose = [...new Set((spec.keys ?? []).map(k => k.f))].filter(f => Number.isFinite(f) && !covered(f)).sort((a, b) => a - b);
	let run = null;
	for (const f of loose) {
		if (run && !beats.some(b => b.src !== "keys" && b.f[1] > run.f[1] && b.f[0] < f)) run.f[1] = f;
		else beats.push(run = { beat: "keys", src: "keys", f: [f, f] });
	}
	const clamp = f => Math.max(0, Math.min(last, Math.round(map(f))));
	for (const b of beats) b.f = [clamp(b.f[0]), clamp(b.f[1])];
	return beats.sort((a, b) => a.f[0] - b.f[0]).slice(0, MAX_BEATS);
}

/** planted[side][f]: the heel or the ball low and still at absolute frame f (false outside the window). */
function plantedFlags(out) {
	const n = out.frameCount, a = out.f0 ?? 0, flags = { l: new Uint8Array(n), r: new Uint8Array(n) };
	for (const [k, S] of [["l", "Left"], ["r", "Right"]]) {
		const sole = out.frames.map((fr, i) => (fr ? groundSole(out, i, S) : null));
		sole.forEach((p, i) => {
			const q = sole[i > 0 ? i - 1 : i + 1];
			if (!p || !q) return;
			const ok = ["heel", "ball"].some(key => p[key][1] < QA_LIMITS.plantH && Math.abs(p[key][1] - q[key][1]) < STILL_Y
				&& Math.hypot(p[key][0] - q[key][0], p[key][2] - q[key][2]) <= QA_LIMITS.slide);
			flags[k][a + i] = ok ? 1 : 0;
		});
	}
	return flags;
}

function plantedIn(flags, [f0, f1]) {
	const runs = [];
	let start = null;
	for (let f = f0; f <= f1 + 1; f++) {
		const on = f <= f1 && flags[f] === 1;
		if (on && start === null) start = f;
		if (!on && start !== null) { if (f - start >= MIN_PLANT) runs.push([start, f - 1]); start = null; }
	}
	if (runs.length <= PER_FOOT) return runs;
	const inner = runs.slice(1, -1).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]) || x[0] - y[0]).slice(0, PER_FOOT - 2);
	return [runs[0], ...inner, runs[runs.length - 1]].sort((x, y) => x[0] - y[0]);
}

/** Every grab/release/show/hide of the take, by absolute frame. */
function eventsOf(out, spec) {
	const n = out.frameCount, events = [], objects = Object.entries(spec.objects ?? {});
	for (const [id, o] of objects) for (let f = 1; f < n; f++) {
		const was = inHandAt(o, f - 1), is = inHandAt(o, f);
		if (is && !was) events.push({ f, object: id, event: "grab" });
		if (was && !is) events.push({ f: f - 1, object: id, event: "release" });
	}
	// every object a channel shows (a carry's or a switch's visible) gets its own event
	const owners = {};
	for (const [id, o] of objects) if (typeof o?.visible === "string") (owners[o.visible] ??= []).push(id);
	for (const ch of new Set([...Object.keys(owners), ...Object.keys(out.baked ?? {}).filter(c => c.endsWith("_vis"))])) {
		const v = out.baked?.[ch];
		if (!v) continue;
		for (let f = 1; f < n; f++) {
			const was = v[f - 1] > 0.5, is = v[f] > 0.5;
			if (was !== is) for (const object of owners[ch] ?? [ch]) events.push({ f, object, event: is ? "show" : "hide" });
		}
	}
	return events.sort((x, y) => x.f - y.f);
}

/** "object:<id>" held by hand k at f, else the "anchor:<a>" with the largest weight > 0.5, else null. */
function onOf(spec, c, k, f) {
	for (const [id, o] of Object.entries(spec.objects ?? {})) if (spec.props?.[o?.prop]?.hand === k && inHandAt(o, f)) return `object:${id}`;
	let best = null, bw = 0.5;
	for (const [ch, w] of Object.entries(c)) {
		const m = /^w_(.+)_([lr])$/.exec(ch);
		if (m && m[2] === k && w > bw) { best = m[1]; bw = w; }
	}
	return best && `anchor:${best}`;
}

function endOf(out, spec, f) {
	const fr = out.frames[f - (out.f0 ?? 0)];
	if (!fr) return null;
	const { s, c } = fr, I = out.ctx.sk.index;
	return { root: vec(s.P[I.Hips]), yaw: r1(c.yaw ?? 0), hand_l: vec(s.P[I.LeftHand]), hand_r: vec(s.P[I.RightHand]),
		on_l: onOf(spec, c, "l", f), on_r: onOf(spec, c, "r", f) };
}

/**
 * timelineOf(out, { used, spec }) -> entries
 * @param {object} out  compileMotion result
 * @param {{ used: { skill: string, f0: number, end: number }[], spec: object }} ctx  used = the
 *   skills expandUse ran, spec = the expanded spec
 * @returns {object[]}
 */
export function timelineOf(out, { used, spec }) {
	const beats = beatsOf(out, used ?? [], spec);
	if (!beats.length) return [];
	const flags = plantedFlags(out), events = eventsOf(out, spec);
	return beats.map(b => ({ ...b, end: endOf(out, spec, b.f[1]),
		planted: { l: plantedIn(flags.l, b.f), r: plantedIn(flags.r, b.f) },
		events: events.filter(e => e.f >= b.f[0] && e.f <= b.f[1]) }));
}
