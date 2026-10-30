import * as THREE from "three";
import { findBone } from "./ik.js";
import { SEGMENT_MASSES } from "./center-of-mass.js";

const G = 9.81;
const V = () => new THREE.Vector3();
const SUPPORT_LIMITS = Object.freeze({ gap: .025, force: .22, moment: .10, maxDrop: .60, friction: .6 });

/** Cached bone lookup and an explicit approximate segmented physical body.
 * Mass is normalized: reported forces are body weights, not measured Newtons.
 * Cylindrical segment inertia is a proxy, not biomechanical ground truth. */
export function createDynamicsSampler(rig) {
	const segments = SEGMENT_MASSES.map((s) => ({ ...s, a: findBone(rig, s.start), b: findBone(rig, s.end) }));
	return () => {
		const out = [];
		for (const s of segments) {
			if (!s.a || !s.b) return null;
			const a = V().setFromMatrixPosition(s.a.matrixWorld), b = V().setFromMatrixPosition(s.b.matrixWorld);
			const direction = b.clone().sub(a), length = direction.length();
			out.push({ mass: s.mass, center: a.add(b).multiplyScalar(.5), rotation: s.a.getWorldQuaternion(new THREE.Quaternion()), axis: direction.normalize(), length,
				radius: /pelvis|torso/.test(s.id) ? .13 : s.id === "head" ? .09 : .045 });
		}
		return out;
	};
}

// Local quadratic fit preserves constant acceleration, including a jump apex.
// One-sided windows at clip edges avoid assuming zero velocity there.
function derivative(values, f, fps, order, radius = 4) {
	const first = Math.max(0, f - radius), last = Math.min(values.length - 1, f + radius);
	if (last - first < 2) return 0;
	const sums = [0, 0, 0, 0, 0], rhs = [0, 0, 0];
	for (let i = first; i <= last; i += 1) {
		const t = (i - f) / fps;
		for (let j = 0; j < 5; j += 1) sums[j] += t ** j;
		for (let j = 0; j < 3; j += 1) rhs[j] += values[i] * t ** j;
	}
	const m = [[sums[0], sums[1], sums[2], rhs[0]], [sums[1], sums[2], sums[3], rhs[1]], [sums[2], sums[3], sums[4], rhs[2]]];
	for (let k = 0; k < 3; k += 1) {
		let pivot = k; for (let i = k + 1; i < 3; i += 1) if (Math.abs(m[i][k]) > Math.abs(m[pivot][k])) pivot = i;
		[m[k], m[pivot]] = [m[pivot], m[k]];
		const scale = m[k][k]; if (Math.abs(scale) < 1e-14) return 0;
		for (let j = k; j < 4; j += 1) m[k][j] /= scale;
		for (let i = 0; i < 3; i += 1) if (i !== k) { const x = m[i][k]; for (let j = k; j < 4; j += 1) m[i][j] -= x * m[k][j]; }
	}
	return m[order][3] * (order === 2 ? 2 : 1);
}

export function supportMotion(rows, fps) {
	const centers = rows.map((r) => r.com ?? r.root), axes = ["x", "y", "z"];
	const track = axes.map((a) => centers.map((p) => p[a]));
	const accelerations = rows.map((_, f) => new THREE.Vector3(...track.map((v) => derivative(v, f, fps, 2))));
	const velocities = rows.map((_, f) => new THREE.Vector3(...track.map((v) => derivative(v, f, fps, 1))));
	const momentum = rows.map(() => V());
	const total = rows[0]?.dynamics?.reduce((n, s) => n + s.mass, 0) || 1;
	for (let s = 0; s < (rows[0]?.dynamics?.length ?? 0); s += 1) {
		const positions = axes.map((a) => rows.map((r) => r.dynamics[s].center[a]));
		for (let f = 0; f < rows.length; f += 1) {
			const segment = rows[f].dynamics[s], mass = segment.mass / total;
			const velocity = new THREE.Vector3(...positions.map((v) => derivative(v, f, fps, 1)));
			momentum[f].add(segment.center.clone().sub(centers[f]).cross(velocity.sub(velocities[f])).multiplyScalar(mass));
			const a = Math.max(0, f - 2), b = Math.min(rows.length - 1, f + 2), dt = (b - a) / fps;
			if (!dt) continue;
			const dq = rows[b].dynamics[s].rotation.clone().multiply(rows[a].dynamics[s].rotation.clone().invert()).normalize();
			if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
			const sin = Math.hypot(dq.x, dq.y, dq.z), omega = new THREE.Vector3(dq.x, dq.y, dq.z).multiplyScalar(sin > 1e-9 ? 2 * Math.atan2(sin, dq.w) / (sin * dt) : 2 / dt);
			const parallel = mass * segment.radius ** 2 / 2, perpendicular = mass * (segment.length ** 2 / 12 + segment.radius ** 2 / 4);
			momentum[f].addScaledVector(omega, perpendicular).addScaledVector(segment.axis, omega.dot(segment.axis) * (parallel - perpendicular));
		}
	}
	const momentTrack = axes.map((a) => momentum.map((p) => p[a]));
	return rows.map((row, f) => {
		const force = accelerations[f].clone().divideScalar(G); force.y += 1;
		const moment = new THREE.Vector3(...momentTrack.map((v) => derivative(v, f, fps, 1))).divideScalar(G);
		return { force, moment, acceleration: accelerations[f], velocity: velocities[f], complete: !!row.com && !!row.dynamics };
	});
}

