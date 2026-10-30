const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicJson, writableDirectory } = require('./files.cjs');

const roles = { director: '白模导演', text: '画布文字', image: '图片生成', video: '视频生成' };
const defaults = { channels: [], directorModel: '', directorChannelId: '', textModel: '', textChannelId: '', imageModel: '', imageChannelId: '', videoModel: '', videoChannelId: '', browser: 'edge', browserPath: '', port: 17860, autoCheckUpdates: true };
const capabilityFor = role => role === 'director' ? 'text' : role;
const directorModelId = (channelId, model) => `${channelId}::${model}`;
const text = (value, name, limit = 8192) => { if (typeof value !== 'string' || value.length > limit) throw new Error(`${name}格式无效`); return value.trim(); };

// Keep the settings and encrypted key from the already distributed single-channel package.
function upgradeConfig(value) {
  if (Array.isArray(value.channels)) return value;
  const models = [...new Set(Object.keys(roles).map(role => value[role + 'Model']).filter(Boolean))];
  const present = value.baseUrl || value.encryptedKey || value.apiKey || models.length;
  const channel = { id: 'launcher', name: '默认渠道', baseUrl: value.baseUrl || '', apiKey: value.apiKey || '', encryptedKey: value.encryptedKey, enabled: true, models, modelCapabilities: Object.fromEntries(Object.keys(roles).filter(role => value[role + 'Model']).map(role => [value[role + 'Model'], capabilityFor(role)])) };
  return { ...value, channels: present ? [channel] : [], ...Object.fromEntries(Object.keys(roles).map(role => [role + 'ChannelId', value[role + 'Model'] ? 'launcher' : ''])) };
}

function validateConfig(value) {
  const next = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, value[key] ?? fallback]));
  if (!['edge', 'chrome', 'firefox', 'custom'].includes(next.browser)) throw new Error('请选择 Edge、Chrome、Firefox 或指定浏览器');
  if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65530) throw new Error('端口须在 1024—65530 之间');
  if (typeof next.autoCheckUpdates !== 'boolean') throw new Error('自动检查更新设置无效');
  next.browserPath = text(next.browserPath, '浏览器路径');
  if (next.browser === 'custom' && !next.browserPath) throw new Error('请选择指定浏览器的程序文件');
  if (!Array.isArray(next.channels) || next.channels.length > 50) throw new Error('最多支持 50 个渠道');
  const ids = new Set();
  next.channels = next.channels.map(channel => {
    const id = text(channel.id, '渠道编号', 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('渠道编号无效或重复');
    ids.add(id);
    const name = text(channel.name, '渠道名称', 100);
    if (!name) throw new Error('请填写渠道名称');
    let baseUrl = text(channel.baseUrl || '', '接口地址');
    if (baseUrl) {
      const url = new URL(baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`渠道「${name}」接口地址无效`);
      baseUrl = url.href.replace(/\/+$/, '').replace(/\/v1$/, '');
    }
    if (!Array.isArray(channel.models) || channel.models.length > 2000) throw new Error(`渠道「${name}」模型列表无效`);
    const models = [...new Set(channel.models.map(model => text(model, '模型名称', 500)))];
    const modelCapabilities = Object.fromEntries(models.map(model => {
      const capability = channel.modelCapabilities?.[model];
      if (!model || !['text', 'image', 'video'].includes(capability)) throw new Error(`请为渠道「${name}」的模型选择文字、图片或视频类型`);
      return [model, capability];
    }));
    return { id, name, baseUrl, apiKey: text(channel.apiKey || '', 'API Key'), enabled: channel.enabled !== false, models, modelCapabilities };
  });
  for (const [role, label] of Object.entries(roles)) {
    const model = next[role + 'Model'] = text(next[role + 'Model'], label + '模型', 500);
    const channelId = next[role + 'ChannelId'] = text(next[role + 'ChannelId'], label + '渠道', 80);
    if (!model && !channelId) continue;
    const channel = next.channels.find(entry => entry.id === channelId && entry.enabled);
    if (!channel || !channel.models.includes(model) || channel.modelCapabilities[model] !== capabilityFor(role)) throw new Error(`请重新选择${label}的渠道和模型`);
  }
  return next;
}

