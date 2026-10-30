// C11. What a beats contact sheet shows and what a trace plots, read from one compile of the
// installed take (pipeline.js compileSpec: out, qa, timeline, the expanded spec). Pure; see
// docs/motion-api-v3.1.md C11. Frames are absolute timeline frames (a whole compile has f0 = 0).
import { refPoint, refDistance } from "./refs.js";

const NEAR = 3, MAX_SERIES = 6;
export const TRACE_COLORS = ["#d1495b", "#2e86ab", "#edae49", "#66a182", "#a06cd5", "#f28f3b"];
const round3 = v => Math.round(v * 1000) / 1000;

/** Grab and release frames: the timeline's events (lane C), then the spec.objects grab/release
 * fields (C3), so a take still shows them when the timeline lists no event. */
export function grabReleases(timeline = [], objects = {}) {
	const rows = [];
	for (const entry of timeline) for (const e of entry.events ?? []) if (e.event === "grab" || e.event === "release") rows.push({ f: e.f, why: `${e.event} ${e.object}` });
	for (const [id, o] of Object.entries(objects ?? {})) for (const event of ["grab", "release"]) if (Number.isFinite(o?.[event])) rows.push({ f: o[event], why: `${event} ${id}` });
	return rows.sort((a, b) => a.f - b.f);
}

/**
 * Up to `count` frames inside [lo, hi], in this order: grab and release frames, beat starts
 * (timeline f[0]), the worstFrame of the top 2 QA groups (qa.groups is ranked), then even fill:
 * the `even` frames, then any frame, each time the one farthest from the frames picked so far.
 * A frame within +-3 of a pick is dropped. Deterministic; answers { frames, picks: [{ f, why }] },
 * ascending. With nothing to read it answers the even frames.
 */
export function beatFrames({ range: [lo, hi], even = [], timeline = [], groups = [], objects = {}, count = 6 }) {
	const picks = [], gap = f => picks.reduce((d, p) => Math.min(d, Math.abs(p.f - f)), Infinity);
	const offer = (f, why) => {
		if (!Number.isFinite(f)) return;
		f = Math.round(f);
		if (picks.length < count && f >= lo && f <= hi && gap(f) > NEAR) picks.push({ f, why });
	};
	for (const row of grabReleases(timeline, objects)) offer(row.f, row.why);
	for (const entry of timeline) offer(entry.f?.[0], `start ${entry.beat}`);
	for (const g of groups.slice(0, 2)) offer(g.worstFrame, `worst ${g.kind} ${String(g.subject).split(": ")[0]}`);
	const every = Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);
	for (const pool of [even.filter(f => f >= lo && f <= hi), every]) {
		while (picks.length < count) {
			let best = null, far = NEAR;
			for (const f of pool) { const d = gap(f); if (d > far) { best = f; far = d; } }
			if (best === null) break;
			picks.push({ f: best, why: "even" });
		}
	}
	picks.sort((a, b) => a.f - b.f);
	return { frames: picks.map(p => p.f), picks };
}

/** What a trace plots: both hand heights, the distance of every `near` goal and every distance
 * probe the spec carries, and each carried object's prop origin to the object's surface. */
function traceDefs(spec = {}) {
	const defs = [
		{ name: "hand_l.y", at: (out, f) => refPoint(out, f, "joint:LeftHand")?.[1] },
		{ name: "hand_r.y", at: (out, f) => refPoint(out, f, "joint:RightHand")?.[1] },
	];
	const pair = (name, [a, b]) => defs.push({ name, at: (out, f) => refDistance(out, f, a, b) });
	(spec.goals ?? []).forEach((g, i) => { if (Array.isArray(g?.near)) pair(`near ${g.name ?? `goals[${i}]`}`, g.near); });
	(spec.probes ?? []).forEach((p, i) => { if (Array.isArray(p?.distance)) pair(p.name ?? `probes[${i}]`, p.distance); });
	for (const [id, o] of Object.entries(spec.objects ?? {})) if (typeof o?.prop === "string") pair(`${o.prop} to ${id}`, [`prop:${o.prop}.origin`, `object:${id}`]);
	return defs.slice(0, MAX_SERIES);
}

/**
 * Series over absolute frames lo..hi (clamped to the compiled frames): { name, color, unit,
 * min, minAt, max, maxAt, values } with values[i] the value at frame lo + i, or null. A series
 * with no value anywhere is left out.
 */
export function traceSeries(out, spec, [lo, hi]) {
	const f0 = out.f0 ?? 0, last = Math.min(hi, f0 + out.frames.length - 1), first = Math.max(lo, f0), series = [];
	for (const def of traceDefs(spec)) {
		const values = [];
		let min = Infinity, minAt = null, max = -Infinity, maxAt = null;
		for (let f = first; f <= last; f++) {
			const raw = def.at(out, f), v = Number.isFinite(raw) ? round3(raw) : null;
			values.push(v);
			if (v === null) continue;
			if (v < min) { min = v; minAt = f; }
			if (v > max) { max = v; maxAt = f; }
		}
		if (minAt !== null) series.push({ name: def.name, color: TRACE_COLORS[series.length], unit: "m", min, minAt, max, maxAt, values });
	}
	return { range: [first, last], series };
}
