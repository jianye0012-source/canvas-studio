import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from '../types';
export type FolderFile = { id: string; relativePath: string; size: number; mtime: number; mimeType: string };
export type FolderSelection = { id: string; name: string; path: string };
export type FolderLoopState = {
    folder: FolderSelection; recursive: boolean; files: FolderFile[];
    state: 'ready' | 'running' | 'paused' | 'error' | 'completed'; index: number; error?: string;
    templates?: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; order: string[] };
    iteration?: { inputId: string; nodeIds: string[]; stage: number; intent: boolean };
    results?: { file: string; inputId: string; nodeIds: string[] }[];
};
export function planFolderWorkflow(loopId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const reached = new Set<string>(); const visit = (id: string) => { for (const edge of connections.filter(e => e.fromNodeId === id)) if (!reached.has(edge.toNodeId)) { reached.add(edge.toNodeId); visit(edge.toNodeId); } }; visit(loopId);
    if (reached.has(loopId)) throw new Error('循环后面的工作流有环，请先断开回连线');
    const templates = nodes.filter(n => reached.has(n.id) && !n.metadata?.folderLoopOwner);
    if (!templates.length) throw new Error('请将循环节点连接到需要执行的生成工作流');
    const ids = new Set(templates.map(n => n.id));
    for (const node of templates) {
        if ([CanvasNodeType.FolderLoop, CanvasNodeType.Director, CanvasNodeType.Group].includes(node.type)) throw new Error('循环内支持文本、图片、视频、音频、全景和生成配置节点；请移除嵌套循环、组或导演台');
        if (['loading', 'stopping'].includes(node.metadata?.status || '')) throw new Error('请先等待模板工作流完成当前任务');
    }
    const remaining = new Set(ids); const order: string[] = [];
    while (remaining.size) {
        const ready = [...remaining].filter(id => !connections.some(e => e.toNodeId === id && remaining.has(e.fromNodeId)));
        if (!ready.length) throw new Error('相连工作流存在循环连线，无法决定顺序');
        ready.forEach(id => { remaining.delete(id); order.push(id); });
    }
    return { nodes: templates, connections: connections.filter(e => ids.has(e.toNodeId) && (e.fromNodeId === loopId || ids.has(e.fromNodeId) || nodes.some(n => n.id === e.fromNodeId))), order };
}
export function clearLoopGeneration(node: CanvasNodeData): CanvasNodeData {
    const metadata = { ...node.metadata };
    for (const key of ['content','storageKey','bytes','naturalWidth','naturalHeight','durationMs','errorDetails','clientTaskId','taskBackend','imageTaskId','imageTaskResultId','videoTaskId','videoTaskVideoId','audioTaskId','audioTaskResultId','isBatchRoot','batchRootId','batchChildIds','primaryImageId','startedAt','progress']) delete metadata[key as keyof typeof metadata];
    return { ...node, metadata: { ...metadata, status: 'idle', count: 1 } };
}
