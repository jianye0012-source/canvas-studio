import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const downloadBase = process.env.DOMESTIC_UPDATE_BASE_URL?.trim() || '';
if (downloadBase) {
  const url = new URL(downloadBase);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) {
    throw new Error('DOMESTIC_UPDATE_BASE_URL must be a public HTTPS directory ending with /');
  }
}
const releases = [];
for (const release of JSON.parse(readFileSync(0, 'utf8')).flat()) {
  if (release.draft || release.prerelease || !release.published_at || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) continue;
  const name = `CanvasStudio-Windows-x64-${release.tag_name.slice(1)}.zip`;
  const zip = release.assets.find(asset => asset.name === name && asset.state === 'uploaded');
  if (!zip || !/^sha256:[a-f0-9]{64}$/.test(zip.digest) || !release.assets.some(asset => asset.name === name + '.sha256' && asset.state === 'uploaded')) continue;
  releases.push({ tag_name: release.tag_name, published_at: release.published_at, body: (release.body || '').slice(0, 4000), size: zip.size, sha256: zip.digest.slice(7) });
}
if (!releases.length) throw new Error('No complete Windows release to publish');

const key = createPrivateKey({ key: Buffer.from(process.env.UPDATE_INDEX_SIGNING_KEY || '', 'base64'), format: 'der', type: 'pkcs8' });
const body = Buffer.from(JSON.stringify({ format: 1, generatedAt: new Date().toISOString(), downloadBase, releases }));
process.stdout.write(JSON.stringify({ body: body.toString('base64'), signature: sign(null, body, key).toString('base64') }) + '\n');
