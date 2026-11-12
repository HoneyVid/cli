import { extname } from 'node:path';
import { generationInput, models } from './playground.mjs';
import { listSkills, installSkills } from './skills.mjs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Auth, login, logout } from './auth.mjs';
import { Api } from './api.mjs';
import { CliError } from './errors.mjs';
import { uploadVideo, addCharacter, downloadFile } from './files.mjs';
import { schema } from './schema.mjs';
import { edit, openEditor } from './edit.mjs';

/** @typedef {{id:string,status:'processing'|'completed'|'failed',credits:number,accountUrl:string,resultUrl?:string,kind?:'image',images?:string[]}} Job */

/** @param {unknown} data @param {string} base @returns {Job} */
function readJob(data, base) {
  if (!data || typeof data !== 'object' || !('job' in data) || !data.job || typeof data.job !== 'object' ||
      typeof data.job.id !== 'string' || !data.job.id || !('status' in data.job) ||
      !['queued', 'processing', 'completed', 'failed'].includes(data.job.status) ||
      typeof data.job.credits !== 'number' || !Number.isFinite(data.job.credits) ||
      ('kind' in data.job && !['video', 'image'].includes(data.job.kind)) ||
      ('images' in data.job && (!Array.isArray(data.job.images) || data.job.images.some(url => typeof url !== 'string'))) ||
      ('resultUrl' in data.job && data.job.resultUrl != null && typeof data.job.resultUrl !== 'string')) {
    throw new CliError('invalid_response', 'HoneyVid returned an invalid job.');
  }
  const accountUrl = new URL(data.job.kind === 'image' ? '/playground' : '/videos', base);
  if (data.job.kind === 'image') accountUrl.searchParams.set('mode', 'image');
  accountUrl.searchParams.set(data.job.kind === 'image' ? 'image_job' : 'job', data.job.id);
  // The live API exposes queued reservations before workflow dispatch begins.
  return { ...data.job, status: data.job.status === 'queued' ? 'processing' : data.job.status, accountUrl: accountUrl.href };
}

/** Keep app renditions and provider details out of the agent template list. */
function templateSummary(template, base) {
  const absolute = value => value ? new URL(value, base).href : value;
  return { id: template.id, title: template.title, category: template.category, durationSeconds: template.durationSeconds,
    qualities: template.qualities.map(({ id, label, credits }) => ({ id, label, credits })),
    posterUrl: absolute(template.posterUrl), previewUrl: absolute(template.previewUrl) };
}

/** @param {string} id */
function waitTimeout(id) {
  return new CliError('wait_timeout', `Job ${id} is still processing.`, 7,
    `Run honeyvid video ${id} --wait.`, true, { jobId: id });
}

