// C7. What changed against a base spec's QA (lane D2). Groups match by severity.js groupKey
// (kind + subject with the numbers as "#"); groups that share a key are summed into one entry.
//   resolved   a key in the base only
//   new        a key in this compile only
//   worse      a key in both whose severity rose by DELTA_STEP (5 %) or more of the base severity
//   better     a key in both whose severity fell by DELTA_STEP or more
// keys lists at most DELTA_KEYS groupKeys of resolved, new and worse, most severe first; the
// counts are always complete.
import { groupKey, severityOf } from "./qa/severity.js";

const DELTA_STEP = 0.05;
const DELTA_KEYS = 6;

/** groups -> Map(groupKey -> summed severity), in first-seen order. */
function byKey(groups) {
	const m = new Map();
	for (const g of groups ?? []) {
		const k = groupKey(g);
		m.set(k, (m.get(k) ?? 0) + (Number.isFinite(g.severity) ? g.severity : severityOf(g)));
	}
	return m;
}

/** The first DELTA_KEYS keys of [key, weight] rows, the heaviest first (ties keep their order). */
const top = rows => rows.map((r, i) => [...r, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).slice(0, DELTA_KEYS).map(r => r[0]);

/**
 * deltaOf(baseGroups, groups, baseId) ->
 *   { base, resolved, new, worse, better, keys: { resolved: [], new: [], worse: [] } }
 * @param {object[]} baseGroups  the base spec's full qa.groups (spec store parts)
 * @param {object[]} groups  this compile's qa.groups
 * @param {string} baseId
 */
export function deltaOf(baseGroups, groups, baseId) {
	const before = byKey(baseGroups), after = byKey(groups);
	const resolved = [], added = [], worse = [];
	let better = 0;
	for (const [k, s] of before) if (!after.has(k)) resolved.push([k, s]);
	for (const [k, s] of after) {
		if (!before.has(k)) { added.push([k, s]); continue; }
		const b = before.get(k), step = DELTA_STEP * Math.max(Math.abs(b), 0.01);
		if (s - b >= step - 1e-9) worse.push([k, s - b]);
		else if (b - s >= step - 1e-9) better += 1;
	}
	return { base: baseId, resolved: resolved.length, new: added.length, worse: worse.length, better,
		keys: { resolved: top(resolved), new: top(added), worse: top(worse) } };
}
