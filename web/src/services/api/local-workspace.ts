import type { FolderFile, FolderSelection } from '@/app/(user)/canvas/utils/folder-loop';
import type { UploadedFile } from '../file-storage';

const editors = new Map<string, string>();
export const editorHeader = (projectId: string) => {
    const id = editors.get(projectId);
    return id ? { 'x-canvas-editor': id } : undefined;
};
export function setCanvasEditor(projectId: string, id: string) { editors.set(projectId, id); }
export function clearCanvasEditor(projectId: string, id: string) { if (editors.get(projectId) === id) editors.delete(projectId); }
export type LoopProgress = { index: number; total: number; file: string; state: string };
export const openCanvasEditor = (projectId: string, id: string) => new EventSource(`/local/editor/${encodeURIComponent(projectId)}?id=${id}`);
const editorPost = (projectId: string, operation: string, data: unknown) => localRequest(`/local/editor/${encodeURIComponent(projectId)}/${operation}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...editorHeader(projectId) }, body: JSON.stringify(data),
});
export const claimLoopStep = (projectId: string, nodeId: string, attempt: string) => editorPost(projectId, 'step', { nodeId, attempt });
export const reportLoopProgress = (projectId: string, progress: LoopProgress) => editorPost(projectId, 'progress', progress);
async function localRequest<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options); const value = await response.json();
    if (!response.ok) throw new Error(value.msg || '本机服务请求失败'); return value;
}
export const selectLoopFolder = () => localRequest<FolderSelection | null>('/local/folders/select', { method: 'POST' });
export const scanLoopFolder = (id: string, recursive: boolean) => localRequest<FolderSelection & { files: FolderFile[] }>(`/local/folders/${encodeURIComponent(id)}?recursive=${recursive ? '1' : '0'}`);
export async function importLoopFile(id: string, file: FolderFile, signal: AbortSignal, onProgress: (percent: number) => void) {
    const response = await fetch(`/local/folders/${encodeURIComponent(id)}/import`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(file), signal });
    if (!response.ok || !response.body) throw new Error('文件导入失败，请重新打开工作台');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) throw new Error('文件导入已中断');
            pending += value;
            let end: number;
            while ((end = pending.indexOf('\n')) !== -1) {
                const line = JSON.parse(pending.slice(0, end)) as { progress?: number; error?: string; result?: UploadedFile & { content?: string } };
                pending = pending.slice(end + 1);
                if (line.error) throw new Error(line.error);
                if (line.result) return line.result;
                if (line.progress !== undefined) onProgress(line.progress);
            }
        }
    } finally { await reader.cancel().catch(() => {}); }
}
