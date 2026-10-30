// smokeCigarette from any posture, and dressed with kits (docs/motion-api-v3.1.md C15).
//   args.kit = { cig, lighter, exhale? }: the kit roots object.createKit made (src/kits/) ride the
//   props cig and lighter at the grip (at/along pin the root to the palm), and their lit parts
//   switch with the skill's channels. A part is found by what it is, not by its name: under the
//   cigarette a glowing body and a light (the ember: ember_vis, level ember) and an effect (the
//   tip smoke: ember_vis); under the lighter a glowing body (the flame) and a light (flame_vis).
//   exhale is the exhale kit's root (or any effect): it follows the mouth, facing forward, and shows
//   while the exhale channel is on (C16: { follow: "landmark:mouth", aim: "face", visible: "exhale" }).
//   squat: with the hips keyed low before f0 the cigarette rests over the right knee, not beside
//   the hip where the thigh is, and the hand leaves (and comes back to) the lips straight ahead
//   first (anchor mouthOut): a straight move between the lips and the knee would cross the hand's
//   detour circle around the leaning torso going down, where the detour jumps.
import { skillError } from "./book.js";
import { groupsOf } from "../scene.js";
import { pose } from "../compiler/pose.js";
import { bonePoint } from "../compiler/skeleton.js";
import { add, sub, scale, len, apply, ry } from "../compiler/math.js";
import { HAND_CLEAR, keepOut, wristBody } from "../body.js";

const KIT_FIELDS = ["cig", "lighter", "exhale"];
/** The exhale emitter's entry: at the lips, its +Y (the puff) along the face, shown while breathing out. */
const EXHALE = { follow: "landmark:mouth", aim: "face", visible: "exhale" };
const KIT_OF = { cig: "cigarette", lighter: "lighter" };
/** Below this share of the rig's standing hips height the pose before f0 is a squat. */
const SQUAT_HIPS = 0.7;
/** The resting cigarette hand over the right knee, from the knee joint in the body frame (m): out, up, forward. */
const OVER_KNEE = [-0.05, 0.07, 0.1];
/** A knee farther than this share of the arm's length from the shoulder: the hand rests on the thigh short of it. */
const REST_REACH = 0.88;
/** Where the hand goes first from the lips in a squat: this far straight ahead of the mouth (m, body frame). */
const OUT_AHEAD = 0.2;
/** A squat's side pocket from the root (body frame, the left side; m): out, up, ahead. */
const SIDE_POCKET = [0.245, 0.08, 0.02];
/** The pockets on the standing body (body frame: left +x), where the hands fetch the kit. */
export const POCKET = { l: [0.13, -0.035, 0.08], r: [-0.13, -0.035, 0.08] };

/** [id, entry, body] of every record under group `root` in a motion scene (bodies and box-less records). */
function partsUnder(scene, root) {
	const rows = Object.entries(scene?.objects ?? {}).map(([id, o]) => [id, o, true]).concat(Object.entries(scene?.others ?? {}).map(([id, o]) => [id, o, false]));
	return rows.filter(([, o]) => o.ancestors?.includes(root));
}

function rootOf(ctx, kit, role) {
	const id = kit[role];
	if (typeof id !== "string" || !groupsOf(ctx.scene)[id]) skillError(ctx.tag, `args.kit.${role} ${JSON.stringify(id)} is not a group in the scene; object.createKit { kit: "${KIT_OF[role]}" } answers its rootId`);
	return id;
}

/** How deep a kit may sit in the thigh its pocket is on, and in the hip over it (a squat folds the pocket into the hip crease): it comes out of (and goes back into) the pocket there. */
const POCKET_DEPTH = { cig: 0.03, lighter: 0.045 };
/** Squatting, the kit comes out of a side pocket past the fat leg capsules (thigh, hips, shin) the scene check reads. */
const SQUAT_POCKET = 0.07;
/** ...and the hand in a side pocket touches the thigh and the hip that deep (m). */
const POCKET_TOUCH = 0.04;

/**
 * The spec.objects entries args.kit asks for and the pocket allowances (null without it). at:
 * absolute frames { cig, lit, unlit } the cigarette and the lighter appear and the lighter goes back; squat: the squat pockets.
 */
