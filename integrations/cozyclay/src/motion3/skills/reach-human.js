// How a person's reach to grasp unfolds in time (reachGrip's keys), from the prehension literature:
//   transport  the wrist's speed is a single bell whose peak comes early, at about a third of the movement, and the
//              longer deceleration (about two thirds) is the slow approach onto the object (time to peak velocity 33 %
//              of movement time: Paulignan et al., Exp Brain Res 1991, doi:10.1007/BF00231858). A minimum-jerk bell
//              (Flash & Hogan 1985) on time warped by t^WARP puts the peak at 0.5^(1/WARP) of the reach.
//   grasp      the hand stays open wider than the object through the transport and closes onto it in the slow
//              approach: the maximum grip aperture comes at about two thirds to three quarters of the movement (Jeannerod,
//              J Mot Behav 1984; Hu et al., Exp Brain Res 2005), and it scales with the object's size (Marteniuk et al.,
//              Hum Mov Sci 1990), a couple of centimetres wider than the object (MARGIN). These rigs' relaxed hands are
//              already open (thumb tip to index tip: Y Bot 11.5 cm, X Bot 9.7 cm) and there is no wider preset: a thing
//              that fits that opening with the margin (a can, a cup) is reached with the hand held open to CLOSE of the
//              reach, then closed on it; a wider one closes along the reach as before, or the open fingers would sweep
//              into it on the way (a 10 cm box: 6 cm deep). So does a thing that sits more than OVER m in from the near
//              edge of what it stands on: the open fingertips hang below the hand and dragged across the table top on the
//              way (a cup 12 cm in, bench S8). CLOSE is 0.4, earlier than a person's: the hand comes straight in, and the
//              open fingertips (about 8 cm past the finger middles) went into a cup wrapped from the side when they
//              stayed open later (1.5 cm at 0.7); a hand that plans an arc around the thing is the next step.
//   gaze       the eyes go to the grasp point before the hand gets there and stay on it until the hand has it
//              (Johansson et al., J Neurosci 2001;21:6917). The rigs have no eyes: the head turns HEAD_SHARE of the
//              way, done by GAZE of the reach, held through the hold, back by the end of the release.
import { add, apply, len, sub } from "../compiler/math.js";
import { restState } from "../compiler/skeleton.js";
import { fingers } from "../compiler/limbs.js";
import { sdBox } from "../qa/geometry.js";

const WARP = 0.65, ARM_WARP = 0.75, HEAD_SHARE = 0.75, MARGIN = 0.025, KNEE = 0.1, OVER = 0.08, BELOW = 0.12;
export const CLOSE = 0.4, GAZE = 0.3;
const TRANSPORT = [0.15, 0.3, 0.45, 0.6, 0.7, 0.8, 0.9];
const minJerk = t => t * t * t * (10 - 15 * t + 6 * t * t);
/** The share of the way the hand has come at fraction t of the reach. */
// two phases: the fast transport covers NEAR of the way by SLOW of the time, the low-velocity approach the rest while the
// fingers close (about half the movement time is that slow approach after peak deceleration, Paulignan et al. 1991)
const NEAR = 0.9, SLOW = 0.7;
const transport = (t, warp) => {
	const u = Math.min(1, Math.max(0, t));
	return u < SLOW ? NEAR * minJerk(Math.pow(u / SLOW, warp)) : NEAR + (1 - NEAR) * minJerk((u - SLOW) / (1 - SLOW));
};
/**
 * Inner keys of the transport for a reach of n frames: [frame from f0, the target's share, the arm's IK share]. The arm's
 * IK weight follows a milder bell (ARM_WARP): the hand is the blend of the two, and the target's bell alone on an arm
 * blending in at its plain ease peaked at mid-reach, while both at WARP pushed a cup reach past the QA's one-frame pop.
 */
export const transportKeys = n => [...new Map(TRANSPORT.map(t => Math.round(t * n)).filter(f => f > 0 && f < n).map(f => [f, [transport(f / n, WARP), transport(f / n, ARM_WARP)]])).entries()].map(([f, [t, a]]) => [f, t, a]);

const DEG = 180 / Math.PI, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/**
 * True when the reach to anchor a takes the early-peaked transport: a thing at rest (a world point or a scene object's;
 * a reach to a body, a bone or a prop chases a moving point) above the knees (KNEE m over the rest knee). A person
 * reaching lower bends or crouches, which these keys do not plan: the arm alone, sped up early, swept the thigh and
 * shin on the way to a vending tray (QA 5 -> 7), so a low reach keeps the plain ease.
 */
export function earlyTransport(ctx, a) {
	const p = restPoint(ctx, a), I = ctx.sk.index;
	return !!p && p[1] >= ctx.sk.restWorldPos[I.LeftLeg][1] + KNEE;
}

