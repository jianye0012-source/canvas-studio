const supported = new Set(['text', 'image', 'video']);

function modelCapability(entry, id) {
  const architecture = entry?.architecture;
  const outputs = entry?.output_modalities ?? architecture?.output_modalities ?? entry?.capabilities?.output;
  if (Array.isArray(outputs) && outputs.length) {
    const candidates = [...new Set(outputs.filter(type => supported.has(type)))];
    if (candidates.length === 1) return candidates[0];
    if (candidates.length !== outputs.length || !candidates.length) return '';
  }
  const explicit = entry?.type ?? entry?.modality;
  if (supported.has(explicit)) return explicit;
  if (['audio', 'embedding', 'rerank', 'moderation'].includes(explicit)) return '';
  if (/embedding|rerank|moderation|whisper|(?:^|[-_/])(?:audio|speech|voice|tts|transcribe|asr|music)(?:[-_/]|$)/i.test(id)) return '';
  if (/video|seedance|kling|(?:^|[/_-])veo(?:[/_.-]|$)|(?:^|[/_-])sora(?:[/_.-]|$)|hailuo|(?:^|[/_-])wan[.-]?2|(?:^|[/_-])wan[.-]?3/i.test(id)) return 'video';
  if (/image|nano[-_ ]?banana|dall[-_]?e|seedream|(?:^|[/_-])flux|sdxl|stable[-_]diffusion|ideogram|midjourney|imagen/i.test(id)) return 'image';
  if (/(?:^|[/_-])(?:gpt|claude|gemini|deepseek|qwen\d*|glm\d*|grok|llama\d*|mistral|mixtral|kimi|doubao|o[1-4]|chat)(?:[./_-]|$)/i.test(id)) return 'text';
  return '';
}

function discoverModels(entries) {
  const rows = new Map();
  for (const value of entries) {
    const entry = typeof value === 'string' ? { id: value } : value;
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (!id || id.length > 500 || rows.size >= 2000 || rows.has(id)) continue;
    const capability = modelCapability(entry, id);
    const advertisedTools = entry.supports_tools ?? entry.capabilities?.tools;
    const tools = typeof advertisedTools === 'boolean' ? advertisedTools
      : [entry.supported_parameters, entry.features].some(list => Array.isArray(list) && list.some(item => ['tools', 'tool_choice', 'tool_calling', 'function_calling'].includes(item))) ? true : undefined;
    rows.set(id, { capability, tools });
  }
  return {
    models: [...rows.keys()],
    modelCapabilities: Object.fromEntries([...rows].filter(([, value]) => value.capability).map(([id, value]) => [id, value.capability])),
    modelToolSupport: Object.fromEntries([...rows].filter(([, value]) => value.capability === 'text' && value.tools !== undefined).map(([id, value]) => [id, value.tools])),
  };
}

module.exports = { discoverModels };
