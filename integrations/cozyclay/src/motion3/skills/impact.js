// hitReaction: a body thrown by a hit (a car, a shove, a blow) and coming to rest on the floor, from the pose at f0.
// Deterministic physics on the root: launched along the push at `speed` (m/s) and up (from the speed), it flies under gravity, lands
// when the hips reach lying height, then slides to a stop on floor friction. The body turns to fall along the push
// (on its back when pushed from the front, "land"), the trunk and head whip on a damped spring against the shove,
// the arms flail and trail, the legs follow the hips (feet held off the floor) and the whole body lies still at the end.
import { add, apply, ry, rx } from "../compiler/math.js";
import { tiltFrame } from "../compiler/pose.js";
import { personJoint } from "../people.js";
import { skillError } from "./book.js";

// LIE: the root's height lying on the back or face down, the trunk's skin just on the floor (X/Y Bot)
const G = 9.81, FPS = 24, MU = 0.75, LIE = { back: 0.16, front: 0.11 }, TURN = 0.25, ONSET = 0.12, LIFT_OFF = 0.25;
/** Distance covered by a speed that builds up over ONSET s (a hit pushes for about a tenth of a second, not one frame). */
const ramp = t => t - ONSET * (1 - Math.exp(-t / ONSET));
/** A foot held off the floor eases onto it (softplus over w m) instead of being cut at it. */
const softFloor = (y, lie, w) => lie + w * Math.log1p(Math.exp((y - lie) / w));
/** The landing: the fall stops over CUSHION s at one deceleration (spread over frames, not one), the trunk sinking SINK m
 * into its own give past lying height, and springs back to it over SETTLE s. */
const CUSHION = 3 / FPS, SINK = 0.03, SETTLE = 0.25;
const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (6 * t - 15) + 10); };
const wrap = d => ((d + 540) % 360) - 180;
const r3 = v => v.map(x => Math.round(x * 1000) / 1000);
const r1 = x => Math.round(x * 10) / 10;

/** Where the earlier keys have a vec3 channel at frame f, read straight between the keys around it (state holds the last key). */
function track(keys, ch, f) {
	let a = null, b = null;
	for (const k of keys) {
		const v = k.set?.[ch];
		if (!Array.isArray(v)) continue;
		if (k.f <= f && (!a || k.f >= a.f)) a = { f: k.f, v };
		if (k.f > f && (!b || k.f < b.f)) b = { f: k.f, v };
	}
	if (!a || !b) return a?.v;
	const w = (f - a.f) / (b.f - a.f);
	return a.v.map((x, i) => x + (b.v[i] - x) * w);
}

/** The push direction [x, z] (unit) from args.dir, or from args.from (object:<id> | person:<id>) toward the hips. */
function pushOf(ctx, root) {
	const { args, scene } = ctx;
	let d = args.dir;
	if (!d && typeof args.from === "string") {
		const [kind, id] = args.from.split(/:(.*)/s);
		const at = kind === "object" ? scene?.objects?.[id]?.pos : kind === "person" ? personJoint(scene, id, "Hips", ctx.f0) : null;
		if (!at) skillError(ctx.tag, `args.from "${args.from}" must be object:<id> of a scene body or person:<id> of a character with an installed take`);
		d = [root[0] - at[0], root[2] - at[2]];
	}
	if (!Array.isArray(d) || d.length !== 2 || !(Math.hypot(d[0], d[1]) > 1e-6)) skillError(ctx.tag, "needs args.dir: [x, z] (the way the body is thrown) or args.from: object:<id> | person:<id> (what hits it)");
	const n = Math.hypot(d[0], d[1]);
	return [d[0] / n, d[1] / n];
}

