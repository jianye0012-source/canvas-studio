// A take's fingerprint for the "bakes as before" pins: its rotations, hips and object tracks, each value rounded to
// QUANTUM before it is hashed. A pin of the raw float bits held on one machine only: x86-64 and arm64 compute a few
// values a last bit apart (the exit-car take: 43 of its 189,800 rotation values, by at most 9e-16), so CI on Linux
// read every pinned take as changed. A change of behaviour moves values by far more than QUANTUM.
import { createHash } from "node:crypto";

const QUANTUM = 1e-6;

/** The first 16 hex digits of the sha256 of the take's arrays, rounded to QUANTUM (-0 counts as 0, NaN stays NaN). */
export function takeHash(t) {
	const h = createHash("sha256");
	for (const a of [t.rot, t.hips, ...Object.values(t.objects ?? {}).flatMap(o => Object.values(o).filter(v => ArrayBuffer.isView(v)))]) {
		const q = new Float64Array(a.length);
		for (let i = 0; i < a.length; i++) { const r = Math.round(a[i] / QUANTUM); q[i] = r === 0 ? 0 : r; }
		h.update(Buffer.from(q.buffer));
	}
	return h.digest("hex").slice(0, 16);
}
