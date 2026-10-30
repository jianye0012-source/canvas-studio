// compiler/grip.js and qa/wrist-obs.js: a hand a fit puts on a scene body turns about its forearm into a grip
// (a thin body across the palm, else the end-state-comfort thumb), never past a comfortable forearm turn and
// with no flex or deviation asked; the fingers stay on the anchor; a turned wrist channel, fit.orient false and a prop anchor
// leave the hand alone; output.observations.wrist reads the holding wrists.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSpec } from '../../src/motion3/pipeline.js';
import { skeletonFor } from '../../src/motion3/rigs/index.js';
import { motionScene } from '../../src/motion3/scene.js';
import { palmAxes } from '../../src/motion3/compiler/limbs.js';
import { WRIST_COMFORT } from '../../src/motion3/compiler/arm-orient.js';

const sk = skeletonFor('y-bot-tpose');
const box = (id, [x, y, z], [w, h, d]) => ({ id, name: id, renderer: 'cube', x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, footprint: { width: w, depth: d }, height: h });
// a bar lying left-right at chest height in front of the right hand, and a crate face beside it
const scene = motionScene([box('bar', [-0.2, 1.1, 0.42], [0.6, 0.04, 0.04]), box('crate', [-0.45, 0.6, 0.4], [0.3, 0.6, 0.3])]);
const deg = r => r * 180 / Math.PI;

function spec(args = {}, extra = {}) {
	return { schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 50,
		use: [{ skill: 'standIdle', f0: 0, args: { at: [0, 0] } }, { skill: 'reachGrip', f0: 5, args: { anchor: 'grip', side: 'r', hold: 20, define: { kind: 'object', object: args.on ?? 'bar', local: args.local ?? [0.15, 0.02, 0] }, ...(args.orient === false ? { orient: false } : {}) } }],
		goals: [{ name: 'fingers on it', near: ['prop:gripGrip.fingers', 'anchor:grip'], tol: 0.04, at: [26, 44] }], ...extra };
}
const at = (r, f) => r.out.frames[f - (r.out.f0 ?? 0)];

test('a hand on a thin bar turns the bar across its palm, within the comfortable forearm turn, the fingers kept on it', () => {
	const on = compileSpec(spec(), { sk, scene }), off = compileSpec(spec({ orient: false }), { sk, scene });
	const g = at(on, 35).diag.grip_r;
	assert.ok(g && g.w > 0.99, JSON.stringify(g));
	assert.ok(Math.abs(g.twist) <= WRIST_COMFORT.twist[1] + 1, `twist ${g.twist}`);
	// the fingers keep the forearm's line: what flex and deviation there is comes from the wrist going back onto the fit
	assert.ok(Math.abs(g.flex) < 10 && Math.abs(g.dev) < 10, `little flex or deviation: ${g.flex} ${g.dev}`);
	assert.equal(at(off, 35).diag.grip_r, undefined, 'orient false: no grip');
	// the knuckle line (pinky to index) comes nearer the bar's left-right axis than without the grip
	const across = r => deg(Math.acos(Math.abs(palmAxes(sk, at(r, 35).s, 'Right').l[0])));
	assert.ok(across(on) < across(off) - 5, `knuckle line vs the bar: ${across(on).toFixed(1)} with the grip, ${across(off).toFixed(1)} without`);
	assert.equal(on.qa.goals[0].ok, true, `the fingers stay on the bar: ${on.qa.goals[0].value}`);
	assert.ok(on.qa.total <= off.qa.total, `QA ${on.qa.total} with the grip, ${off.qa.total} without`);
});

test('a hand on a crate face turns about its forearm, no further than a comfortable forearm twist', () => {
	const crate = { on: 'crate', local: [0.15, 0.3, 0] }, r = compileSpec(spec(crate), { sk, scene }), off = compileSpec(spec({ ...crate, orient: false }), { sk, scene });
	const l = x => palmAxes(sk, at(x, 35).s, 'Right').l, g = at(r, 35).diag.grip_r;
	assert.ok(g, 'grip on a non-thin body');
	const turned = deg(Math.acos(Math.min(1, l(r).reduce((acc, v, i) => acc + v * l(off)[i], 0))));
	// the forearm points down to the crate's side, so the comfortable thumb leads toward the midline
	assert.ok(turned > 20, `the hand turned ${turned.toFixed(1)} deg`);
	assert.ok(Math.abs(g.twist) <= WRIST_COMFORT.twist[1] + 1, `the turn stops at the comfortable forearm twist: ${g.twist}`);
});

test('a turned wrist channel on the frame wins over the grip', () => {
	const r = compileSpec(spec({}, { keys: [{ f: 0, set: { wflex_r: 20 } }] }), { sk, scene });
	assert.equal(at(r, 35).diag.grip_r, undefined);
});

test('observations.wrist reads the holding wrist', () => {
	const r = compileSpec(spec(), { sk, scene }), w = r.observations.wrist?.hand_r;
	assert.ok(w && w.frames >= 20, JSON.stringify(r.observations.wrist));
	for (const n of ['flex', 'dev', 'twist']) assert.equal(w[n].length, 4, n);
	assert.ok(Number.isInteger(w.past) && Number.isInteger(w.limit));
	assert.match(r.observations.units, /wrist: deg/);
	const idle = compileSpec({ schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 10, use: [{ skill: 'standIdle', f0: 0, args: { at: [0, 0] } }] }, { sk, scene });
	assert.equal(idle.observations.wrist, undefined, 'no hand holds anything: no reading');
});
