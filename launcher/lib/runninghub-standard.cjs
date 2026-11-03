const { endpointPattern, imageFields, normalizeModel, parseModel, parameters } = require('./runninghub-schema.cjs');

const protocol = 'runninghub-standard';
const model = 'rhart-image-g-2/image-to-image';
const baseURL = 'https://www.runninghub.ai';
const catalogueURL = baseURL + '/runninghub-api-doc-en/llms.txt';
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
      (!['', '/runninghub-api-doc-en', '/openapi/v2'].includes(pathname) && !(pathname.startsWith('/openapi/v2/') && endpointPattern.test(pathname.slice('/openapi/v2/'.length))))) {
    throw new Error('RunningHub 标准模型请使用 https://www.runninghub.ai、官方英文文档首页或模型的完整提交地址');
  }
  return baseURL;
}

async function request(channel, route, body, { fetchImpl = fetch, signal } = {}) {
  if (!channel.apiKey) throw new Error('请填写 RunningHub 企业级共享 API Key');
  let response;
  try {
    const multipart = body instanceof FormData;
    response = await fetchImpl(normalizeRunningHubURL(channel.baseUrl) + route, {
      method: 'POST', redirect: 'error', headers: { ...(multipart ? {} : { 'content-type': 'application/json' }), authorization: 'Bearer ' + channel.apiKey },
      body: multipart ? body : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(multipart ? 120000 : 30000)]) : AbortSignal.timeout(15000),
    });
  } catch { throw new Error('无法连接 RunningHub，请检查网络后重试'); }
  if (response.status === 401 || response.status === 403) throw new Error('RunningHub 拒绝访问，请核对企业级共享 API Key');
  const result = await response.json().catch(() => null);
  if (!response.ok || (result?.code !== undefined && Number(result.code) !== 0)) {
    const detail = String(result?.msg || result?.message || result?.errorMessage || '').replaceAll(channel.apiKey, '***').slice(0, 300);
    const reason = response.ok ? '' : '（HTTP ' + response.status + '）';
    throw new Error('RunningHub 请求失败' + reason + (detail ? '：' + detail : ''));
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('RunningHub 响应格式无效');
  if (typeof result.errorMessage === 'string') result.errorMessage = result.errorMessage.replaceAll(channel.apiKey, '***').slice(0, 300);
  return result;
}

async function checkAccount(channel, options) {
  const result = await request(channel, '/uc/openapi/accountStatus', { apikey: channel.apiKey }, options);
  if (Number(result.code) !== 0 || !result.data) throw new Error('RunningHub 账户检查未返回有效数据');
}

async function readPublic(url, fetchImpl, label) {
  try {
    const response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.text();
  } catch (error) {
    const status = /^HTTP \d{3}$/.test(error.message) ? `（${error.message}）` : '';
    throw new Error(`无法读取 RunningHub 官方${label}${status}，请检查网络后重试`);
  }
}

async function readCatalogue(fetchImpl) {
  const source = await readPublic(catalogueURL, fetchImpl, '模型目录');
  const models = new Map();
  const entries = /^- Standard Model API > ([^>\r\n]+?)(?: > [^\r\n]+?)? \[([^\r\n]{1,500}?)\]\(https:\/\/www\.runninghub\.ai\/runninghub-api-doc-en\/api-(\d+)\.md\)/gm;
  for (const [, category, name, id] of source.matchAll(entries)) {
    const type = catalogueTypes.get(category) || (/\/(?:text-to-image|image-to-image|image-upscale|layer-decomposition)$/.test(name) ? 'image' : 'other');
    models.set(id, { id, name, type, importable: ['image', 'video'].includes(type) && !/\bdeprecated\b/i.test(name) });
  }
  if (!models.size) throw new Error('RunningHub 官方目录未返回可识别的模型，请稍后重试');
  return [...models.values()];
}

