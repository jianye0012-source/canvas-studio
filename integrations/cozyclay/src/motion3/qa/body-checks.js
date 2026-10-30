// BODY on the fitted skin (src/motion3/body.js): an upper arm, forearm or hand going into any other
// part of the body (torso, hips, head, legs, the other arm) more than L.skin. Each limb probes as
// spheres on its bone; the body answers from its signed distance grids. The parts are named as the
// capsules were (qa/geometry.js CAPSULES), so "hand_r into torso_hi" reads the same as before; a
// spec's checks.allow { part, object: <part>, depth } lets a declared contact touch deeper.
import { bodyFor, limbDepth } from "../body.js";

const REGIONS = [
	[/^Hips$/, "hips"], [/^(Spine|Spine1)$/, "torso_lo"], [/^Spine2$/, "torso_hi"], [/^Neck$/, "neck"], [/^Head/, "head"],
	[/Shoulder$/, "shoulder"], [/UpLeg$/, "thigh"], [/Leg$/, "shin"], [/(Foot|Toe)/, "foot"], [/ForeArm$/, "farm"], [/Arm$/, "uarm"], [/Hand$/, "hand"],
];
/** The QA part name of bone b ("thigh_l", "torso_hi", ...). */
export function regionOf(sk, b) {
	const name = sk.names[b] ?? "", side = /^Left/.test(name) ? "_l" : /^Right/.test(name) ? "_r" : "";
	const hit = REGIONS.find(([re]) => re.test(name));
	return hit ? `${hit[1]}${side}` : name;
}

export const ARM_BONES = ["Arm", "ForeArm", "Hand"].flatMap(n => [`Left${n}`, `Right${n}`]);

/** L: limits { skin } (m); push(kind, msg, frame, value, limit); allowed(part, into): a declared depth or null. */
export function bodyChecks(sk, out, L, push, allowed) {
	const body = bodyFor(sk);
	if (!body) return;
	const limbs = ARM_BONES.map(n => sk.index[n]);
	out.frames.forEach(({ s }, f) => {
		for (const b of limbs) {
			const hit = limbDepth(body, sk, s, b);
			if (hit.into < 0) continue;
			const part = regionOf(sk, b), into = regionOf(sk, hit.into), lim = Math.max(allowed(part, into) ?? 0, L.skin);
			if (hit.depth > lim) push("BODY", `${part} into ${into}`, f, hit.depth, lim);
		}
	});
}
