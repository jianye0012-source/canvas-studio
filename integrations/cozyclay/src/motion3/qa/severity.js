// C6. How bad a QA issue group is, one formula for the agent (qa.groups order and severity),
// the open-parameter search (search.js cost) and repair (repair.js): the issue count weighted by
// how far the worst issue is past its limit, at most 4x. See docs/motion-api-v3.1.md.

/** Kinds whose value must stay ABOVE the limit (a cosine, a drop, a clearance). */
export const LOW_IS_BAD = new Set(["ORIENT", "BELOW", "CLEARANCE"]);

/** How far the worst issue of group g is past its limit (>= 0, in the kind's unit). */
export const excessOf = g => Math.max(0, LOW_IS_BAD.has(g.kind) ? g.limit - g.worst : g.worst - g.limit);

/** Unrounded severity; search.js sums these as its cost. */
export const weightOf = g => g.count * (1 + Math.min(3, excessOf(g) / Math.max(Math.abs(g.limit), 0.01)));

/** Severity of group g, rounded to 2 decimals. */
export const severityOf = g => Math.round(weightOf(g) * 100) / 100;

/** A measurement in a subject: a free-standing number ("12.0 cm", "120deg", "-0.30") or a frame ("f150"). */
const MEASURE = /(?<![\w\-.[])[-+]?\d+(\.\d+)?|\bf\d+\b/g;

/**
 * The grouping key of an issue (kind + subject): every measurement in the subject becomes "#",
 * so one problem at many frames and depths is one group. Digits that are part of a name stay:
 * an id ("cube-6", "empty-2"), a bone ("LeftHandIndex3"), a bracketed index ("contacts[1]", a
 * default check name, qa/check-names.js) and the whole "<name>: " prefix of a named check or goal.
 */
export const groupKey = g => {
	const cut = g.subject.indexOf(": "), head = cut >= 0 ? g.subject.slice(0, cut + 2) : "";
	return `${g.kind} ${head}${g.subject.slice(head.length).replace(MEASURE, m => (m[0] === "f" ? "f#" : "#"))}`;
};

/**
 * Adds excess (4 decimals) and severity to every group and returns them ordered: GOAL groups
 * first, then severity, then count, both descending (ties keep their order).
 */
export function rankGroups(groups) {
	for (const g of groups) { g.excess = Math.round(excessOf(g) * 1e4) / 1e4; g.severity = severityOf(g); }
	return groups.sort((a, b) => (b.kind === "GOAL") - (a.kind === "GOAL") || b.severity - a.severity || b.count - a.count);
}
