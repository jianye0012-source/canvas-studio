// Bone names as the agent writes them -> the rig's bone. Tried in order: the exact name, the
// name in any case ("hips", "lefthand"), the name without a "mixamorig:" prefix, then aliases
// ("pelvis" -> Hips, "hand_l" / "l_hand" / "left hand" -> LeftHand, "thigh_r" -> RightUpLeg).
// Nothing found: a "did you mean" suggestion. Callers that hand the name on to code that needs
// the exact name (validate-common.js boneOk, sk.index) use the answered `bone`.
import { didYouMean } from "./compiler/vocab.js";

// Unsided aliases (lower case, no separators) -> the rig's name.
const ALIAS = { pelvis: "Hips", hip: "Hips", hips: "Hips", root: "Hips", chest: "Spine2", upperchest: "Spine2", torso: "Spine1", belly: "Spine",
	abdomen: "Spine", neck: "Neck", head: "Head" };
// Sided part aliases -> the part after Left/Right.
const PART = { hand: "Hand", wrist: "Hand", foot: "Foot", ankle: "Foot", toe: "ToeBase", toes: "ToeBase", ball: "ToeBase", arm: "Arm", upperarm: "Arm",
	forearm: "ForeArm", lowerarm: "ForeArm", elbow: "ForeArm", shoulder: "Shoulder", clavicle: "Shoulder", thigh: "UpLeg", upleg: "UpLeg",
	upperleg: "UpLeg", leg: "Leg", lowerleg: "Leg", shin: "Leg", calf: "Leg", knee: "Leg" };
const SIDE = { l: "Left", left: "Left", r: "Right", right: "Right" };

const squash = s => s.toLowerCase().replace(/[\s_.-]+/g, "");

function caseless(sk, name) {
	const want = name.toLowerCase();
	return sk.names.find(n => n.toLowerCase() === want) ?? null;
}

function alias(sk, name) {
	const flat = squash(name);
	if (ALIAS[flat]) return caseless(sk, ALIAS[flat]);
	const low = name.toLowerCase().trim();
	const pre = /^(l|r|left|right)[\s_.-]+(.+)$/.exec(low) ?? /^(left|right)(.+)$/.exec(low);
	const post = /^(.+?)[\s_.-]+(l|r|left|right)$/.exec(low) ?? /^(.+?)(left|right)$/.exec(low);
	const [side, part] = pre ? [pre[1], pre[2]] : post ? [post[2], post[1]] : [];
	if (!side) return null;
	return caseless(sk, `${SIDE[side]}${PART[squash(part)] ?? squash(part)}`);
}

/**
 * @param {{ index: Record<string, number>, names: string[] }} sk  the rig (rigs/index.js skeletonFor)
 * @param {string} name
 * @returns {{ bone: string | null, hint: string }} bone = the rig's own name, or null; hint = the
 *   suffix for an error message when bone is null ('; did you mean "LeftHand"?' or "").
 */
export function resolveBone(sk, name) {
	if (typeof name !== "string" || !name) return { bone: null, hint: "" };
	if (sk.index[name] !== undefined) return { bone: name, hint: "" };
	const bare = name.replace(/^mixamorig\d*:/i, "");
	const bone = caseless(sk, name) ?? caseless(sk, bare) ?? alias(sk, bare);
	return bone ? { bone, hint: "" } : { bone: null, hint: didYouMean(bare, sk.names) };
}