export function kitObjects(ctx, at) {
	const kit = ctx.args.kit;
	if (kit === undefined) return null;
	if (!kit || typeof kit !== "object" || Array.isArray(kit)) skillError(ctx.tag, `args.kit must be { cig, lighter, exhale? } (kit root ids), got ${JSON.stringify(kit)}`);
	for (const f of Object.keys(kit)) if (!KIT_FIELDS.includes(f)) skillError(ctx.tag, `args.kit has unknown field "${f}"; fields: ${KIT_FIELDS.join(", ")}`);
	const cig = rootOf(ctx, kit, "cig"), lighter = rootOf(ctx, kit, "lighter");
	const objects = {
		[cig]: { prop: "cig", grab: at.cig, at: [0, 0, 0], along: [0, 0, 1], visible: "cig_vis" },
		[lighter]: { prop: "lighter", grab: at.lit, release: at.unlit, at: [0, 0, 0], along: [0, 1, 0], visible: "lit_vis" },
	};
	for (const [id, o, body] of partsUnder(ctx.scene, cig)) {
		if ((body && o.glow) || (!body && o.renderer === "light")) objects[id] = { visible: "ember_vis", level: "ember" };
		else if (!body && o.renderer === "effect") objects[id] = { visible: "ember_vis" };
	}
	for (const [id, o, body] of partsUnder(ctx.scene, lighter)) if ((body && o.glow) || (!body && o.renderer === "light")) objects[id] = { visible: "flame_vis" };
	if (kit.exhale !== undefined) {
		if (typeof kit.exhale !== "string" || !(ctx.scene?.others?.[kit.exhale] || ctx.scene?.objects?.[kit.exhale] || groupsOf(ctx.scene)[kit.exhale])) {
			skillError(ctx.tag, `args.kit.exhale ${JSON.stringify(kit.exhale)} is not a scene object; object.createKit { kit: "exhale" } answers its rootId (it follows the mouth)`);
		}
		objects[kit.exhale] = { ...EXHALE };
	}
	const deep = d => (at.squat ? SQUAT_POCKET : d);
	const allow = [["thigh_r", cig, deep(POCKET_DEPTH.cig)], ["thigh_l", lighter, deep(POCKET_DEPTH.lighter)], ["hips", cig, deep(POCKET_DEPTH.cig)], ["hips", lighter, deep(POCKET_DEPTH.lighter)],
		...(at.squat ? [["shin", cig, SQUAT_POCKET], ["shin", lighter, SQUAT_POCKET],
			// the hands in the side pockets brush the thigh and the hip (qa/body-checks.js)
			["hand_l", "thigh_l", POCKET_TOUCH], ["hand_r", "thigh_r", POCKET_TOUCH], ["hand", "hips", POCKET_TOUCH]] : [])].map(([part, object, depth]) => ({ part, object, depth }));
	return { objects, allow };
}

/**
 * For a squat keyed before f0, the body-frame anchors { hold, mouthOut }: the resting hand over the
 * right knee and the point the hand leaves the lips toward; null when the pose is not a squat.
 */
export function squatAnchors(ctx) {
	const { sk, state } = ctx, I = sk.index, P = sk.restWorldPos;
	if (!(state.root[1] < SQUAT_HIPS * P[I.Hips][1])) return null;
	const { s } = pose(sk, state), yaw = state.yaw ?? 0, shoulder = s.P[I.RightArm], body = p => apply(ry(-yaw), sub(p, state.root));
	const arm = len(sub(P[I.RightForeArm], P[I.RightArm])) + len(sub(P[I.RightHand], P[I.RightForeArm]));
	const over = add(s.P[I.RightLeg], apply(ry(yaw), OVER_KNEE)), far = len(sub(over, shoulder));
	const hold = body(far > REST_REACH * arm ? add(shoulder, scale(sub(over, shoulder), REST_REACH * arm / far)) : over);
	const out = add(body(bonePoint(s, I.Head, sk.landmarks.mouth)), [0, 0, OUT_AHEAD]);
	// squatting, the front pockets fold into the hip crease under the thighs: with fix.self (smoke.js) the hands go to the side pockets,
	// SIDE_POCKET from the root (body frame), kept off the skin (the hand comes in from the side)
	const skin = wristBody(sk), pocket = (side, sg) => {
		const at = add(state.root, apply(ry(yaw), [sg * SIDE_POCKET[0], SIDE_POCKET[1], SIDE_POCKET[2]]));
		return body(skin ? keepOut(skin.body, sk, s, at, HAND_CLEAR, skin.skip) : at);
	};
	const r3 = p => p.map(v => Math.round(v * 1000) / 1000);
	return { hold: r3(hold), mouthOut: r3(out), lpocket: r3(pocket("Left", 1)), rpocket: r3(pocket("Right", -1)) };
}
