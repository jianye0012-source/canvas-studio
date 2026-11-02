const $ = selector => document.querySelector(selector);
const titles = { home: '一键启动', models: '模型配置', skills: 'Skill 管理', storage: '存储设置', logs: '运行日志', repair: '检查与修复', about: '关于' };
let config, state, updateState, draft, activeId = '';
const roles = { director: '白模导演', text: '画布文字', image: '图片生成', video: '视频生成' };
const capabilities = { text: '文字 / 白模', image: '图片', video: '视频' };
const catalogues = new Map();
const activeChannel = () => draft?.channels.find(channel => channel.id === activeId);
function page(name) { for (const node of document.querySelectorAll('.page')) node.hidden = node.id !== 'page-' + name; for (const node of document.querySelectorAll('nav button')) node.classList.toggle('active', node.dataset.page === name); $('#page-title').textContent = titles[name]; if (name === 'skills') void loadSkills().catch(() => {}); }
function notice(text, error = false) { $('#notice').textContent = text; $('#notice').hidden = false; $('#notice').classList.toggle('error', error); }
function status(value) {
  state = value;
  const running = value.phase === 'running', busy = ['starting', 'stopping'].includes(value.phase);
  $('#start').disabled = busy || running; $('#open').disabled = !running; $('#stop').disabled = busy || !['running', 'error'].includes(value.phase);
  $('#start').textContent = running ? '✓ 工作台运行中' : busy ? '正在处理…' : '▶ 一键启动工作台';
  $('#status-message').textContent = value.message; $('#sidebar-status').textContent = running ? '服务运行中' : busy ? '服务处理中' : value.phase === 'error' ? '需要处理' : '服务未启动';
  $('#top-status').textContent = running ? '运行中' : busy ? '正在处理' : value.phase === 'error' ? '需要处理' : '准备就绪';
  $('#progress').value = value.progress; $('#progress-label').textContent = value.progress + '%';
  $('#workspace-url').textContent = value.url || '运行环境随包提供，点击即可启动。';
  for (const id of ['#status-dot', '#main-dot']) $(id).className = running ? 'running' : value.phase === 'error' ? 'error' : '';
}
function fill(value) {
  config = value; draft = structuredClone(value);
  if (!draft.channels.some(channel => channel.id === activeId)) activeId = draft.channels[0]?.id || '';
  fillBrowser(value);
  $('#data-dir').value = value.dataDir; renderModels();
}
function browserLabel(browser, browserPath) {
  return browser === 'custom' ? browserPath.split(/[\\/]/).pop() || '指定浏览器' : { edge: 'Microsoft Edge', chrome: 'Google Chrome', firefox: 'Mozilla Firefox' }[browser];
}
function renderBrowserChoice() {
  const form = $('#browser-form'), browser = form.elements.browser.value, browserPath = form.elements.browserPath.value.trim();
  $('#browser-path-row').hidden = browser !== 'custom' && !browserPath;
  $('#open').textContent = `用 ${browserLabel(browser, browserPath)} 打开`;
  $('#browser-current').textContent = `已保存：${browserLabel(config.browser, config.browserPath)}${config.browserPath ? ' · ' + config.browserPath : ''}`;
}
function fillBrowser(value) {
  config = value;
  for (const key of ['browser', 'browserPath']) $('#browser-form').elements[key].value = value[key] || '';
  $('#port-form').elements.port.value = value.port;
  if (draft) Object.assign(draft, { browser: value.browser, browserPath: value.browserPath, port: value.port, autoCheckUpdates: value.autoCheckUpdates });
  $('#auto-check-updates').checked = value.autoCheckUpdates;
  renderBrowserChoice();
}
async function saveBrowserChoice() {
  const input = values($('#browser-form')); input.browserPath = input.browserPath.trim();
  if (input.browser !== config.browser || input.browserPath !== config.browserPath) fillBrowser(await invoke('config:save', input));
}
function repairSelections() {
  for (const role of Object.keys(roles)) {
    const channel = draft.channels.find(entry => entry.id === draft[role + 'ChannelId'] && entry.enabled);
    if (!channel?.models.some(model => model === draft[role + 'Model'] && channel.modelCapabilities[model] === (role === 'director' ? 'text' : role))) { draft[role + 'Model'] = ''; draft[role + 'ChannelId'] = ''; }
  }
}
function renderRoleSelectors() {
  $('#role-selectors').replaceChildren(...Object.entries(roles).map(([role, title]) => {
    const label = document.createElement('label'); label.textContent = title;
    const select = document.createElement('select'); select.dataset.role = role;
    select.add(new Option('暂不设置', ''));
    for (const channel of draft.channels.filter(entry => entry.enabled)) {
      const group = document.createElement('optgroup'); group.label = channel.name;
      for (const model of channel.models.filter(model => channel.modelCapabilities[model] === (role === 'director' ? 'text' : role))) group.append(new Option(`${channel.name} · ${model}`, JSON.stringify([channel.id, model])));
      if (group.children.length) select.append(group);
    }
    select.value = draft[role + 'Model'] ? JSON.stringify([draft[role + 'ChannelId'], draft[role + 'Model']]) : '';
    select.onchange = () => { const [channelId, model] = select.value ? JSON.parse(select.value) : ['', '']; draft[role + 'ChannelId'] = channelId; draft[role + 'Model'] = model; };
    label.append(select); return label;
  }));
}
function renderChannelList() {
  $('#channel-list').replaceChildren(...draft.channels.map(channel => {
    const button = document.createElement('button'); button.type = 'button'; button.classList.toggle('selected', channel.id === activeId); button.setAttribute('aria-pressed', channel.id === activeId);
    const name = document.createElement('span'); name.textContent = channel.name;
    const detail = document.createElement('small'); detail.textContent = `${channel.models.length} 个模型 · ${channel.enabled ? '已启用' : '已停用'}`; button.append(name, detail);
    button.onclick = () => { activeId = channel.id; $('#new-model').value = ''; renderModels(); }; return button;
  }));
}
function renderModels() {
  renderChannelList(); renderRoleSelectors();
  const channel = activeChannel(); $('#channel-editor').hidden = !channel; $('#channel-empty').hidden = Boolean(channel);
  if (!channel) return;
  for (const input of $('#model-form').elements) if (input.name) { if (input.type === 'checkbox') input.checked = channel[input.name]; else input.value = channel[input.name] || ''; }
  $('#key-status').textContent = channel.clearApiKey ? '待清除，保存后生效' : channel.keyUnavailable ? '此渠道密钥无法解密，请重新填写或清除。' : channel.hasApiKey ? '此渠道 API Key 已加密保存' : '接口无需密钥时可留空';
  $('#model-list').replaceChildren(...(catalogues.get(channel.id) || []).map(model => new Option(model, model)));
  $('#channel-models').replaceChildren(...channel.models.map(model => {
    const item = document.createElement('li'); const name = document.createElement('span'); name.textContent = model;
    const type = document.createElement('small'); type.textContent = capabilities[channel.modelCapabilities[model]];
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除'; remove.setAttribute('aria-label', '移除模型 ' + model);
    remove.onclick = () => { channel.models = channel.models.filter(entry => entry !== model); repairSelections(); renderModels(); }; item.append(name, type, remove); return item;
  }));
}
function renderUpdate(value) {
  updateState = value; const busy = ['checking', 'downloading', 'verifying'].includes(value.phase);
  $('#update-version').textContent = `当前版本 ${value.currentVersion}${value.latestVersion ? ' · 发行版 ' + value.latestVersion : ''}`;
  $('#update-message').textContent = value.message; $('#update-progress').hidden = !['downloading', 'verifying'].includes(value.phase); $('#update-progress').value = value.progress;
  $('#check-update').disabled = busy; $('#download-update').disabled = busy || value.phase !== 'available'; $('#install-update').disabled = value.phase !== 'ready'; $('#import-update').disabled = busy;
  $('#update-notes').hidden = !value.notes; $('#update-notes').textContent = value.notes || '';
  $('#update-hint').hidden = !['available', 'ready'].includes(value.phase);
}
function values(form) { return Object.fromEntries(new FormData(form).entries()); }
async function invoke(channel, value) { try { return await window.launcher.invoke(channel, value); } catch (e) { notice(e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); throw e; } }
function action(selector, channel, callback, prepare) { $(selector).addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; try { await prepare?.(); const result = await invoke(channel); callback?.(result); } catch {} finally { button.disabled = false; if (state) status(state); if (updateState) renderUpdate(updateState); } }); }
for (const node of document.querySelectorAll('[data-page],[data-goto]')) node.addEventListener('click', () => page(node.dataset.page || node.dataset.goto));
action('#start', 'runtime:start', null, saveBrowserChoice); action('#stop', 'runtime:stop'); action('#open', 'runtime:open', null, saveBrowserChoice);
action('#open-data', 'storage:open'); action('#open-log-dir', 'storage:open'); action('#choose-data', 'storage:choose'); action('#open-notice', 'about:open');
action('#choose-browser', 'browser:choose', value => { if (value) { $('#browser-form').elements.browser.value = 'custom'; $('#browser-form').elements.browserPath.value = value; renderBrowserChoice(); } });
action('#check', 'runtime:check', result => { $('#check-result').hidden = false; $('#check-result').textContent = `运行文件：${result.checked} 个文件校验通过\n数据目录：可读写\n浏览器：${result.browser}\n数据位置：${result.dataDir}`; notice('检查完成'); });
action('#check-update', 'update:check'); action('#download-update', 'update:download'); action('#install-update', 'update:install'); action('#open-releases', 'update:open-release');
$('#auto-check-updates').addEventListener('change', async event => { const enabled = event.target.checked; try { const saved = await invoke('config:save', { autoCheckUpdates: enabled }); config.autoCheckUpdates = saved.autoCheckUpdates; draft.autoCheckUpdates = saved.autoCheckUpdates; } catch { event.target.checked = config.autoCheckUpdates; } });
action('#import-update', 'update:import', result => { if (result) notice('更新包已校验，启动器即将重新启动'); });
$('#model-form').addEventListener('submit', event => { event.preventDefault(); $('#save-models').click(); });
for (const input of $('#model-form').elements) if (input.name) input.addEventListener('input', () => { const channel = activeChannel(); if (!channel) return; channel[input.name] = input.type === 'checkbox' ? input.checked : input.value; if (input.name === 'apiKey') channel.clearApiKey = false; repairSelections(); renderChannelList(); renderRoleSelectors(); });
$('#add-channel').onclick = () => { const channel = { id: crypto.randomUUID(), name: `渠道 ${draft.channels.length + 1}`, baseUrl: '', apiKey: '', enabled: true, models: [], modelCapabilities: {} }; draft.channels.push(channel); activeId = channel.id; $('#new-model').value = ''; renderModels(); };
$('#delete-channel').onclick = () => { draft.channels = draft.channels.filter(channel => channel.id !== activeId); activeId = draft.channels[0]?.id || ''; repairSelections(); renderModels(); notice('渠道已移除；原项目与素材保留。保存后生效。'); };
$('#add-model').onclick = () => { const channel = activeChannel(), model = $('#new-model').value.trim(); if (!channel || !model) return notice('请填写或选择模型名称', true); if (!channel.models.includes(model)) channel.models.push(model); channel.modelCapabilities[model] = $('#new-capability').value; $('#new-model').value = ''; repairSelections(); renderModels(); };
$('#new-model').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('#add-model').click(); } };
$('#save-models').onclick = async () => { $('#save-models').disabled = true; try { fill(await invoke('config:save', draft)); notice('全部渠道和默认模型已保存；已打开的工作台刷新后生效。'); } catch {} finally { $('#save-models').disabled = false; } };
$('#browser-form').addEventListener('submit', async event => { event.preventDefault(); try { await saveBrowserChoice(); notice('浏览器选择已保存，启动和打开工作台都会使用此浏览器。'); } catch {} });
$('#browser-form').elements.browser.addEventListener('change', event => { if (event.target.value !== 'custom') $('#browser-form').elements.browserPath.value = ''; renderBrowserChoice(); });
$('#browser-form').elements.browserPath.addEventListener('input', () => { if ($('#browser-form').elements.browserPath.value.trim()) $('#browser-form').elements.browser.value = 'custom'; renderBrowserChoice(); });
$('#port-form').addEventListener('submit', async event => { event.preventDefault(); try { fillBrowser(await invoke('config:save', { port: Number(event.currentTarget.elements.port.value) })); notice('端口已保存，下次启动服务生效'); } catch {} });
$('#test-models').onclick = async () => { const channel = activeChannel(); if (!channel) return; $('#test-models').disabled = true; try { const models = await invoke('config:test', channel); catalogues.set(channel.id, models); renderModels(); notice(`渠道「${channel.name}」连接成功，读取到 ${models.length} 个模型。请选择需要的模型并指定类型。`); } catch {} finally { $('#test-models').disabled = false; } };
$('#clear-key').onclick = () => { const channel = activeChannel(); if (channel) { channel.apiKey = ''; channel.hasApiKey = false; channel.clearApiKey = true; renderModels(); notice('此渠道密钥将于保存时清除。'); } };
window.launcher.subscribe(event => { if (event.type === 'status') status(event.value); else if (event.type === 'update') renderUpdate(event.value); else { $('#logs').textContent = event.value.join('\n'); $('#logs').scrollTop = $('#logs').scrollHeight; } });
invoke('app:load').then(result => { fill(result.config); status(result.status); renderUpdate(result.update); if (result.logs.length) $('#logs').textContent = result.logs.join('\n'); }).catch(() => {});

