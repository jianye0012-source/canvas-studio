import { useEffect, useRef } from 'react';
import { importHdrFile } from './stage-hdr-library.js';
import { openModelGenerator } from './canvas-model-generator.js';
import { createSaveQueue } from './canvas-save-queue.js';
import { createOutputRequests } from './canvas-output-request.js';
import { openAssetDb, listAssetIds, putAsset } from './scene-assets.js';
import { localizedImportMessage } from './domains/import-message.js';
import './canvas-bridge.css';

// The .cclayproject envelope includes meshes, HDRs, images, motion specs and
// poses. A browser's IndexedDB is a working cache, never the durable copy.
export function useCanvasBridge(api) {
  const latest = useRef(api); latest.current = api;
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('canvas')) return;
    let session, initialized = false, canceled = false, lastSnapshot = '', panoramas = [], activePanorama = null;
    const known = new Map();
    const upload = async asset => {
      const url = `/local/director-assets/${asset.id}`;
      if ((await fetch(url, { method: 'HEAD' })).ok) return;
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'x-asset-type': asset.type, 'x-asset-name': encodeURIComponent(asset.name || '') }, body: asset.bytes });
      if (!response.ok) throw new Error((await response.json()).msg || '素材保存失败');
    };
    const restoreAssets = async entries => {
      const db = await openAssetDb();
      try {
        const have = new Set(await listAssetIds(db));
        for (const { size, ...entry } of entries) {
          if (!have.has(entry.id)) {
            const response = await fetch(`/local/director-assets/${entry.id}`);
            if (!response.ok) throw new Error(`缺少素材 ${entry.id}，无法打开导演台`);
            await putAsset(db, { ...entry, bytes: await response.arrayBuffer() });
          }
          known.set(entry.id, { ...entry, size });
        }
      } finally { db.close(); }
    };
    const post = (type, payload) => parent.postMessage({ type, payload }, location.origin);
    const run = async (id, args) => { const result = await latest.current.runStudioAction(id, args); if (!result?.ok) throw new Error(`操作未完成：${id}，请查看导演台提示`); return result; };
    const bar = document.createElement('div'); bar.className = 'canvas-return-bar';
    const label = document.createElement('span'); label.textContent = '正在连接画布…'; label.setAttribute('role', 'status');
    const fail = error => { label.textContent = `未保存：${error.message}`; label.classList.add('error'); };
    const outputs = createOutputRequests({ post, onAccepted: () => { label.textContent = '画布正在保存…'; label.classList.remove('error'); } });
    const sendOutput = outputs.send;
    const button = (name, action) => {
      const node = document.createElement('button'); node.textContent = name; node.type = 'button';
      node.onclick = async () => { node.disabled = true; try { await action(); } catch (error) { fail(error); } finally { node.disabled = false; } };
      bar.append(node); return node;
    };
    const snapshot = () => latest.current.scenesDomain.collectProjectSnapshot(latest.current.scenesDomain.projectName || '白模导演台');
    const save = createSaveQueue(async force => {
      if (!initialized || canceled) return;
      const before = snapshot();
      if (!force && before === lastSnapshot) return;
      label.textContent = '正在保存到本机…'; label.classList.remove('error');
      const project = await latest.current.scenesDomain.collectProjectReferenced(latest.current.scenesDomain.projectName || '白模导演台', known, upload);
      const envelope = { engine: 'cozyclay', schemaVersion: 2, project, panoramas, activePanorama };
      const response = await fetch(`/local/director/${encodeURIComponent(session.instanceId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
      if (!response.ok) { const body = await response.json(); (body.missing || []).forEach(id => known.delete(id)); throw new Error(body.msg || '磁盘保存失败，请检查数据目录'); }
      lastSnapshot = before;
      post('storyai:director-project-changed', { project: { engine: 'cozyclay', schemaVersion: 2, projectId: session.instanceId, name: project.name, savedAt: project.savedAt } });
      label.textContent = '已保存到本机';
    });
    const capture = async () => {
      await save();
      const result = await latest.current.appContext.ports.capture();
      if (!result?.dataUrl) throw new Error('镜头画面尚未准备好，请稍后重试');
      await sendOutput('storyai:director-captures-sent', { captures: [{ dataUrl: result.dataUrl, fileName: '白模导演台截图.png' }] });
      label.textContent = '截图已发送到画布';
    };
    const video = async () => {
      await save(); label.textContent = '正在导出动画…';
      const result = await latest.current.runShotExport({ download: false });
      if (!result?.blob || !result.blob.type.startsWith('video/mp4')) throw new Error('视频导出失败，请查看导演台导出面板');
      await sendOutput('storyai:director-video-sent', { blob: result.blob, fileName: '白模预演.mp4', width: result.width || 1280, height: result.height || 720, durationSeconds: result.frameCount / 24 });
      label.textContent = '动画已发送到画布';
    };
    button('← 返回画布', async () => { await save(); post('storyai:director-close'); });
    button('AI 生成 3D 模型', async () => { if (!initialized) throw new Error('请等待导演台连接完成'); await openModelGenerator({ sceneId: session.instanceId, save, importMesh: file => latest.current.appContext.storeDomain('objects').importMeshFile(file) }); });
    button('保存场景', () => save(true)); button('截图到画布', capture); button('动画到画布', video);
    const panoramaSelect = document.createElement('select'); panoramaSelect.setAttribute('aria-label', '画布全景背景'); panoramaSelect.hidden = true;
    const applyPanorama = async item => {
      const response = await fetch(item.imageUrl); if (!response.ok) throw new Error('全景图片读取失败');
      const blob = await response.blob();
      if (item.projectionMode === 'equirectangular') {
        const hdr = await importHdrFile(new File([blob], item.fileName || '全景.jpg', { type: blob.type }));
        await run('stage.set', { lighting: { hdr: hdr.id, hdrBackground: true } });
      } else {
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        await run('stage.setEnvironment', { environmentImage: dataUrl, hasEnvSheet: true });
      }
      activePanorama = item.edgeId; await save(true);
    };
    panoramaSelect.onchange = () => { const item = panoramas.find(row => row.edgeId === panoramaSelect.value); if (item) applyPanorama(item).catch(fail); };
    bar.append(panoramaSelect, label); document.body.append(bar);
    async function message(event) {
      if (event.origin !== location.origin || event.source !== parent) return;
      try {
        if (['storyai:director-output-accepted', 'storyai:director-output-result'].includes(event.data?.type)) {
          outputs.receive(event.data.type, event.data.payload);
          return;
        }
        if (event.data?.type === 'storyai:director-session') {
          if (session) return;
          session = event.data.payload;
          if (!/^[a-zA-Z0-9_-]{1,160}$/.test(session.instanceId)) throw new Error('导演台编号无效');
          if (session.project && session.project.engine !== 'cozyclay') throw new Error('旧导演台格式无法直接打开，请新建导演台节点');
          let response = await fetch(`/local/director/${session.instanceId}`);
          const sourceId = session.project?.projectId;
          if (response.status === 404 && sourceId && sourceId !== session.instanceId) {
            if (!/^[a-zA-Z0-9_-]{1,160}$/.test(sourceId)) throw new Error('原导演台编号无效');
            response = await fetch(`/local/director/${sourceId}`);
          }
          if (response.ok) {
            const saved = await response.json();
            if (saved.engine !== 'cozyclay' || saved.schemaVersion !== 2) throw new Error('导演台保存格式不受支持');
            await restoreAssets(saved.project.resources.assets);
            await run('project.open', { serialized: JSON.stringify(saved.project) });
            panoramas = saved.panoramas || []; activePanorama = saved.activePanorama || null;
          } else if (response.status === 404 && !session.project?.projectId) {
            await run('project.new', { name: '白模导演台', castStyle: 'rig' });
          } else throw new Error('已保存的导演台文件不可用，请检查数据目录');
          latest.current.scenesDomain.setProjectStartupOpen(false);
          latest.current.scenesDomain.setProjectBrowserOpen(false);
          latest.current.scenesDomain.setProjectNameDialog(null);
          initialized = true; label.textContent = '已连接画布';
          if (panoramas.length && !activePanorama) await applyPanorama(panoramas[0]);
          await save(true);
        }
        if (event.data?.type === 'storyai:director-panoramas') {
          panoramas = event.data.payload?.panoramas || [];
          panoramaSelect.replaceChildren(...panoramas.map(item => { const option = document.createElement('option'); option.value = item.edgeId; option.textContent = item.fileName || '全景背景'; return option; }));
          panoramaSelect.hidden = !panoramas.length;
          if (activePanorama) panoramaSelect.value = activePanorama;
          if (initialized && panoramas.length && !activePanorama) await applyPanorama(panoramas[0]);
        }
        // From the canvas's 参考图库: stand the picture up in the scene as a photo card (3.3's cutout import), so the
        // author can block the character against it and tell the Agent to match the pose. Same-origin files (the
        // reference gallery) are fetched directly; anything else arrives as a data URL already.
        if (event.data?.type === 'storyai:director-reference-image') {
          if (!initialized) throw new Error('请等待导演台连接完成');
          const { url, name } = event.data.payload || {};
          if (typeof url !== 'string' || !url) throw new Error('参考图片地址无效');
          const response = url.startsWith('data:') ? await fetch(url) : await fetch(url, { credentials: 'same-origin' });
          if (!response.ok) throw new Error('参考图片读取失败');
          const blob = await response.blob();
          const file = new File([blob], name || '参考图.jpg', { type: blob.type || 'image/jpeg' });
          const receipt = await latest.current.appContext.storeDomain('objects').importCutoutFile(file);
          if (!receipt?.ok) throw new Error(localizedImportMessage(receipt?.message ?? ''));
          label.textContent = '参考图已加入场景，可在智能体面板里让角色照着摆姿势';
        }
      } catch (error) { fail(error); }
    }
    window.addEventListener('message', message);
    const ready = setInterval(() => { if (!session) post('storyai:director-ready'); }, 400);
    const autosave = setInterval(() => { if (initialized) save().catch(fail); }, 1500);
    const onLeaving = event => { if (initialized && snapshot() !== lastSnapshot) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', onLeaving);
    // Used by the File menu too: exports follow the same canvas return path.
    globalThis.__CANVAS_PROJECT_SAVE__ = () => save(true).then(() => ({ saved: true, name: latest.current.scenesDomain.projectName, fileName: '本机导演台场景.cclayproject' }));
    return () => { canceled = true; outputs.close(); clearInterval(ready); clearInterval(autosave); window.removeEventListener('message', message); window.removeEventListener('beforeunload', onLeaving); bar.remove(); delete globalThis.__CANVAS_PROJECT_SAVE__; };
  }, []);
}