/** The world point an anchor rests at before the grab (world, or a scene object's point), or null for one that moves with a body. */
function restPoint(ctx, a) {
	if (a?.kind === "world" && Array.isArray(a.p)) return a.p.map(Number); // a copy, as in bodyOf
	const o = a?.kind === "object" ? ctx.scene?.objects?.[a.object] : null;
	if (!o || [a.object, ...(o.ancestors ?? [])].some(id => movesBy(ctx, id))) return null;
	return add(o.pos, apply(o.R, a.local ?? [0, o.half?.[1] ?? 0, 0]));
}

/**
 * True when spec.objects moves record `id` before the reach is done (ctx.until): a follow or a hinge, or keys or a fall
 * from before that frame (a carry whose keys start at a grab after the hand arrives rests until then).
 */
function movesBy(ctx, id) {
	const o = ctx.objects?.[id];
	if (!o || typeof o !== "object") return false;
	if (o.follow !== undefined || o.hinge !== undefined) return true;
	const from = Math.min(...(o.keys ?? []).map(k => k.f).filter(Number.isFinite), o.fall?.at ?? Infinity);
	return from < (ctx.until ?? Infinity);
}

const opened = new WeakMap();
/** The rig's relaxed hand opening, thumb tip to index tip (m). */
function openHand(sk) {
	if (!opened.has(sk)) {
		const s = restState(sk), I = sk.index;
		fingers(sk, s, "Right", {});
		opened.set(sk, len(sub(s.P[I.RightHandThumb4], s.P[I.RightHandIndex4])));
	}
	return opened.get(sk);
}

/** The scene body anchor a reaches for (its object, or the body its world point lies in), or null. */
function bodyOf(ctx, a) {
	const objects = ctx.scene?.objects ?? {};
	if (a?.kind === "object") return objects[a.object]?.half ? objects[a.object] : null;
	if (a?.kind !== "world" || !Array.isArray(a.p)) return null;
	// a copy: the spec's own (frozen) array passed into the shared vector math deoptimised it for the whole compile (2x)
	const p = a.p.map(Number);
	return Object.values(objects).filter(o => o.half && sdBox(p, o) <= 0.01).sort((x, y) => sdBox(p, x) - sdBox(p, y))[0] ?? null;
}

/** True when, OVER m short of point p toward the character (root r), the hand is still above a surface within BELOW m under p. */
function overSupport(ctx, p, r, skip) {
	const dx = r[0] - p[0], dz = r[2] - p[2], d = Math.hypot(dx, dz);
	if (d < 1e-6) return false;
	const q = [p[0] + (dx / d) * OVER, p[1], p[2] + (dz / d) * OVER];
	return Object.entries(ctx.scene?.objects ?? {}).some(([id, o]) => {
		if (!o.half || skip.has(id) || skip.has(o.parent)) return false;
		const top = sub(q, [0, BELOW, 0]);
		return sdBox(q, o) > 0 && sdBox(top, o) <= 0;
	});
}

/**
 * True when the hand stays open on the way to the thing anchor a reaches for, from the pose at f0 (state): it fits the
 * rig's open hand with MARGIN, and the hand's last OVER m to it are not over the surface it rests on.
 */
export function holdsOpen(ctx, a, state) {
	const o = bodyOf(ctx, a), p = restPoint(ctx, a) ?? (o && add(o.pos, apply(o.R, [0, o.half[1], 0])));
	if (!o || !p || 2 * Math.min(...o.half) + MARGIN > openHand(ctx.sk)) return false;
	const skip = new Set(Object.entries(ctx.scene.objects).filter(([, x]) => x === o).map(([id]) => id));
	return !(Array.isArray(state.root) && overSupport(ctx, p, state.root, skip));
}

/**
 * The head's yaw and pitch (deg, the head's own channels) that turn the gaze HEAD_SHARE of the way onto anchor a from the
 * pose at f0 (state), or null when the anchor moves with a body or the pose has no root.
 */
export function gazeAt(ctx, a, state) {
	const p = restPoint(ctx, a), r = state.root;
	if (!p || !Array.isArray(r)) return null;
	const P = ctx.sk.restWorldPos, I = ctx.sk.index, eye = [r[0], r[1] + P[I.Head][1] - P[I.Hips][1], r[2]];
	const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]], flat = Math.hypot(d[0], d[2]);
	if (flat < 0.05) return null;
	let yaw = Math.atan2(d[0], d[2]) * DEG - (state.yaw ?? 0) - (state.spine_yaw ?? 0);
	while (yaw > 180) yaw -= 360;
	while (yaw < -180) yaw += 360;
	const down = Math.atan2(-d[1], flat) * DEG - (state.pitch ?? 0) - (state.spine_pitch ?? 0);
	return { head_yaw: clamp(HEAD_SHARE * yaw, -60, 60), head_pitch: clamp(HEAD_SHARE * down, -30, 50) };
}

/** True when keys before this skill already move the head within [a, b]: a keyed look wins. */
export const headKeyed = (keys, a, b) => keys.some(k => k.f >= a && k.f <= b && (k.set?.head_yaw !== undefined || k.set?.head_pitch !== undefined));
