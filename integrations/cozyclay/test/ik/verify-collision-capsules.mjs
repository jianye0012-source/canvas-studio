import * as THREE from "three";
import { resolveIkRig, solveIk } from "../../src/motion/ik.js";
import { primeBindPose } from "../../src/poses.js";
import {
	buildCollisionCapsules,
	detectPenetrations,
	supportsCollisionCleanup,
	PAIR_TOLERANCE,
	DEFAULT_SLACK_FACTOR,
	FINGER_RADIUS,
	TRIM_FRACTION,
	HINGE_SLACK_FACTOR,
	MIN_DEPTH,
} from "../../src/motion/fix-collisions.js";

// Collision DETECTION only: capsules, penetrations and the documented
// thresholds. The 2.x fixCollisions solver was removed with ARDY.

let failures = 0;
function check(name, cond, detail = "") {
	if (cond) console.log(`PASS ${name}`);
	else {
		failures += 1;
		console.log(`FAIL ${name}${detail ? " — " + detail : ""}`);
	}
}

/* Synthetic Mixamo-spelled rig in a T-pose: arms along ±X, legs along -Y,
 * toes forward (+Z). Rig scaled 0.01 (cm → m). Same layout as
 * test/ik/verify-ik.mjs.
 *
 * `withFingers` adds the middle-finger base bones. Real Mixamo exports have
 * them, cheaper game rigs do not, and the hand capsule has to work either
 * way — so the fixture builds both. */
function makeRig(withFingers = false) {
	const rig = new THREE.Object3D();
	rig.scale.setScalar(0.01);
	const mk = (name, parent, x, y, z) => {
		const b = new THREE.Bone();
		b.name = name;
		b.position.set(x, y, z);
		parent.add(b);
		return b;
	};
	const hips = mk("mixamorigHips", rig, 0, 100, 0);
	const spine = mk("mixamorigSpine", hips, 0, 15, 0);
	const chest = mk("mixamorigSpine1", spine, 0, 15, 0);
	mk("mixamorigSpine2", chest, 0, 15, 0);
	const neck = mk("mixamorigNeck", chest, 0, 30, 0);
	const head = mk("mixamorigHead", neck, 0, 15, 0);
	mk("mixamorigHeadTop_End", head, 0, 20, 0);
	const lShoulder = mk("mixamorigLeftShoulder", chest, 10, 25, 0);
	const rShoulder = mk("mixamorigRightShoulder", chest, -10, 25, 0);
	const lArm = mk("mixamorigLeftArm", lShoulder, 10, -10, 0);
	const lFore = mk("mixamorigLeftForeArm", lArm, 30, 0, 0);
	const lHand = mk("mixamorigLeftHand", lFore, 30, 0, 0);
	const rArm = mk("mixamorigRightArm", rShoulder, -10, -10, 0);
	const rFore = mk("mixamorigRightForeArm", rArm, -30, 0, 0);
	const rHand = mk("mixamorigRightHand", rFore, -30, 0, 0);
	if (withFingers) {
		mk("mixamorigLeftHandMiddle1", lHand, 9, 0, 0);
		mk("mixamorigRightHandMiddle1", rHand, -9, 0, 0);
	}
	const lUp = mk("mixamorigLeftUpLeg", hips, 10, 0, 0);
	const lLeg = mk("mixamorigLeftLeg", lUp, 0, -45, 0);
	const lFoot = mk("mixamorigLeftFoot", lLeg, 0, -45, 0);
	mk("mixamorigLeftToeBase", lFoot, 0, -5, 12);
	const rUp = mk("mixamorigRightUpLeg", hips, -10, 0, 0);
	const rLeg = mk("mixamorigRightLeg", rUp, 0, -45, 0);
	const rFoot = mk("mixamorigRightFoot", rLeg, 0, -45, 0);
	mk("mixamorigRightToeBase", rFoot, 0, -5, 12);
	rig.updateMatrixWorld(true);
	return rig;
}

/**
 * A REAL Mixamo hand: mixamorig{Side}Hand{Thumb,Index,Middle,Ring,Pinky}1..4 on
 * top of whatever makeRig already built. Each finger runs 9 cm out from the
 * knuckle in three 3 cm phalanges, so the tip sits 18 cm past the wrist — the
 * palm's length again, which is exactly why a wrist-only proxy cannot judge a
 * hand pressed into anything.
 */
function addFingers(rig) {
	const SPREAD = { Thumb: -3, Index: -1.5, Middle: 0, Ring: 1.5, Pinky: 3 };
	for (const side of ["Left", "Right"]) {
		const sign = side === "Left" ? 1 : -1;
		const hand = rig.getObjectByName(`mixamorig${side}Hand`);
		for (const finger of ["Thumb", "Index", "Middle", "Ring", "Pinky"]) {
			let parent = rig.getObjectByName(`mixamorig${side}Hand${finger}1`);
			if (!parent) {
				parent = new THREE.Bone();
				parent.name = `mixamorig${side}Hand${finger}1`;
				parent.position.set(9 * sign, 0, SPREAD[finger]);
				hand.add(parent);
			}
			for (let joint = 2; joint <= 4; joint += 1) {
				const bone = new THREE.Bone();
				bone.name = `mixamorig${side}Hand${finger}${joint}`;
				bone.position.set(3 * sign, 0, 0);
				parent.add(bone);
				parent = bone;
			}
		}
	}
	rig.updateMatrixWorld(true);
	return rig;
}

