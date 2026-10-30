// Validation of spec.goals (C8), exact messages through err(...):
//   - each goal names exactly one predicate of near | above | moved | still | speed
//     (schema/fields.js GOAL_FIELDS)
//   - near/above take two refs, moved/still/speed one ref (refs.js checkRef, the full ref grammar);
//     a bare "<id>[.center|.top|.base]" in moved, still or speed is taken as object:<id>
//     (canonicalGoals, before validation; the spec a specId names holds the object: form); moved
//     and still on any other point measure from at[0], so they need at: [f0, f1] with f0 < f1
//   - tol (near, still) and by (above, moved, speed) are numbers; speed needs by (m/s, > 0);
//     mode "all" | "any", at an absolute frame or [f0, f1] within 0..frames-1; goal names differ
//   - after / before name another goal (its name, or goals[i] for an unnamed one); a goal that
//     waits on itself through after/before is refused, listing the loop
//   - unknown fields go through opts.unknown (ignored when lenient)
import { GOAL_FIELDS } from "../schema/fields.js";
import { checkRef } from "../refs.js";
import { GOAL_KINDS, ONE_REF, goalKinds, goalName } from "../qa/goals.js";
import { didYouMean, fmt } from "./vocab.js";

const SHAPE = "{ name?, near | above | moved | still | speed, tol?, by?, at, mode?, after?, before? }";
const TOL = new Set(["near", "still"]), BY = new Set(["above", "moved", "speed"]);
// tol on above/moved is refused, not mapped: a tolerance reads as by: -tol (slack) or by: tol (clearance),
// and agents meant both, so the message names each by that could be meant with the number sent.
function tolOnBy(kind, tol) {
	const v = Number.isFinite(tol) && tol !== 0 ? Math.abs(tol) : 0.05;
	if (kind === "speed") return `speed takes by (the point reaches by m/s): use by: ${v} (m/s), not tol`;
	return kind === "above" ? `above takes by (a.y - b.y >= by, default 0): use by: ${v} for a at least ${v} m above b, or by: -${v} to let a sit up to ${v} m below b, not tol`
		: `moved takes by (the object moves >= by, default 0.05): use by: ${v} (metres), not tol`;
}
const bareRef = v => typeof v === "string" && v !== "" && !/^[a-z]+:/.test(v);
const bareOf = g => ["moved", "still", "speed"].find(k => bareRef(g?.[k]));

/** goals with every bare moved, still or speed id written as "object:<id>"; goals itself when none is bare. */
export function canonicalGoals(goals) {
	return Array.isArray(goals) && goals.some(bareOf) ? goals.map(g => { const k = bareOf(g); return k ? { ...g, [k]: `object:${g[k]}` } : g; }) : goals;
}

function validateAt(err, at, v, frames, past = "") {
	const ok = f => Number.isInteger(f);
	if (v === undefined) return err(`${at} needs at: a frame or [f0, f1] (absolute frames within 0..${frames - 1})`);
	const range = Array.isArray(v) ? v : [v, v];
	if (!(range.length === 2 && range.every(ok) && range[0] <= range[1])) return err(`${at}.at must be an integer frame or [f0, f1] with f0 <= f1, got ${fmt(v)}`);
	if (range[0] < 0 || range[1] > frames - 1) err(`${at}.at = ${fmt(v)} is outside 0..${frames - 1} (spec.frames ${frames})${range[1] > frames - 1 ? past : ""}`);
}

/** The one-ref predicates: an object id or a point ref; moved and still on a point need a span. */
function validateOneRef(spec, err, ctx, at, g, kind) {
	const ref = g[kind];
	if (typeof ref !== "string") return err(`${at}.${kind} must be an object id or a point ref (object:<id>[.center|.top|.base], prop:<prop>.<point>, joint:<Bone>, landmark:mouth, anchor:<name>), got ${fmt(ref)}`);
	if (checkRef(spec, err, ctx, `${at}.${kind}`, ref) && kind !== "speed" && !ref.startsWith("object:") && (Number.isInteger(g.at) || (Array.isArray(g.at) && g.at[0] === g.at[1])))
		err(`${at}.${kind} "${ref}" measures ${kind === "moved" ? "how far the point gets" : "how far the point strays"} from where it is at at[0], so at must be [f0, f1] with f0 < f1, got ${fmt(g.at)}`);
}

