"use client";

import { App } from 'antd';
import { useCallback } from 'react';
import { exportLocalMedia } from '@/services/api/local-workspace';
import { useUserStore } from '@/stores/use-user-store';

export function useExportLocalMedia() {
    const { message } = App.useApp();
    const available = useUserStore(state => state.user?.id === 'local-owner');
    const save = useCallback(async (media: Parameters<typeof exportLocalMedia>[0]) => {
        try {
            const result = await exportLocalMedia(media);
            if (result) message.success(`已另存：${result.name}`);
        } catch (error) { message.error((error as Error).message || '素材另存失败'); }
    }, [message]);
    return available ? save : undefined;
}
