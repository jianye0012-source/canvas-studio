import { createServer } from 'node:http';
import { createAgentHandler } from '../integrations/cozyclay/bin/agent/agent-routes.mjs';
import { studioMcpHttp, directorMcpSurface } from '../integrations/cozyclay/mcp/studio-http.mjs';

const port = Number(process.env.COZYCLAY_HTTP_PORT);
const agent = createAgentHandler({ port: () => port });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  try {
    if (pathname === '/mcp/director') {
      if (req.headers.authorization !== `Bearer ${process.env.CANVAS_LOCAL_PROVIDER_TOKEN}`) { res.writeHead(401); res.end(); return; }
      return await studioMcpHttp(req, res, await directorMcpSurface(agent));
    }
    if (pathname === '/health') { res.end('ok'); return; }
    if (pathname.startsWith('/oauth/')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ signedIn: false, providersConfigured: 1, configured: true })); return; }
    if (pathname.startsWith('/agent/') && await agent(req, res, pathname)) return;
    res.writeHead(404); res.end();
  } catch (error) {
    console.error('白模服务：', error.message);
    if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: '白模服务请求失败，请查看启动器日志' })); }
  }
});
server.listen(port, '127.0.0.1');
async function stop() { await agent.close(); server.closeAllConnections(); server.close(() => process.exit(0)); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
// A launcher disappearing must never leave orphaned local services on Windows.
if (process.send) process.on('disconnect', stop);
