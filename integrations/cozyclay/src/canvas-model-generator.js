const labels = { prompt: '模型描述', imageUrl: '正面参考图', frontImageUrl: '正面参考图', imageUrls: '参考图', leftImageUrl: '左侧参考图', rightImageUrl: '右侧参考图', backImageUrl: '背面参考图', topImageUrl: '顶部参考图', bottomImageUrl: '底部参考图', leftFrontImageUrl: '左前参考图', rightFrontImageUrl: '右前参考图', faceCount: '目标面数', face: '目标面数', requestType: '输出类型', generateType: '生成类型', enablePbr: 'PBR 材质', resolution: '分辨率' };
const statuses = { submitting: '正在提交', processing: '生成中', completed: '已生成并保存到本机', download_failed: '模型下载待重试', failed: '未完成', uncertain: '提交结果未确认', blocked: '请恢复原渠道配置' };
const readImage = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('文件读取失败')); reader.readAsDataURL(file); });
async function api(url, body) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const result = await response.json(); if (!response.ok) throw new Error(result.msg || result.error || '3D 请求失败'); return result;
}
export function openModelGenerator({ sceneId, run, save }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'canvas-3d-dialog';
    const heading = document.createElement('h2'); heading.textContent = 'AI 生成 3D 模型';
    const note = document.createElement('p'); note.textContent = '使用启动器中已添加的 3D 模型，调用在线接口会按渠道计费。任务在后台继续；完成后可加入场景或另存 GLB。本机支持 100 MB 以内模型。';
    const form = document.createElement('form');
    const select = document.createElement('select'); select.setAttribute('aria-label', '3D 模型');
    const fields = document.createElement('div'); fields.className = 'canvas-3d-fields';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = '提交 3D 生成'; submit.disabled = true;
    const feedback = document.createElement('p'); feedback.setAttribute('role', 'status');
    const title = document.createElement('h3'); title.textContent = '生成任务';
    const list = document.createElement('div'); list.className = 'canvas-3d-tasks';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.onclick = () => dialog.close();
    form.append(select, fields, submit); dialog.append(heading, note, form, feedback, title, list, close); document.body.append(dialog); dialog.showModal();
    let models = [], selected, controls = [], loading = false, ended = false, actionBusy = false;
    const previews = new Set();
    const fieldControls = () => {
      for (const url of previews) URL.revokeObjectURL(url); previews.clear(); controls = []; fields.replaceChildren();
      selected = models.find(model => JSON.stringify([model.channelId, model.model]) === select.value);
      for (const field of selected?.fields || []) {
        const label = document.createElement('label'); label.textContent = (labels[field.name] || '参数：' + field.name) + (field.required ? ' *' : '');
        const input = document.createElement(field.name === 'prompt' ? 'textarea' : field.enum ? 'select' : 'input');
        input.setAttribute('aria-label', labels[field.name] || field.name); input.required = field.required;
        if (field.media) {
          input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif'; input.multiple = field.type === 'array';
          const image = document.createElement('img'); image.hidden = true; image.className = 'canvas-3d-reference'; image.alt = labels[field.name] || field.name;
          input.onchange = () => { if (image.src) { URL.revokeObjectURL(image.src); previews.delete(image.src); } const file = input.files?.[0]; image.hidden = !file; if (file) { image.src = URL.createObjectURL(file); previews.add(image.src); } };
          label.append(input, image);
        } else {
          if (field.enum) for (const value of field.enum) input.add(new Option(({ mesh: '网格', both: '网格与纹理', Normal: '标准', Geometry: '几何白模', Sketch: '草图' })[value] || String(value), String(value)));
          else if (field.type === 'boolean') input.type = 'checkbox';
          else if (['number', 'integer'].includes(field.type)) { input.type = 'number'; input.step = field.type === 'integer' ? '1' : 'any'; if (field.minimum !== undefined) input.min = String(field.minimum); if (field.maximum !== undefined) input.max = String(field.maximum); }
          else if (input.tagName === 'INPUT') input.type = 'text';
          if (field.type === 'boolean') { input.checked = field.default === true; input.required = false; }
          else if (field.default !== undefined) input.value = String(field.default);
          if (field.maxLength) input.maxLength = field.maxLength;
          label.append(input);
        }
        controls.push({ field, input }); fields.append(label);
      }
    };
    select.onchange = fieldControls;
    form.onsubmit = async event => {
      event.preventDefault(); if (!selected) return;
      const model = selected;
      select.disabled = true; for (const { input } of controls) input.disabled = true;
      submit.disabled = true; feedback.textContent = '正在上传参考图并提交任务，请勿重复点击…';
      try {
        const parameters = {}, references = {};
        for (const { field, input } of controls) {
          if (field.media) {
            const files = [...(input.files || [])];
            if (files.some(file => file.size > 10 * 1024 ** 2)) throw new Error('建模参考图单张最多 10 MB，请压缩后上传');
            if (files.length) { const images = await Promise.all(files.map(readImage)); references[field.name] = field.type === 'array' ? images : images[0]; }
          } else if (field.type === 'boolean') parameters[field.name] = input.checked;
          else if (input.value.trim()) parameters[field.name] = ['number', 'integer'].includes(field.type) ? Number(input.value) : input.value.trim();
        }
        const task = await api('/local/3d/tasks', { id: crypto.randomUUID(), sceneId, channelId: model.channelId, model: model.model, prompt: parameters.prompt || '', parameters, references });
        feedback.textContent = task.error || '已提交。关闭窗口后仍会继续生成，请在下面查看任务状态。';
        await refresh();
      } catch (error) { feedback.textContent = error.message; }
      finally { submit.disabled = false; select.disabled = false; for (const { input } of controls) input.disabled = false; }
    };
    const action = (label, handler) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = async () => { if (actionBusy) return; actionBusy = true; button.disabled = true; try { await handler(); } catch (error) { feedback.textContent = error.message; } finally { actionBusy = false; button.disabled = false; void refresh(); } }; return button; };
    async function refresh() {
      if (loading || ended || actionBusy) return; loading = true;
      try {
        const result = await api('/local/3d/tasks?sceneId=' + encodeURIComponent(sceneId)); if (ended) return;
        list.replaceChildren(...result.tasks.map(task => {
          const row = document.createElement('article'); row.className = 'canvas-3d-task';
          const name = document.createElement('strong'); name.textContent = `${task.channelName} · ${task.name}`;
          const status = document.createElement('p'); status.textContent = (statuses[task.status] || '待查询') + (task.taskId ? ' · 任务 ' + task.taskId : '');
          row.append(name, status);
          if (task.error) { const error = document.createElement('p'); error.className = 'error'; error.textContent = task.error; row.append(error); }
          if (task.status === 'completed') row.append(action('加入场景', async () => {
            const response = await fetch(`/local/3d/tasks/${task.id}/file`); if (!response.ok) throw new Error('GLB 模型读取失败，请重新查询任务');
            const blob = await response.blob(); const source = await readImage(blob);
            const { parseMeshGlb } = await import('./scene-mesh-cache.js');
            const parsed = await parseMeshGlb(await blob.arrayBuffer());
            let meshes = 0; parsed.scene?.traverse(object => { if (object.isMesh) meshes++; });
            if (!meshes) throw new Error('生成文件不包含可显示的网格，请核对平台结果');
            await run('asset.import', { source, name: task.name + '.glb', placeAs: 'mesh' });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await save(true); feedback.textContent = '模型已加入场景并保存到本机';
          }), action('另存 GLB', async () => { feedback.textContent = '请在系统窗口选择保存文件夹…'; const saved = await api(`/local/3d/tasks/${task.id}/export`, {}); feedback.textContent = saved ? '已保存：' + saved.name : '已取消保存'; }));
          else if (task.taskId) row.append(action('重新查询原任务', async () => { await api(`/local/3d/tasks/${task.id}`); await refresh(); }));
          return row;
        }));
      } catch (error) { if (!ended) feedback.textContent = error.message; }
      finally { loading = false; }
    }
    const timer = setInterval(() => { void refresh(); }, 3000);
    dialog.addEventListener('close', () => { ended = true; clearInterval(timer); for (const url of previews) URL.revokeObjectURL(url); dialog.remove(); resolve(); }, { once: true });
    void api('/local/3d/models').then(result => {
      if (ended) return; models = result.models;
      for (const model of models) select.add(new Option(model.label, JSON.stringify([model.channelId, model.model])));
      submit.disabled = !models.length; fieldControls();
      if (!models.length) feedback.textContent = '请先在启动器的模型配置中检测 RunningHub 渠道，并从 3D 目录添加模型。OpenAI 兼容文字模型仍用于白模场景搭建。';
    }).catch(error => { if (!ended) feedback.textContent = error.message; });
    void refresh();
  });
}
