const fs = require('node:fs/promises');
const { openAsBlob } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mime = require('mime-types');
const { atomicJson, contained, writableDirectory } = require('./files.cjs');
const extensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.mp3', '.wav', '.ogg', '.txt', '.md']);
class FolderStore {
  constructor(dataDir, choose) { this.dataDir = dataDir; this.choose = choose; this.file = path.join(dataDir, 'config', 'folders.json'); }
  async grants() { try { return JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } }
  async select() {
    if (!this.choose) throw new Error('请从 Windows 启动器启动工作台后选择文件夹');
    const selected = await this.choose(); if (!selected) return null;
    const root = await fs.realpath(selected); const grants = await this.grants();
    const id = Object.keys(grants).find(id => grants[id] === root) || crypto.randomUUID(); grants[id] = root;
    await writableDirectory(this.dataDir); await atomicJson(this.file, grants);
    return { id, name: path.basename(root), path: root };
  }
  async scan(id, recursive = false) {
    const root = (await this.grants())[id]; if (!root) throw new Error('文件夹授权不存在，请重新选择');
    if (await fs.realpath(root) !== root) throw new Error('文件夹位置已变动，请重新选择');
    const files = []; let visited = 0;
    const visit = async (dir, depth) => {
      if (depth > 20) throw new Error('子文件夹层级超过 20 层');
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (++visited > 20000) throw new Error('目录项超过 20000 项，请选择更小的文件夹');
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && recursive) await visit(file, depth + 1);
        if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
        const stat = await fs.stat(file); if (!stat.size) continue;
        if (stat.size > 1024 ** 3) throw new Error(`${entry.name} 超过 1 GB，请缩小文件`);
        if (files.length >= 2000) throw new Error('一次循环最多 2000 个文件，请分批选择');
        const relativePath = path.relative(root, file).split(path.sep).join('/');
        files.push({ id: Buffer.from(relativePath).toString('base64url'), relativePath, size: stat.size, mtime: stat.mtimeMs, mimeType: mime.lookup(entry.name) || 'application/octet-stream' });
      }
    };
    await visit(root, 0); files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true }));
    return { id, name: path.basename(root), path: root, files };
  }
  async import(id, item, apiPort, token) {
    const root = (await this.grants())[id]; if (!root) throw new Error('文件夹授权已失效');
    const relative = Buffer.from(item.id, 'base64url').toString('utf8');
    const file = contained(root, relative); if (await fs.realpath(file) !== file || await fs.realpath(root) !== root) throw new Error('文件位置已改变，请重新扫描');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size !== item.size || stat.mtimeMs !== item.mtime) throw new Error('文件已被修改，请重新选择文件夹开始新的循环');
    if (stat.size > 1024 ** 3 || !extensions.has(path.extname(file).toLowerCase())) throw new Error('文件不受支持');
    await writableDirectory(this.dataDir);
    if (['.txt', '.md'].includes(path.extname(file).toLowerCase())) { if (stat.size > 1024 * 1024) throw new Error('文本文件超过 1 MB'); return { content: await fs.readFile(file, 'utf8'), mimeType: 'text/plain' }; }
    const form = new FormData(); form.append('file', await openAsBlob(file, { type: mime.lookup(file) || 'application/octet-stream' }), path.basename(file));
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/v1/files`, { method: 'POST', headers: { 'X-Canvas-Local-Token': token }, body: form, signal: AbortSignal.timeout(180000) });
    const result = await response.json(); if (!response.ok || result.code !== 0) throw new Error(result.msg || '文件写入素材存储失败');
    return result.data;
  }
}
module.exports = { FolderStore };
