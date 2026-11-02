import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export async function directorMcpSurface(agent) {
  const runtime = await agent.mcpRuntime();
  const prefix = 'canvas_studio_director_';
  return {
    name: 'canvas-studio-director', version: '1.3.0',
    tools: () => [{ name: prefix + 'list_workspaces', description: '列出本整合包已连接的 3D 导演台场景', inputSchema: { type: 'object', properties: {} } }, ...runtime.handlers.map(tool => ({ name: prefix + tool.name, description: tool.description, annotations: tool.annotations, inputSchema: zodToJsonSchema(z.object({ ...tool.inputSchema, workspace_handle: z.string().optional().describe('多个导演台打开时必填；来自 list_workspaces') }), { target: 'jsonSchema7' }) }))],
    call: async (name, args, signal) => {
      signal?.throwIfAborted();
      if (name === prefix + 'list_workspaces') return runtime.liveHub?.workspaceHandleDetails() || [];
      if (!runtime.liveHub?.connected) throw new Error('请在工作台打开 3D 导演台，再执行场景工具');
      const tool = runtime.handlers.find(t => prefix + t.name === name);
      if (!tool) throw new Error('不是 Canvas Studio 导演台工具');
      return tool.handler(args, { workspaceHandle: args.workspace_handle });
    },
  };
}

// A transport per request also permits several independent MCP clients.
export async function studioMcpHttp(req, res, { name, version, tools, call }) {
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 20 * 1024 * 1024) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks)); } catch { res.writeHead(400); res.end(); return; }
  const server = new Server({ name, version }, { capabilities: { tools: {} }, instructions: 'Canvas Studio 本机工作台。先列出已连接工作区；多个工作区时必须明确指定目标。生成工具可能调用用户配置的在线 API。' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await tools() }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
    try {
      const result = await call(params.name, params.arguments || {}, signal);
      return Array.isArray(result?.content) ? result : { isError: result?.ok === false, content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.once('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
