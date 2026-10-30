// QA WRIST (lane wristqa): a holding wrist at its anatomical limit is broken whatever the motion is for
// (C13 keeps style measured, not judged; a wrist the arm had to clamp is neither). On the frames a hand
// holds (wrist-obs.js holding: a fit, a keyed carry, a grip or a carry), the wrist's turn on its forearm
// is read where the arm asked for it: a keyed carry's need before hold.js clamped it (diag.hold_<k>),
// else the turn the solved pose shows at the joint, against the whole limits: the wtwist channel turns the
// hand alone (limbs.js wrist, the forearm bone takes no share), and a grip stays inside the comfortable twist.
// An axis more than AT deg past its limit (arm-orient.js WRIST_LIMITS: the clamp engaged, or a turn no wrist makes) is an issue:
//   WRIST  "hand_r flex 72deg (limit 70)", value the degrees asked, limit the limit
// Past the comfortable range only is not judged: output.observations.wrist counts it.
// The hint moves the body, not the wrist. Which move frees it depends on the elbow's path the hold plans
// over the whole carry (hold-plan.js), so no single frame predicts it (a 10 cm hip drop computed to free
// the wrist at f90 of bench S6 kept it at its limit once compiled; a 20 deg lean freed 3 of its 4
// frames): repair compiles the leans instead (repair-tune.js WRIST) and keeps the one that lowers the summed
// severity with every goal held.
import { WRIST_LIMITS, wristNeed } from "../compiler/arm-orient.js";
import { palmAxes } from "../compiler/limbs.js";
import { apply, len, mul, scale, sub, T } from "../compiler/math.js";
import { holding } from "./wrist-obs.js";

const AT = 0.5, HELD = 0.5, AXES = ["flex", "dev", "twist"], SIDES = { l: "Left", r: "Right" };
const WORDS = { flex: v => (v >= 0 ? "flex" : "extension"), dev: v => (v >= 0 ? "radial deviation" : "ulnar deviation"), twist: () => "twist" };

/** The worst axis of a wrist need against its limits: { axis, value, edge, past } (past > AT is an issue). */
function worstAxis(need) {
	let best = null;
	for (const n of AXES) {
		const [lo, hi] = WRIST_LIMITS[n], v = need[n], edge = v >= 0 ? hi : lo, past = v >= 0 ? v - hi : lo - v;
		if (!best || past > best.past) best = { axis: n, value: v, edge, past };
	}
	return best;
}

/** The wrist need of hand k on frame i: the hold's (before its clamp) when a keyed carry leads it, else the joint's on the solved pose. */
function needAt(sk, out, k, i) {
	const { s, diag } = out.frames[i], h = diag[`hold_${k}`];
	if ((h?.w ?? 0) > HELD) return h;
	const S = SIDES[k], I = sk.index, hb = I[`${S}Hand`], fa = I[`${S}ForeArm`], rw = sk.restWorldRot;
	const axT = scale(sub(s.P[hb], s.P[fa]), 1 / Math.max(1e-9, len(sub(s.P[hb], s.P[fa])))), neutral = mul(s.R[fa], mul(T(rw[fa]), rw[hb]));
	return wristNeed(neutral, s.R[hb], axT, apply(mul(neutral, T(s.R[hb])), palmAxes(sk, s, S).l));
}

/** WRIST issues of every holding hand ({ kind, msg, frame, value, limit }, frame an out.frames index). */
export function wristIssues(sk, out) {
	const issues = [], f0 = out.f0 ?? 0;
	for (const k of ["l", "r"]) out.frames.forEach((_, i) => {
		if (!holding(out, k, i, i + f0)) return;
		const w = worstAxis(needAt(sk, out, k, i));
		if (w.past <= AT) return;
		const lim = Math.abs(w.edge);
		issues.push({ kind: "WRIST", msg: `hand_${k} ${WORDS[w.axis](w.value)} ${Math.round(Math.abs(w.value))}deg (limit ${Math.round(lim)})`, frame: i, value: +Math.abs(w.value).toFixed(2), limit: lim });
	});
	return issues;
}

/** WRIST group -> { cause, hint }: what bends the wrist (fix.self's elbow turn, or where the body stands), and the body moves repair tries (repair-tune.js WRIST). */
function wristHint(X, g) {
	const m = /^hand_([lr]) /.exec(g.subject), k = m?.[1];
	if (!k) return null;
	const f = g.worstFrame, where = `at f${f}${g.count > 1 ? ` (f${g.first}-f${g.last}, ${g.count} frames)` : ""}`;
	// fix.self turned the elbow about the shoulder-wrist line and the hand kept its turn: the wrist took the turn
	const turn = Math.round(X.out.ctx?.swivel?.[k]?.get(f) ?? 0);
	if (Math.abs(turn) >= 1) return { cause: `fix.self elbow turn ${turn}deg at f${f}`, hint: `${g.subject} ${where}: fix.self turned the elbow ${turn} deg to keep the arm out of the body and the hand kept its turn, so the wrist took it; key elbow_${k} (the elbow pole) or the hand's target so the arm clears the body without the turn` };
	const held = (X.out.frames[X.rel(f)]?.diag[`hold_${k}`]?.w ?? 0) > HELD && Object.keys(X.spec.objects ?? {}).find(id => X.spec.props?.[X.spec.objects[id]?.prop]?.hand === k);
	const lean = X.fr(f).c.spine_pitch ?? 0;
	return { cause: held ? `objects.${held}.keys near f${f}` : X.cause(`armw_${k}`, f),
		hint: `${g.subject} ${where}: the arm cannot turn the hand that far from where the body stands; lean the upper body over the hand (spine_pitch ${Math.round(lean)} at f${f}: try ${Math.round(lean + 20)}) or bring the body to it (root), ${held ? `or key ${held} so the hand need not bend that far (its aim or pos)` : "or move what the hand reaches"}; repair: { rounds } tries leans of 10-30 deg here and keeps one that helps` };
}

export const wristHints = { WRIST: wristHint };