/** makeRig with a full set of fingers on both hands. */
function makeHandRig() {
	return addFingers(makeRig(true));
}

// Plausible humanoid radii (metres). The synthetic rig has no skinned mesh
// to measure, so tests inject them explicitly.
const RADII = {
	Spine: 0.13, Head: 0.11, Neck: 0.06,
	LeftArm: 0.05, LeftForeArm: 0.045, LeftHand: 0.05,
	RightArm: 0.05, RightForeArm: 0.045, RightHand: 0.05,
	LeftUpLeg: 0.075, LeftLeg: 0.055, LeftFoot: 0.05,
	RightUpLeg: 0.075, RightLeg: 0.055, RightFoot: 0.05,
};

function penetrations(rig) {
	const capsules = buildCollisionCapsules(rig, RADII);
	return detectPenetrations(capsules, { offset: 0 });
}

/** "a×b" with the ids sorted, so a pair reads the same whichever side of the
 * detection loop it came from. */
function pairIds(pen) {
	return [pen.a.def.id, pen.b.def.id].sort().join("×");
}

/* --- build: every capsule resolves, T-pose is clean ----------------------- */

/* --- build: every capsule resolves, T-pose is clean ----------------------- */
{
	const rig = makeRig();
	const capsules = buildCollisionCapsules(rig, RADII);
	check("builds all 15 body capsules", capsules && capsules.size === 15);
	check("capsule world positions respect rig scale",
		Math.abs(capsules.get("torso").a.y - 1.0) < 1e-6);
	const pens = penetrations(rig);
	check("T-pose reports no self-collision", pens.length === 0,
		`got ${pens.map((p) => `${p.a.def.id}×${p.b.def.id}@${p.depth.toFixed(3)}`).join(", ")}`);
}

/* --- detect: a wrist dragged into the chest is caught --------------------- */
{
	const rig = makeRig();
	const { chains } = resolveIkRig(rig);
	solveIk(chains.get("leftHand"), new THREE.Vector3(0.05, 1.45, 0));
	const pens = penetrations(rig);
	check("forearm-through-chest is detected", pens.length > 0,
		"no penetration found");
	check("detection names the arm and the torso",
		pens.some((p) => /left(ForeArm|Hand|UpperArm)/.test(p.a.def.id + p.b.def.id)
			&& /torso|chest/.test(p.a.def.id + p.b.def.id)),
		pens.map((p) => `${p.a.def.id}×${p.b.def.id}`).join(", "));
}

/* --- offset: the skin gap is part of the TEST, not just the push ---------- */
/* A pose parked just clear of the thigh at offset 0 must read as penetrating
 * once a gap is demanded, and an already-reported pair's depth must grow by
 * exactly the offset. Before the fix, offset only scaled the push, so the
 * fixer opened a gap detection never asked for and immediately forgot. */
{
	const rig = makeRig();
	const { chains } = resolveIkRig(rig);
	solveIk(chains.get("leftHand"), new THREE.Vector3(0.22, 0.85, 0));
	const capsules = buildCollisionCapsules(rig, RADII);
	check("a grazing pose is clean with no offset",
		detectPenetrations(capsules, { offset: 0 }).length === 0);
	check("the same pose penetrates once a skin gap is demanded",
		detectPenetrations(capsules, { offset: 0.03 }).length > 0);

	const deeper = makeRig();
	const { chains: chains2 } = resolveIkRig(deeper);
	solveIk(chains2.get("leftHand"), new THREE.Vector3(0.2, 0.85, 0));
	const caps2 = buildCollisionCapsules(deeper, RADII);
	const bare = detectPenetrations(caps2, { offset: 0 })[0];
	const gapped = detectPenetrations(caps2, { offset: 0.01 })[0];
	check("offset adds itself to the reported depth",
		bare && gapped && Math.abs((gapped.depth - bare.depth) - 0.01) < 1e-9,
		`delta=${gapped && bare ? (gapped.depth - bare.depth).toFixed(6) : "n/a"}`);
}

/* --- hand capsule: fingers when the rig has them, wrist sphere when not --- */
{
	const bare = buildCollisionCapsules(makeRig(false), RADII);
	const fingered = buildCollisionCapsules(makeRig(true), RADII);
	check("a fingerless rig still builds every capsule",
		bare && bare.size === 15, "optional end must not disqualify the rig");
	check("the fingerless hand degrades to a wrist sphere",
		bare.get("leftHand").a.distanceTo(bare.get("leftHand").b) < 1e-9);
	check("the hand capsule reaches the middle finger when present",
		Math.abs(fingered.get("leftHand").a.distanceTo(fingered.get("leftHand").b) - 0.09) < 1e-6,
		`span=${fingered.get("leftHand").a.distanceTo(fingered.get("leftHand").b).toFixed(4)}`);
	check("both spellings of the rig are supported",
		supportsCollisionCleanup(makeRig(false)) && supportsCollisionCleanup(makeRig(true)));
}

