// C16. Aim keys: a held-object key (C14) may give aim [x, y, z], the world direction the object's
// +Y points (a bat: knob to barrel), with an optional roll (degrees about that direction,
// right-handed), in place of the quaternion rot. An aim key turns the object the shortest way
// from where the plain carry (no keys) holds it at that key's frame onto aim, then by roll.
// (Turning from the key before instead piles the roll up over a swing: the bat fixture's keys as
// aims, so chained, missed by 45.5 cm.)
// Without roll (lane K8) the key takes the roll the arm holds most easily: ROLLS candidate rolls
// about aim are scored by the strain of the arm that holds them (compiler/hold.js holdCost), a
// pass over the keys in order picks one per key with a light price on how far the object turns
// from the key before (so equally easy rolls do not alternate), and a golden-section search
// settles each pick within its step. roll given (0 included) and rot keys are used exactly.
// The quaternion is rounded to 1e-5 (the grid motion.keyObject writes) and kept on the hemisphere
// of the key before it.
// lean (degrees, lane elbow) lets the compiler lean aim itself up to that far: a cup brought to the mouth
// is tipped toward the face AND a little toward the hand's side, which lets the elbow stay down (a cup at
// the mouth aimed only at the face can be held with a comfortable wrist only with the elbow over the
// shoulder). The aim, and AZIMUTHS directions leaned lean/2 and lean, each at every roll (or at the
// given roll), are scored by the arm's strain plus the shoulder's price (hold.js holdCost opts.shoulder);
// the chain and the roll refinement run as above on the picked direction.
import { qmul, qrot, qdot, qnorm, arcQuat, axisQuat } from "./compiler/quat.js";
import { add, cross, norm, scale, sub } from "./compiler/math.js";

const ROLLS = 24, STEP = 360 / ROLLS, TURN = 0.2, GOLDEN = 12, AZIMUTHS = 8;
const round5 = v => Math.round(v * 1e5) / 1e5;
/** The turn between two unit quaternions, radians. */
const turn = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(qdot(a, b))));

/**
 * Where a leaning key puts the object: a lean pivots about the object's top (its +Y end, `top` m above its
 * base pivot), so a cup's rim stays where aim put it (at the lips) and its foot swings; any other key's pos.
 */
export const leanPos = (key, q, top) => (key.lean > 0 && key.aim && top > 0 ? add(key.pos, scale(sub(norm(key.aim), qrot(q, [0, 1, 0])), top)) : key.pos);

/** aim d and the directions leaned lean/2 and lean deg from it toward AZIMUTHS sides. */
function leanedAims(d, lean) {
	const side = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), up = cross(d, side), out = [d];
	for (const deg of [lean / 2, lean]) for (let j = 0; j < AZIMUTHS; j++) {
		const a = (2 * Math.PI * j) / AZIMUTHS, t = (Math.min(deg, 45) * Math.PI) / 180, w = add(scale(side, Math.cos(a)), scale(up, Math.sin(a)));
		out.push(norm(add(scale(d, Math.cos(t)), scale(w, Math.sin(t)))));
	}
	return out;
}

/** The pick per key: DP over candidates [{ q, cost }] per key, a TURN price on the squared turn between neighbours. */
function chain(cands) {
	let best = cands[0].map(c => ({ total: c.cost, from: -1 }));
	const back = [best];
	for (let i = 1; i < cands.length; i++) {
		best = cands[i].map(c => {
			let pick = { total: Infinity, from: -1 };
			cands[i - 1].forEach((p, j) => { const t = back[i - 1][j].total + TURN * turn(p.q, c.q) ** 2; if (t < pick.total) pick = { total: t, from: j }; });
			return { total: pick.total + c.cost, from: pick.from };
		});
		back.push(best);
	}
	const picks = [];
	for (let i = cands.length - 1, j = best.reduce((m, b, k) => (b.total < best[m].total ? k : m), 0); i >= 0; j = back[i][j].from, i--) picks[i] = j;
	return picks;
}

/** Golden-section search of f on [lo, hi]. */
function golden(f, lo, hi) {
	const g = (Math.sqrt(5) - 1) / 2;
	let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
	for (let i = 0; i < GOLDEN; i++) {
		if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
	}
	return (a + b) / 2;
}

/**
 * The rot of each key (keys sorted by f): a rot key's own, an aim key's resolved quaternion
 * [x, y, z, w]. plain(i) is the rotation (a quaternion) the plain carry gives the object at key
 * i's frame; it is asked for aim keys only. strain(i, q), when given, is the arm's cost of
 * holding key i at rotation q; it picks the roll of aim keys that give none.
 */
export function keyRots(keys, plain, strain) {
	const at = keys.map((k, i) => {
		if (k.aim === undefined) return { fixed: qnorm(k.rot) };
		const from = qnorm(plain(i)), aimed = d => { const q0 = qmul(arcQuat(norm(qrot(from, [0, 1, 0])), d), from); return r => qmul(axisQuat(d, r), q0); };
		if (k.lean > 0 && strain) return { leans: leanedAims(norm(k.aim), k.lean).map(aimed), roll: k.roll };
		const rolled = aimed(norm(k.aim));
		return k.roll !== undefined || !strain ? { fixed: k.roll ? rolled(k.roll) : rolled(0) } : { rolled };
	});
	const rollsOf = a => (a.roll !== undefined ? [a.roll] : Array.from({ length: ROLLS }, (_, j) => j * STEP - 180));
	const cands = at.map((a, i) => (a.fixed ? [{ q: a.fixed, cost: 0, r: 0 }]
		: a.leans ? a.leans.flatMap(rolled => rollsOf(a).map(r => { const q = rolled(r); return { q, cost: strain(i, q), r, rolled, fixedRoll: a.roll !== undefined }; }))
		: Array.from({ length: ROLLS }, (_, j) => { const r = j * STEP - 180, q = a.rolled(r); return { q, cost: strain(i, q), r }; })));
	const picks = chain(cands), chosen = cands.map((c, i) => c[picks[i]]);
	// a leaning key keeps the direction it picked; its roll is refined below like any other (unless given)
	for (const [i, a] of at.entries()) if (a.leans) at[i] = chosen[i].fixedRoll ? { fixed: chosen[i].q } : { rolled: chosen[i].rolled };
	const rots = [];
	let prev = null;
	for (const [i, a] of at.entries()) {
		if (keys[i].aim === undefined) { rots.push(keys[i].rot); prev = a.fixed; continue; }
		let q = (a.fixed ?? a.rolled(golden(r => {
			const qr = a.rolled(r), near = [chosen[i - 1], chosen[i + 1]].filter(Boolean);
			return strain(i, qr) + near.reduce((sum, n) => sum + TURN * turn(n.q, qr) ** 2, 0);
		}, chosen[i].r - STEP / 2, chosen[i].r + STEP / 2))).map(round5);
		if (prev && qdot(q, prev) < 0) q = q.map(v => -v);
		rots.push(q);
		prev = qnorm(q);
	}
	return rots;
}
