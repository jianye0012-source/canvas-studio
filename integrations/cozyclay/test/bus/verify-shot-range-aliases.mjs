// shot.setRange takes the two spellings a live agent session sent (c100b90c, refused then):
// range: [start, endExclusive] and flat startFrame/endFrameExclusive. Both land the same range
// as range: { startFrame, endFrameExclusive }; the receipt and the shot read back the normalized range.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture } from './shots-fixture.mjs';

const landed = (args, origin = 'agent') => {
  const f = shotsFixture();
  try {
    const receipt = f.run('shot.setRange', args, origin), shot = f.live.current.shots.find(row => row.id === 'shot-a');
    return { receipt, range: shot && [shot.startFrame, shot.endFrame + 1] };
  } finally { f.dispose(); }
};

test('the array and flat spellings land the declared range, with the same receipt', () => {
  const canonical = landed({ shotId: 'shot-a', range: { startFrame: 2, endFrameExclusive: 48 } });
  assert.equal(canonical.receipt.ok, true, JSON.stringify(canonical.receipt));
  assert.deepEqual(canonical.range, [2, 48]);
  assert.match(canonical.receipt.summary, /\[2, 48\)/);
  for (const args of [{ shotId: 'shot-a', range: [2, 48] }, { shotId: 'shot-a', startFrame: 2, endFrameExclusive: 48 }]) {
    for (const origin of ['agent', 'ui']) {
      const alias = landed(args, origin);
      assert.equal(alias.receipt.ok, true, JSON.stringify(alias.receipt));
      assert.deepEqual(alias.range, [2, 48], JSON.stringify(args));
      assert.equal(alias.receipt.summary, canonical.receipt.summary);
      assert.deepEqual(alias.receipt.delta, canonical.receipt.delta);
    }
  }
  console.log(`PASS range: [2, 48] and flat startFrame/endFrameExclusive land ${canonical.receipt.summary}`);
});

test('a bad alias is refused with the declared range message', () => {
  const refusal = args => landed(args).receipt;
  for (const [args, message] of [
    [{ shotId: 'shot-a', range: [10, 10] }, /Frame range must be nonempty and half-open/],
    [{ shotId: 'shot-a', range: [0, 24, 48] }, /\$\.args\.range: expected an object, got an array/],
    [{ shotId: 'shot-a', startFrame: 4 }, /endFrameExclusive/],
    [{ shotId: 'shot-a', range: { startFrame: 0, endFrameExclusive: 24 }, startFrame: 0 }, /unknown field "?startFrame"?/],
  ]) {
    const receipt = refusal(args);
    assert.equal(receipt.ok, false, JSON.stringify(args));
    assert.equal(receipt.code, 'INVALID_ARGUMENT');
    assert.match(receipt.message, message, JSON.stringify([args, receipt.message]));
  }
  console.log('PASS an empty, three-number, half or doubled range is refused as before');
});
