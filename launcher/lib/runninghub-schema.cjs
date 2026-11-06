const { parse } = require('yaml');

const endpointPattern = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)+$/;
const imageFields = new Set(['imageUrl', 'imageUrls', 'referenceImageUrl', 'referenceImageUrls', 'firstFrameUrl', 'lastFrameUrl', 'firstImageUrl', 'lastImageUrl', 'frontImageUrl', 'leftImageUrl', 'rightImageUrl', 'backImageUrl', 'topImageUrl', 'bottomImageUrl', 'leftFrontImageUrl', 'rightFrontImageUrl']);
const controls = {
  prompt: ['string'], aspectRatio: ['string'], resolution: ['string'], duration: ['string', 'integer', 'number'],
  width: ['integer', 'number'], height: ['integer', 'number'], generateAudio: ['boolean'],
};
const scalar = value => typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);

function matches(value, field) {
  const { type, enum: options, minimum, maximum, maxLength } = field;
  if (options && !options.includes(value)) return false;
  if (type === 'string') return typeof value === 'string' && (!maxLength || [...value].length <= maxLength);
  if (type === 'boolean') return typeof value === 'boolean';
  return Number.isFinite(value) && (type !== 'integer' || Number.isInteger(value)) &&
    (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum);
}

function normalizeModel(endpoint, input) {
  if (typeof endpoint !== 'string' || endpoint.length > 240 || !endpointPattern.test(endpoint) ||
      !['image', 'video', '3d'].includes(input?.type) || !Array.isArray(input.required) || !input.properties || typeof input.properties !== 'object') {
    throw new Error('RunningHub 模型的接口或参数格式无效');
  }
  const required = new Set(input.required);
  const fields = {};
  for (const [name, raw] of Object.entries(input.properties)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(name) || !raw || typeof raw !== 'object') continue;
    const { type } = raw;
    const field = { type };
    if (Array.isArray(raw.enum) && raw.enum.length && raw.enum.every(scalar)) field.enum = raw.enum;
    for (const key of ['minimum', 'maximum', 'minItems', 'maxItems', 'maxLength']) {
      if (Number.isFinite(raw[key])) field[key] = raw[key];
    }
    const media = imageFields.has(name) && (type === 'string' || (type === 'array' && raw.items?.type === 'string'));
    if (media && type === 'array') field.items = { type: 'string' };
    const control = Object.hasOwn(controls, name) && controls[name].includes(type);
    const safeDefault = name !== 'prompt' && !media &&
      ((type === 'string' && field.enum) || ['boolean', 'integer', 'number'].includes(type)) && matches(raw.default, field);
    if (safeDefault) field.default = raw.default;
    if (media || control || (required.has(name) && safeDefault) || (input.type === '3d' && ['string', 'boolean', 'integer', 'number'].includes(type))) {
      fields[name] = field;
    }
  }
  const unsupported = [...required].filter(name => !Object.hasOwn(fields, name));
  if (unsupported.length) throw new Error('当前画布无法提供此模型的必填参数：' + unsupported.join('、'));
  if (!Object.hasOwn(fields, 'prompt') && !Object.keys(fields).some(name => imageFields.has(name))) throw new Error('此模型暂未提供画布可用的输入');
  return { type: input.type, name: typeof input.name === 'string' ? input.name.slice(0, 500) : endpoint, docId: typeof input.docId === 'string' && /^\d{1,20}$/.test(input.docId) ? input.docId : '', required: [...required], properties: fields };
}

