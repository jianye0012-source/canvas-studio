// compiler/wrist-clamp.js: after fix.self's elbow turn the wrist stops at its limits and the hand turns on with
// the elbow; a wrist within its limits is left exactly as it was.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skeletonFor } from '../../src/motion3/rigs/index.js';
import { restState, rotateSubtree } from '../../src/motion3/compiler/skeleton.js';
import { clampWrist } from '../../src/motion3/compiler/wrist-clamp.js';
import { palmAxes } from '../../src/motion3/compiler/limbs.js';
import { WRIST_LIMITS, wristNeed } from '../../src/motion3/compiler/arm-orient.js';
import { apply, axisRot, len, mul, scale, sub, T } from '../../src/motion3/compiler/math.js';

const sk = skeletonFor('y-bot-tpose'), I = sk.index, side = 'Right', h = I[`${side}Hand`], fa = I[`${side}ForeArm`];
/** The wrist of `side` on pose s as the QA reads it (qa/wrist-checks.js needAt). */
function needOf(s) {
	const rw = sk.restWorldRot, axT = scale(sub(s.P[h], s.P[fa]), 1 / len(sub(s.P[h], s.P[fa]))), neutral = mul(s.R[fa], mul(T(rw[fa]), rw[h]));
	return wristNeed(neutral, s.R[h], axT, apply(mul(neutral, T(s.R[h])), palmAxes(sk, s, side).l));
}
/** A rest pose with the right hand bent `deg` about the knuckle line (flex). */
function bent(deg) {
	const s = restState(sk), { l } = palmAxes(sk, s, side);
	rotateSubtree(sk, s, h, s.P[h].slice(), axisRot(l, deg));
	return s;
}

test('a wrist within its limits is left as it was', () => {
	const s = bent(40), before = s.R[h].map(r => r.slice());
	assert.equal(clampWrist(sk, s, side), null);
	assert.deepEqual(s.R[h], before);
});

test('a wrist past its limit stops at it, the rest of the turn left to the hand', () => {
	const s = bent(95), was = needOf(s);
	assert.ok(Math.abs(was.flex) > WRIST_LIMITS.flex[1] + 5, `bent past the limit first: ${was.flex}`);
	const r = clampWrist(sk, s, side);
	assert.ok(r && Math.abs(Math.abs(r.got.flex) - WRIST_LIMITS.flex[1]) < 1e-6, JSON.stringify(r));
	const now = needOf(s);
	for (const k of ['twist', 'flex', 'dev']) assert.ok(now[k] >= WRIST_LIMITS[k][0] - 0.5 && now[k] <= WRIST_LIMITS[k][1] + 0.5, `${k} ${now[k]}`);
	assert.ok(Math.abs(Math.abs(now.flex) - WRIST_LIMITS.flex[1]) < 0.5, `at the limit: ${now.flex}`);
});
