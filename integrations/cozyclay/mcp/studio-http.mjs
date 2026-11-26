import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

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
