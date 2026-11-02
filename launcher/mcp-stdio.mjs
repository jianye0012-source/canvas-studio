import { readFile } from 'node:fs/promises';
import { Server } from '../integrations/cozyclay/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StdioServerTransport } from '../integrations/cozyclay/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '../integrations/cozyclay/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';

const [configPath, scope] = process.argv.slice(2);
if (!configPath || !['canvas', 'director'].includes(scope)) throw new Error('需要本整合包 MCP 配置文件与 canvas/director 类型');
async function request(method, params, signal) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const url = new URL(config.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('MCP 只连接本机工作台');
  const response = await fetch(`${url.origin}/mcp/${scope}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${config.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(310000)]) : AbortSignal.timeout(310000) });
  const value = await response.json();
  if (!response.ok || value.error) throw new Error(value.error?.message || value.msg || '请启动画布工作台');
  return value.result;
}
const server = new Server({ name: `canvas-studio-${scope}`, version: '1.3.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, (_, { signal }) => request('tools/list', {}, signal));
server.setRequestHandler(CallToolRequestSchema, ({ params }, { signal }) => request('tools/call', params, signal));
await server.connect(new StdioServerTransport());
