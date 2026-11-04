"use client";

import { useEffect, useState } from 'react';
import { Button, Input } from 'antd';
import { Copy, RefreshCw } from 'lucide-react';
import { useCopyText } from '@/hooks/use-copy-text';
import { canvasThemes } from '@/lib/canvas-theme';
import { useThemeStore } from '@/stores/use-theme-store';
import { testLocalMcp } from '@/services/api/local-workspace';
import type { useCodexAgent } from '../agent/use-codex-agent';

type McpConfig = { mcpServers: Record<string, unknown>; instructions: Record<string, string>; endpoints: Record<string, string>; canvases: unknown[] };
export function CanvasCodexConnectView({ agent }: {
    agent: Pick<ReturnType<typeof useCodexAgent>, 'connection' | 'status' | 'error' | 'connect' | 'disconnect'>;
    onChat: () => void;
}) {
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const copyText = useCopyText();
    const [config, setConfig] = useState<McpConfig>();
    const [scope, setScope] = useState<'canvas' | 'director'>('canvas');
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(false);
    const [checkResult, setCheckResult] = useState('');
    const load = async () => {
        try { const response = await fetch('/local/mcp/config'); if (!response.ok) throw Error('请通过画布工作台启动器打开本页面'); setConfig(await response.json()); setError(''); }
        catch (reason) { setError((reason as Error).message); }
    };
    useEffect(() => { void load(); }, []);
    const name = `canvas-studio-${scope}`;
    const selected = config ? JSON.stringify({ mcpServers: { [name]: config.mcpServers[name] } }, null, 2) : '';
    const instructions = config?.instructions?.[name];
    const check = async () => {
        setChecking(true);
        setCheckResult('');
        try {
            const value = await testLocalMcp(scope);
            setCheckResult(value.workspaces ? `连接成功 · ${value.tools} 个工具 · ${value.workspaces} 个工作区` : `服务可用 · ${value.tools} 个工具 · 尚未打开工作区`);
        } catch (reason) { setCheckResult(`连接失败：${(reason as Error).message}`); }
        finally { setChecking(false); }
    };
    return <div className="space-y-5">
        <div><h2 className="text-base font-semibold">Canvas Studio MCP</h2><p className="mt-2 text-xs leading-6" style={{ color: theme.node.muted }}>本整合包专属连接。支持 Codex、Claude Desktop、Cursor、Cherry Studio 等支持 MCP 的客户端，无需安装原项目插件。</p></div>
        <div className="flex gap-2">{(['canvas', 'director'] as const).map(item => <Button key={item} disabled={checking} type={scope === item ? 'primary' : 'text'} onClick={() => { setScope(item); setCheckResult(''); }}>{item === 'canvas' ? '画布 MCP' : '3D 导演台 MCP'}</Button>)}</div>
        <p className="text-xs leading-6" style={{ color: theme.node.muted }}>{scope === 'canvas' ? '读取和编辑节点、连线、素材、生成任务。保持目标画布页面打开；多个画布时先列出工作区。' : '搭建白模、编辑角色姿态、动作、关键帧与运镜、截图和导出。先在画布打开目标导演台；多个场景时先列出工作区。'}</p>
        <div className="flex items-center justify-between text-xs"><span>{scope === 'canvas' ? `画布桥接：${config?.canvases.length ? '已连接' : '等待连接'}` : '独立服务：canvas-studio-director'}</span><Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} onClick={() => { void load(); }}>刷新连接</Button></div>
        <div className="flex flex-wrap gap-2"><Button type="primary" icon={<Copy className="size-3.5" />} disabled={!instructions} onClick={() => instructions && copyText(instructions, '接入指令已复制')}>复制给 AI 的接入指令</Button><Button loading={checking} disabled={!config} onClick={() => void check()}>测试连接</Button></div>
        {checkResult && <p role="status" className="text-xs" style={{ color: theme.node.text }}>{checkResult}</p>}
        <div className="space-y-2"><div className="text-xs font-medium">通用 MCP JSON 配置（stdio）</div><Input.TextArea aria-label="MCP JSON 配置" readOnly value={selected} autoSize={{ minRows: 8, maxRows: 16 }} style={{ fontFamily: 'monospace', fontSize: 11 }} /><Button icon={<Copy className="size-3.5" />} disabled={!selected} onClick={() => copyText(selected, 'MCP 配置已复制')}>复制配置</Button></div>
        <ol className="list-decimal space-y-2 pl-4 text-xs leading-6" style={{ color: theme.node.muted }}><li>保持启动器服务运行，将配置加入客户端的 MCP 设置。</li><li>重载 MCP 后，让客户端先列出画布或导演台工作区，再执行操作。</li><li>配置使用整合包内置 Node，无需另装环境；移动整合包后重新复制配置。</li></ol>
        {config ? <p className="break-all text-xs leading-6" style={{ color: theme.node.muted }}>Streamable HTTP 地址：{config.endpoints[scope]}。需要 HTTP 的客户端可在“复制 HTTP 配置”中获取地址和请求头。<Button type="text" size="small" onClick={async () => { const response = await fetch('/local/mcp/config'); const value = await response.json(); void copyText(JSON.stringify({ mcpServers: { [`canvas-studio-${scope}`]: { type: 'http', url: value.endpoints[scope], headers: { Authorization: `Bearer ${value.token}` } } } }, null, 2), 'HTTP 配置已复制'); }}>复制 HTTP 配置</Button></p> : null}
        <p className="text-xs leading-6" style={{ color: theme.node.muted }}>画布与导演台使用独立工具名称，与 Infinite Canvas 原项目分开。连接凭据仅用于本机程序通信；配置只交给你使用的客户端。</p>
        {error || agent.error ? <p role="alert" className="text-xs">{error || agent.error}</p> : null}
    </div>;
}
