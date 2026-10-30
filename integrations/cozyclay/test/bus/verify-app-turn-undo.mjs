// 9240db36 through the real App: the agent undoes its own newest edit inside its turn (undo_edit by receipt), the
// scene revision moves so its next command is admitted, and the turn still lands as one undo step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectsFixture } from './objects-fixture.mjs';

const ok = receipt => { assert.equal(receipt.ok, true, JSON.stringify(receipt)); return receipt; };
test('App: an agent turn undoes its own newest edit by receipt and still lands as one entry', () => {
  const f = objectsFixture();
  try {
    const ids = () => f.store.current.objects.map(object => object.id), turnId = crypto.randomUUID();
    const agent = (id, args = {}) => f.run(id, args, 'agent', { turnId });
    const before = ids();
    ok(agent('agent.turn.begin', { turnId }));
    const first = ok(agent('object.duplicate', { objectId: 'cube' })), afterFirst = ids();
    const second = ok(agent('object.duplicate', { objectId: 'cube' }));
    assert.equal(ids().length, before.length + 2);
    const revision = f.binding.refresh().revision;
    const undone = ok(agent('edit.undo', { receiptId: second.receiptId }));
    assert.equal(undone.output.undoneReceiptId, second.receiptId);
    assert.deepEqual(ids(), afterFirst, 'only the newest duplicate is gone');
    assert.ok(undone.revision.after > revision, `the revision moves: ${revision} -> ${undone.revision.after}`);
    assert.equal(undone.revision.after, f.binding.refresh().revision, 'the receipt names the revision the next command is admitted at');
    ok(agent('object.duplicate', { objectId: 'sphere' }));
    const finished = ok(agent('agent.turn.finish', { turnId }));
    assert.equal(finished.undo.entries, 1);
    assert.equal(ids().length, before.length + 2, 'the first and the last duplicate land');
    ok(f.run('edit.undo', { receiptId: finished.receiptId }));
    assert.deepEqual(ids(), before, 'one undo takes the whole turn back');
    assert.ok(first.affectedIds.length);
  } finally { f.dispose(); }
});
