const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

function contained(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('文件路径无效');
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(path.resolve(root) + path.sep)) throw new Error('文件路径超出整合包目录');
  return target;
}

async function writableDirectory(directory) {
  // Refuse to silently recreate a missing selected directory on another drive.
  const stat = await fs.stat(directory);
  if (!stat.isDirectory()) throw new Error('数据目录不可用');
  const probe = path.join(directory, `.write-${crypto.randomUUID()}`);
  await fs.writeFile(probe, 'ok', { flag: 'wx', mode: 0o600 });
  await fs.unlink(probe);
}

async function verifyManifest(root, { required = true, filename = 'bundle-manifest.json' } = {}) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, filename), 'utf8')); }
  catch (e) { if (!required && e.code === 'ENOENT') return { development: true, checked: 0 }; throw new Error('整合包清单缺失或损坏，请导入完整发行包'); }
  if (manifest.format !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('发行包清单格式无效');
  let checked = 0;
  for (const entry of manifest.files) {
    const file = contained(root, entry.path);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size !== entry.size) throw new Error(`文件大小不匹配：${entry.path}`);
    const digest = crypto.createHash('sha256');
    for await (const chunk of require('node:fs').createReadStream(file)) digest.update(chunk);
    if (digest.digest('hex') !== entry.sha256) throw new Error(`文件校验失败：${entry.path}`);
    checked++;
  }
  return { checked, version: manifest.version };
}

module.exports = { atomicJson, contained, writableDirectory, verifyManifest };
