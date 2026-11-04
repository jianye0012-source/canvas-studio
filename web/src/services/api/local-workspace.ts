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
export const loopPreviewUrl = (folderId: string, file: FolderFile) => `/local/folders/${encodeURIComponent(folderId)}/preview?${new URLSearchParams({ file: file.id, size: String(file.size), mtime: String(file.mtime) })}`;
const postLocal = <T,>(url: string, data: unknown) => localRequest<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
export async function pickNativeMedia(kind: 'image' | 'video' | 'audio' | 'media', multiple = false) {
    const picks = await postLocal<{ id: string; name: string; type: string }[]>('/local/media/select', { kind, multiple });
    const files: File[] = [];
    for (const pick of picks) {
        const response = await fetch(`/local/media/picked/${encodeURIComponent(pick.id)}`);
        if (!response.ok) throw new Error(`无法读取本机文件「${pick.name}」，请重新选择`);
        files.push(new File([await response.blob()], pick.name, { type: pick.type }));
    }
    return files;
}
export const testLocalMcp = (scope: 'canvas' | 'director') => postLocal<{ tools: number; workspaces: number }>('/local/mcp/test', { scope });
export const desktopAssetId = (storageKey?: string, url?: string) => {
    const id = storageKey?.match(/^server:([a-f0-9-]{36})$/i)?.[1];
    return id || url?.match(/^\/api\/files\/([a-f0-9-]{36})\/content(?:\?|$)/i)?.[1];
};
export const autoExportLocalMedia = (id: string, completedAt: number, resultKey: string) => postLocal<{ name: string } | null>('/local/media/export', { id, completedAt, resultKey });
export async function exportLocalMedia(media: { storageKey?: string; url: string; name: string; kind: 'image' | 'video' | 'audio' }) {
    let id = desktopAssetId(media.storageKey, media.url);
    if (!id) {
        const { resolveMediaUrl, downloadRemoteMedia, uploadAssetMediaFile } = await import('../file-storage');
        const { resolveImageUrl } = await import('../image-storage');
        const url = await (media.kind === 'image' ? resolveImageUrl(media.storageKey, media.url) : resolveMediaUrl(media.storageKey, media.url));
        if (!url) throw new Error('素材地址已失效');
        const blob = await downloadRemoteMedia(url);
        const stored = await uploadAssetMediaFile(new File([blob], media.name, { type: blob.type }));
        id = desktopAssetId(stored.storageKey, stored.url);
        if (!id) throw new Error('素材未能写入本机，请恢复数据目录');
    }
    return postLocal<{ name: string } | null>('/local/media/export', { id, name: media.name });
}
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
