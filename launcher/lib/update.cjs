const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const unzipper = require('unzipper');
const { contained, verifyManifest, writableDirectory, requireFreeSpace, atomicJson } = require('./files.cjs');
const { applyUpdaterPatch } = require('./update-patch.cjs');

async function stageUpdate(zipFile, dataDir) {
  await writableDirectory(dataDir);
  const archive = await unzipper.Open.file(zipFile);
  const manifests = archive.files.filter(entry => /(^|\/)package-manifest\.json$/.test(entry.path));
  if (manifests.length !== 1) throw new Error('这不是完整的画布工作台发行包');
  const prefix = manifests[0].path.slice(0, -'package-manifest.json'.length);
  const manifest = JSON.parse((await manifests[0].buffer()).toString('utf8'));
  if (manifest.application !== 'canvas-studio' || manifest.platform !== 'win32-x64' || manifest.format !== 1 || !Array.isArray(manifest.files)) throw new Error('发行包类型或平台不匹配');
  const expected = new Set(manifest.files.map(entry => entry.path));
  if (!expected.has('画布工作台启动器.exe') || !expected.has('resources/bundle/runtime/node.exe')) throw new Error('发行包缺少启动器或运行环境');
  const bytes = archive.files.reduce((sum, entry) => sum + (entry.type === 'Directory' ? 0 : entry.uncompressedSize), 0);
  if (bytes > 5 * 1024 ** 3) throw new Error('发行包解压后体积异常');
  await requireFreeSpace(dataDir, bytes);
  const staging = path.join(dataDir, 'updates', crypto.randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    let total = 0; const seen = new Set();
    for (const entry of archive.files) {
      if (entry.type === 'Directory') continue;
      if (!entry.path.startsWith(prefix)) throw new Error('发行包包含异常路径');
      const relative = entry.path.slice(prefix.length);
      const normalized = relative.toLowerCase();
      if (seen.has(normalized)) throw new Error('发行包包含重复文件'); seen.add(normalized);
      if (!expected.has(relative) && relative !== 'package-manifest.json') continue;
      if (/^(?:data|work|outputs|\.versions)(?:\/|$)|^(?:portable\.json|managed-version\.json|launch-ready|next-active\.json)$/i.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || /[:. ]$|[:<>|?*]/.test(part))) throw new Error('发行包包含保留目录或无效文件路径');
      if ((entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000) throw new Error('发行包包含符号链接');
      total += entry.uncompressedSize; if (total > 5 * 1024 ** 3) throw new Error('发行包解压后体积异常');
      const target = contained(staging, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await require('node:stream/promises').pipeline(entry.stream(), require('node:fs').createWriteStream(target, { flags: 'wx' }));
    }
    await verifyManifest(staging, { filename: 'package-manifest.json' });
    return staging;
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}

const versionDirectory = /^[a-f0-9-]{36}$/;
const executableName = '画布工作台启动器.exe';

function installationPaths(program) {
  const container = path.dirname(program);
  const root = path.basename(container) === '.versions' && versionDirectory.test(path.basename(program))
    ? path.dirname(container) : program;
  return { root, program, pointer: path.join(root, '.versions', 'active.json') };
}

async function prepareInstallation(staging, root, dataDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(staging, 'package-manifest.json'), 'utf8'));
  const id = crypto.randomUUID();
  const directory = path.join(root, '.versions', id);
  await requireFreeSpace(root, manifest.files.reduce((sum, entry) => sum + entry.size, 0));
  try {
    await fs.mkdir(directory, { recursive: true });
    await atomicJson(path.join(directory, 'managed-version.json'), { id });
    await atomicJson(path.join(directory, 'package-manifest.json'), manifest);
    for (const name of await fs.readdir(staging)) {
      if (name !== 'package-manifest.json') await fs.cp(path.join(staging, name), path.join(directory, name), { recursive: true, errorOnExist: true, force: false });
    }
    await verifyManifest(directory, { filename: 'package-manifest.json' });
    await applyUpdaterPatch(directory);
    // Historical launchers read a locator beside their own executable.
    await atomicJson(path.join(directory, 'portable.json'), { dataDir });
    return { id, directory, version: manifest.version };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function applyUpdate(staging, root, dataDir) {
  await writableDirectory(dataDir);
  await writableDirectory(root);
  const prepared = await prepareInstallation(staging, root, dataDir);
  try {
    await atomicJson(installationPaths(root).pointer, { id: prepared.id, version: prepared.version });
  } catch (error) {
    await fs.rm(prepared.directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return prepared;
}

async function containsOnlyProgramFiles(directory, manifest) {
  const files = new Set(['package-manifest.json', 'portable.json', 'managed-version.json', 'launch-ready', 'next-active.json', ...manifest.files.map(entry => entry.path)]);
  const directories = new Set();
  for (const file of files) for (let parent = path.posix.dirname(file); parent !== '.' && parent !== '/'; parent = path.posix.dirname(parent)) directories.add(parent);
  async function check(current, prefix = '') {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory() && directories.has(relative)) {
        if (!await check(path.join(current, entry.name), relative + '/')) return false;
      } else if (!entry.isFile() || !files.has(relative)) return false;
    }
    return true;
  }
  return check(directory);
}

async function clearInactiveVersions(root, program, dataDir) {
  const versions = path.join(root, '.versions');
  const active = await fs.readFile(path.join(versions, 'active.json'), 'utf8').then(JSON.parse, error => { if (error.code !== 'ENOENT') throw error; return {}; });
  const entries = await fs.readdir(versions, { withFileTypes: true }).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
  let removed = 0;
  for (const entry of entries) {
    const directory = path.join(versions, entry.name);
    if (!entry.isDirectory() || !versionDirectory.test(entry.name) || entry.name === active.id || directory === program) continue;
    if (dataDir === directory || dataDir.startsWith(directory + path.sep)) continue;
    const marker = await fs.readFile(path.join(directory, 'managed-version.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (marker?.id !== entry.name) continue;
    const manifest = await fs.readFile(path.join(directory, 'package-manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (manifest?.application !== 'canvas-studio' || !Array.isArray(manifest.files) || !await containsOnlyProgramFiles(directory, manifest)) continue;
    await fs.rm(directory, { recursive: true, force: true }); removed++;
  }
  return removed;
}

module.exports = { stageUpdate, applyUpdate, installationPaths, prepareInstallation, clearInactiveVersions, executableName, versionDirectory };
