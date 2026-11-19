const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicJson, atomicBytes } = require('./files.cjs');

class DirectorStore {
  constructor(projectsDir) {
    this.projectsDir = path.join(projectsDir, 'director');
    this.assetsDir = path.join(projectsDir, 'director-assets');
  }
  assetId(id) {
    if (!/^(img|mesh|hdr|sculpt)-[0-9a-f]{32}$/.test(id)) throw Object.assign(new Error('素材编号无效'), { status: 400 });
    return id;
  }
  async assetFile(id) {
    this.assetId(id);
    const file = path.join(this.assetsDir, id + '.bin'), metadata = path.join(this.assetsDir, id + '.json');
    if (!existsSync(metadata) || !existsSync(file)) return null;
    const meta = JSON.parse(await fs.readFile(metadata, 'utf8'));
    return (await fs.stat(file)).size === meta.size ? { file, meta } : null;
  }
  async hasAsset(id, size) {
    const asset = await this.assetFile(id);
    return Boolean(asset && (size === undefined || asset.meta.size === size));
  }
  async putAsset(id, bytes, { type, name }) {
    this.assetId(id);
    if (bytes.length > 100 * 1024 * 1024) throw Object.assign(new Error('素材超过 100 MB'), { status: 413 });
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (id.startsWith('sculpt-')) {
      if (!bytes.length) throw Object.assign(new Error('素材为空'), { status: 400 });
    } else if (sha256.slice(0, 32) !== id.slice(id.indexOf('-') + 1)) throw Object.assign(new Error('素材内容与编号不一致'), { status: 400 });
    const existing = await this.assetFile(id);
    if (existing) return { stored: true, size: existing.meta.size };
    await atomicBytes(path.join(this.assetsDir, id + '.bin'), bytes);
    await atomicJson(path.join(this.assetsDir, id + '.json'), { id, type, name, size: bytes.length, sha256 });
    return { stored: true, size: bytes.length };
  }
  async splitAssets(value) {
    const assets = value.project.resources?.assets;
    if (assets) {
      for (const [index, entry] of assets.entries()) {
        const { bytes, ...rest } = entry;
        assets[index] = null;
        if (typeof bytes !== 'string') continue;
        const decoded = Buffer.from(bytes, 'base64');
        try { await this.putAsset(entry.id, decoded, entry); }
        catch (error) { if (!error.status) throw error; continue; }
        assets[index] = { ...rest, size: decoded.length };
      }
      value.project.resources.assets = assets.filter(Boolean);
    }
    value.schemaVersion = 2;
    return value;
  }
  async readProject(id, { inline }) {
    const file = path.join(this.projectsDir, id + '.json');
    if (!existsSync(file)) return null;
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.schemaVersion === 1) {
      const backup = path.join(this.projectsDir, id + '.v1.json');
      if (!existsSync(backup)) {
        const temporary = `${backup}.${crypto.randomUUID()}.tmp`;
        await fs.copyFile(file, temporary);
        await fs.rename(temporary, backup);
      }
      await this.splitAssets(value);
      await atomicJson(file, value);
    }
    if (inline) {
      const assets = value.project.resources?.assets;
      if (assets) {
        for (const [index, entry] of assets.entries()) {
          const asset = await this.assetFile(entry.id);
          if (!asset) throw new Error(`素材缺失 ${entry.id}`);
          const { size, ...rest } = entry;
          assets[index] = { ...rest, bytes: (await fs.readFile(asset.file)).toString('base64') };
        }
      }
      value.schemaVersion = 1;
    }
    return value;
  }
  async writeProject(id, value) {
    if (value.schemaVersion === 1) await this.splitAssets(value);
    else {
      const missing = [];
      for (const entry of value.project.resources?.assets || []) if (!await this.hasAsset(entry.id, entry.size)) missing.push(entry.id);
      if (missing.length) throw Object.assign(new Error(`缺少素材 ${missing[0]}，请重试保存`), { status: 409, missing });
    }
    await atomicJson(path.join(this.projectsDir, id + '.json'), value);
  }
  async deleteProject(id) {
    await fs.rm(path.join(this.projectsDir, id + '.json'), { force: true });
    await fs.rm(path.join(this.projectsDir, id + '.v1.json'), { force: true });
  }
}

module.exports = { DirectorStore };
