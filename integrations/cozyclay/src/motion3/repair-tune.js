// C6. Repair's second move: a QA group just past its limit that carries no patch. Its cause names
// what made it, and a skill arg or a key time maps to the geometry too indirectly for a hint to
// predict (in the cup take, firstStep -1 cm cleared a thigh hit but a 5.04 cm/f^2 pop appeared;
// step did nothing). A compile is cheap, so repair tries a few small changes instead and keeps
// the best (repair.js), like an automatic { range } that stays near the agent's value:
//   cause "... use[i] <skill> ..."          each arg in SKILL_INFO[skill].tune, 1 then 2 steps
//                                             either way, from the arg as sent or its default
//   SPEED/ACC/POP "between keys[a] fA and keys[b] fB" (the agent's keys)
//                                             key a 1 or 2 frames earlier, key b later
//   GOAL up to 10 cm short (with or without a patch): where the body stands at the worst frame,
//                                             1 then 2 steps either way: the agent's root keys
//                                             there (x, z), else the last standIdle/walkTo before
//                                             it (SKILL_INFO[skill].place); then the lean, the
//                                             spine_pitch of the agent's keys around it (5 deg)
//   WRIST (qa/wrist-checks.js) at the worst frame: a lean there (a spine_pitch key 10, 20 or 30 deg
//                                             forward of the lean before it, or 10 back, eased back to it 12
//                                             frames either side when no lean key is nearer), then the lean
//                                             keys around it 5 or 10 deg either way; which move frees
//                                             a held wrist depends on the elbow path the hold plans, so it is
//                                             compiled (on bench S6 the body's floor steps only made it worse)
//                                             ; none when fix.self's elbow turn bent it (cause "fix.self ..."): a lean
//                                             does not undo the turn (car exit: 21 compiles, 20 s, 57 -> 51 deg)
// Every candidate is a JSON Patch on the agent's spec; the order is fixed, so the search is
// deterministic. Least-change candidates come first, so a tie keeps the smaller edit.
import { excessOf } from "./qa/severity.js";
import { SKILL_INFO } from "./skills/info.js";

const NEAR = 0.5, STEPS = [-1, 1, -2, 2], PLACE_MAX = 0.1, LEAN = 5;
const isNum = x => typeof x === "number" && Number.isFinite(x);

/** A group no more than half its limit (or 5 mm, for small limits) past it. */
const nearLimit = g => excessOf(g) <= NEAR * Math.max(Math.abs(g.limit), 0.01);

/** use[i] <skill>: one patch per tune arg and step, smallest steps first. */
function skillCandidates(cause, spec) {
	const m = /\buse\[(\d+)\] (\w+)/.exec(cause), i = Number(m?.[1]), u = m && spec.use?.[i];
	const info = m && u?.skill === m[2] ? SKILL_INFO[u.skill] : null;
	if (!info?.tune) return [];
	const out = [];
	for (const n of [1, 2]) for (const [arg, step] of Object.entries(info.tune)) {
		const schema = info.args[arg] ?? {}, now = u.args?.[arg] ?? schema.default;
		if (!isNum(now)) continue;
		for (const sg of STEPS.filter(s => Math.abs(s) === n)) {
			const raw = now + sg * step, value = schema.type === "integer" ? Math.round(raw) : Math.round(raw * 1e4) / 1e4;
			if (!(value > 0) || value === now) continue;
			out.push(u.args ? [{ op: u.args[arg] === undefined ? "add" : "replace", path: `/use/${i}/args/${arg}`, value }]
				: [{ op: "add", path: `/use/${i}/args`, value: { [arg]: value } }]);
		}
	}
	return out;
}

/** SPEED/ACC/POP between two of the agent's keys: more frames between them, 1 then 2. */
function keyCandidates(g, cause, spec) {
	if (!["SPEED", "ACC", "POP"].includes(g.kind)) return [];
	const m = /between keys\[(\d+)\] f(\d+) and keys\[(\d+)\] f(\d+)/.exec(cause);
	if (!m) return [];
	const [a, fa, b, fb] = m.slice(1).map(Number), keys = spec.keys ?? [];
	if (keys[a]?.f !== fa || keys[b]?.f !== fb) return [];
	const last = Number.isInteger(spec.frames) ? spec.frames - 1 : Infinity, out = [];
	for (const n of [1, 2]) {
		if (fa - n >= 0) out.push([{ op: "replace", path: `/keys/${a}/f`, value: fa - n }]);
		if (fb + n <= last) out.push([{ op: "replace", path: `/keys/${b}/f`, value: fb + n }]);
	}
	return out;
}

const round4 = v => Math.round(v * 1e4) / 1e4;

