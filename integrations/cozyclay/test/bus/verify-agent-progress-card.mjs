// The agent panel's progress card as data (agent-progress-view.js) and its image feed: every image verify_result
// keeps (studio-motion-visual.js studioVisual) is published for the user with a caption.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goalRows, issueRows, sheetCaption, trendPoints, turnCount } from '../../src/workflow/agent-progress-view.js';
import { clearProgress, progressSheets } from '../../src/agent-progress.js';
import { studioVisual } from '../../src/studio-motion-visual.js';

test('the QA trend fits its box, falls with the totals and ends on the last draft', () => {
	const { points, max, first, last } = trendPoints([144, 31, 0], { width: 220, height: 40, pad: 4 });
	assert.deepEqual([max, first, last], [144, 144, 0]);
	assert.deepEqual(points.map(p => p[0]), [4, 110, 216], 'evenly spaced across the width');
	assert.deepEqual(points.map(p => p[1]), [4, 29.1, 36], 'the worst draft at the top, 0 on the base line');
	assert.deepEqual(trendPoints([5]).points, [[110, 4]], 'one draft sits in the middle');
	assert.deepEqual(trendPoints([]).points, []);
	assert.equal(trendPoints([0, 0]).max, 1, 'all clean still draws on the base line');
});

test('goal rows read in cm with the side that passes', () => {
	const rows = goalRows([
		{ name: 'finger on the button', kind: 'near', ok: true, value: 0.0123, need: 0.02, at: 70 },
		{ name: 'seated', kind: 'above', ok: true, value: 0.158, need: 0.14, at: 0 },
		{ name: 'below the rim', kind: 'above', ok: false, value: -0.031, need: 0, at: 12 },
		{ name: 'right hand strums', kind: 'moved', ok: true, value: 0.054, need: 0.04 },
		{ kind: 'near', ok: false },
	]);
	assert.deepEqual(rows[0], { name: 'finger on the button', ok: true, value: '1.2 cm', need: '≤ 2.0 cm', at: 'f70' });
	assert.deepEqual([rows[1].value, rows[1].need], ['+15.8 cm', '≥ +14.0 cm']);
	assert.deepEqual([rows[2].ok, rows[2].value, rows[2].need], [false, '−3.1 cm', '≥ +0.0 cm']);
	assert.deepEqual([rows[3].value, rows[3].need, rows[3].at], ['5.4 cm', '≥ 4.0 cm', '']);
	assert.deepEqual(rows[4], { name: 'near', ok: false, value: '—', need: '', at: '' }, 'a goal without a value');
});

test('issue rows keep QA order, leave goals to the checklist and name their frames', () => {
	const rows = issueRows([
		{ kind: 'GOAL', subject: 'kick foot at panel: 0.12 m at f140 (needs <= 0.03)', count: 1, first: 140, last: 140 },
		{ kind: 'COLLIDE', subject: 'thigh_l x chair', count: 24, first: 0, last: 23 },
		{ kind: 'FLOAT', subject: 'foot_r', count: 3 },
		{ kind: 'POP', subject: 'LeftForeArm', count: 1, first: 9, last: 9 },
		{ kind: 'REACH', subject: 'arm_miss_l', count: 5, first: 30, last: 34 },
	]);
	assert.deepEqual(rows.map(r => r.kind), ['COLLIDE', 'FLOAT', 'POP'], 'at most three, in QA order, no GOAL');
	assert.deepEqual(rows.map(r => r.frames), ['f0–23', '', 'f9']);
});

test('a steer is not a new turn', () => {
	assert.equal(turnCount([{ kind: 'user' }, { kind: 'tool' }, { kind: 'user', steered: true }, { kind: 'assistant' }, { kind: 'user' }]), 2);
});

test('every image verify_result keeps is published with a caption', () => {
	clearProgress();
	const run = (args, ports) => studioVisual(args, { s: { revision: 3, frameCount: 120 }, receipt: null, result: { receiptId: 'r1', visualRefs: [] }, images: new Map(), ports });
	run({ visual: 'frame', targets: ['actor-a'] }, { capture: () => ({ dataUrl: 'data:image/png;base64,AA==', width: 4, height: 2 }) });
	run({ visual: 'plan' }, { capturePlan: () => ({ dataUrl: 'data:image/png;base64,AQ==', width: 8, height: 8 }) });
	const sheets = progressSheets();
	assert.deepEqual(sheets.map(s => [s.characterId, s.caption, s.width]), [['actor-a', 'frame', 4], [null, 'plan', 8]]);
	assert.equal(sheets[0].dataUrl, 'data:image/png;base64,AA==');
	assert.equal(sheetCaption({ kind: 'contact sheet', views: ['front', 'three-quarter', 'side'], frames: [0, 12, 200] }), 'contact sheet · front, three-quarter, side · f0–200');
	clearProgress();
});