/* --- and the fingers CHANGE the verdict: fingertip through the thigh ------ */
/* Wrist parked clear of the thigh, fingers sunk into it. Judged at the wrist
 * this pose is clean — the exact miss the optional end exists to close. */
{
	const target = new THREE.Vector3(0.18, 0.95, -0.1);
	const wristOnly = makeRig(false);
	solveIk(resolveIkRig(wristOnly).chains.get("leftHand"), target);
	const fingered = makeRig(true);
	solveIk(resolveIkRig(fingered).chains.get("leftHand"), target);
	check("the wrist sphere misses a fingertip in the thigh",
		detectPenetrations(buildCollisionCapsules(wristOnly, RADII), { offset: 0 }).length === 0);
	check("the finger-extended hand catches it",
		detectPenetrations(buildCollisionCapsules(fingered, RADII), { offset: 0 })
			.some((p) => /leftHand/.test(p.a.def.id + p.b.def.id) && /leftThigh/.test(p.a.def.id + p.b.def.id)));
}

/* --- QA S2-C: siblings are not hinges, and a reporting floor --------------- */
/* thigh × thigh fired at 0.218 mm during a normal walk stride and the pass
 * keyed the frame and moved the pose 16 mm for it. Two rules, not one: a pair
 * that meets only through a shared PARENT is an ordinary calibrated pair (it has
 * no joint between the two segments to trim toward), and nothing under MIN_DEPTH
 * is reported at all. */
{
	check("the reporting floor is the documented 4 mm", MIN_DEPTH === 0.004);

	/** Thighs `gap` metres apart at the axis, the walk-stride geometry. */
	const straddle = (gap) => {
		const rig = makeRig(true);
		primeBindPose(rig);
		rig.getObjectByName("mixamorigLeftUpLeg").position.set(gap * 50, 0, 0);
		rig.getObjectByName("mixamorigRightUpLeg").position.set(-gap * 50, 0, 0);
		rig.updateMatrixWorld(true);
		return rig;
	};
	// radii 0.075 + 0.075 + 0.002 offset, slack 0.25 × 0.075 = 0.01875.
	const depthOf = (gap) => {
		const hits = detectPenetrations(buildCollisionCapsules(straddle(gap), RADII));
		return hits.find((p) => pairIds(p) === "leftThigh×rightThigh")?.depth ?? 0;
	};
	check("a walk-stride graze between the thighs is not reported",
		depthOf(0.1315) === 0, `depth=${(depthOf(0.1315) * 1000).toFixed(3)}mm`);
	check("a real thigh-through-thigh crossing still is, at full depth",
		Math.abs(depthOf(0.05) - (0.15 + 0.002 - 0.05 - 0.01875)) < 1e-6,
		`depth=${(depthOf(0.05) * 1000).toFixed(2)}mm`);
	// If siblings were treated as a hinge, their allowance would be
	// 0.65 × (0.075 + 0.075) = 97.5 mm and a 10 cm crossing would read clean.
	check("the sibling pair is judged by the ordinary rule, not a hinge allowance",
		depthOf(0.05) > 0.065, `depth=${(depthOf(0.05) * 1000).toFixed(2)}mm`);

	// The same floor covers the feet, which graze constantly in a stride.
	{
		const rig = makeRig(true);
		primeBindPose(rig);
		rig.getObjectByName("mixamorigLeftUpLeg").position.set(5.4, 0, 0);
		rig.getObjectByName("mixamorigRightUpLeg").position.set(-5.4, 0, 0);
		rig.updateMatrixWorld(true);
		const feet = detectPenetrations(buildCollisionCapsules(rig, RADII))
			.filter((p) => pairIds(p) === "leftFoot×rightFoot");
		check("a millimetre of foot × foot in a stride is not worth a key",
			feet.length === 0 || feet[0].depth >= MIN_DEPTH,
			feet.map((p) => `${(p.depth * 1000).toFixed(2)}mm`).join(", "));
	}
}

{
	const rig = makeHandRig();
	const capsules = buildCollisionCapsules(rig, RADII);
	const fingers = [...capsules.values()].filter((capsule) => capsule.def.fixedRadius);
	check("a full Mixamo hand adds one capsule per finger", capsules.size === 25 && fingers.length === 10, `size=${capsules?.size} fingers=${fingers.length}`);
	check("finger capsules use the fixed finger radius", fingers.every((capsule) => capsule.radius === FINGER_RADIUS));
}

{
	check("the documented detection thresholds", DEFAULT_SLACK_FACTOR === 0.25 && PAIR_TOLERANCE === 0.005
		&& TRIM_FRACTION === 0.45 && HINGE_SLACK_FACTOR === 0.65 && FINGER_RADIUS === 0.011);
}

console.log(failures ? `\n${failures} FAIL` : "\nall pass");
process.exit(failures ? 1 : 0);
