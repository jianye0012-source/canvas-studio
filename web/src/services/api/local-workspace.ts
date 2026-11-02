import type { FolderFile, FolderSelection } from '@/app/(user)/canvas/utils/folder-loop';
import type { UploadedFile } from '../file-storage';
async function localRequest<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options); const value = await response.json();
    if (!response.ok) throw new Error(value.msg || '本机服务请求失败'); return value;
}
export const selectLoopFolder = () => localRequest<FolderSelection | null>('/local/folders/select', { method: 'POST' });
export const scanLoopFolder = (id: string, recursive: boolean) => localRequest<FolderSelection & { files: FolderFile[] }>(`/local/folders/${encodeURIComponent(id)}?recursive=${recursive ? '1' : '0'}`);
export const importLoopFile = (id: string, file: FolderFile) => localRequest<UploadedFile & { content?: string }>(`/local/folders/${encodeURIComponent(id)}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(file) });