let skills = [];
function editSkill(skill = {}) { for (const key of ['id','name','description','content']) $('#skill-form').elements[key].value = skill[key] || ''; $('#skills-export').disabled = $('#skills-delete').disabled = !skill.id; }
async function loadSkills() { skills = await invoke('skills:list'); $('#skills-list').replaceChildren(...skills.map(skill => { const button = document.createElement('button'); button.type = 'button'; button.textContent = skill.name; button.onclick = () => editSkill(skill); return button; })); if (!skills.some(s => s.id === $('#skill-form').elements.id.value)) editSkill(); }
$('#skills-refresh').onclick = () => loadSkills().catch(() => {});
$('#skills-new').onclick = () => { editSkill(); $('#skill-form').elements.name.focus(); };
$('#skills-import').onclick = async () => { try { const skill = await invoke('skills:import'); if (skill) { await loadSkills(); editSkill(skill); notice('Skill 已导入，画布可直接选择。'); } } catch {} };
$('#skill-form').onsubmit = async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const skill = await invoke('skills:save', values($('#skill-form'))); await loadSkills(); editSkill(skill); notice('Skill 已保存，下一次文字生成生效。'); } catch {} finally { button.disabled = false; } };
$('#skills-delete').onclick = async () => { const id = $('#skill-form').elements.id.value; if (!id || !confirm('删除此 Skill？已生成的文字会保留。')) return; try { await invoke('skills:delete', id); await loadSkills(); editSkill(); notice('Skill 已删除'); } catch {} };
$('#skills-export').onclick = async () => { try { if (await invoke('skills:export', $('#skill-form').elements.id.value)) notice('Skill 已导出'); } catch {} };
