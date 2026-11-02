const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
(async () => {
  const root = path.resolve(__dirname, '../..'), runtime = JSON.parse(await fs.readFile(path.join(root, 'work/smoke-runtime.json'), 'utf8'));
  const sdk = name => import(pathToFileURL(path.join(root, 'integrations/cozyclay/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm', name)));
  const { Client } = await sdk('client/index.js'), { StreamableHTTPClientTransport } = await sdk('client/streamableHttp.js'), { StdioClientTransport } = await sdk('client/stdio.js');
  const requests = [], errors = [], clients = [];
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    if (req.url === '/v1/models') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ data: [{ id: 'loop-text' }] })); return; }
    requests.push(body); await new Promise(resolve => setTimeout(resolve, 1200));
    const content = `循环输出-${requests.length}`;
    if (!body.stream) { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ choices: [{ message: { role:'assistant', content } }] })); return; }
    res.writeHead(200, { 'content-type':'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant', content }, finish_reason: null }] }) + '\n\n');
    res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => mock.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'], env: { ...process.env, TMPDIR: path.join(root,'work/tmp') } });
  const context = await browser.newContext({ viewport: { width:1800,height:1100 } }); const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  let original;
  try {
    await page.goto(runtime.launchUrl); await page.waitForURL('**/canvas');
    const config = await page.evaluate(() => fetch('/local/mcp/config').then(r=>r.json()));
    async function httpClient(scope) { const client = new Client({ name:'Generic MCP integration test',version:'1' }); await client.connect(new StreamableHTTPClientTransport(new URL(config.endpoints[scope]), { requestInit:{headers:{Authorization:'Bearer '+config.token}} })); clients.push(client); return client; }
    const canvas = await httpClient('canvas');
    let list = await canvas.listTools(); assert.ok(list.tools.some(t=>t.name==='canvas_studio_skill_save'));
    const created = await canvas.callTool({ name:'canvas_studio_skill_save',arguments:{ name:'循环测试写作 Skill',content:'SKILL_SENTINEL：使用简短中文文案输出。' } });
    assert.equal(created.isError,false); const skill = JSON.parse(created.content[0].text);
    original = await page.evaluate(()=>fetch('/local/config').then(r=>r.json()));
    const channel = { id:'loop-tests',name:'循环测试',enabled:true,baseUrl:`http://127.0.0.1:${mock.address().port}`,apiKey:'loop-test-key',models:['loop-text'],modelCapabilities:{'loop-text':'text'} };
    await page.evaluate(async ({config,channel})=> { const next={...config,channels:[channel],directorChannelId:channel.id,directorModel:'loop-text',textChannelId:channel.id,textModel:'loop-text',imageModel:'',imageChannelId:'',videoModel:'',videoChannelId:''}; const r=await fetch('/local/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(next)}); if(!r.ok)throw Error(await r.text()); },{config:original,channel});
    const projectId='loop-proof-'+Date.now();
    await page.evaluate(async ({id,skill})=> {
      const now=new Date().toISOString();
      const nodes=[{id:'loop',type:'folder-loop',title:'FOR 文件夹循环',position:{x:0,y:0},width:380,height:310,metadata:{}},...['a','b'].map((id,i)=>({id,type:'text',title:'文字步骤'+id,position:{x:500+i*450,y:0},width:340,height:240,metadata:{status:'idle',prompt:i?'继续润色上游文字':'根据上游文件写一句文案',textSkills:[{id:skill.id,name:skill.name,source:'user'}]}}))];
      const project={id,title:'文件夹循环验收',createdAt:now,updatedAt:now,nodes,connections:[{id:'e1',fromNodeId:'loop',toNodeId:'a'},{id:'e2',fromNodeId:'a',toNodeId:'b'}],chatSessions:[],activeChatId:null,agentConfig:null,backgroundMode:'dots',showImageInfo:false,viewport:{x:330,y:140,k:0.8},sidePanel:{open:true,width:280},agentPanel:{open:false,width:464},autoTitlePending:false};
      const r=await fetch('/api/v1/canvas/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:project})}); if(!r.ok)throw Error(await r.text());
    },{id:projectId,skill});
    await page.goto(`${runtime.url}/canvas/${projectId}`);
    await page.getByRole('button',{name:'选文件夹',exact:true}).click();
    await page.getByRole('button',{name:'开始循环',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>document.body.innerText.includes('0 / 2'));
    await page.getByRole('button',{name:'开始循环',exact:true}).click();
    await page.waitForFunction(()=>document.body.innerText.includes('当前任务完成后暂停'));
    const deadline = Date.now() + 20000; while (!requests.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100)); assert.ok(requests.length, '首个任务未提交');
    await page.getByRole('button',{name:'当前任务完成后暂停',exact:true}).click();
    await page.getByRole('button',{name:'继续循环',exact:true}).waitFor({timeout:30000});
    assert.equal(requests.length,1);
    await page.reload(); await page.getByRole('button',{name:'继续循环',exact:true}).waitFor();
    await page.getByRole('button',{name:'继续循环',exact:true}).click();
    await page.waitForFunction(()=>document.body.innerText.includes('已完成 · 2 / 2'),null,{timeout:45000});
    assert.equal(requests.length,4); assert.ok(requests.every(r=>JSON.stringify(r).includes('SKILL_SENTINEL')));
    assert.ok(JSON.stringify(requests[0]).includes('文件甲故事素材')); assert.ok(JSON.stringify(requests[1]).includes('循环输出-1')); assert.ok(JSON.stringify(requests[2]).includes('文件乙故事素材'));
    await page.waitForTimeout(800);
    const saved=await page.evaluate(id=>fetch('/api/v1/canvas/projects').then(r=>r.json()).then(v=>v.data.find(p=>p.id===id)),projectId);
    assert.equal(saved.nodes.find(n=>n.id==='loop').metadata.folderLoop.results.length,2);
    const stdio = new Client({name:'Non Codex stdio test',version:'1'}); const stdioConfig=config.mcpServers['canvas-studio-canvas'];
    await stdio.connect(new StdioClientTransport({...stdioConfig,stderr:'pipe'})); clients.push(stdio);
    await page.waitForFunction(()=>fetch('/local/mcp/config').then(r=>r.json()).then(v=>v.canvases.length===1));
    list=await stdio.listTools(); assert.ok(list.tools.some(t=>t.name==='canvas_studio_get_canvas_summary'));
    const generatedText=await stdio.callTool({name:'canvas_studio_generate_text',arguments:{prompt:'通过 MCP 生成一段文案',sourceNodeIds:[],skillIds:[skill.id]}}); assert.ok(!generatedText.isError,JSON.stringify(generatedText)); assert.equal(requests.length,5); assert.ok(JSON.stringify(requests[4]).includes('SKILL_SENTINEL'));
    const summary=await stdio.callTool({name:'canvas_studio_get_canvas_summary',arguments:{}}); assert.ok(!summary.isError,JSON.stringify(summary)); assert.ok(JSON.stringify(summary).includes('文件夹循环验收'));
    // Use the actual UI to open the director and verify its separate MCP surface.
    await page.getByLabel('导演台',{exact:true}).click(); await page.mouse.click(950,460);
    await page.getByRole('button',{name:'打开导演台',exact:true}).last().click();
    const frame = page.frameLocator('iframe[title="3D导演台"]'); await frame.locator('.canvas-return-bar').waitFor();
    await frame.locator('.topbar-mcp[data-state="connected"]').waitFor({timeout:30000});
    const director=await httpClient('director'); const tools=await director.listTools(); assert.ok(tools.tools.every(t=>t.name.startsWith('canvas_studio_director_')));
    const workspaces=await director.callTool({name:'canvas_studio_director_list_workspaces',arguments:{}}); assert.ok(!workspaces.isError); assert.ok(JSON.parse(workspaces.content[0].text).length);
    const scene=await director.callTool({name:'canvas_studio_director_describe_scene',arguments:{}}); assert.ok(!scene.isError,JSON.stringify(scene));
    await frame.getByRole('button',{name:'导演台 MCP',exact:true}).click(); await frame.getByRole('dialog').waitFor(); assert.ok((await frame.getByLabel('导演台 MCP 配置').inputValue()).includes('canvas-studio-director')); await frame.getByRole('button',{name:'关闭',exact:true}).click();
    const input=frame.locator('input[type=file][accept*="video"]').first(); if(!await input.count()) await frame.locator('.agent-rail-toggle').click();
    await input.setInputFiles(path.join(root,'work/video-fixture/h264-10bit.mp4'));
    await frame.locator('.agent-attachments img').first().waitFor({state:'attached',timeout:30000}); assert.ok((await frame.locator('.agent-attachments img').first().getAttribute('alt')).includes('9 frames'));
    for(const name of ['h264-8bit.mp4','h264-10bit.mp4']) {
      const bytes=await fs.readFile(path.join(root,'work/video-fixture',name));
      const result=await context.request.post(runtime.url+'/local/media/video-sheet',{data:bytes,headers:{'content-type':'application/octet-stream'}}); assert.equal(result.status(),200,await result.text());
      const jpg=await result.body(); assert.equal(jpg.readUInt16BE(0),0xffd8); await fs.writeFile(path.join(root,'work',name+'.jpg'),jpg);
    }
    const failed=await context.request.post(runtime.url+'/local/media/video-sheet',{data:Buffer.from('invalid h264'),headers:{'content-type':'application/octet-stream'}}); assert.equal(failed.status(),500); assert.ok((await failed.json()).msg.includes('无法解码'));
    assert.equal((await fs.readdir(path.join(runtime.dataDir,'tmp'))).some(n=>n.startsWith('video-')),false);
    await page.screenshot({path:path.join(root,'outputs/MCP与导演台预览.png')});
    await fs.writeFile(path.join(root,'work/workspace-proof.json'),JSON.stringify({requests:requests.length,skills:true,pausedAndReloaded:true,completedFiles:2,httpMcp:true,stdioMcp:true,directorTools:tools.tools.length,videoProfiles:['H264 8-bit 420','H264 10-bit 444'],errors},null,2));
    assert.deepEqual(errors,[]); console.log('PASS folder workflow pause/reload, per-file two-step outputs, Skill injection, HTTP+stdio generic MCP, director tools, H264 profiles and corrupt-video errors');
  } catch(error) { await page.screenshot({path:path.join(root,'work/workspace-failure.png')}).catch(()=>{}); console.error('requests',requests.length); throw error; }
  finally { if(original)await page.evaluate(config=>fetch('/local/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(config)}),original).catch(()=>{}); for(const c of clients)await c.close().catch(()=>{}); await browser.close(); await new Promise(resolve=>mock.close(resolve)); }
})().catch(e=>{console.error(e);process.exit(1)});