function validateGoal(spec, err, opts, g, i, names) {
	const at = `goals[${i}]`, ctx = { sk: opts.sk, scene: opts.scene }, unknown = opts.unknown ?? err;
	if (!g || typeof g !== "object" || Array.isArray(g)) return err(`${at} must be ${SHAPE}, got ${fmt(g)}`);
	for (const f of Object.keys(g)) if (!GOAL_FIELDS.includes(f)) unknown(`${at} has unknown field "${f}"${didYouMean(f, GOAL_FIELDS)} (fields: ${GOAL_FIELDS.join(", ")})`);
	if (g.name !== undefined) {
		if (typeof g.name !== "string" || !g.name.trim()) err(`${at}.name must be a non-empty string, got ${fmt(g.name)}`);
		else if (names.has(g.name)) err(`${at}.name "${g.name}" is already used by goals[${names.get(g.name)}]; goal names must differ`);
		else names.set(g.name, i);
	}
	const kinds = goalKinds(g), kind = kinds[0];
	if (!kinds.length) err(`${at} needs one predicate: ${GOAL_KINDS.join(", ")}`);
	if (kinds.length > 1) err(`${at} names ${kinds.join(" and ")}; a goal takes exactly one of ${GOAL_KINDS.join(", ")} (split it into ${kinds.length} goals)`);
	if (kinds.length === 1 && ONE_REF.has(kind)) validateOneRef(spec, err, ctx, at, g, kind);
	else if (kinds.length === 1) {
		const pair = g[kind];
		if (!(Array.isArray(pair) && pair.length === 2 && pair.every(r => typeof r === "string"))) err(`${at}.${kind} must be [ref, ref] (two point refs), got ${fmt(pair)}`);
		else pair.forEach((ref, j) => checkRef(spec, err, ctx, `${at}.${kind}[${j}]`, ref));
	}
	if (g.tol !== undefined) {
		if (kinds.length === 1 && !TOL.has(kind)) err(`${at}.tol applies to near and still; ${tolOnBy(kind, g.tol)}`);
		else if (!(Number.isFinite(g.tol) && g.tol >= 0)) err(`${at}.tol must be a number >= 0 (metres), got ${fmt(g.tol)}`);
	}
	if (g.by !== undefined) {
		if (kinds.length === 1 && !BY.has(kind)) err(`${at}.by applies to above, moved and speed; ${kind} takes tol`);
		else if (!Number.isFinite(g.by) || (kind === "moved" && g.by < 0) || (kind === "speed" && g.by <= 0)) err(`${at}.by must be a ${kind === "moved" ? "number >= 0 (metres)" : kind === "speed" ? "number > 0 (m/s)" : "finite number (metres)"}, got ${fmt(g.by)}`);
	} else if (kind === "speed" && kinds.length === 1) err(`${at}.speed needs by: the speed the point must reach, in m/s (e.g. by: 2)`);
	if (g.mode !== undefined && g.mode !== "all" && g.mode !== "any") err(`${at}.mode must be "all" or "any", got ${fmt(g.mode)}`);
	validateAt(err, at, g.at, opts.frames, opts.past);
}

/** after/before: each names another goal, and no goal waits on itself; one message per loop. */
function validateOrder(goals, err) {
	const names = new Map(goals.map((g, i) => [g && typeof g === "object" ? goalName(g, i) : `goals[${i}]`, i]));
	const waits = goals.map((g, i) => ["after", "before"].flatMap(side => {
		if (!g || typeof g !== "object" || g[side] === undefined) return [];
		const j = names.get(g[side]);
		if (typeof g[side] !== "string" || j === undefined) { err(`goals[${i}].${side} must name another goal (its name, or goals[<i>] when it has none), got ${fmt(g[side])}${typeof g[side] === "string" ? didYouMean(g[side], [...names.keys()]) : ""}`); return []; }
		if (j === i) { err(`goals[${i}].${side} names the goal itself; name the goal whose first met frame this one waits for`); return []; }
		return [j];
	}));
	const state = goals.map(() => 0), path = [];
	const visit = i => {
		if (state[i] === 2) return;
		if (state[i] === 1) {
			const loop = path.slice(path.indexOf(i)).map(j => `"${goalName(goals[j], j)}"`);
			return err(`goals wait on each other through after/before: ${[...loop, loop[0]].join(" -> ")}; one of them must not wait`);
		}
		state[i] = 1; path.push(i);
		for (const j of waits[i]) visit(j);
		path.pop(); state[i] = 2;
	};
	goals.forEach((_, i) => visit(i));
}

/**
 * validateGoals(spec, err, opts)
 * @param {object} spec  the expanded spec
 * @param {(msg: string) => void} err  collects one problem (validate.js)
 * @param {{ sk?: object, scene?: object, frames: number, lenient?: boolean, unknown?: (msg: string) => void, past?: string }} opts
 */
export function validateGoals(spec, err, opts) {
	if (spec.goals === undefined) return;
	if (!Array.isArray(spec.goals)) return err(`spec.goals must be an array of goals ${SHAPE}, got ${fmt(spec.goals)}`);
	const names = new Map();
	spec.goals.forEach((g, i) => validateGoal(spec, err, opts, g, i, names));
	validateOrder(spec.goals, err);
}
