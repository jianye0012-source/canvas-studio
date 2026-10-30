// Quaternion helpers for the held-object keys (../object-keys.js) and the hand-from-object solve
// (hold.js). Quaternions are three.js order [x, y, z, w], as math.js quatFromMat / matFromQuat;
// a rotation vector is axis * radians.

export const qmul = (a, b) => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qconj = q => [-q[0], -q[1], -q[2], q[3]];
export const qdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export function qnorm(q) {
	const l = Math.hypot(q[0], q[1], q[2], q[3]);
	return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

/** Rotation vector of unit q, the short way round (|v| <= pi). */
export function qlog(q) {
	const sg = q[3] < 0 ? -1 : 1, x = q[0] * sg, y = q[1] * sg, z = q[2] * sg, w = q[3] * sg, s = Math.hypot(x, y, z);
	if (s < 1e-12) return [2 * x, 2 * y, 2 * z];
	const a = 2 * Math.atan2(s, w) / s;
	return [x * a, y * a, z * a];
}

/** Unit quaternion of rotation vector v. */
export function qexp(v) {
	const a = Math.hypot(v[0], v[1], v[2]);
	if (a < 1e-12) return qnorm([v[0] / 2, v[1] / 2, v[2] / 2, 1]);
	const s = Math.sin(a / 2) / a;
	return [v[0] * s, v[1] * s, v[2] * s, Math.cos(a / 2)];
}

/** Rotate vector v by unit q. */
export const qrot = (q, v) => qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)).slice(0, 3);

/** The shortest turn taking unit direction a onto unit direction b (half a turn about a normal of a when they are opposite). */
export function arcQuat(a, b) {
	const w = 1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	if (w > 1e-9) return qnorm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], w]);
	const n = Math.abs(a[0]) < 0.9 ? [0, a[2], -a[1]] : [-a[2], 0, a[0]], l = Math.hypot(...n);
	return [n[0] / l, n[1] / l, n[2] / l, 0];
}

/** The turn by `deg` degrees about unit axis `u` (right-handed). */
export const axisQuat = (u, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [u[0] * s, u[1] * s, u[2] * s, Math.cos(h)]; };

/** a -> b by t along the short arc (t = 0: a, t = 1: b). */
export const slerp = (a, b, t) => qmul(a, qexp(qlog(qmul(qconj(a), b)).map(c => c * t)));
