export type LocalChannel = { id: string; name: string; baseUrl: string; enabled: boolean; models: string[]; modelCapabilities: Record<string, 'text' | 'image' | 'video'>; hasApiKey?: boolean; keyUnavailable?: boolean; apiKey?: string; clearApiKey?: boolean };
export type LocalModelConfig = { channels: LocalChannel[]; directorModel: string; directorChannelId: string; textModel: string; textChannelId: string; imageModel: string; imageChannelId: string; videoModel: string; videoChannelId: string };
export const localRoles = [{ key: 'director', label: '白模导演', capability: 'text' }, { key: 'text', label: '画布文字', capability: 'text' }, { key: 'image', label: '图片生成', capability: 'image' }, { key: 'video', label: '视频生成', capability: 'video' }] as const;
async function request<T>(url: string, input?: unknown) {
    const response = await fetch(url, input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {});
    const result = await response.json();
    if (!response.ok) throw new Error(result.msg || '本机模型配置读取失败');
    return result as T;
}
export const localConfig = (input?: Partial<LocalModelConfig>) => request<LocalModelConfig>('/local/config', input);
export const testLocalChannel = (channel: LocalChannel) => request<{ models: string[] }>('/local/channels/test', channel);
