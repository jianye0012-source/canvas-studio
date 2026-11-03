const protocol = 'runninghub-standard';
const model = 'rhart-image-g-2/image-to-image';
const baseURL = 'https://www.runninghub.ai';
const catalogueURL = baseURL + '/runninghub-api-doc-en/llms.txt';
const imageDocId = '448184504';
const catalogueTypes = new Map([
  ['Image Generation & Processing', 'image'],
  ['Video Generation & Processing', 'video'],
  ['3D Generation & Processing', '3d'],
  ['Audio Generation & Processing', 'audio'],
]);
const ratios = new Set(['1:1', '2:3', '3:2', '4:5', '5:4', '4:3', '16:9', '9:16', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3']);

function normalizeRunningHubURL(value) {
  const url = new URL(value || baseURL);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (url.protocol !== 'https:' || !['www.runninghub.ai', 'runninghub.ai'].includes(url.host) || url.username || url.password || url.search || url.hash ||
      !['', '/runninghub-api-doc-en', '/openapi/v2', '/openapi/v2/' + model].includes(pathname)) {
    throw new Error('RunningHub 标准模型请使用 https://www.runninghub.ai、官方英文文档首页或已适配模型的完整提交地址');
  }
  return baseURL;
}

async function request(channel, route, body, { fetchImpl = fetch, signal } = {}) {
  if (!channel.apiKey) throw new Error('请填写 RunningHub 企业级共享 API Key');
  let response;
  try {
    response = await fetchImpl(normalizeRunningHubURL(channel.baseUrl) + route, {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + channel.apiKey },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(15000),
    });
  } catch { throw new Error('无法连接 RunningHub，请检查网络后重试'); }
  if (response.status === 401 || response.status === 403) throw new Error('RunningHub 拒绝访问，请核对企业级共享 API Key');
  if (!response.ok) throw new Error('RunningHub 返回 HTTP ' + response.status);
  const result = await response.json().catch(() => null);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('RunningHub 响应格式无效');
  if (result.code !== undefined && Number(result.code) !== 0) {
    const detail = String(result.msg || result.message || '').replaceAll(channel.apiKey, '***').slice(0, 300);
    throw new Error('RunningHub 请求失败' + (detail ? '：' + detail : ''));
  }
  if (typeof result.errorMessage === 'string') result.errorMessage = result.errorMessage.replaceAll(channel.apiKey, '***').slice(0, 300);
  return result;
}

async function checkAccount(channel, options) {
  const result = await request(channel, '/uc/openapi/accountStatus', { apikey: channel.apiKey }, options);
  if (Number(result.code) !== 0 || !result.data) throw new Error('RunningHub 账户检查未返回有效数据');
}

async function readCatalogue(fetchImpl) {
  let source;
  try {
    const response = await fetchImpl(catalogueURL, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    source = await response.text();
  } catch (error) {
    const status = /^HTTP \d{3}$/.test(error.message) ? `（${error.message}）` : '';
    throw new Error(`无法读取 RunningHub 官方模型目录${status}，请检查网络后重试`);
  }
  const models = new Map();
  const entries = /^- Standard Model API > ([^>\r\n]+?)(?: > [^\r\n]+?)? \[([^\r\n]{1,500}?)\]\(https:\/\/www\.runninghub\.ai\/runninghub-api-doc-en\/api-(\d+)\.md\)/gm;
  for (const [, category, name, id] of source.matchAll(entries)) {
    models.set(id, { id, name, type: catalogueTypes.get(category) || 'other', integrated: id === imageDocId });
  }
  if (!models.size) throw new Error('RunningHub 官方目录未返回可识别的模型，请稍后重试');
  return [...models.values()];
}

async function detect(channel, { fetchImpl, catalogueFetch = fetchImpl, keyUnavailable } = {}) {
  const [models, accountError] = await Promise.all([
    readCatalogue(catalogueFetch),
    keyUnavailable ? '该渠道密钥无法解密，请重新填写' : checkAccount(channel, { fetchImpl }).then(() => '', error => error.message),
  ]);
  const available = !accountError && models.some(entry => entry.integrated);
  return { models: available ? [model] : [], modelCapabilities: available ? { [model]: 'image' } : {}, modelToolSupport: {}, runningHub: { models, accountError } };
}

function imageParameters(input) {
  if (input.model !== model) throw new Error('请选择受支持的 RunningHub 图生图模型');
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt || [...prompt].length > 20000) throw new Error('RunningHub 提示词须在 1 至 20000 字符之间');
  if (!Array.isArray(input.imageUrls) || input.imageUrls.length < 1 || input.imageUrls.length > 10) throw new Error('RunningHub 图生图需要 1 至 10 张参考图');
  for (const image of input.imageUrls) {
    if (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(image)) throw new Error('请传入 PNG、JPEG、WebP 或 GIF 参考图');
    if (Buffer.byteLength(image.slice(image.indexOf(',') + 1), 'base64') > 50 * 1024 * 1024) throw new Error('RunningHub 单张参考图最多 50 MB');
  }
  const aspectRatio = input.aspectRatio || '1:1';
  const resolution = input.resolution || '1k';
  if (!ratios.has(aspectRatio) || !['1k', '2k', '4k'].includes(resolution)) throw new Error('RunningHub 图像比例或分辨率不受支持');
  return { prompt, imageUrls: input.imageUrls, aspectRatio, resolution };
}

async function callStandardImage(channel, route, input, options) {
  if (route === '/runninghub/submit') return request(channel, '/openapi/v2/' + model, imageParameters(input), options);
  if (typeof input.taskId !== 'string' || !/^\d{1,32}$/.test(input.taskId)) throw new Error('RunningHub 任务编号无效');
  return request(channel, '/openapi/v2/query', { taskId: input.taskId }, options);
}

module.exports = { protocol, model, baseURL, normalizeRunningHubURL, detect, callStandardImage };
