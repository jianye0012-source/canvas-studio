// The agent panel's progress card as plain data (AgentProgressCard.jsx draws it): the QA trend across the
// drafts, the latest draft's goals as checklist rows, its heaviest issue groups, and when a new turn starts.
// Goal values are metres (near: a distance, above: a height difference, moved: a distance); the card shows cm.

const round = v => Math.round(v * 10) / 10;
const cm = v => `${(v * 100).toFixed(1)} cm`;
const signedCm = v => `${v < 0 ? "−" : "+"}${(Math.abs(v) * 100).toFixed(1)} cm`;

/** QA totals across the drafts inside a width x height box: { points: [[x, y], ...], max, first, last }. */
export function trendPoints(totals, { width = 220, height = 40, pad = 4 } = {}) {
	if (!totals.length) return { points: [], max: 0, first: null, last: null };
	const max = Math.max(1, ...totals), n = totals.length;
	const x = i => (n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
	const y = v => pad + (1 - v / max) * (height - 2 * pad);
	return { points: totals.map((v, i) => [round(x(i)), round(y(v))]), max, first: totals[0], last: totals[n - 1] };
}

/**
 * Checklist rows of a draft's goals: { name, ok, value, need, at }. near passes at value <= need; above and moved
 * at value >= need. A goal without a measured value reads "—".
 */
export function goalRows(goals = []) {
	return goals.map(g => {
		const show = g.kind === "above" ? signedCm : g.kind === "speed" ? v => `${Math.round(v * 100) / 100} m/s` : cm;
		const value = Number.isFinite(g.value) ? show(g.value) : "—";
		const need = Number.isFinite(g.need) ? `${g.kind === "near" || g.kind === "still" ? "≤" : "≥"} ${show(g.need)}` : "";
		return { name: g.name ?? g.kind ?? "goal", ok: !!g.ok, value, need, at: Number.isFinite(g.at) ? `f${g.at}` : "" };
	});
}

/** The first `limit` issue groups by severity, as QA ordered them: { kind, subject, count, frames }. GOAL groups are left
 * out: the goals checklist already shows them. */
export function issueRows(groups = [], limit = 3) {
	return groups.filter(g => g.kind !== "GOAL").slice(0, limit).map(g => ({
		kind: g.kind ?? "", subject: g.subject ?? "", count: g.count ?? 0,
		frames: !Number.isFinite(g.first) ? "" : Number.isFinite(g.last) && g.last !== g.first ? `f${g.first}–${g.last}` : `f${g.first}`,
	}));
}

/** The number of turns the user started: messages that are not steers of a running turn. */
export const turnCount = items => items.filter(item => item.kind === "user" && !item.steered).length;

/** A short caption for an image the agent asked to see: its kind and, for a sheet, its views and frames. */
export function sheetCaption({ kind, views = [], frames = [] } = {}) {
	const span = frames.length ? (frames.length > 1 ? `f${frames[0]}–${frames[frames.length - 1]}` : `f${frames[0]}`) : "";
	return [kind, views.join(", "), span].filter(Boolean).join(" · ");
}