function parseModel(source, type) {
  const yaml = source.match(/^\x60\x60\x60ya?ml\r?\n([\s\S]*?)^\x60\x60\x60\s*$/m)?.[1];
  if (!yaml) throw new Error('RunningHub 未提供可读取的官方参数');
  let document;
  try { document = parse(yaml, { maxAliasCount: 0 }); }
  catch { throw new Error('RunningHub 官方参数格式无效'); }
  const endpoints = Object.entries(document?.paths || {}).filter(([path, value]) => path.startsWith('/openapi/v2/') && value?.post);
  if (endpoints.length !== 1) throw new Error('无法确定 RunningHub 模型的提交地址');
  const [path, operation] = endpoints[0];
  const schema = operation.post.requestBody?.content?.['application/json']?.schema;
  const endpoint = path.slice('/openapi/v2/'.length);
  const name = source.match(/^# (.+)$/m)?.[1]?.trim() || endpoint;
  if (/\bdeprecated\b/i.test(name) || operation.post.deprecated) throw new Error('RunningHub 已弃用此模型');
  return { endpoint, ...normalizeModel(endpoint, { ...schema, required: schema?.required || [], type, name }) };
}

function parameters(spec, input) {
  const result = {};
  const required = new Set(spec.required);
  const media = Object.entries(spec.properties).filter(([name]) => imageFields.has(name));
  const plural = media.some(([, field]) => field.type === 'array');
  const firstFrame = media.some(([name, field]) => field.type !== 'array' && name !== 'lastFrameUrl' && name !== 'lastImageUrl');
  const lastFrame = media.some(([name]) => name === 'lastFrameUrl' || name === 'lastImageUrl');
  const images = Array.isArray(input.imageUrls) ? input.imageUrls : [];
  const mapped = spec.type === '3d' ? input.references || {} : {};
  if (spec.type === '3d' && Object.keys(mapped).some(name => !imageFields.has(name) || !spec.properties[name])) throw new Error('所选 3D 模型不支持这些视角参考图');
  if (!media.length && (images.length || input.firstFrameUrl || input.lastFrameUrl)) throw new Error('所选 RunningHub 模型为纯文生模式，请移除参考图或切换模型');
  if ((input.firstFrameUrl && !firstFrame) || (input.lastFrameUrl && !lastFrame)) throw new Error('所选 RunningHub 模型不支持指定的首帧或尾帧，请切换模型或调整参考图');
  if (!plural && (images.length > (lastFrame ? 2 : 1) || (images.length && (input.firstFrameUrl || input.lastFrameUrl)))) throw new Error('所选 RunningHub 模型无法同时接收这些参考图和首尾帧，请调整输入');
  for (const [name, field] of Object.entries(spec.properties)) {
    let value = spec.type === '3d' && Object.hasOwn(input.parameters || {}, name) ? input.parameters[name] : Object.hasOwn(controls, name) ? input[name] : undefined;
    if (imageFields.has(name)) {
      if (spec.type === '3d') value = mapped[name] || (field.type === 'array' ? images.length ? images : undefined : ['imageUrl', 'frontImageUrl'].includes(name) ? images[0] : undefined);
      else if (field.type === 'array') {
        value = images.length ? images : undefined;
      }
      else if (name === 'lastFrameUrl' || name === 'lastImageUrl') value = input.lastFrameUrl || (!plural ? images[1] : undefined);
      else value = input.firstFrameUrl || (!plural ? images[0] : undefined);
      if (value !== undefined && field.type === 'array' &&
          (value.length < (field.minItems || 1) || value.length > (field.maxItems || 10))) {
        throw new Error(`所选 RunningHub 模型需要 ${field.minItems || 1} 至 ${field.maxItems || 10} 张参考图`);
      }
    } else {
      if (name === 'prompt') value = typeof value === 'string' ? value.trim() : '';
      if (name === 'duration' && value !== undefined && field.type !== 'string') value = Number(value);
      if (value !== undefined && value !== '' && spec.type === '3d' && !matches(value, field)) throw new Error(`3D 模型参数 ${name} 超出支持范围或类型错误`);
      if (value === '' || !matches(value, field)) value = field.default;
    }
    if (value === undefined) {
      if (required.has(name)) throw new Error(`所选 RunningHub 模型缺少必填参数 ${name}${imageFields.has(name) ? '，请添加参考图或首尾帧' : ''}`);
      continue;
    }
    result[name] = value;
  }
  return result;
}

module.exports = { endpointPattern, imageFields, normalizeModel, parseModel, parameters };
