// Unnamed checks get a name from their place in the agent's own spec ("contacts[0]"), so their
// QA groups say which check failed and two unnamed checks stay two groups (severity.js groupKey
// keeps a bracketed index). Runs on a copy before the skills expand, so skill checks keep theirs.

const NAMED = ["contacts", "orient", "below", "clearance", "appear"];

/** spec -> a copy whose unnamed spec.checks entries are named "<list>[<index>]" (spec when none are). */
export function nameChecks(spec) {
	const c = spec?.checks;
	if (!c || typeof c !== "object" || !NAMED.some(k => Array.isArray(c[k]) && c[k].some(e => e && typeof e === "object" && e.name === undefined))) return spec;
	const checks = { ...c };
	for (const k of NAMED) if (Array.isArray(c[k])) checks[k] = c[k].map((e, i) => (e && typeof e === "object" && e.name === undefined ? { ...e, name: `${k}[${i}]` } : e));
	return { ...spec, checks };
}