/** @param {import('./api.mjs').Api} api @param {string} id @param {number=} deadline */
async function fetchJob(api, id, deadline) {
  try {
    if (deadline && Date.now() >= deadline) throw waitTimeout(id);
    return readJob(await api.request(`/api/jobs/${encodeURIComponent(id)}`, deadline ? { timeout: deadline - Date.now() } : {}), api.base);
  } catch (error) {
    if (deadline && Date.now() >= deadline && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw waitTimeout(id);
    throw error;
  }
}

/** @param {import('./api.mjs').Api} api @param {Job} initial @param {object} options @param {number=} deadline */
async function finishJob(api, initial, options, deadline = Date.now() + (options.timeout ?? 600) * 1000) {
  let job = initial;
  try {
    while (options.wait && job.status === 'processing') {
      console.error(`Job ${job.id}: processing`);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw waitTimeout(job.id);
      await delay(Math.min(5000, remaining));
      job = await fetchJob(api, job.id, deadline);
    }
    if (job.status === 'failed') throw new CliError('job_failed', `Job ${job.id} failed.`, 6,
      `Check honeyvid video ${job.id}.`, false);
    const result = { job };
    if (options.output) {
      if (job.status !== 'completed') throw new CliError('video_not_ready', 'The job is still processing.', 1,
        `Run honeyvid video ${job.id} --wait --output <path>.`, true);
      const urls = job.kind === 'image' && job.images?.length ? job.images : job.resultUrl ? [job.resultUrl] : [];
      if (!urls.length) throw new CliError('invalid_response', 'The completed job has no download URL.');
      result.paths = [];
      const extension = extname(options.output);
      const stem = extension ? options.output.slice(0, -extension.length) : options.output;
      for (const [index, url] of urls.entries()) {
        result.paths.push(await downloadFile(url, index === 0 ? options.output : `${stem}-${index + 1}${extension}`));
      }
      result.path = result.paths[0];
    }
    return result;
  } catch (error) {
    if (error instanceof CliError) error.details = { ...error.details, jobId: job.id };
    else throw new CliError('job_request_failed', 'Could not read or download the media.', 1,
      `Run honeyvid video ${job.id} --wait.`, true, { jobId: job.id });
    throw error;
  }
}

/** @param {string} base @param {string} target @param {boolean} apply */
async function setup(base, target, apply) {
  const url = `${base}/mcp`;
  const configurations = [];
  if (target === 'all' || target === 'claude') {
    const config = { target: 'claude', command: `claude mcp add --transport http honeyvid ${url}`, applied: false };
    if (apply) {
      const result = await new Promise(resolve => {
        const child = spawn('claude', ['mcp', 'add', '--transport', 'http', 'honeyvid', url], {
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
        });
        // Keep external tool output on stderr, so stdout remains exactly one envelope.
        child.stdout.pipe(process.stderr, { end: false });
        child.stderr.pipe(process.stderr, { end: false });
        child.once('error', error => resolve({ missing: error.code === 'ENOENT', error: true }));
        child.once('close', code => resolve({ code }));
      });
      if (result.missing) config.note = 'Claude is not on PATH. Run the printed command after installing Claude Code.';
      else if (result.error || result.code !== 0) throw new CliError('setup_failed', 'Claude MCP setup failed.', 1, 'Check stderr and run the printed Claude command.');
      else config.applied = true;
    }
    configurations.push(config);
  }
  if (target === 'all' || target === 'codex') configurations.push({ target: 'codex', path: '~/.codex/config.toml',
    config: `[mcp_servers.honeyvid]\nurl = ${JSON.stringify(url)}\n`, note: 'Add this block yourself; this CLI never edits config files.' });
  if (target === 'all' || target === 'cursor') configurations.push({ target: 'cursor', path: '~/.cursor/mcp.json',
    config: { mcpServers: { honeyvid: { url } } }, note: 'Merge this block yourself; this CLI never edits config files.' });
  return { url, configurations, next: 'honeyvid skills install' };
}


/** Paid submissions share replay-safe headers, output and error handling. */
async function submitJob(api, path, payload, options, idempotencyKey = options['idempotency-key'] || randomUUID()) {
  console.error(`Idempotency-Key: ${idempotencyKey}`);
  try {
    const data = await api.request(path, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey,
    }, body: () => JSON.stringify(payload) });
    return { ...await finishJob(api, readJob(data, api.base), options), idempotencyKey };
  } catch (error) {
    if (error instanceof CliError) error.details = { ...error.details, idempotencyKey };
    else throw new CliError('request_failed', 'The request could not be completed. Its outcome may be unknown.', 1,
      `Retry with --idempotency-key ${idempotencyKey} to avoid a second charge.`, true, { idempotencyKey });
    throw error;
  }
}

