import assert from 'node:assert/strict';
import { fixture, host, result } from './fixture.mjs';

// A declared readOnly action only measures: the bus admits it on a stale
// expectedRevision and mid-gesture, while the host fence still refuses it.
// Fake declarations stand in for motion.qa (readOnly job) and motion.compile (write job).
const input = { type: 'object', properties: {}, required: [], additionalProperties: false };
const job = (id, extra) => ({ id, label: id, kind: 'job', domain: 'motion', description: `${id} fixture.`, input, available: () => true, ...extra });
let reads = 0, writes = 0;
const f = fixture([
  job('fake.measure', { readOnly: true, run: () => { reads++; return result(['char-a']); } }),
  job('fake.write', { run: (_, context) => { context.commit(() => { writes++; }); return result(['char-a']); } }),
]);

const rows = Object.fromEntries(f.registry.list().map(row => [row.id, row]));
assert.equal(rows['fake.measure'].readOnly, true, 'list() rows expose readOnly');
assert.equal('readOnly' in rows['fake.write'], false, 'a write action carries no readOnly key');

const stale = f.state.revision;
f.edit(1, 'motion');
assert.notEqual(f.state.revision, stale);

const read = await f.bus.run('fake.measure', {}, f.request('agent', { expectedRevision: stale }));
assert.equal(read.ok, true, JSON.stringify(read));
assert.equal(reads, 1);

const write = await f.bus.run('fake.write', {}, f.request('agent', { expectedRevision: stale }));
assert.equal(write.ok, false);
assert.equal(write.code, 'STALE_SCENE', JSON.stringify(write));
assert.equal(writes, 0);

// The editor is mid-gesture: a read still runs, a write meets TARGET_BUSY.
f.patch({ busy: true });
const busyRead = await f.bus.run('fake.measure', {}, f.request('agent'));
assert.equal(busyRead.ok, true, JSON.stringify(busyRead));
const busyWrite = await f.bus.run('fake.write', {}, f.request('agent'));
assert.equal(busyWrite.code, 'TARGET_BUSY', JSON.stringify(busyWrite));
f.patch({ busy: false });

// Another document: both are refused at the host fence.
const other = { ...host, sceneEpoch: 'other-epoch' };
for (const id of ['fake.measure', 'fake.write']) {
  const refused = await f.bus.run(id, {}, f.request('agent', { host: other }));
  assert.equal(refused.ok, false, id);
  assert.equal(refused.code, 'STALE_SCENE', `${id}: ${JSON.stringify(refused)}`);
}
assert.equal(reads, 2);

// A current revision still admits the write.
const fresh = await f.bus.run('fake.write', {}, f.request('agent'));
assert.equal(fresh.ok, true, JSON.stringify(fresh));
assert.equal(writes, 1);
console.log('readonly actions: ok');