/** Non-negative least squares on the rays of an inscribed friction pyramid.
 * Minimizes force + CoM-moment residual; all forces push up at actual patches.
 * This is a centroidal feasibility check, NOT full joint-torque certification. */
export function solveSupportForces(row, demand, patches, { friction = SUPPORT_LIMITS.friction, iterations = 96 } = {}) {
	const height = Math.max(.7, Math.min(2.2, (row.stature ?? 1.7)));
	const target = [...demand.force.toArray(), ...demand.moment.clone().divideScalar(height).toArray()];
	const columns = [], ids = [], mu = friction / Math.SQRT2;
	for (const [id, item] of patches) {
		const points = item.patch?.length ? item.patch : [item.point ?? item.position];
		for (const p of points) {
			const arm = p.clone().sub(row.com ?? row.root).divideScalar(height);
			for (const x of [-mu, mu]) for (const z of [-mu, mu]) {
				const force = new THREE.Vector3(x, 1, z), moment = arm.clone().cross(force);
				columns.push([...force.toArray(), ...moment.toArray()]); ids.push(id);
			}
		}
	}
	const residual = [...target], weights = new Float64Array(columns.length), norms = columns.map((c) => c.reduce((s, v) => s + v * v, .0002));
	// Symmetric starting load avoids the arbitrary first patch monopolizing
	// weight during coordinate descent on nearly collinear friction rays.
	weights.fill(Math.max(0, target[1]) / Math.max(1, columns.length));
	for (let i = 0; i < columns.length; i += 1) for (let j = 0; j < 6; j += 1) residual[j] -= columns[i][j] * weights[i];
	for (let pass = 0; pass < iterations; pass += 1) {
		let change = 0;
		for (let n = 0; n < columns.length; n += 1) {
			const col = columns[n]; let dot = -.0002 * weights[n];
			for (let j = 0; j < 6; j += 1) dot += col[j] * residual[j];
			const next = Math.max(0, weights[n] + dot / norms[n]), delta = next - weights[n];
			weights[n] = next; change += Math.abs(delta);
			for (let j = 0; j < 6; j += 1) residual[j] -= col[j] * delta;
		}
		if (change < 1e-6) break;
	}
	const loads = {};
	weights.forEach((w, i) => { if (w > .001) loads[ids[i]] = (loads[ids[i]] ?? 0) + w; });
	const forceResidual = Math.hypot(...residual.slice(0, 3)), momentResidual = Math.hypot(...residual.slice(3));
	return { forceResidual, momentResidual, residual: Math.hypot(forceResidual, momentResidual), loads };
}

function patchesAt(row, floorY, shift = 0, overrides = [], frame = 0) {
	return Object.entries(row.support).filter(([id, p]) => p.vertices > 0 && p.floor + shift <= floorY + SUPPORT_LIMITS.gap && p.floor + shift >= floorY - .03
		&& !overrides.some((o) => o.site === id && o.mode === "free" && frame >= o.start && frame <= o.end));
}

/** Deliberately independent of detected contact masks: 'no contacts' is not a
 * zero-error success when gravity requires support. */
export function supportDiagnostics(rows, fps, floorY = 0) {
	const motion = supportMotion(rows, fps);
	const frames = rows.map((row, f) => {
		const fit = solveSupportForces(row, motion[f], patchesAt(row, floorY));
		const clearance = Math.min(...Object.values(row.support).filter((p) => p.vertices > 0).map((p) => p.floor - floorY));
		return { frame: f, ...fit, clearance, flight: motion[f].force.length() < .28, measured: Number.isFinite(clearance) && !!row.dynamics };
	});
	const unsupported = frames.filter((r) => r.measured && !r.flight && r.clearance > SUPPORT_LIMITS.gap && r.forceResidual > SUPPORT_LIMITS.force);
	return { frames, unsupportedFrames: unsupported.length, unsupportedGap: Math.max(0, ...unsupported.map((f) => f.clearance)),
		forceResidual: Math.max(0, ...frames.filter((f) => f.measured).map((f) => f.forceResidual)),
		momentResidual: Math.max(0, ...frames.filter((f) => f.measured).map((f) => f.momentResidual)),
		unresolved: frames.filter((r) => r.measured && !r.flight && (r.forceResidual > SUPPORT_LIMITS.force || r.momentResidual > SUPPORT_LIMITS.moment)) };
}
