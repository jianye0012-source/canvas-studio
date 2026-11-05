import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const archiver = require('archiver');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const versions = ['1.3.8', '1.3.10', '1.3.11'];
const files = ['lib/runninghub-standard.cjs', 'lib/config.cjs', 'lib/gateway.cjs', 'main.cjs', 'ui/app.js', 'ui/index.html'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stage = await fs.mkdtemp(path.join(root, 'work/tmp/runninghub-patch-'));
const folder = path.join(stage, 'RunningHub-CN-Patch');
try {
  await fs.mkdir(folder);
  const delta = execFileSync('git', ['diff', '--unified=0', 'v1.3.11', '--', ...files.filter(file => file !== 'ui/index.html').map(file => 'launcher/' + file)], { cwd: root });
  const html = await fs.readFile(path.join(root, 'launcher/ui/index.html'), 'utf8');
  const siteRow = html.match(/<label id="runninghub-site-row"[\s\S]*?<\/label>/)?.[0];
  if (!siteRow) throw new Error('启动器缺少站点选择入口');
  const manifest = { versions: {} };
  for (const version of versions) {
    const source = path.join(stage, version);
    const before = new Map();
    for (const file of files) {
      const bytes = execFileSync('git', ['show', `v${version}:launcher/${file}`], { cwd: root });
      before.set(file, bytes);
      const target = path.join(source, 'launcher', file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    const applied = spawnSync('git', ['apply', '--unidiff-zero', '--directory=' + path.relative(root, source)], { cwd: root, input: delta, encoding: 'utf8' });
    if (applied.status !== 0) throw new Error(`无法为 ${version} 生成补丁：${applied.stderr}`);
    const htmlFile = path.join(source, 'launcher/ui/index.html');
    const originalHtml = await fs.readFile(htmlFile, 'utf8');
    const address = '<label>接口地址<input name="baseUrl"';
    if (originalHtml.split(address).length !== 2) throw new Error(`${version} 的模型配置入口不匹配`);
    await fs.writeFile(htmlFile, originalHtml.replace(address, siteRow + address));
    manifest.versions[version] = [];
    for (const file of files) {
      const bytes = await fs.readFile(path.join(source, 'launcher', file));
      const target = path.join(folder, 'payload', version, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
      const original = before.get(file);
      const windows = Buffer.from(original.toString('utf8').replace(/\r?\n/g, '\r\n'));
      manifest.versions[version].push({ path: file, before: [...new Set([digest(original), digest(windows)])], after: digest(bytes) });
    }
  }
  await fs.writeFile(path.join(folder, 'patch.json'), JSON.stringify(manifest));
  await fs.copyFile(path.join(root, 'launcher/lib/runninghub-site-patch.cjs'), path.join(folder, 'runninghub-site-patch.cjs'));
  await fs.copyFile(path.join(root, 'launcher/scripts/Apply-RunningHub-Site-Patch.cmd'), path.join(folder, '一键应用国内站补丁.cmd'));
  await fs.writeFile(path.join(folder, '使用说明.txt'), 'RunningHub 国内站补丁\r\n\r\n适用官方 Windows x64 1.3.8、1.3.10、1.3.11。\r\n1. 先在启动器停止服务，再关闭启动器和工作台浏览器。\r\n2. 将解压得到的 RunningHub-CN-Patch 文件夹放在画布工作台启动器.exe 的同一目录。\r\n3. 双击补丁文件夹中的“一键应用国内站补丁.cmd”。\r\n4. 显示应用成功后重开启动器。在模型配置选择 RunningHub 国内站 .cn，核对 API Key，检测渠道并保存。\r\n5. 生图时选择国内渠道下添加的模型。检测结果显示该 Key 返回的钱包余额。\r\n\r\n补丁会核对文件及当前活动版本，并更新程序完整性清单。版本号保持原值。项目、素材与密钥沿用原数据目录。\r\n');
  const output = path.join(root, 'outputs/CanvasStudio-RunningHub-CN-Patch.zip');
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = createWriteStream(output);
  const finished = new Promise((resolve, reject) => { stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject); });
  archive.pipe(stream);
  archive.directory(folder, 'RunningHub-CN-Patch');
  await archive.finalize();
  await finished;
  const bytes = await fs.readFile(output);
  await fs.writeFile(output + '.sha256', digest(bytes) + '  ' + path.basename(output) + '\n');
  console.log(`已生成 ${path.basename(output)}，${bytes.length} 字节`);
} finally { await fs.rm(stage, { recursive: true, force: true }); }
