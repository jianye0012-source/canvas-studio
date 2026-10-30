// Fit the collision body of a Mixamo FBX rig from its skin to src/motion3/rigs/<model>-body.json
// for motion3's self-collision (src/motion3/body.js): one signed distance grid per skinned bone, in
// that bone's bind frame (the bone moves it rigidly), from the skin vertices the bone carries; and
// for each limb bone the radius of its skin along the bone (the probe spheres a limb collides with).
// Run once per rig: node tools/motion3/extract-body.mjs y-bot-tpose
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { axisEnd } from "../../src/motion3/body.js";
import { sub, apply, T, dot, len } from "../../src/motion3/compiler/math.js";

const model = process.argv[2] ?? "y-bot-tpose";
const STEP = 0.015, MARGIN = 0.04, MEMBER = 0.25, MM = 1000;
const buf = fs.readFileSync(path.resolve("public/models", `${model}.fbx`));
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
root.updateMatrixWorld(true);
const sk = skeletonFor(model), name = n => n.replace(/^mixamorig:?/, "");

// Skin vertices (metres, bind pose) with normals and the bones that carry them, both meshes (the
// Y/X Bot joint balls are their own mesh), duplicates merged.
const verts = new Map();
root.traverse(o => {
	if (!o.isSkinnedMesh) return;
	const g = o.geometry, pos = g.attributes.position, nrm = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
	const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).multiplyScalar(0.01);
		const key = v.toArray().map(x => Math.round(x * 2000)).join();
		const entry = verts.get(key) ?? { p: v.toArray(), n: [0, 0, 0], w: new Map() };
		n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
		entry.n = entry.n.map((x, k) => x + n.getComponent(k));
		for (let k = 0; k < 4; k++) {
			const w = sw.getComponent(i, k), b = sk.index[name(o.skeleton.bones[si.getComponent(i, k)].name)];
			if (w > 0 && b !== undefined) entry.w.set(b, Math.max(entry.w.get(b) ?? 0, w));
		}
		verts.set(key, entry);
	}
});
const V = [...verts.values()].map(e => ({ ...e, n: e.n.map(x => x / (len(e.n) || 1)) }));
const dominant = e => [...e.w].sort((a, b) => b[1] - a[1])[0]?.[0];
// Fingers bend inside the hand: their skin is no grid of the hand; every other skinned bone gets one.
const FINGER = /Hand(Thumb|Index|Middle|Ring|Pinky)/;
const owners = [...new Set(V.map(dominant))].filter(b => b !== undefined && !FINGER.test(sk.names[b]));

/** Signed distance grid of the skin bone b carries, in b's bind frame (millimetres, Int8, outside +). */
function grid(b) {
	const toLocal = p => apply(T(sk.restWorldRot[b]), sub(p, sk.restWorldPos[b]));
	const pts = V.filter(e => (e.w.get(b) ?? 0) >= MEMBER || dominant(e) === b).map(e => ({ p: toLocal(e.p), n: apply(T(sk.restWorldRot[b]), e.n) }));
	const own = V.filter(e => dominant(e) === b).map(e => toLocal(e.p));
	const lo = [0, 1, 2].map(k => Math.min(...own.map(p => p[k])) - MARGIN), hi = [0, 1, 2].map(k => Math.max(...own.map(p => p[k])) + MARGIN);
	const dims = lo.map((l, k) => Math.max(2, Math.ceil((hi[k] - l) / STEP) + 1));
	// a hash of the member points: the nearest few decide distance and side
	const cell = 0.03, hash = new Map(), at = p => p.map(x => Math.floor(x / cell)).join();
	for (const q of pts) { const k = at(q.p); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(q); }
	const near = p => {
		const c = p.map(x => Math.floor(x / cell)), found = [];
		for (let r = 1; r <= 6 && found.length < 6; r++) {
			found.length = 0;
			for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) found.push(...(hash.get(`${c[0] + i},${c[1] + j},${c[2] + k}`) ?? []));
		}
		return found.map(q => ({ q, d: len(sub(p, q.p)) })).sort((x, y) => x.d - y.d).slice(0, 6);
	};
	const data = new Int8Array(dims[0] * dims[1] * dims[2]);
	for (let x = 0; x < dims[0]; x++) for (let y = 0; y < dims[1]; y++) for (let z = 0; z < dims[2]; z++) {
		const p = [lo[0] + x * STEP, lo[1] + y * STEP, lo[2] + z * STEP], nn = near(p);
		let d = 0.127;
		if (nn.length) {
			// side: the nearest points' normals vote, nearer ones louder; distance: to the nearest point's
			// tangent plane where the point lies over it, else to the point
			const side = nn.reduce((acc, { q, d: dq }) => acc + Math.sign(dot(sub(p, q.p), q.n)) / (dq + 0.005), 0) >= 0 ? 1 : -1;
			const { q, d: dq } = nn[0], along = Math.abs(dot(sub(p, q.p), q.n)), lateral = Math.sqrt(Math.max(0, dq * dq - along * along));
			d = side * (lateral < STEP ? along : dq);
		}
		data[(x * dims[1] + y) * dims[2] + z] = Math.max(-127, Math.min(127, Math.round(d * MM)));
	}
	return { min: lo.map(v => +v.toFixed(4)), dims, data: Buffer.from(data.buffer).toString("base64") };
}

/** Skin radius along a limb bone (bone to its first child), [t, r] at 6 stations: the 80th percentile of
 * the skin's distance from the bone, but for a hand the median capped at HAND (the palm is flat, and the
 * thumb's root rides the hand bone: a round 80th percentile would make it a 10 cm ball); HAND is the palm's half thickness (qa/geometry.js hand_*). */
const HAND = 0.022;
function profile(b) {
	const hand = /Hand$/.test(sk.names[b]);
	const child = axisEnd(sk, b), A = sk.restWorldPos[b], B = sk.restWorldPos[child], axis = sub(B, A), L2 = dot(axis, axis);
	const bins = Array.from({ length: 6 }, () => []);
	for (const e of V) {
		if (dominant(e) !== b) continue;
		const t = dot(sub(e.p, A), axis) / L2;
		if (t < 0 || t > 1) continue;
		bins[Math.min(5, Math.floor(t * 6))].push(len(sub(sub(e.p, A), axis.map(v => v * t))));
	}
	const pick = r => { const v = r.sort((x, y) => x - y)[Math.floor(r.length * (hand ? 0.5 : 0.8))]; return +(hand ? Math.min(HAND, v) : v).toFixed(4); };
	return bins.map((r, i) => [+((i + 0.5) / 6).toFixed(3), r.length ? pick(r) : null]).filter(([, r]) => r !== null);
}

const LIMBS = ["Arm", "ForeArm", "Hand", "UpLeg", "Leg"].flatMap(n => [`Left${n}`, `Right${n}`]);
const out = { model, step: STEP, unit: "mm", grids: Object.fromEntries(owners.map(b => [sk.names[b], grid(b)])), radii: Object.fromEntries(LIMBS.map(n => [n, profile(sk.index[n])])) };
const file = path.resolve("src/motion3/rigs", `${model}-body.json`);
fs.writeFileSync(file, `${JSON.stringify(out)}\n`);
console.log(`${file}: ${owners.length} grids, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
