import { useEffect, useRef } from 'react';
import { createCodexAgentClient } from '@/services/api/codex-agent';
import { CANVAS_AGENT_TOOLS, normalizeCanvasAgentAction, type CanvasAgentAction, type CanvasAgentToolResult } from './canvas-agent-tools';
const tools = CANVAS_AGENT_TOOLS.filter(t => t.function.name !== 'set_agent_state').map(({ function: t }) => ({ name: t.name, description: t.description, inputSchema: t.parameters }));
export function useCanvasMcp(canvasId: string, execute: (action: CanvasAgentAction, refs: string[]) => Promise<CanvasAgentToolResult>) {
    const latest = useRef(execute); latest.current = execute;
    useEffect(() => {
        const lifetime = new AbortController();
        let client: ReturnType<typeof createCodexAgentClient> | undefined;
        const canceled = new Set<string>(); let queue = Promise.resolve();
        void fetch('/local/health', { signal: lifetime.signal }).then(r => r.json()).then(value => {
            if (lifetime.signal.aborted || value.application !== 'canvas-studio') return;
            client = createCodexAgentClient({ endpoint: location.origin + '/local/agent', token: 'local-session' }, canvasId, tools, {
                ready: async () => {}, rpc: () => {}, error: () => {}, cancelTool: id => canceled.add(id),
                tool: event => {
                    queue = queue.then(async () => {
                        if (lifetime.signal.aborted || canceled.has(event.requestId)) return;
                        try {
                            const action = normalizeCanvasAgentAction(event.name, event.arguments, event.requestId);
                            const result = await latest.current(action, []);
                            if (!lifetime.signal.aborted && !canceled.has(event.requestId)) await client?.result(event.requestId, result);
                        } catch (error) { if (!lifetime.signal.aborted) await client?.result(event.requestId, undefined, (error as Error).message); }
                        finally { canceled.delete(event.requestId); }
                    }).catch(() => {});
                },
            });
        }).catch(() => {});
        return () => { lifetime.abort(); client?.close(); };
    }, [canvasId]);
}
