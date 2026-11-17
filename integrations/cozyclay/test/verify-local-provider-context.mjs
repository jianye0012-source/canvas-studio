import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options';
import { openaiCompatibleProvider } from '../bin/agent/openai-compatible-provider.mjs';

const server = createServer((request, response) => {
  assert.equal(request.url, '/v1/models');
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ data: [{ id: 'fixture-model', name: '测试模型' }] }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const previous = process.env.CANVAS_LOCAL_PROVIDER_BASE;
const credential = { key: 'fixture-key', env: { OPENAI_COMPATIBLE_BASE_URL: base } };
async function model(local) {
  if (local) process.env.CANVAS_LOCAL_PROVIDER_BASE = base;
  else delete process.env.CANVAS_LOCAL_PROVIDER_BASE;
  const provider = await openaiCompatibleProvider();
  await provider.refreshModels({ credential, allowNetwork: true, signal: new AbortController().signal, publish: async ({ update }) => { update(); return true; } });
  return provider.getModels()[0];
}
try {
  const local = await model(true), general = await model(false);
  assert.deepEqual([local.contextWindow, local.maxTokens], [131072, 8192]);
  assert.deepEqual([general.contextWindow, general.maxTokens], [32768, 8192]);
  const context = [{ role: 'user', content: 'x'.repeat(100000) }];
  assert.equal(clampMaxTokensToContext(local, context, local.maxTokens), 8192);
  assert.ok(clampMaxTokensToContext(general, context, general.maxTokens) < 8192);
  console.log('PASS 启动器本机渠道 131072/8192，通用渠道 32768/8192；长上下文仍有 8192 输出额度');
} finally {
  if (previous === undefined) delete process.env.CANVAS_LOCAL_PROVIDER_BASE;
  else process.env.CANVAS_LOCAL_PROVIDER_BASE = previous;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
