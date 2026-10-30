// flip: a standing back or front tuck, or a cartwheel, from the standing pose keyed before f0. The root and the feet (and
// the cartwheel's hands) are keyed every frame from closed-form curves whose speeds join without a kink (no POP); the
// arms, spine and head are keyed at the phase edges and the channels' own interpolation carries them between.
// - back/front: crouch, push-off (the heels roll up over the balls), a ballistic flight (the hips on a parabola under
//   gravity, so QA reads a jump, not a float) with the knees tucked to the chest while the whole body turns 360 deg a turn
//   (pitch, - backward), a landing that absorbs the fall, and the stand.
// - cartwheel: the lead foot steps out, then the body rolls 360 deg toward args.side like a wheel whose spokes are the
//   straddled legs and the arms overhead: each frame the hips sit as high as the lowest spoke touching the floor allows,
//   and a hand or foot whose spoke is down stays planted where it touched.
// Both end with the turn's full angle and then 0 on the last two frames (the same pose), so a later key at 0 does not
// unwind it. Poles are given so the knees and elbows bend toward the turning body's front (pose.js tiltFrame).
import { add, sub, scale, apply, mul, rx, ry, rz, dist, T } from "../compiler/math.js";
import { pivot } from "../compiler/walk-pelvis.js";
import { tiltFrame } from "../compiler/pose.js";
import { skillError } from "./book.js";