class ConfigStore {
  constructor(root, encrypt, decrypt) { this.root = root; this.encrypt = encrypt; this.decrypt = decrypt; this.unavailable = new Set(); }
  async initialize() {
    let locator;
    try { locator = JSON.parse(await fs.readFile(path.join(this.root, 'portable.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.dataDir = locator ? path.resolve(this.root, locator.dataDir) : path.join(this.root, 'data');
    if (!locator) { await fs.mkdir(this.dataDir, { recursive: true }); await atomicJson(path.join(this.root, 'portable.json'), { dataDir: 'data' }); }
    await writableDirectory(this.dataDir);
    this.file = path.join(this.dataDir, 'settings.json');
    try {
      const saved = upgradeConfig(JSON.parse(await fs.readFile(this.file, 'utf8')));
      for (const channel of saved.channels) {
        channel.apiKey = '';
        if (channel.encryptedKey) {
          try { channel.apiKey = await this.decrypt(Buffer.from(channel.encryptedKey, 'base64')); }
          catch { this.unavailable.add(channel.id); }
        }
      }
      this.value = validateConfig(saved);
    } catch (e) { if (e.code !== 'ENOENT') throw e; this.value = validateConfig(defaults); }
    return this;
  }
  public() {
    return { ...this.value, channels: this.value.channels.map(({ apiKey, ...channel }) => ({ ...channel, hasApiKey: Boolean(apiKey), keyUnavailable: this.unavailable.has(channel.id) })), dataDir: this.dataDir };
  }
  channelInput(input) {
    const previous = this.value.channels.find(channel => channel.id === input.id);
    return { ...input, apiKey: input.clearApiKey ? '' : input.apiKey || previous?.apiKey || '' };
  }
  async save(input) {
    await writableDirectory(this.dataDir);
    const next = validateConfig({ ...this.value, ...input, channels: (input.channels || this.value.channels).map(channel => this.channelInput(channel)) });
    const channels = await Promise.all(next.channels.map(async ({ apiKey, ...channel }) => {
      if (this.unavailable.has(channel.id) && !apiKey && !input.channels?.find(entry => entry.id === channel.id)?.clearApiKey) throw new Error(`渠道「${channel.name}」密钥无法解密，请重新填写或清除密钥`);
      return { ...channel, encryptedKey: apiKey ? (await this.encrypt(apiKey)).toString('base64') : '' };
    }));
    await atomicJson(this.file, { ...next, channels });
    this.value = next; this.unavailable.clear(); return this.public();
  }
  async testChannel(input) {
    const channel = validateConfig({ ...defaults, channels: [this.channelInput(input)] }).channels[0];
    if (!channel.baseUrl) throw new Error('请先填写接口地址');
    if (this.unavailable.has(channel.id) && !channel.apiKey && !input.clearApiKey) throw new Error('该渠道密钥无法解密，请重新填写');
    const response = await fetch(channel.baseUrl + '/v1/models', { headers: channel.apiKey ? { Authorization: 'Bearer ' + channel.apiKey } : {}, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`渠道「${channel.name}」返回 ${response.status}，请检查地址与 API Key`);
    const result = await response.json();
    return [...new Set((result.data || result.models || []).map(entry => typeof entry === 'string' ? entry : entry.id).filter(id => typeof id === 'string' && id && id.length <= 500))];
  }
  async selectDataDir(directory) { await writableDirectory(directory); await atomicJson(path.join(this.root, 'portable.json'), { dataDir: path.resolve(directory) }); return { restartRequired: true, dataDir: directory }; }
}
module.exports = { ConfigStore, validateConfig, upgradeConfig, roles, capabilityFor, directorModelId };