/** @param {string} command @param {string[]} args @param {object} options @param {string} base */
export async function run(command, args, options, base) {
  if (command === 'schema') return schema;
  if (command === 'setup') return setup(base, args[0] || 'all', Boolean(options.apply));
  if (command === 'skills list') return listSkills();
  if (command === 'skills install') return installSkills(options);
  if (command === 'logout') return logout(base);
  if (command === 'edit open') return openEditor(base, args[0], options);
  const auth = new Auth(base);
  const api = new Api(base, auth);
  if (command.startsWith('edit ')) return edit(command, args, options, api);
  if (command === 'login') {
    await login(base, { noBrowser: options['no-browser'], code: options.code, wait: options.wait, json: options.json });
    return api.request('/api/me');
  }
  if (command === 'auth export') return auth.exportToken();
  if (command === 'models') return models(api, options);
  if (command.startsWith('generate ')) {
    const kind = command.slice('generate '.length);
    const payload = generationInput(kind, options);
    if (options['dry-run']) return api.request('/api/playground/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: () => JSON.stringify({ kind, ...payload }),
    });
    return submitJob(api, kind === 'image' ? '/api/playground/images/jobs' : '/api/playground/jobs',
      { ...payload, maxCredits: options['max-credits'] }, options);
  }
  if (command === 'whoami') return api.request('/api/me');
  if (command === 'account') return { ...await api.request('/api/me'), topUpUrl: `${base}/pricing` };
  if (command === 'templates') {
    const result = await api.request('/api/templates');
    if (!Array.isArray(result.templates)) throw new CliError('invalid_response', 'HoneyVid returned an invalid template list.');
    const search = options.search?.toLowerCase();
    const category = options.category?.toLowerCase();
    return { templates: result.templates.filter(template =>
      (!search || `${template.title} ${template.category}`.toLowerCase().includes(search)) &&
      (!category || template.category.toLowerCase() === category)).slice(0, options.limit ?? 10).map(template => templateSummary(template, base)) };
  }
  if (command === 'template') {
    const { template } = await api.request(`/api/templates/${encodeURIComponent(args[0])}`);
    return { template: { ...templateSummary(template, base),
      ...(template.cardPreviewUrl ? { cardPreviewUrl: new URL(template.cardPreviewUrl, base).href } : {}),
      ...(template.previewHqUrl ? { previewHqUrl: new URL(template.previewHqUrl, base).href } : {}) } };
  }
  if (command === 'characters') return api.request('/api/characters');
  if (command === 'characters add') return addCharacter(api, { file: args[0], url: options.url, name: options.name });
  if (command === 'upload') return uploadVideo(api, args[0]);
  if (command === 'quote' || (command === 'create' && options['dry-run'])) {
    const query = new URLSearchParams({ quality: options.quality,
      ...(options.template ? { templateId: options.template } : { uploadId: options.upload }) });
    return api.request(`/api/jobs/quote?${query}`);
  }
  if (command === 'create' || command === 'retry') {
    const idempotencyKey = options['idempotency-key'] || randomUUID();
    const payload = command === 'retry' ? { maxCredits: options['max-credits'] } : {
      ...(options.template ? { templateId: options.template } : { uploadId: options.upload }),
      characterId: options.character, quality: options.quality, maxCredits: options['max-credits'],
    };
    const path = command === 'retry' ? `/api/jobs/${encodeURIComponent(args[0])}/retry` : '/api/jobs';
    return submitJob(api, path, payload, options, idempotencyKey);
  }
  if (command === 'video') {
    const deadline = options.wait ? Date.now() + (options.timeout ?? 600) * 1000 : undefined;
    return finishJob(api, await fetchJob(api, args[0], deadline), options, deadline);
  }
  if (command === 'videos') {
    const data = await api.request(options.kind ? `/api/jobs?kind=${options.kind}` : '/api/jobs');
    if (!Array.isArray(data.jobs)) throw new CliError('invalid_response', 'HoneyVid returned an invalid video list.');
    return { ...data, jobs: data.jobs.map(job => readJob({ job }, api.base)).filter(job => !options.status || job.status === options.status).slice(0, options.limit ?? 10) };
  }
  if (command === 'download') {
    const job = readJob(await api.request(`/api/jobs/${encodeURIComponent(args[0])}`), api.base);
    // Avoid using an untrusted job ID as a local pathname.
    const filename = `honeyvid-${job.id.replace(/[^A-Za-z0-9_-]/g, '_')}.${job.kind === 'image' ? 'png' : 'mp4'}`;
    const result = await finishJob(api, job, { output: options.output || filename });
    return { jobId: job.id, path: result.path, paths: result.paths };
  }
  throw new CliError('usage', 'Choose a command.', 2, 'Run honeyvid --help.');
}
