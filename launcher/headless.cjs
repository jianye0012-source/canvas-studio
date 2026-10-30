const path = require('node:path');
const fs = require('node:fs/promises');
const { Runtime } = require('./lib/runtime.cjs');
const { ConfigStore } = require('./lib/config.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dataDir = process.env.CANVAS_SMOKE_DATA_DIR || path.join(root, 'work', 'smoke-data');
  const configRoot = path.join(root, 'work', 'smoke-locator');
  await fs.mkdir(dataDir, { recursive: true }); await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, 'portable.json'), JSON.stringify({ dataDir }));
  // Test-only encryption; production uses Electron safeStorage in main.cjs.
  const store = await new ConfigStore(configRoot, async value => Buffer.from(value), async bytes => bytes.toString()).initialize();
  if (!store.value.channels.length) await store.save({ channels: [{ id: 'smoke-main', name: '联调渠道', baseUrl: '', enabled: true, models: ['smoke-director', 'smoke-image', 'smoke-video'], modelCapabilities: { 'smoke-director': 'text', 'smoke-image': 'image', 'smoke-video': 'video' } }], directorModel: 'smoke-director', directorChannelId: 'smoke-main', textModel: 'smoke-director', textChannelId: 'smoke-main', imageModel: 'smoke-image', imageChannelId: 'smoke-main', videoModel: 'smoke-video', videoChannelId: 'smoke-main', browser: 'chrome', browserPath: '/usr/bin/google-chrome' });
  const runtime = new Runtime({ store, root: path.join(root, 'work', 'bundle-linux'), development: true });
  runtime.on('status', status => console.log(JSON.stringify(status)));
  runtime.on('log', lines => { const line = lines.at(-1); if (line && !line.includes('GIN')) console.log(line); });
  await runtime.start({ open: false });
  await fs.writeFile(path.join(root, 'work', 'smoke-runtime.json'), JSON.stringify({ url: runtime.gateway.origin, launchUrl: runtime.gateway.launchUrl(), dataDir }));
  process.on('SIGINT', () => runtime.stop().then(() => process.exit(0))); process.on('SIGTERM', () => runtime.stop().then(() => process.exit(0)));
})().catch(error => { console.error(error); process.exit(1); });
