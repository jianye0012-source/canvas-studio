const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const archiver = require('archiver');
const semver = require('semver');
const assert = require('node:assert/strict');
(async () => {
  const root=path.resolve(__dirname,'../..'), taskRoot=await fs.mkdtemp(path.join(root,'work/tmp/up-'));
  const current=require('../package.json').version, future=semver.inc(current,'minor'), older='1.2.0', archives=new Map(), requests=[], errors=[];
  for(const version of [future,current,older]) {
    const name=`CanvasStudio-Windows-x64-${version}.zip`, file=path.join(taskRoot,name), entries=[{path:'画布工作台启动器.exe',data:'MZ-launcher'},{path:'resources/bundle/runtime/node.exe',data:'MZ-node'}];
    const manifest={application:'canvas-studio',format:1,platform:'win32-x64',version,files:entries.map(e=>({path:e.path,size:Buffer.byteLength(e.data),sha256:crypto.createHash('sha256').update(e.data).digest('hex')}))};
    const writer=createWriteStream(file), archive=archiver('zip');const done=new Promise((resolve,reject)=>{writer.on('close',resolve);archive.on('error',reject);});archive.pipe(writer);
    entries.forEach(e=>archive.append(e.data,{name:'画布工作台/'+e.path}));archive.append(JSON.stringify(manifest),{name:'画布工作台/package-manifest.json'});await archive.finalize();await done;
    const bytes=await fs.readFile(file), hash=crypto.createHash('sha256').update(bytes).digest('hex'), base=`https://github.com/jianye0012-source/canvas-studio/releases/download/v${version}/`;
    archives.set(name,{bytes,hash});archives.set(name+'.sha256',{bytes:Buffer.from(hash+'  '+name+'\n')});
    archives.get(name).release={tag_name:'v'+version,body:`版本 ${version} 的测试更新说明`,assets:[{name,size:bytes.length,digest:'sha256:'+hash,browser_download_url:base+name},{name:name+'.sha256',size:101,browser_download_url:base+name+'.sha256'}]};
  }
  const proxy=http.createServer((req,res)=>{
    const url=new URL(req.url); requests.push({url:req.url,userAgent:req.headers['user-agent']});
    if(url.pathname.endsWith('/releases')) {res.setHeader('content-type','application/json');res.end(JSON.stringify([...archives.values()].filter(v=>v.release).map(v=>v.release)));return;}
    const file=archives.get(decodeURIComponent(url.pathname.split('/').pop()));
    if(!file){res.writeHead(404);res.end();return;}res.end(file.bytes);
  });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const launch=()=>electron.launch({executablePath:require('electron'),args:['--no-sandbox',path.join(root,'launcher')],env:{...process.env,TMPDIR:path.join(root,'work/tmp'),CANVAS_DEV_ROOT:taskRoot}});
  let app;
  const network=async()=>app.evaluate(async ({net,session},port)=>{
    await session.defaultSession.setProxy({proxyRules:`http://127.0.0.1:${port}`,proxyBypassRules:'<-loopback>'});
    const original=net.fetch.bind(net);globalThis.__proxyTestOffline=false;
    net.fetch=(input,init)=>{
      if(globalThis.__proxyTestOffline) return Promise.reject(new TypeError('fetch failed',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}}));
      const url=new URL(input);return original('http://update-check.invalid'+url.pathname+url.search,init);
    };
  },proxy.address().port);
  try {
    app=await launch();
    let page=await app.firstWindow(); page.on('pageerror',e=>errors.push(e.message));await page.locator('#browser-current').filter({hasText:'已保存'}).waitFor();
    await page.locator('[data-page="repair"]').click();await page.locator('#auto-check-updates').uncheck();await network();
    await app.evaluate(()=>{globalThis.__proxyTestOffline=true;});
    await page.locator('#check-update').click();await page.locator('#notice.error').filter({hasText:'系统代理'}).waitFor();
    assert.ok(!(await page.locator('#notice').innerText()).includes('Error invoking'));assert.ok(!(await page.locator('#notice').innerText()).includes('fetch failed'));
    await app.evaluate(()=>{globalThis.__proxyTestOffline=false;});
    await page.locator('#check-update').click();await page.locator('#update-message').filter({hasText:`发现新版本 ${future}`}).waitFor();
    assert.equal(await page.locator('#release-versions option').count(),3);
    assert.equal(await page.locator('#notice').isVisible(),false);
    await page.locator('#release-versions').selectOption(older);assert.equal(await page.locator('#download-update').isDisabled(),true);await page.locator('#select-release').click();await page.locator('#update-message').filter({hasText:`已选择回退版本 ${older}`}).waitFor();
    await page.locator('#download-update').click();await page.locator('#update-message').filter({hasText:`更新 ${older} 已校验`}).waitFor();
    assert.equal((await page.evaluate(()=>window.launcher.invoke('app:load'))).update.intent,'rollback');
    await app.close(); app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('#browser-current').filter({hasText:'已保存'}).waitFor();
    await page.locator('[data-page="repair"]').click();await page.locator('#update-message').filter({hasText:`版本 ${older} 已校验`}).waitFor();await network();
    assert.equal((await page.evaluate(()=>window.launcher.invoke('app:load'))).update.intent,'rollback');assert.equal(await page.locator('#install-update').isEnabled(),true);
    await page.locator('#check-update').click();await page.locator('#release-versions').selectOption(future);await page.locator('#select-release').click();await page.locator('#update-message').filter({hasText:`发现新版本 ${future}`}).waitFor();
    await page.locator('#download-update').click();await page.locator('#update-message').filter({hasText:`更新 ${future} 已校验`}).waitFor();
    await page.evaluate(()=>window.launcher.invoke('skills:list'));
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async(_window,options)=>{globalThis.__rollbackPrompt=options;return {response:0};};},path.join(taskRoot,`CanvasStudio-Windows-x64-${older}.zip`));
    const canceled=await page.evaluate(()=>window.launcher.invoke('update:import'));assert.equal(canceled,null);assert.equal((await page.evaluate(()=>window.launcher.invoke('app:load'))).status.processes.length,3);assert.ok((await app.evaluate(()=>globalThis.__rollbackPrompt.detail)).includes('旧版可能无法打开'));
    const pids=(await page.evaluate(()=>window.launcher.invoke('app:load'))).status.processes.map(p=>p.pid);assert.equal(pids.length,3);
    await page.locator('#force-stop-repair').click();await page.locator('#status-message').filter({hasText:'本软件后台进程已全部停止'}).waitFor({state:'attached'});
    assert.deepEqual((await page.evaluate(()=>window.launcher.invoke('app:load'))).status.processes,[]);
    for(const pid of pids) assert.throws(()=>process.kill(pid,0),/ESRCH/);assert.doesNotThrow(()=>process.kill(unrelated.pid,0));
    await page.evaluate(()=>window.launcher.invoke('skills:list'));await page.locator('[data-page="home"]').click();await page.locator('#force-stop').click();await page.locator('#status-message').filter({hasText:'本软件后台进程已全部停止'}).waitFor({state:'attached'});
    await page.locator('[data-page="repair"]').click();await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(root,'outputs/版本选择与进程管理预览.png'),fullPage:true});
    assert.ok(requests.length>5);assert.ok(requests.every(r=>r.url.startsWith('http://update-check.invalid/')));assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(root,'outputs/更新代理与进程管理联调结果.json'),JSON.stringify({passed:true,versions:[future,current,older],proxyRequests:requests.length,verified:['Chromium 网络经会话代理读取版本列表与流式下载','网络失败中文提示和重试恢复','升级、当前版本及回退版本列表','选择回退包校验与重启恢复待安装','选择其他版本重新校验','停止三个真实后台服务并保留无关进程','停止后可重新启动'],remaining:['Windows 实机代理配置','Windows 安装和回退实际执行']},null,2));
    console.log('PASS Chromium proxy transport, release history, rollback staging/restart, scoped process termination and restart');
  } catch(error) {const page=app ? await app.firstWindow().catch(()=>null) : null;await page?.screenshot({path:path.join(root,'work/update-proxy-failure.png'),fullPage:true}).catch(()=>{});console.error('proxy requests',requests.length);throw error;}
  finally {if(app) await app.close().catch(()=>{});unrelated.kill('SIGKILL');proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await fs.rm(taskRoot,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});
