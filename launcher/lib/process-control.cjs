const { execFile } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const alive = child => Boolean(child.pid && child.exitCode === null && child.signalCode === null && !child.launchError);
async function terminateChild(child, force = false) {
  if (!alive(child)) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }, error => {
      if (error && alive(child)) reject(new Error(`无法停止${child.serviceName || '后台进程'}（PID ${child.pid}），请检查系统权限`)); else resolve();
    }));
  } else {
    const kill = signal => { try { if (child.ownsProcessGroup) process.kill(-child.pid, signal); else child.kill(signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    kill(force ? 'SIGKILL' : 'SIGTERM');
    if (!force) { await Promise.race([exited, delay(1500, undefined, { ref: false })]); if (alive(child)) kill('SIGKILL'); }
  }
  await Promise.race([exited, delay(2000, undefined, { ref: false })]);
  if (alive(child)) throw new Error(`进程 ${child.pid} 尚未退出，请再次强制停止`);
}
module.exports = { alive, terminateChild };
