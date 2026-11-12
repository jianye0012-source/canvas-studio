const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = await fs.mkdtemp(path.join(root, 'work/tmp/live-models-ui-'));
  await fs.mkdir(path.join(directory, 'data'));
  await fs.writeFile(path.join(directory, 'data/settings.json'), JSON.stringify({ autoCheckUpdates: false, channels: [] }));
  const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(root, 'launcher')], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp'), CANVAS_DEV_ROOT: directory } });
  try {
    const page = await app.firstWindow();
    await page.locator('#top-status').filter({ hasText: '准备就绪' }).waitFor();
    await app.evaluate(({ net }) => {
      globalThis.__catalogueVersion = 1; globalThis.__catalogueOffline = false; globalThis.__catalogueReads = [];
      net.fetch = async url => {
        const pathname = new URL(url).pathname;
        if (globalThis.__catalogueOffline) throw new Error('mock offline');
        if (pathname.endsWith('/llms.txt')) {
          globalThis.__catalogueReads.push(url);
          const id = globalThis.__catalogueVersion === 1 ? '123' : '456';
          return new Response(`- 模型API > 图像生成与处理 > image-to-image [模型${id}](https://www.runninghub.cn/runninghub-api-doc-cn/api-${id}.md):`);
        }
        const definition = { paths: { '/openapi/v2/fixture/image-to-image': { post: { requestBody: { content: { 'application/json': { schema: { required: ['prompt', 'imageUrls'], properties: { prompt: { type: 'string' }, imageUrls: { type: 'array', items: { type: 'string' }, maxItems: 10 } } } } } } } } } };
        return new Response(['# 模型123', '```yaml', JSON.stringify(definition), '```'].join('\n'));
      };
    });
    await page.locator('[data-page="models"]').click(); await page.locator('#add-channel').click();
    await page.locator('#model-form [name="protocol"]').selectOption('runninghub-standard');
    await page.locator('#test-models').click();
    await page.locator('#runninghub-catalogue-summary').filter({ hasText: '本次联网读取' }).waitFor();
    await page.locator('#runninghub-catalogue-groups summary').filter({ hasText: '图片' }).click();
    await page.getByRole('button', { name: '添加 模型123', exact: true }).click();
    await page.getByRole('button', { name: '更新参数 模型123', exact: true }).waitFor();
    await page.locator('#save-models').click();
    await app.evaluate(() => { globalThis.__catalogueVersion = 2; });
    await page.locator('#test-models').click();
    await page.getByRole('button', { name: '添加 模型456', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '更新参数 模型123', exact: true }).count(), 0);
    assert.match(await page.locator('#channel-models').innerText(), /fixture\/image-to-image.*本次目录未返回可用条目/s);
    const reads = await app.evaluate(() => globalThis.__catalogueReads);
    assert.equal(new Set(reads).size, reads.length); assert.ok(reads.length >= 3);
    await app.evaluate(() => { globalThis.__catalogueOffline = true; });
    await page.locator('#test-models').click();
    await page.locator('#notice').filter({ hasText: '无法读取' }).waitFor();
    assert.equal(await page.locator('#runninghub-catalogue').isVisible(), false);
    console.log('PASS real launcher replaces the live catalogue, marks missing configured models and clears the directory on network failure');
  } finally { await app.close(); await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
