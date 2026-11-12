const path = require('node:path');
const { spawn } = require('node:child_process');
const { terminateChild } = require('./process-control.cjs');

// A separate Electron process owns the system dialog. A stalled Windows
// dialog can then be cancelled without blocking the launcher or other pickers.
class NativePicker {
  constructor({ executable, entry, dataDir, spawnImpl = spawn, stop = terminateChild, timeout = 5 * 60 * 1000 }) {
    Object.assign(this, { executable, entry, dataDir, spawnImpl, stop, timeout });
    this.active = null;
  }

  async select(options) {
    if (this.active?.cancelled) await this.active.stopping;
    if (this.active) {
      this.active.child.stdin.write('focus\n');
      return [];
    }
    const env = { ...process.env, CANVAS_NATIVE_PICKER: '1', CANVAS_PICKER_DATA: this.dataDir, CANVAS_PICKER_OPTIONS: JSON.stringify(options) };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = this.spawnImpl(this.executable, [this.entry], { env, cwd: this.dataDir, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.serviceName = '文件选择窗口';
    child.ownsProcessGroup = process.platform !== 'win32';
    const job = { child };
    this.active = job;
    try {
      return await new Promise((resolve, reject) => {
        let output = '', settled = false;
        const finish = (error, files = []) => {
          if (settled) return;
          settled = true;
          clearTimeout(job.timer);
          error ? reject(error) : resolve(files);
        };
        job.finish = finish;
        job.timer = setTimeout(() => finish(new Error('文件选择等待超时，请重新选择')), this.timeout);
        child.stdin.on('error', () => {});
        child.stdout.setEncoding('utf8');
        child.stderr.resume();
        child.stdout.on('data', data => {
          output += data;
          if (output.length > 1024 * 1024) return finish(new Error('文件选择结果过大'));
          let end;
          while ((end = output.indexOf('\n')) !== -1) {
            const line = output.slice(0, end); output = output.slice(end + 1);
            if (!line.startsWith('CANVAS_PICKER_RESULT ')) continue;
            try {
              const result = JSON.parse(line.slice('CANVAS_PICKER_RESULT '.length));
              if (result.error) finish(new Error(result.error));
              else if (Array.isArray(result.files) && result.files.every(file => typeof file === 'string' && path.isAbsolute(file))) finish(null, result.files);
              else finish(new Error('文件选择结果无效'));
            } catch { finish(new Error('文件选择结果无法读取')); }
          }
        });
        child.once('error', error => finish(new Error('文件选择窗口无法启动：' + error.message)));
        child.once('close', () => finish(job.cancelled ? null : new Error('文件选择窗口意外退出，请重试')));
      });
    } finally {
      try { await this.stop(child, true); }
      finally { if (this.active === job) this.active = null; }
    }
  }

  async cancel() {
    const job = this.active;
    if (!job) return;
    if (job.stopping) return job.stopping;
    job.cancelled = true;
    job.stopping = (async () => {
      try { await this.stop(job.child, true); }
      finally { job.finish(null); if (this.active === job) this.active = null; }
    })();
    return job.stopping;
  }
}

module.exports = { NativePicker };
