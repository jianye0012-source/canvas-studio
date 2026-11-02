import { Button, Checkbox } from 'antd';
import { FolderOpen, Play, Pause, RotateCcw } from 'lucide-react';
import { canvasThemes } from '@/lib/canvas-theme';
import { useThemeStore } from '@/stores/use-theme-store';
import type { CanvasNodeData } from '../types';
export function CanvasFolderLoopPanel({ node, active, onSelect, onRun, onPause }: { node: CanvasNodeData; active: boolean; onSelect: (recursive: boolean) => void; onRun: (retry?: boolean) => void; onPause: () => void }) {
    const theme = canvasThemes[useThemeStore(s => s.theme)]; const loop = node.metadata?.folderLoop;
    return <div data-canvas-no-zoom className="thin-scrollbar flex h-full w-full flex-col gap-3 overflow-y-auto p-5 text-xs [&>*]:shrink-0" style={{ color: theme.node.text }} onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><strong>FOR · 逐文件工作流</strong><Button size="small" type="text" disabled={active} icon={<FolderOpen className="size-4" />} onClick={() => onSelect(loop?.recursive || false)}>选文件夹</Button></div>
        <p className="truncate" title={loop?.folder.path} style={{ color: theme.node.muted }}>{loop?.folder.path || '选择本机文件夹，连接后面的生成节点'}</p>
        <Checkbox disabled={active} checked={loop?.recursive || false} onChange={e => onSelect(e.target.checked)}>包含子文件夹（重新选择并扫描）</Checkbox>
        <p className="leading-5" style={{ color: theme.node.muted }}>按文件名排序，每次取一个文件，依次执行相连工作流。每个步骤生成一份结果，保留在画布上。</p>
        {loop ? <><div role="status">{active ? '运行中' : loop.state === 'completed' ? '已完成' : loop.state === 'error' ? '已中断' : '待运行 / 可继续'} · {loop.index} / {loop.files.length}</div><p className="truncate" title={loop.files[loop.index]?.relativePath}>{loop.files[loop.index]?.relativePath || '全部文件已处理'}</p></> : null}
        {loop?.error ? <p role="alert" className="line-clamp-3 leading-5">{loop.error}</p> : null}
        <div className="mt-auto flex gap-2">{active ? <Button icon={<Pause className="size-3.5" />} onClick={onPause}>当前任务完成后暂停</Button> : <Button type="primary" disabled={!loop?.files.length || loop.state === 'completed'} icon={<Play className="size-3.5" />} onClick={() => onRun()}>{loop?.index || loop?.iteration ? '继续循环' : '开始循环'}</Button>}{!active && loop?.state === 'error' ? <Button icon={<RotateCcw className="size-3.5" />} onClick={() => onRun(true)}>重试当前步骤</Button> : null}</div>
    </div>;
}
