import assert from 'node:assert/strict';
import { fixture, result, sample } from './fixture.mjs';
import { STUDIO_ACTIONS, studioActionRefusal } from '../../src/studio-actions.js';
for (const declaration of STUDIO_ACTIONS) {
  const f = fixture();
  const text = `Refusal from ${declaration.id}`;
  f.register(declaration.id, () => { f.toast(text, '한국어 알림'); });
  const args = sample(declaration.input);
  const confirmationToken = f.bus.confirm(declaration.id, args);
  const r = await f.bus.run(declaration.id, args, f.request('agent', { confirmationToken }));
  assert.equal(r.ok, false, declaration.id);
  assert.equal(r.code, 'TARGET_NOT_READY', declaration.id);
  assert.equal(r.message, text, declaration.id);
}
const f = fixture();
f.register('shot.create', () => { f.edit(1); f.toast('An English warning.', '한국어 경고'); return result(); });
const warning = await f.bus.run('shot.create', {}, f.request());
assert.equal(warning.ok, true);
assert.deepEqual(warning.warnings, [{ code: 'STUDIO_TOAST', message: 'An English warning.' }]);
f.register('shot.remove', () => { f.toast('Generic text.'); throw studioActionRefusal('INVALID_RANGE', 'Specific refusal.', '범위 오류'); });
assert.equal((await f.bus.run('shot.remove', { shotId: 'target' }, f.request())).message, 'Specific refusal.');
const shown = [];
f.ports.showRefusal = text => shown.push(text);
assert.equal((await f.bus.run('shot.remove', { shotId: 'target' }, f.request('ui'))).code, 'INVALID_RANGE');
assert.deepEqual(shown, ['범위 오류']);
console.log(`PASS bus acceptance 2: English toast refusals for all ${STUDIO_ACTIONS.length} actions, warnings and explicit precedence`);
// 1c631d0c: a job that answered (motion.compile with install "never" changes nothing) is not refused
// because a toast showed while it ran: the user entering Pose mode is not the job's refusal.
{
  const g = fixture();
  g.register('ai.prepareShot', () => { g.toast('Pose mode — preview the correction, then apply it to the selected motion block'); return { ...result([]), output: { specId: 'spec-1' } }; }, { readOnly: true });
  const job = STUDIO_ACTIONS.find(action => action.id === 'ai.prepareShot');
  const answered = await g.bus.run(job.id, sample(job.input), g.request('agent'));
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.deepEqual(answered.output, { specId: 'spec-1' });
  assert.equal(answered.warnings[0]?.code, 'STUDIO_TOAST', 'the toast still rides along as a warning');
  console.log('PASS a job that answered keeps its answer when a toast shows while it runs');
}
