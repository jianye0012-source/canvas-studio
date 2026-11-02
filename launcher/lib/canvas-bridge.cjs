const { randomUUID } = require('node:crypto');

class CanvasBridge {
  constructor() { this.sessions = new Map(); }
  session(id) { const session = this.sessions.get(id); if (!session) throw new Error('画布未连接，请打开工作台画布'); return session; }
  async handle(req, res, route, body) {
    const send = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const url = new URL(req.url, 'http://localhost');
    if (route === '/events' && req.method === 'GET') {
      const id = url.searchParams.get('clientId'); if (!id) throw new Error('缺少工作区编号');
      const previous = this.sessions.get(id); previous?.events.end();
      const session = { id, events: res, tools: [], pending: new Map() }; this.sessions.set(id, session);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(': connected\n\n');
      const timer = setInterval(() => res.write(': ping\n\n'), 15000);
      res.once('close', () => { clearInterval(timer); if (this.sessions.get(id) === session) this.sessions.delete(id); for (const task of session.pending.values()) task.reject(new Error('画布已断开，请检查任务状态后继续')); });
      return;
    }
    const value = await body(); const session = this.session(value.clientId);
    if (route === '/connect') {
      if (typeof value.canvasId !== 'string' || !Array.isArray(value.tools)) throw new Error('连接参数无效');
      session.canvasId = value.canvasId; session.tools = value.tools.filter(t => !['set_agent_state', 'read_skill_file'].includes(t.name));
      return send({ serviceId: 'canvas-studio' });
    }
    if (route === '/result') { const task = session.pending.get(value.requestId); if (task) value.error ? task.reject(new Error(value.error)) : task.resolve(value.result); return send({ ok: true }); }
    if (route === '/rpc' && value.method === 'bridge/stop') return send({ ok: true });
    res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: '这里是通用 MCP 连接。请在外部 MCP 客户端中对话，或切换到创作 Agent。' }));
  }
  workspaces() { return [...this.sessions.values()].filter(s => s.canvasId).map(s => ({ workspace_id: s.id, canvas_id: s.canvasId })); }
  tools() {
    const definitions = new Map();
    for (const session of this.sessions.values()) for (const tool of session.tools) definitions.set(tool.name, tool);
    return [{ name: 'canvas_studio_list_canvases', description: '列出本整合包中已打开并连接的画布', inputSchema: { type: 'object', properties: {} } }, ...[...definitions.values()].map(t => ({ ...t, name: 'canvas_studio_' + t.name, inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, workspace_id: { type: 'string', description: 'list_canvases 返回的 workspace_id；打开多个画布时必填' } } } }))];
  }
  async call(name, args, signal) {
    if (name === 'canvas_studio_list_canvases') return this.workspaces();
    if (!name.startsWith('canvas_studio_')) throw new Error('不是 Canvas Studio 画布工具');
    const targets = [...this.sessions.values()].filter(s => s.canvasId && (!args.workspace_id || args.workspace_id === s.id));
    if (targets.length !== 1) throw new Error('请先列出画布，并明确指定一个 workspace_id');
    const session = targets[0], tool = name.slice('canvas_studio_'.length);
    if (!session.tools.some(t => t.name === tool)) throw new Error('画布没有此工具');
    const { workspace_id, ...input } = args; const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => { session.events.write(`event: tool-cancel\ndata: ${JSON.stringify({ requestId: id })}\n\n`); finish(reject, new Error('工具请求已取消；请先查询任务状态')); };
      const timer = setTimeout(cancel, 300000);
      const finish = (fn, value) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); session.pending.delete(id); fn(value); };
      session.pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) return cancel();
      session.events.write(`event: tool\ndata: ${JSON.stringify({ requestId: id, name: tool, arguments: input, source: 'external', generation: 0 })}\n\n`);
    });
  }
  close() { for (const session of this.sessions.values()) session.events.end(); this.sessions.clear(); }
}
module.exports = { CanvasBridge };