export function hitReaction(ctx) {
	const { sk, args, state } = ctx, I = sk.index, P = sk.restWorldPos;
	if (!state.root) skillError(ctx.tag, "needs a pose keyed before f0 (standIdle, a walk, ...)");
	// the hit takes the body where the earlier motion has it at f0, a foot in the air going on at its speed
	const root0 = track(ctx.keys, "root", ctx.f0) ?? state.root.slice(), from = {};
	for (const k of ["l", "r"]) {
		const at = track(ctx.keys, `foot_${k}`, ctx.f0), was = track(ctx.keys, `foot_${k}`, ctx.f0 - 1);
		if (at) from[k] = { at, v: was ? at.map((x, i) => x - was[i]) : [0, 0, 0] };
	}
	const yaw0 = state.yaw ?? 0, [dx, dz] = pushOf(ctx, root0);
	const speed = args.speed ?? 4;
	if (!(Number.isFinite(speed) && speed > 0)) skillError(ctx.tag, `args.speed must be a launch speed above 0 m/s, got ${JSON.stringify(args.speed)}`);
	const up = Math.min(2.5, Math.max(0.8, 0.3 * speed));
	// pushed against the way it faces (a hit from the front) it lands on its back; "land" overrides
	const facing = apply(ry(yaw0), [0, 0, 1]), back = (args.land ?? (dx * facing[0] + dz * facing[2] <= 0 ? "back" : "front")) === "back";
	const head = Math.atan2(dx, dz) * 180 / Math.PI, yawT = back ? head + 180 : head, turn = wrap(yawT - yaw0), pitchT = back ? -90 : 90;
	const lie = back ? LIE.back : LIE.front, y0 = root0[1], fall = t => y0 + up * ramp(t) - 0.5 * G * t * t, vel = t => up * (1 - Math.exp(-t / ONSET)) - G * t;
	// the cushion starts at t1 where the fall, slowed evenly to rest over CUSHION, ends just at lying height
	let lo = 0, hi = (up + Math.sqrt(up * up + 2 * G * Math.max(0, y0 - lie))) / G + 1;
	for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (fall(m) + vel(m) * CUSHION / 2 > lie - SINK || vel(m) > 0) lo = m; else hi = m; }
	const t1 = lo, v1 = Math.min(0, vel(t1)), y1 = fall(t1), T = t1 + CUSHION, tSlide = speed / (MU * G), tRest = T + tSlide;
	const height = t => t < t1 ? fall(t) : t < T ? y1 + v1 * (t - t1) - v1 / (2 * CUSHION) * (t - t1) ** 2 : lie - SINK * (1 - smooth((t - T) / SETTLE));
	const ankle = P[I.LeftFoot][1], hipsY = P[I.Hips][1], sign = back ? 1 : -1, LEG = 0.9 * Math.hypot(...[0, 1, 2].map(i => P[I.LeftFoot][i] - P[I.Hips][i]));
	const end = ctx.f0 + Math.ceil((tRest + 0.6) * FPS), keys = [];
	for (let f = ctx.f0; f <= end; f++) {
		const t = (f - ctx.f0) / FPS, flying = t < T, ts = Math.min(Math.max(0, t - T), tSlide);
		const run = flying ? speed * ramp(t) : speed * ramp(T) + speed * ts - 0.5 * MU * G * ts * ts;
		const y = height(t);
		const root = [root0[0] + dx * run, y, root0[2] + dz * run];
		const tilt = Math.max(0.35, 0.9 * T), yaw = yaw0 + turn * smooth(t / Math.max(TURN, tilt)), pitch = pitchT * smooth(t / tilt), R = (v => apply(ry(yaw), apply(rx(pitch), v)));
		// the trunk and head whip against the shove (a damped spring), the arms flail and trail, all settling by the rest
		const ease = smooth(t / ONSET), whip = ease * Math.exp(-t / 0.18) * Math.sin(2 * Math.PI * t / 0.55), flail = smooth(t / 0.3) * Math.exp(-t / 0.45) * Math.sin(2 * Math.PI * t / 0.6);
		const lying = smooth((t - T) / 0.3);
		// legs bend in the air and lie out: on the back a little bent, knees up, toes up; face down straight, toes down
		const legY = -(hipsY - ankle) + 0.06 * (1 - lying) + (back ? 0.03 : 0.01) * lying, off = smooth(t / LIFT_OFF);
		// face down the feet ride a little off the floor while the body slides, so they are not taken for planted feet
		const floor = ankle + 0.01 + (!back && !flying && ts < tSlide ? 0.04 : 0);
		// on the back the heels stay below the hips (a soft cap), so the legs slope down to the feet and the knees bend up
		const foot = (k, x, z) => { const p = add(root, R([x, legY, z])), cap = root[1] - 0.05; if (back) p[1] = cap - 0.05 * Math.log1p(Math.exp((cap - p[1]) / 0.05)); p[1] = softFloor(p[1], floor, 0.03); const o = from[k]; if (!o) return p; const q = o.at.map((x, i) => x + o.v[i] * (f - ctx.f0) * (1 - off)); q[1] = Math.max(o.at[1], q[1]); return reach(p.map((v, i) => q[i] + (v - q[i]) * off)); };
		// a foot left behind is drawn in within the leg's reach of the hips (a soft cap, in as the foot lifts), so the leg is pulled, not torn
		const reach = p => { const d = p.map((v, i) => v - root[i]), n = Math.hypot(...d), m = LEG - 0.02 * Math.log1p(Math.exp((LEG - n) / 0.02)); return n > 1e-9 ? root.map((v, i) => v + d[i] * (1 + (m / n - 1) * off)) : p; };
		// the knee points along the body's forward pitched with it, square to the leg (no flip lying down); a pole is read
		// in the yaw frame, tilted past 60 degrees of pitch (pose.js tiltFrame), so that tilt (lean) is taken back out of
		// the knee poles (and half of it, face down, out of the foot pitch: the toes rest on the floor, not in it)
		const tf = tiltFrame(0, pitch, 0), back0 = tf ? apply(tf.R, [0, 1, 0]) : [0, 1, 0], lean = Math.atan2(back0[2], back0[1]) * 180 / Math.PI;
		const knee = apply(rx(-lean), [0, -Math.sin(pitch * Math.PI / 180), Math.max(0.05, Math.cos(pitch * Math.PI / 180))]);
		const set = { root: r3(root), yaw: r1(yaw), pitch: r1(pitch), roll: 0,
			foot_l: r3(foot("l", 0.11, 0.04 + 0.1 * flail * off - (back ? 0.1 : 0) * lying)), foot_r: r3(foot("r", -0.11, 0.04 - 0.1 * flail * off - (back ? 0.1 : 0) * lying)), fyaw_l: r1(yaw), fyaw_r: r1(yaw), fpitch_l: r1(back ? -50 * lying : -0.5 * lean), fpitch_r: r1(back ? -50 * lying : -0.5 * lean),
			knee_l: r3([0.05, knee[1], knee[2]]), knee_r: r3([-0.05, knee[1], knee[2]]),
			spine_pitch: r1(sign * 22 * whip * Math.min(1, speed / 4)), spine_yaw: 0, spine_roll: r1(10 * flail * (1 - lying)), head_pitch: r1(sign * 30 * whip * Math.min(1, speed / 4) + (back ? -8 : 8) * lying), head_roll: r1(12 * lying),
			arm_rest: r1(72 - 22 * lying), aswing_l: r1(sign * 45 * flail + 8 * lying), aswing_r: r1(-sign * 35 * flail - 8 * lying), abend_l: r1(25 + 30 * flail * flail), abend_r: r1(30 + 25 * flail * flail) };
		if (f === ctx.f0) Object.assign(set, { armw_l: 0, armw_r: 0, fingers_l: { relaxed: 1 }, fingers_r: { relaxed: 1 } });
		keys.push({ f, set });
	}
	return { keys, end };
}
