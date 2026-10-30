/**
 * Grasp sockets on a record (`grasp`): where and how a hand takes hold of it, in the record's own axes, so they move
 * with it and save with it. { <name>: { at: [x, y, z] m from the base pivot, axis?: the line across the palm (a bar,
 * a handle), from?: the side the hand comes from (the palm faces against it), thumb?: the axis end the thumb takes } }.
 * A motion spec's object anchor with `grasp` takes a hand by one (src/motion3/sockets.js), and a thin body is a socket
 * of its own without one. At most MAX sockets, names of letters, digits, _ and -.
 */
const MAX = 8, NAME = /^[A-Za-z0-9_-]{1,32}$/, REACH = 10;

const vec = (v, limit) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && v.every(x => Math.abs(x) <= limit) ? v.map(x => Math.round(x * 1e4) / 1e4) : null);
const dir = v => { const u = vec(v, 1e3), n = u && Math.hypot(...u); return n > 1e-6 ? u.map(x => Math.round((x / n) * 1e4) / 1e4) : null; };

/** The repaired sockets of a record, or null for none (invalid entries are dropped). */
function normalizeObjectGrasp(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const out = {};
	for (const [name, s] of Object.entries(value)) {
		if (Object.keys(out).length >= MAX || !NAME.test(name) || !s || typeof s !== "object") continue;
		const at = vec(s.at, REACH);
		if (!at) continue;
		out[name] = { at };
		for (const k of ["axis", "from", "thumb"]) { const d = dir(s[k]); if (d) out[name][k] = d; }
	}
	return Object.keys(out).length ? out : null;
}

/** The grasp field of a stored record (normalizeSceneObject): kept when it has a socket. */
export function objectGraspFields(record) {
	const grasp = normalizeObjectGrasp(record?.grasp);
	return grasp ? { grasp } : {};
}

/** The grasp part of an object.update patch: the sockets replace the record's own; `grasp: null` removes them. Only a change is returned. */
export function objectGraspPatch(object, patch) {
	if (patch?.grasp === undefined) return {};
	const next = patch.grasp === null ? null : normalizeObjectGrasp(patch.grasp);
	return JSON.stringify(next) === JSON.stringify(object.grasp ?? null) ? {} : { grasp: next };
}
