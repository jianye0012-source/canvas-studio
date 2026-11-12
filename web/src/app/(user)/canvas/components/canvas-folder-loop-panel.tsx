import { Button, Checkbox } from 'antd';
import { useState } from 'react';
import { FolderOpen, Play, Pause, RotateCcw } from 'lucide-react';
import { cancelNativePicker, loopPreviewUrl } from '@/services/api/local-workspace';
import { canvasThemes } from '@/lib/canvas-theme';
import { useThemeStore } from '@/stores/use-theme-store';
import type { CanvasNodeData } from '../types';
export function CanvasFolderLoopPanel({ node, active, progress, onSelect, onRun, onPause }: { node: CanvasNodeData; active: boolean; progress?: number; onSelect: (recursive: boolean) => Promise<void>; onRun: (retry?: boolean) => void; onPause: () => void }) {
    const theme = canvasThemes[useThemeStore(s => s.theme)]; const loop = node.metadata?.folderLoop;
    const current = loop?.files[loop.index];
    const preview = loop && current?.mimeType.startsWith('image/') ? loopPreviewUrl(loop.folder.id, current) : '';
    const [failedPreview, setFailedPreview] = useState('');
    const [selecting, setSelecting] = useState(false);
    const [pickerError, setPickerError] = useState('');
    const choose = async (recursive: boolean) => {
        if (selecting) return;
        setSelecting(true); setPickerError('');
        try { await onSelect(recursive); }
        finally { setSelecting(false); }
    };
    return <div data-canvas-no-zoom className="thin-scrollbar flex h-full w-full flex-col gap-3 overflow-y-auto p-5 text-xs [&>*]:shrink-0" style={{ color: theme.node.text }} onMouseDown={event => {
        const { target, currentTarget } = event;
        const scrollbar = target === currentTarget && event.nativeEvent.offsetX >= currentTarget.clientWidth;
        if (scrollbar || (target instanceof Element && target.closest("button, label"))) event.stopPropagation();
    }} onWheel={event => event.stopPropagation()}>
        <div className="flex items-center justify-between"><strong>FOR · 逐文件工作流</strong><Button size="small" type="text" disabled={active} loading={selecting} icon={<FolderOpen className="size-4" />} onClick={() => void choose(loop?.recursive || false)}>选文件夹</Button></div>
        {selecting && <Button size="small" onClick={() => void cancelNativePicker().catch(error => setPickerError(error.message))}>取消文件夹选择</Button>}
        {pickerError && <p role="alert">{pickerError}</p>}
        <p className="truncate" title={loop?.folder.path} style={{ color: theme.node.muted }}>{loop?.folder.path || '选择本机文件夹，连接后面的生成节点'}</p>
        <Checkbox disabled={active || selecting} checked={loop?.recursive || false} onChange={e => void choose(e.target.checked)}>包含子文件夹（重新选择并扫描）</Checkbox>
        <p className="leading-5" style={{ color: theme.node.muted }}>按文件名排序，每次取一个文件，依次执行相连工作流。每个步骤生成一份结果，保留在画布上。</p>
        {loop ? <><div role="status">{active ? '运行中' : loop.state === 'completed' ? '已完成' : loop.state === 'error' ? '已中断' : '待运行 / 可继续'} · {loop.index} / {loop.files.length}</div><p className="truncate" title={current?.relativePath}>{current?.relativePath || '全部文件已处理'}</p></> : null}
        {preview && (failedPreview === preview
            ? <p style={{ color: theme.node.muted }}>当前图片无法预览</p>
            : <img key={preview} src={preview} alt={`当前输入：${current?.relativePath}`} onError={() => setFailedPreview(preview)} draggable={false} className="h-20 w-full rounded-md object-contain" style={{ background: theme.node.panel }} />)}
        {progress !== undefined ? <div role="status">正在导入素材 · {progress}% <progress className="w-full" value={progress} max={100} /></div> : null}
        {loop?.error ? <p role="alert" className="line-clamp-3 leading-5">{loop.error}</p> : null}
        <div className="mt-auto flex gap-2">{active ? <Button icon={<Pause className="size-3.5" />} onClick={onPause}>{progress !== undefined ? '取消导入并暂停' : '当前任务完成后暂停'}</Button> : <Button type="primary" disabled={!loop?.files.length || loop.state === 'completed'} icon={<Play className="size-3.5" />} onClick={() => onRun()}>{loop?.index || loop?.iteration ? '继续循环' : '开始循环'}</Button>}{!active && loop?.state === 'error' ? <Button icon={<RotateCcw className="size-3.5" />} onClick={() => onRun(true)}>重试当前步骤</Button> : null}</div>
    </div>;
}