async function detect(channel, { fetchImpl, catalogueFetch = fetchImpl, keyUnavailable } = {}) {
  const [models, accountError] = await Promise.all([
    readCatalogue(catalogueFetch),
    keyUnavailable ? '该渠道密钥无法解密，请重新填写' : checkAccount(channel, { fetchImpl }).then(() => '', error => error.message),
  ]);
  return { models: [], modelCapabilities: {}, modelToolSupport: {}, runningHub: { models, accountError } };
}

async function loadModel(id, catalogue, fetchImpl) {
  const entry = catalogue.find(model => model.id === id && model.importable);
  if (!entry || !/^\d{1,20}$/.test(id)) throw new Error('请先检测渠道，并选择一个可添加的图片或视频模型');
  const source = await readPublic(baseURL + '/runninghub-api-doc-en/api-' + id + '.md', fetchImpl, '模型参数');
  return { ...parseModel(source, entry.type), docId: id };
}

function configuredModels(channel) {
  return Object.fromEntries((Array.isArray(channel.models) ? channel.models : []).slice(0, 2000).flatMap(id => {
    const spec = typeof id === 'string' && Object.hasOwn(channel.runningHubModels || {}, id) && channel.runningHubModels[id];
    if (spec) return [[id, normalizeModel(id, spec)]];
    return [];
  }));
}

async function uploadReference(channel, value, options) {
  if (typeof value !== 'string') throw new Error('RunningHub 参考图格式无效');
  if (/^https:\/\//i.test(value)) return value;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,/);
  if (!match) throw new Error('请提供 PNG、JPEG、WebP 或 GIF 参考图');
  const bytes = Buffer.from(value.slice(match[0].length), 'base64');
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('RunningHub 单张参考图最多 50 MB');
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: match[1] }), 'reference.' + match[1].split('/')[1]);
  const result = await request(channel, '/openapi/v2/media/upload/binary', form, options);
  const url = result.data?.download_url;
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new Error('RunningHub 上传参考图后未返回有效地址');
  return url;
}

async function submit(channel, input, type, options) {
  if (!channel.models.includes(input.model) || channel.modelCapabilities[input.model] !== type) throw new Error('所选 RunningHub 模型未添加到此渠道，或类型不匹配');
  const spec = channel.runningHubModels?.[input.model];
  if (!spec) return request(channel, '/openapi/v2/' + model, imageParameters(input), options);
  const body = parameters(spec, input);
  const uploads = new Map();
  const upload = value => {
    if (!uploads.has(value)) uploads.set(value, uploadReference(channel, value, options));
    return uploads.get(value);
  };
  for (const name of Object.keys(body).filter(name => imageFields.has(name))) {
    body[name] = Array.isArray(body[name]) ? await Promise.all(body[name].map(upload)) : await upload(body[name]);
  }
  return request(channel, '/openapi/v2/' + input.model, body, options);
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
  return route === '/runninghub/submit' ? submit(channel, input, 'image', options) : query(channel, input.taskId, options);
}

async function query(channel, taskId, options) {
  if (typeof taskId !== 'string' || !/^\d{1,32}$/.test(taskId)) throw new Error('RunningHub 任务编号无效');
  return request(channel, '/openapi/v2/query', { taskId }, options);
}

async function callStandardVideo(channel, input, options) {
  const result = await submit(channel, input, 'video', options);
  const id = result.taskId;
  const state = String(result.status).toUpperCase();
  if (['FAILED', 'CANCEL', 'CANCELLED'].includes(state)) throw new Error(result.errorMessage || result.errorCode || 'RunningHub 视频生成失败');
  if (typeof id !== 'string' || !/^\d{1,32}$/.test(id)) throw new Error('RunningHub 未返回有效任务编号，请核对平台任务记录');
  return { id, task_id: id, status: state === 'RUNNING' ? 'running' : 'queued' };
}

module.exports = { protocol, model, baseURL, normalizeRunningHubURL, detect, loadModel, configuredModels, callStandardImage, callStandardVideo };
