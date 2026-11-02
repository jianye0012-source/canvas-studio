const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root=path.resolve(__dirname,'../..'), taskRoot=await fs.mkdtemp(path.join(root,'work/tmp/native-skills-'));
  const imported=path.join(taskRoot,'中文规则.md'), exported=path.join(taskRoot,'导出规则.md');
  await fs.writeFile(imported,'导入 Skill 的内容');
  const launch=()=>electron.launch({executablePath:require('electron'),args:['--no-sandbox',path.join(root,'launcher')],env:{...process.env,TMPDIR:path.join(root,'work/tmp'),CANVAS_DEV_ROOT:taskRoot}});
  let app=await launch();
  try {
    let page=await app.firstWindow(); await page.locator('#browser-current').filter({hasText:'已保存'}).waitFor();
    await page.locator('[data-page="skills"]').click(); await page.locator('#top-status').filter({hasText:'运行中'}).waitFor({timeout:120000});
    await page.locator('#skills-new').click();
    await page.locator('#skill-form [name="name"]').fill('原生 Skill 测试'); await page.locator('#skill-form [name="description"]').fill('AI 文字规则'); await page.locator('#skill-form [name="content"]').fill('输出简体中文，保留关键参数。');
    await page.locator('#skill-form [type="submit"]').click(); await page.locator('#notice').filter({hasText:'Skill 已保存'}).waitFor();
    assert.equal((await page.evaluate(()=>window.launcher.invoke('skills:list'))).length,1);
    await page.locator('#skill-form [name="content"]').fill('修改后的文字生成规则'); await page.locator('#skill-form [type="submit"]').click();
    await page.waitForFunction(()=>window.launcher.invoke('skills:list').then(s=>s[0].content==='修改后的文字生成规则'));
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exported);
    await page.locator('#skills-export').click(); await page.locator('#notice').filter({hasText:'Skill 已导出'}).waitFor(); assert.equal(await fs.readFile(exported,'utf8'),'修改后的文字生成规则');
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},imported);
    await page.locator('#skills-import').click(); await page.locator('#notice').filter({hasText:'Skill 已导入'}).waitFor();
    assert.equal((await page.evaluate(()=>window.launcher.invoke('skills:list'))).length,2);
    await page.screenshot({path:path.join(root,'outputs/Skill管理预览.png')});
    await app.close(); app=await launch(); page=await app.firstWindow(); await page.locator('#browser-current').filter({hasText:'已保存'}).waitFor();
    await page.locator('[data-page="skills"]').click(); await page.getByRole('button',{name:'中文规则',exact:true}).waitFor({timeout:120000});
    assert.equal((await page.evaluate(()=>window.launcher.invoke('skills:list'))).length,2);
    page.on('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'中文规则',exact:true}).click(); await page.locator('#skills-delete').click();
    await page.waitForFunction(()=>window.launcher.invoke('skills:list').then(s=>s.length===1));
    console.log('PASS native Skill create, edit, import, export, delete and restart persistence');
  } finally { await app.close().catch(()=>{}); await fs.rm(taskRoot,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exit(1)});
