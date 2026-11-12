const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');

const dataDir = process.env.CANVAS_PICKER_DATA;
app.setPath('userData', path.join(dataDir, 'picker-profile'));
app.setPath('sessionData', path.join(dataDir, 'picker-profile'));
app.setPath('crashDumps', path.join(dataDir, 'logs', 'crashes'));
app.commandLine.appendSwitch('disk-cache-dir', path.join(dataDir, 'cache', 'picker'));
app.disableHardwareAcceleration();
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
let owner, finished = false;
const focus = () => {
  if (!owner || owner.isDestroyed()) return;
  if (owner.isMinimized()) owner.restore();
  owner.setAlwaysOnTop(true, 'pop-up-menu');
  owner.show(); owner.moveTop(); owner.focus();
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', focus);
function finish(result) {
  if (finished) return;
  finished = true;
  process.stdout.write('CANVAS_PICKER_RESULT ' + JSON.stringify(result) + '\n', () => app.quit());
}
app.whenReady().then(async () => {
  const options = JSON.parse(process.env.CANVAS_PICKER_OPTIONS);
  owner = new BrowserWindow({ title: options.title, width: 480, height: 120, show: false, resizable: false, autoHideMenuBar: true, alwaysOnTop: true, backgroundColor: '#f6f7fb', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  owner.on('closed', () => finish({ files: [] }));
  await owner.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html lang="zh-CN"><meta charset="utf-8"><body style="font:14px system-ui;color:#17324d;background:#f6f7fb"><p>请在系统窗口选择文件或文件夹。可回到工作台取消选择。</p></body></html>'));
  focus();
  const result = await dialog.showOpenDialog(owner, options);
  finish({ files: result.canceled ? [] : result.filePaths });
}).catch(error => finish({ error: error.message }));
