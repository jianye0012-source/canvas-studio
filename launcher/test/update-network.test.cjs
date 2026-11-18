const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateFetch } = require('../lib/update-network.cjs');

test('仅显式阻止跳转时标记 Electron 的固定跳转错误', async () => {
  for (const [redirect, message] of [
    ['manual', 'Redirect was cancelled'],
    ['error', "Attempted to redirect, but redirect policy was 'error'"],
  ]) {
    const fetchImpl = createUpdateFetch({ fetch: async () => { throw new Error(message); } });
    await assert.rejects(fetchImpl('https://example.com', { redirect }), { code: 'ERR_REDIRECT_BLOCKED' });
    await assert.rejects(fetchImpl('https://example.com'), error => error.code === undefined);
  }
  for (const message of ['fetch failed', 'redirect failed', 'Redirect was cancelled!']) {
    const fetchImpl = createUpdateFetch({ fetch: async () => { throw new Error(message); } });
    await assert.rejects(fetchImpl('https://example.com', { redirect: 'manual' }), error => error.code === undefined);
  }
});
