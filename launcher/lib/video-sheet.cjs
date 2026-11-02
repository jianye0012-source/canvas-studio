const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { writableDirectory } = require('./files.cjs');
function ffmpeg(executable, args, signal) {
  return new Promise((resolve, reject) => execFile(executable, ['-nostdin', '-hide_banner', '-threads', '2', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,ogg', ...args], { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer', signal }, (error, stdout, stderr) => error ? reject(Object.assign(error, { diagnostics: stderr.toString() })) : resolve({ stdout, stderr: stderr.toString() })));
}
async function videoSheet(req, res, { root, dataDir }) {
  await writableDirectory(dataDir);
  const dir = await fs.mkdtemp(path.join(dataDir, 'tmp', 'video-'));
  const controller = new AbortController(); const abort = () => controller.abort(); req.once('aborted', abort); res.once('close', abort);
  try {
    let size = 0;
    const limit = new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > 1024 ** 3 ? new Error('视频超过 1 GB，请截取所需片段后再附加') : null, chunk); } });
    const input = path.join(dir, 'input.media'); await pipeline(req, limit, createWriteStream(input), { signal: controller.signal });
    const executable = path.join(root, 'runtime', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    let info;
    try { info = await ffmpeg(executable, ['-i', input, '-map', '0:v:0', '-t', '0', '-f', 'null', '-'], controller.signal); }
    catch (error) { if (error.code === 'ENOENT') throw new Error('视频运行文件缺失，请在启动器中导入新版整合包修复'); throw new Error('视频无法解码：文件可能损坏、没有视频轨或格式不受支持'); }
    const match = info.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
    if (!duration || duration > 36000) throw new Error('视频时长无法读取或超过 10 小时，请截取片段');
    const result = await ffmpeg(executable, ['-i', input, '-map', '0:v:0', '-an', '-vf', `fps=${9 / duration},scale=480:480:force_original_aspect_ratio=decrease,pad=480:480:(ow-iw)/2:(oh-ih)/2,tile=3x3`, '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe', '-'], controller.signal);
    if (!result.stdout.length) throw new Error('视频没有可用画面');
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-video-duration': String(duration) }); res.end(result.stdout);
  } finally { req.off('aborted', abort); res.off('close', abort); await fs.rm(dir, { recursive: true, force: true }); }
}
module.exports = { videoSheet };