const G = 9.81 / (24 * 24); // m per frame^2 at the timeline's 24 fps
const CROUCH = 10, PUSH = 5, LAND = 6, RISE = 14, TOE_OFF = 50;
const clamp01 = u => Math.min(1, Math.max(0, u));
const ease = u => { const t = clamp01(u); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const window = (u, a, b, c, d) => ease((u - a) / (b - a)) - ease((u - c) / (d - c));
const SIDE = { l: 1, r: -1 };
const bodyFrame = (h, pitch, roll) => mul(ry(h), mul(rx(pitch), rz(roll)));
/** A pole the turning body (B) holds as `local`, written as the channel pose.js turns by its own frame. */
const poleFor = (h, pitch, roll, B, local) => apply(T(tiltFrame(h, pitch, roll)?.R ?? ry(h)), apply(B, local));

/**
 * fyaw/fpitch that make pose.js aim the foot (orientFoot, in its tilt frame) where the turning body B holds it at fpitch
 * `fp` in its own frame: the toe direction solved back through the frame pose.js reads the channels in (clamped to fpitch's
 * range). Nearer upright pose.js reads them on the level, as for any foot, and they pass as they are.
 */
function footAim(b, k, pitch, roll, B, fp) {
	const tilt = tiltFrame(b.h, pitch, roll);
	if (!tilt) return { fyaw: b.h, fpitch: fp };
	const rest = b.toe[k], want = apply(B, apply(rx(fp), rest)), d = apply(T(tilt.R), want);
	const phi = Math.atan2(-rest[1], rest[2]), deg = 180 / Math.PI;
	const p = Math.asin(Math.max(-1, Math.min(1, -d[1] / Math.hypot(...d)))) - phi;
	return { fyaw: b.h + Math.atan2(d[0], d[2]) * deg, fpitch: Math.max(-60, Math.min(90, p * deg)) };
}

function base(ctx) {
	const { sk, args, state } = ctx, I = sk.index, P = sk.restWorldPos;
	if (!state.foot_l || !state.foot_r || !state.root) skillError(ctx.tag, "needs a standing pose keyed before f0 (use standIdle or another skill first)");
	const h = args.heading ?? state.yaw ?? 0, R = ry(h), hips = P[I.Hips];
	const leg = dist(P[I.LeftUpLeg], P[I.LeftLeg]) + dist(P[I.LeftLeg], P[I.LeftFoot]), arm = dist(P[I.LeftArm], P[I.LeftForeArm]) + dist(P[I.LeftForeArm], P[I.LeftHand]);
	return { h, R, F: apply(R, [0, 0, 1]), L: apply(R, [1, 0, 0]), ank: P[I.LeftFoot][1], y0: hips[1] - 0.01, leg, arm,
		feet: { l: state.foot_l.slice(), r: state.foot_r.slice() }, root: state.root.slice(),
		hipOff: { l: sub(P[I.LeftUpLeg], hips), r: sub(P[I.RightUpLeg], hips) }, shoulder: { l: sub(P[I.LeftArm], hips), r: sub(P[I.RightArm], hips) },
		toe: { l: sub(P[I.LeftToeBase], P[I.LeftFoot]), r: sub(P[I.RightToeBase], P[I.RightFoot]) } };
}

function tuck(ctx, b, kind) {
	// one turn from a standing jump whose hips rise H at the top: the curves below are measured clean for that flip (a
	// higher jump or more turns would need its own tuck timing, so the skill takes neither)
	const { args } = ctx, s = kind === "back" ? -1 : 1, turn = s * 360, H = 0.5;
	const travel = args.travel ?? (kind === "back" ? -0.25 : 0.4);
	const yT = b.y0 + 0.05, yL = b.y0 - 0.02;                // the hips at take-off (toes pointed) and at touch-down
	const Tf = Math.max(10, Math.round(Math.sqrt(2 * (H - 0.05) / G) + Math.sqrt(2 * (yT + H - 0.05 - yL) / G)));
	const v0 = (yL - yT + (G * Tf * Tf) / 2) / Tf, vL = v0 - G * Tf, yc = yT - (v0 * PUSH) / 2, bottom = yL + (vL * LAND) / 2;
	const vx = travel / (PUSH / 2 + Tf + LAND / 2);
	const t0 = ctx.f0, tP = t0 + CROUCH, tA = tP + PUSH, tD = tA + Tf, tL = tD + LAND, tE = tL + RISE;
	const land = k => add(b.feet[k], scale(b.F, travel)), ball = k => add(b.feet[k], apply(b.R, b.toe[k]));
	const hipsAt = f => {
		let y, x;
		if (f <= tP) { y = mix(b.root[1], yc, ease((f - t0) / CROUCH)); x = 0; }
		else if (f <= tA) { const t = f - tP; y = yc + (v0 / PUSH) * t * t / 2; x = (vx / PUSH) * t * t / 2; }
		else if (f <= tD) { const t = f - tA; y = yT + v0 * t - (G * t * t) / 2; x = (vx * PUSH) / 2 + vx * t; }
		else if (f <= tL) { const t = f - tD; y = yL + vL * t - (vL / LAND) * t * t / 2; x = (vx * PUSH) / 2 + vx * Tf + vx * t - (vx / LAND) * t * t / 2; }
		else { y = mix(bottom, b.y0, ease((f - tL) / RISE)); x = travel; }
		return add([b.root[0], y, b.root[2]], scale(b.F, x));
	};
	// the turn starts 2 frames before take-off and ends 3 after touch-down
	const pitchAt = f => turn * ease((f - tA + 2) / (Tf + 5)), frameAt = f => bodyFrame(b.h, pitchAt(f), 0);
	// in the air the feet ride the body: from where they left the floor, through the tuck, to where they land, all in its frame
	const local = (f, p) => apply(T(frameAt(f)), sub(p, hipsAt(f)));
	const offL = { l: local(tA, pivot(ball("l"), b.h, TOE_OFF, b.feet.l)), r: local(tA, pivot(ball("r"), b.h, TOE_OFF, b.feet.r)) };
	const onL = { l: local(tD, land("l")), r: local(tD, land("r")) };
	const keys = [];
	for (let f = t0; f <= tE + 1; f++) {
		const pitch = f > tE ? 0 : pitchAt(f), B = bodyFrame(b.h, pitch, 0), hips = hipsAt(f), u = (f - tA) / Tf;
		const tk = f > tA && f < tD ? window(u, 0.12, 0.34, 0.6, 0.82) : 0;
		const set = { root: hips, yaw: b.h, pitch, roll: 0, armw_l: 0, armw_r: 0, fyaw_l: b.h, fyaw_r: b.h };
		for (const k of ["l", "r"]) {
			let foot, fp;
			if (f <= tP) { foot = b.feet[k]; fp = 0; }
			else if (f <= tA) { fp = TOE_OFF * ease((f - tP) / PUSH); foot = pivot(ball(k), b.h, fp, b.feet[k]); }
			else if (f < tD) {
				const a = 1 - ease(u / 0.2), c = ease((u - 0.72) / 0.28);
				const mid = add(b.hipOff[k], mix3([0, -b.leg * 0.97, 0], [SIDE[k] * 0.02, -0.24, 0.16], tk));
				foot = add(hips, apply(B, add(add(scale(offL[k], a), scale(onL[k], c)), scale(mid, 1 - a - c))));
				fp = mix(mix(TOE_OFF, 30, ease(u / 0.2)), 0, ease((u - 0.7) / 0.3));
			} else { foot = land(k); fp = 0; }
			const aim = f > tA && f < tD ? footAim(b, k, pitch, 0, B, fp) : { fyaw: b.h, fpitch: fp };
			Object.assign(set, { [`foot_${k}`]: foot, [`fpitch_${k}`]: aim.fpitch, [`fyaw_${k}`]: aim.fyaw, [`knee_${k}`]: poleFor(b.h, pitch, 0, B, [SIDE[k] * 0.05, 0.5 * tk, 1]) });
		}
		keys.push({ f, set });
	}
	// the arms, spine and head at the phase edges: back in the crouch, overhead at take-off, to the shins in the tuck,
	// forward for the landing, then down
	const head = kind === "back" ? [-12, 18] : [10, 25];
	for (const [f, sw, bd, sp, hd] of [[t0, 0, 0, 0, 0], [tP, -45, 15, 20, 0], [tA, 160, 5, -8, head[0]], [Math.round(tA + 0.3 * Tf), 55, 85, 32, head[1]],
		[Math.round(tA + 0.62 * Tf), 55, 85, 32, head[1]], [tD, 75, 25, 22, 0], [tL, 70, 25, 28, 0], [tE, 0, 0, 0, 0]]) {
		keys.push({ f, set: { aswing_l: sw, aswing_r: sw, abend_l: bd, abend_r: bd, spine_pitch: sp, head_pitch: hd } });
	}
	return { keys, end: tE + 1 };
}

function cartwheel(ctx, b) {
	const { args } = ctx, dir = args.side === "r" ? -1 : 1, rs = -dir;   // toward the character's left the head goes to +x: roll -
	const W = 12, ROT = 34, REC = 14, t0 = ctx.f0, tR = t0 + W, tC = tR + ROT, tE = tC + REC;
	const lead = dir > 0 ? "l" : "r", trail = lead === "l" ? "r" : "l";
	// spokes from the hips in the body's frame (x the body's left): the legs straddled, the arms overhead and apart
	const spoke = { foot: k => add(b.hipOff[k], [SIDE[k] * 0.3, -b.leg * 0.93, 0]), hand: k => add(b.shoulder[k], [SIDE[k] * 0.32, b.arm * 0.88, 0]) };
	const floor = { foot: b.ank, hand: 0.1 };
	// the order the ends touch down rolling toward the lead side; the body pivots on each in turn like a wheel on its spokes
	const order = [["foot", lead], ["hand", lead], ["hand", trail], ["foot", trail], ["foot", lead]];
	const rollAt = f => f <= tR ? 0 : f <= tC ? rs * 360 * ease((f - tR) / ROT) : rs * 360;
	const end = (f, hips, part, k) => add(hips, apply(bodyFrame(b.h, 0, rollAt(f)), spoke[part](k)));
	// start: the trail foot stays, the lead foot steps out so both stand on their spokes; the hips over them
	const B0 = bodyFrame(b.h, 0, 0), hips0 = sub(b.feet[trail], apply(B0, spoke.foot(trail))), stepTo = end(tR, hips0, "foot", lead);
	stepTo[1] = b.ank;
	const raw = [], plants = { foot: { l: [], r: [] }, hand: { l: [], r: [] } };
	let at = 0, pivot = b.feet[lead].slice(), from = tR;
	plants.foot[trail].push({ a: t0, b: tR, p: b.feet[trail] });
	for (let f = t0; f <= tE + 1; f++) {
		if (f <= tR) { raw.push(mix3(b.root, hips0, ease((f - t0) / W))); continue; }
		if (f === tR + 1) pivot = stepTo.slice();
		let hips = sub(pivot, apply(bodyFrame(b.h, 0, rollAt(f)), spoke[order[at][0]](order[at][1])));
		const next = order[at + 1];
		if (next && f <= tC) {
			const e = end(f, hips, ...next);
			if (e[1] <= floor[next[0]]) {
				// the end touched between the frames: pivot where it crossed the floor, so the hips do not jump
				const ep = end(f - 1, raw.at(-1), ...next), h1 = ep[1] - floor[next[0]], h2 = e[1] - floor[next[0]];
				const cross = mix3(ep, e, h1 > 0 ? h1 / (h1 - h2) : 1);
				plants[order[at][0]][order[at][1]].push({ a: from, b: f, p: pivot });
				at++; from = f; pivot = [cross[0], floor[next[0]], cross[2]];
				hips = sub(pivot, apply(bodyFrame(b.h, 0, rollAt(f)), spoke[next[0]](next[1])));
			}
		}
		raw.push(hips);
	}
	plants[order[at][0]][order[at][1]].push({ a: from, b: tE + 1, p: pivot });
	// the trail foot that landed stays down to the end too
	const last = order[order.length - 2];
	if (at >= order.length - 1) plants[last[0]][last[1]].at(-1).b = tE + 1;
	// the pivot path turns at each touch-down: blurred over a few frames (the planted ends absorb it), then the stand
	const blur = raw.map((p, i) => { let s = [0, 0, 0], w = 0; for (let d = -3; d <= 3; d++) { const j = Math.min(raw.length - 1, Math.max(0, i + d)), g = Math.exp(-(d * d) / 4); s = add(s, scale(raw[j], g)); w += g; } return scale(s, 1 / w); });
	const hipsAt = f => f <= tC ? blur[f - t0] : add(blur[tC - t0], [0, (b.y0 - blur[tC - t0][1]) * ease((f - tC) / REC), 0]);
	// a planted end the turning body has rolled away from is drawn toward its hip or shoulder until the limb reaches it
	const reach = (p, from, n) => { const v = sub(p, from), d = Math.hypot(...v); return d > n ? add(from, scale(v, n / d)) : p; };
	// a hand or foot near its plant: easing onto it over the 6 frames before, held, then let go by following the body from
	// where it left the floor (its place in the body's frame then) toward its spoke, so it lifts without a jolt
	const touch = (part, k, f, free) => {
		for (const r of plants[part][k]) {
			if (f >= r.a - 6 && f <= r.b) return mix3(free, r.p, ease((f - r.a + 6) / 6));
			if (f > r.b && f <= r.b + 10) {
				const at = bodyFrame(b.h, 0, rollAt(r.b)), left = apply(T(at), sub(r.p, hipsAt(r.b)));
				const follow = add(hipsAt(f), apply(bodyFrame(b.h, 0, rollAt(f)), mix3(left, spoke[part](k), ease((f - r.b - 1) / 9))));
				return mix3(r.p, follow, ease((f - r.b) / 8));
			}
		}
		return free;
	};
	const planted = (part, k, f) => plants[part][k].some(r => f >= r.a && f <= r.b);
	// where the feet stand after the roll: a planted one where it is, else under its spoke at the roll's end
	const landed = Object.fromEntries(["l", "r"].map(k => { const p = planted("foot", k, tC) ? plants.foot[k].at(-1).p.slice() : end(tC, hipsAt(tC), "foot", k); p[1] = b.ank; return [k, p]; }));
	const keys = [];
	for (let f = t0; f <= tE + 1; f++) {
		const roll = f === tE + 1 ? 0 : rollAt(f), B = bodyFrame(b.h, 0, rollAt(f)), hips = hipsAt(f);
		const set = { root: hips, yaw: b.h, pitch: 0, roll };
		for (const k of ["l", "r"]) {
			let foot;
			if (f <= tR && k === lead) { const w = ease((f - t0 - 1) / (W - 4)); foot = add(mix3(b.feet[k], stepTo, w), [0, 0.07 * Math.sin(Math.PI * w), 0]); }
			else if (f > tC) foot = landed[k];
			else {
				const down = ease((f - tC + 4) / 4);
				foot = reach(mix3(touch("foot", k, f, end(f, hips, "foot", k)), landed[k], down), add(hips, apply(B, b.hipOff[k])), b.leg * 0.995);
			}
			const aim = f > tR && f <= tC ? footAim(b, k, 0, rollAt(f), B, 0) : { fyaw: b.h, fpitch: 0 };
			Object.assign(set, { [`foot_${k}`]: foot, [`fyaw_${k}`]: aim.fyaw, [`fpitch_${k}`]: aim.fpitch, [`knee_${k}`]: poleFor(b.h, 0, roll, B, [SIDE[k] * 0.05, 0, 1]),
				[`hand_${k}`]: reach(f > tR && f <= tC ? touch("hand", k, f, end(f, hips, "hand", k)) : end(f, hips, "hand", k), add(hips, apply(B, b.shoulder[k])), b.arm * 0.995), [`elbow_${k}`]: poleFor(b.h, 0, roll, B, [SIDE[k] * 0.4, 0, -1]),
				[`armw_${k}`]: f <= tR ? 0 : f <= tC ? ease((f - tR) / 6) : 1 - ease((f - tC) / 8) });
		}
		// the FK arms overhead along the hand spokes, so the hand eases onto its IK target without a jump
		set.arm_rest = f <= tR ? mix(72, -56, ease((f - t0) / W)) : f <= tC ? -56 : mix(-56, 72, ease((f - tC) / REC));
		keys.push({ f, set });
	}
	return { keys, end: tE + 1 };
}

/** flip({ kind: "back" | "front" | "cartwheel", travel, side, heading }) */
export function flip(ctx) {
	const kind = ctx.args.kind ?? "back";
	if (!["back", "front", "cartwheel"].includes(kind)) skillError(ctx.tag, `kind must be "back", "front" or "cartwheel", got ${JSON.stringify(kind)}`);
	const b = base(ctx);
	return kind === "cartwheel" ? cartwheel(ctx, b) : tuck(ctx, b, kind);
}
