import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const release = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';
const digests = { linux: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99', win32: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00' };
export async function mediaRuntime(sourceRoot, bundle, platform) {
  const asset = `ffmpeg-${platform}-x64`, file = path.join(sourceRoot, 'work/cache', asset);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.access(file); } catch { const response = await fetch(release + asset); if (!response.ok) throw Error('视频运行环境下载失败'); await pipeline(response.body, createWriteStream(file)); }
  const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== digests[platform]) throw Error('视频运行环境校验失败');
  await fs.copyFile(file, path.join(bundle, 'runtime', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')); await fs.chmod(path.join(bundle, 'runtime', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), 0o755);
  const notices = path.join(bundle, 'runtime', 'ffmpeg-notices'); await fs.mkdir(notices, { recursive: true });
  for (const extension of ['LICENSE', 'README']) { const response = await fetch(release + `${platform}-x64.${extension}`); if (!response.ok) throw Error('视频运行环境许可下载失败'); await fs.writeFile(path.join(notices, extension + '.txt'), await response.text()); }
  await fs.writeFile(path.join(notices, 'SOURCE.txt'), `Redistributed from https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1\nExact binary build, versions, external libraries and upstream source: see README.txt.\nWindows source commit: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93\nWindows FFmpeg source: https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz\nLinux FFmpeg source: https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz\n`);
}
