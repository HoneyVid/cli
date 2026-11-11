import { createReadStream, createWriteStream } from 'node:fs';
import { stat, readFile, mkdir, rm, link } from 'node:fs/promises';
import { basename, extname, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CliError, usage, safeUrl, apiError } from './errors.mjs';

const IMAGE_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 100 * 1024 * 1024;

/** @param {string} path @param {number} max */
async function fileInfo(path, max) {
  const info = await stat(path);
  if (!info.isFile() || !info.size || info.size > max) throw usage(`Use a nonempty file no larger than ${max / 1024 / 1024} MB.`);
  return info;
}

/** @param {import('./api.mjs').Api} api @param {string} path */
export async function uploadVideo(api, path) {
  const info = await fileInfo(path, VIDEO_LIMIT);
  if (extname(path).toLowerCase() !== '.mp4') throw usage('Upload an MP4 video (3–30 seconds).');
  return api.request('/api/uploads', { method: 'POST', headers: {
    'Content-Type': 'video/mp4', 'Content-Length': String(info.size),
  }, body: () => createReadStream(path), timeout: 120_000 });
}

/** @param {Uint8Array} bytes */
function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP') return 'image/webp';
  throw usage('Choose a PNG, JPG or WebP image under 10 MB.');
}

/** @param {string} input */
async function remoteImage(input) {
  const url = safeUrl(input);
  if (url.protocol !== 'https:') throw usage('--url requires HTTPS.');
  // Follow only HTTPS redirects, without ever forwarding HoneyVid credentials.
  let current = url;
  const signal = AbortSignal.timeout(30_000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(current, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new CliError('image_download', 'Image redirect has no location.');
      current = safeUrl(new URL(location, current));
      if (current.protocol !== 'https:') throw usage('Image redirects must use HTTPS.');
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw apiError(response, null); }
    if (Number(response.headers.get('content-length')) > IMAGE_LIMIT) {
      await response.body?.cancel(); throw usage('Use an image no larger than 10 MB.');
    }
    if (!response.body) throw new CliError('image_download', 'The image response was empty.');
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return Buffer.concat(chunks, length);
        length += value.length;
        if (length > IMAGE_LIMIT) throw usage('Use an image no larger than 10 MB.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
  }
  throw new CliError('image_download', 'The image URL redirected too many times.');
}

/** @param {import('./api.mjs').Api} api @param {{file?:string,url?:string,name:string}} input */
export async function addCharacter(api, { file, url, name }) {
  if (!name.trim() || name.trim().length > 60) throw usage('--name must contain 1–60 characters.');
  let bytes;
  if (file) { await fileInfo(file, IMAGE_LIMIT); bytes = await readFile(file); }
  else bytes = await remoteImage(url);
  const type = imageType(bytes);
  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), file ? basename(file) : `character.${type.split('/')[1]}`);
  form.set('name', name.trim());
  return api.request('/api/characters', { method: 'POST', body: () => form, timeout: 120_000 });
}

/** Downloads are atomic and never overwrite existing files. @param {string} url @param {string} output */
export async function downloadFile(url, output) {
  let temporary;
  try {
    // Result URLs are signed/public media URLs. Do not send the account bearer token.
    const response = await fetch(safeUrl(url), { signal: AbortSignal.timeout(120_000), redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw apiError(response, null); }
    if (!response.body) throw new CliError('download_failed', 'The video response was empty.');
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4' }[type];
    const supplied = extname(output);
    const matches = supplied.toLowerCase() === extension || (type === 'image/jpeg' && supplied.toLowerCase() === '.jpeg');
    const target = resolve(extension && !matches ? `${supplied ? output.slice(0, -supplied.length) : output}${extension}` : output);
    await mkdir(dirname(target), { recursive: true });
    temporary = `${target}.${randomBytes(8).toString('hex')}.part`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    await link(temporary, target);
    if (target !== resolve(output)) console.error(`Saved ${target} (${type}); corrected the output extension.`);
    return target;
  } catch (error) {
    if (error.code === 'EEXIST') throw new CliError('output_exists', 'The output file already exists.', 1, 'Choose a different --output path.');
    throw error;
  } finally { if (temporary) await rm(temporary, { force: true }); }
}
