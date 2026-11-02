import { useEffect, useRef, useState } from 'react';
import { importLoopFile, scanLoopFolder, selectLoopFolder } from '@/services/api/local-workspace';
import { persistCanvasProjectNow } from '../stores/use-canvas-store';
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasGenerationMode } from '../types';
import { clearLoopGeneration, planFolderWorkflow, type FolderLoopState } from './folder-loop';

type Graph = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
export function useFolderLoop(options: { projectId: string; get: () => Graph; set: (graph: Graph) => void; generate: (id: string, mode: CanvasGenerationMode, prompt: string) => Promise<void>; onError: (error: string) => void }) {
    const latest = useRef(options); latest.current = options;
    const alive = useRef(true), runs = useRef(new Map<string, { pause: boolean }>());
    const [active, setActive] = useState<string[]>([]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; for (const run of runs.current.values()) run.pause = true; }; }, []);
    const state = (id: string) => latest.current.get().nodes.find(n => n.id === id)?.metadata?.folderLoop;
    const patch = async (id: string, value: FolderLoopState) => {
        if (!alive.current) throw new Error('工作区已关闭，任务将在重新打开后继续查询');
        const graph = latest.current.get(); if (!graph.nodes.some(n => n.id === id)) throw new Error('循环节点已删除');
        const nodes = graph.nodes.map(n => n.id === id ? { ...n, metadata: { ...n.metadata, folderLoop: value } } : n);
        latest.current.set({ ...graph, nodes });
        await persistCanvasProjectNow(latest.current.projectId, nodes, graph.connections);
    };
    const select = async (id: string, recursive: boolean) => {
        if (runs.current.has(id)) return;
        try { const folder = await selectLoopFolder(); if (!folder) return; const scan = await scanLoopFolder(folder.id, recursive); if (!scan.files.length) throw new Error('所选文件夹没有支持的图片、视频、音频或文本文件'); await patch(id, { folder, recursive, files: scan.files, state: 'ready', index: 0 }); }
        catch (error) { latest.current.onError((error as Error).message); }
    };
    const run = async (id: string, retry = false) => {
        if (runs.current.has(id) || runs.current.size) { latest.current.onError('请先暂停正在运行的文件夹循环'); return; }
        const control = { pause: false }; runs.current.set(id, control); setActive([...runs.current.keys()]);
        try {
            const initial = state(id); if (!initial || initial.state === 'completed') return;
            let loop: FolderLoopState = initial;
            const graph = latest.current.get();
            loop = { ...loop, state: 'running', error: undefined, templates: loop.templates || planFolderWorkflow(id, graph.nodes, graph.connections) };
            if (retry && loop.iteration) {
                const target = loop.iteration.nodeIds[loop.iteration.stage]; const graph = latest.current.get();
                const node = graph.nodes.find(n => n.id === target);
                if (node && ['loading', 'stopping'].includes(node.metadata?.status || '') && (node.metadata?.imageTaskId || node.metadata?.videoTaskId || node.metadata?.audioTaskId)) throw new Error('当前任务仍在运行，请先等待任务完成');
                latest.current.set({ ...graph, nodes: graph.nodes.map(n => n.id === target ? clearLoopGeneration(n) : n) });
                loop.iteration = { ...loop.iteration, intent: false };
            }
            await patch(id, loop);
            while (loop.index < loop.files.length) {
                if (control.pause || !alive.current) { if (alive.current) await patch(id, { ...loop, state: 'paused' }); return; }
                if (!loop.iteration) {
                    const file = loop.files[loop.index], uploaded = await importLoopFile(loop.folder.id, file);
                    const graph = latest.current.get(), anchor = graph.nodes.find(n => n.id === id)!;
                    const inputId = crypto.randomUUID(); const ids = new Map(loop.templates!.order.map(old => [old, crypto.randomUUID()]));
                    const baseY = Math.max(...graph.nodes.map(n => n.position.y + n.height), anchor.position.y) + 100;
                    const inputType = uploaded.content !== undefined ? CanvasNodeType.Text : uploaded.mimeType.startsWith('video/') ? CanvasNodeType.Video : uploaded.mimeType.startsWith('audio/') ? CanvasNodeType.Audio : CanvasNodeType.Image;
                    const input: CanvasNodeData = { id: inputId, type: inputType, title: `[${loop.index + 1}] ${file.relativePath}`, position: { x: anchor.position.x, y: baseY }, width: 380, height: 240, metadata: { ...uploaded, naturalWidth: uploaded.width, naturalHeight: uploaded.height, content: uploaded.content ?? uploaded.url, status: 'success', folderLoopOwner: id } };
                    const minX = Math.min(...loop.templates!.nodes.map(n => n.position.x)), minY = Math.min(...loop.templates!.nodes.map(n => n.position.y));
                    const templates = loop.templates!;
                    const clones: CanvasNodeData[] = templates.order.map(old => {
                        const template = clearLoopGeneration(templates.nodes.find(n => n.id === old)!);
                        const type = template.type === CanvasNodeType.Config ? (template.metadata?.generationMode || 'image') as CanvasNodeType : template.type;
                        const rewrite = (target?: string) => target ? ids.get(target) || target : undefined;
                        return { ...template, id: ids.get(old)!, type, title: `[${loop!.index + 1}] ${template.title}`, position: { x: anchor.position.x + 500 + template.position.x - minX, y: baseY + template.position.y - minY }, metadata: { ...template.metadata, folderLoopOwner: id, groupId: undefined, firstFrameNodeId: rewrite(template.metadata?.firstFrameNodeId), lastFrameNodeId: rewrite(template.metadata?.lastFrameNodeId), referenceAudioNodeId: rewrite(template.metadata?.referenceAudioNodeId), mimoVoiceCloneAudioNodeId: rewrite(template.metadata?.mimoVoiceCloneAudioNodeId) } };
                    });
                    const edges = loop.templates!.connections.map(e => ({ id: crypto.randomUUID(), fromNodeId: e.fromNodeId === id ? inputId : ids.get(e.fromNodeId) || e.fromNodeId, toNodeId: ids.get(e.toNodeId)! }));
                    latest.current.set({ nodes: [...graph.nodes, input, ...clones], connections: [...graph.connections, ...edges] });
                    loop = { ...loop, iteration: { inputId, nodeIds: clones.map(n => n.id), stage: 0, intent: false } };
                    await patch(id, loop);
                }
                const iteration: NonNullable<FolderLoopState['iteration']> = loop.iteration!;
                while (iteration.stage < iteration.nodeIds.length) {
                    if (control.pause || !alive.current) { if (alive.current) await patch(id, { ...loop, state: 'paused' }); return; }
                    const target = iteration.nodeIds[iteration.stage]; let node = latest.current.get().nodes.find(n => n.id === target);
                    if (!node) throw new Error('循环结果节点被删除，无法继续当前步骤');
                    if (iteration.intent && ['loading', 'stopping'].includes(node.metadata?.status || '') && !(node.metadata?.imageTaskId || node.metadata?.videoTaskId || node.metadata?.audioTaskId)) throw new Error('上次请求的提交状态未确认，已停止自动重发。请核对任务记录，确认未提交或已失败后点击“重试当前步骤”');
                    if (!iteration.intent) {
                        iteration.intent = true; await patch(id, loop);
                        await latest.current.generate(target, node.type === CanvasNodeType.Text ? 'text' : node.type === CanvasNodeType.Video ? 'video' : node.type === CanvasNodeType.Audio ? 'audio' : 'image', node.metadata?.composerContent ?? node.metadata?.prompt ?? '');
                        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                    }
                    for (;;) {
                        if (!alive.current) return;
                        node = latest.current.get().nodes.find(n => n.id === target);
                        if (!node) throw new Error('当前步骤节点已删除');
                        if (node.metadata?.status === 'success' && node.metadata.content) break;
                        if (['error', 'stopped'].includes(node.metadata?.status || '')) throw new Error(node.metadata?.errorDetails || '当前生成步骤失败，请检查结果后重试当前步骤');
                        if (!['loading', 'stopping'].includes(node.metadata?.status || '')) throw new Error('上次提交状态未确认。请检查模型配置和任务记录，确认后点击“重试当前步骤”');
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    iteration.stage += 1; iteration.intent = false; await patch(id, loop);
                }
                loop = { ...loop, index: loop.index + 1, iteration: undefined, results: [...(loop.results || []), { file: loop.files[loop.index].relativePath, inputId: iteration.inputId, nodeIds: iteration.nodeIds }] };
                await patch(id, loop);
            }
            await patch(id, { ...loop, state: 'completed' });
        } catch (error) {
            const detail = (error as Error).message; const loop = state(id);
            if (alive.current && loop) await patch(id, { ...loop, state: 'error', error: detail }).catch(() => {});
            if (alive.current) latest.current.onError(detail);
        } finally { runs.current.delete(id); if (alive.current) setActive([...runs.current.keys()]); }
    };
    return { active, select, run, pause: (id: string) => { const run = runs.current.get(id); if (run) run.pause = true; } };
}