/** One step (n = 1 or 2, either way) of what places the body at frame f, then of the lean. */
function placeSteps(spec, f, n) {
	const keys = spec.keys ?? [], out = [];
	const skill = (spec.use ?? []).map((u, i) => ({ u, i })).filter(({ u }) => (u?.skill === "standIdle" || u?.skill === "walkTo") && u.f0 <= f).sort((a, b) => a.u.f0 - b.u.f0).at(-1);
	const roots = keys.map((k, j) => ({ k, j })).filter(({ k }) => Array.isArray(k?.set?.root) && k.set.root.length === 3 && isNum(k.f) && k.f > (skill?.u.f0 ?? -1));
	if (roots.some(({ k }) => k.f <= f)) {
		for (const axis of [0, 2]) for (const sg of [-n, n]) out.push(roots.map(({ k, j }) => ({ op: "replace", path: `/keys/${j}/set/root`, value: k.set.root.map((v, a) => (a === axis ? round4(v + sg * 0.03) : v)) })));
	} else if (skill) {
		const { u, i } = skill, place = SKILL_INFO[u.skill].place ?? {}, steps = u.args?.steps ?? 8;
		for (const [arg, step] of Object.entries(place)) {
			if (arg === "step" && steps <= 2) continue;
			const now = u.args?.[arg] ?? SKILL_INFO[u.skill].args[arg]?.default;
			const set = value => [u.args ? { op: u.args[arg] === undefined ? "add" : "replace", path: `/use/${i}/args/${arg}`, value } : { op: "add", path: `/use/${i}/args`, value: { [arg]: value } }];
			if (Array.isArray(now)) for (const axis of [0, now.length - 1]) for (const sg of [-n, n]) out.push(set(now.map((v, a) => (a === axis ? round4(v + sg * step) : v))));
			else if (isNum(now)) for (const sg of [-n, n]) if (now + sg * step > 0.05) out.push(set(round4(now + sg * step)));
		}
	}
	const pitched = keys.map((k, j) => ({ f: k?.f, j })).filter(({ j }) => isNum(keys[j]?.set?.spine_pitch) && isNum(keys[j].f)).sort((a, b) => a.f - b.f);
	const lean = [pitched.filter(p => p.f <= f).at(-1), pitched.find(p => p.f > f)].filter(Boolean).map(p => p.j);
	for (const sg of lean.length ? [n, -n] : []) out.push(lean.map(j => ({ op: "replace", path: `/keys/${j}/set/spine_pitch`, value: keys[j].set.spine_pitch + sg * LEAN })));
	return out;
}

const LEANS = [10, 20, 30, -10], EASE = 12;

/** WRIST: a spine_pitch key at f that leans the upper body by d from the lean before it, eased back over EASE frames where no lean key is nearer. */
function leanSteps(spec, f) {
	const keys = spec.keys ?? [], at = Math.round(f), last = Number.isInteger(spec.frames) ? spec.frames - 1 : Infinity;
	const pitched = keys.filter(k => isNum(k?.f) && isNum(k?.set?.spine_pitch)).sort((a, b) => a.f - b.f);
	const prev = pitched.filter(k => k.f < at).at(-1), next = pitched.find(k => k.f > at), base = prev?.set.spine_pitch ?? 0;
	const same = keys.findIndex(k => k?.f === at && k.set && typeof k.set === "object");
	return LEANS.map(d => {
		const value = base + d, ops = [same >= 0 ? { op: keys[same].set.spine_pitch === undefined ? "add" : "replace", path: `/keys/${same}/set/spine_pitch`, value } : { op: "add", path: "/keys/-", value: { f: at, set: { spine_pitch: value } } }];
		if ((!prev || at - prev.f > EASE) && at - EASE >= 0) ops.push({ op: "add", path: "/keys/-", value: { f: at - EASE, set: { spine_pitch: base } } });
		if ((!next || next.f - at > EASE) && at + EASE <= last) ops.push({ op: "add", path: "/keys/-", value: { f: at + EASE, set: { spine_pitch: next?.set.spine_pitch ?? base } } });
		return ops;
	});
}

/**
 * tuneCandidates(g, spec) -> patch[] (each a JSON Patch on spec; [] when the group is not near its
 * limit, already carries a patch, or its cause names nothing tunable; a GOAL group up to 10 cm
 * short also gets the body placement steps)
 */
export function tuneCandidates(g, spec) {
	if (typeof g.cause !== "string") return [];
	if (g.kind === "WRIST" && g.cause.startsWith("fix.self")) return [];
	if (g.kind === "WRIST" && isNum(g.worstFrame)) return [...leanSteps(spec, g.worstFrame), ...[1, 2].flatMap(n => placeSteps(spec, g.worstFrame, n)).filter(p => p.every(op => op.path.endsWith("/spine_pitch")))];
	const near = !g.patch && nearLimit(g) ? [...skillCandidates(g.cause, spec), ...keyCandidates(g, g.cause, spec)] : [];
	if (g.kind !== "GOAL" || !isNum(g.worstFrame) || excessOf(g) > PLACE_MAX) return near;
	return [...near, ...placeSteps(spec, g.worstFrame, 1), ...placeSteps(spec, g.worstFrame, 2)];
}
