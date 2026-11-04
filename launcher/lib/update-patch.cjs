const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const original = {
  'update-patch.cjs': null,
  'update.cjs': 'da4fa4617f262b8b6a81d1771669083002ea16e3126fa1b8e44e5ae49b1dd93b',
  'release-update.cjs': '5ce667ec7d4c7a8c040af421b72f059cfd0fa3d54e8d3ca9d767136096c69bfd',
};
const sha256 = bytes => bytes && crypto.createHash('sha256').update(bytes).digest('hex');
const readOptional = file => fs.readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });

async function replaceFile(file, bytes) {
  const pending = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(pending, bytes, { flag: 'wx' });
  try { await fs.rename(pending, file); }
  finally { await fs.rm(pending, { force: true }); }
}

async function applyUpdaterPatch(directory, required = false) {
  const manifestFile = path.join(directory, 'package-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.application !== 'canvas-studio' || manifest.platform !== 'win32-x64' || !['1.3.8', '1.3.10'].includes(manifest.version)) {
    if (required) throw new Error('此补丁仅适用于官方 Windows x64 的 1.3.8 和 1.3.10');
    return false;
  }
  const lib = path.join(directory, 'resources', 'app', 'lib');
  if (path.relative(lib, await fs.realpath(lib))) throw new Error('启动器代码目录必须位于当前整合包内');
  const changes = [];
  for (const [name, expected] of Object.entries(original)) {
    const file = path.join(lib, name);
    const before = await readOptional(file);
    const after = await fs.readFile(path.join(__dirname, name));
    const hash = sha256(after);
    const current = sha256(before);
    if (before && !(await fs.lstat(file)).isFile()) throw new Error(`无效的启动器文件：${name}`);
    if (current !== expected && current !== hash) {
      if (!required) return false;
      throw new Error(`启动器文件与官方版本不符：${name}`);
    }
    const relative = `resources/app/lib/${name}`;
    const entry = manifest.files.find(item => item.path === relative);
    if (entry) Object.assign(entry, { sha256: hash, size: after.length });
    else manifest.files.push({ path: relative, sha256: hash, size: after.length });
    if (current !== hash) changes.push({ file, before, after });
  }
  const applied = [];
  try {
    for (const change of changes) {
      await replaceFile(change.file, change.after);
      applied.push(change);
    }
    await replaceFile(manifestFile, JSON.stringify(manifest));
  } catch (error) {
    for (const { file, before } of applied.reverse()) {
      if (before) await replaceFile(file, before);
      else await fs.rm(file, { force: true });
    }
    throw error;
  }
  return true;
}

module.exports = { applyUpdaterPatch };

if (require.main === module) {
  (async () => {
    const root = await fs.realpath(path.resolve(process.argv[2]));
    await fs.access(path.join(root, '画布工作台启动器.exe'));
    const pointer = await readOptional(path.join(root, '.versions', 'active.json'));
    const active = pointer && JSON.parse(pointer.toString('utf8')).id;
    if (pointer && !/^[a-f0-9-]{36}$/.test(active)) throw new Error('当前启动器的版本记录无效');
    const directory = active ? path.join(root, '.versions', active) : root;
    if (path.relative(directory, await fs.realpath(directory))) throw new Error('当前版本目录必须位于整合包内');
    await applyUpdaterPatch(directory, true);
    console.log('补丁已应用。请重新打开画布工作台启动器。');
  })().catch(error => { console.error(`补丁应用失败：${error.message}`); process.exitCode = 1; });
}
