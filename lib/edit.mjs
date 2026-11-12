import { readFile } from 'node:fs/promises';
import { openBrowser } from './auth.mjs';
import { CliError, usage } from './errors.mjs';

const MAX_OPS = 50;
const MAX_BODY = 64 * 1024;
const MAX_NOTE = 140;

/** @param {string} base @param {string} id */
export const watchUrl = (base, id) => `${base}/editor/${encodeURIComponent(id)}`;
const path = (id, suffix = '') => `/api/edits/${encodeURIComponent(id)}${suffix}`;
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: () => body });

/** Read --ops from inline JSON, @file or - (stdin). @param {string} value */
async function readOps(value) {
  let text = value;
  if (value === '-') {
    // Never wait on a person typing at a terminal.
    if (process.stdin.isTTY) throw usage('--ops - needs ops piped on stdin.');
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    text = Buffer.concat(chunks).toString('utf8');
  } else if (value.startsWith('@')) {
    try { text = await readFile(value.slice(1), 'utf8'); }
    catch { throw usage(`Cannot read the --ops file ${value.slice(1)}.`); }
  }
  let ops;
  try { ops = JSON.parse(text); } catch { throw usage('--ops must be valid JSON: an op object or an array of ops.'); }
  if (ops && typeof ops === 'object' && !Array.isArray(ops) && Array.isArray(ops.ops)) ops = ops.ops;
  if (!Array.isArray(ops)) ops = [ops];
  if (!ops.length || ops.length > MAX_OPS) throw usage(`--ops needs 1–${MAX_OPS} ops.`);
  for (const [index, op] of ops.entries()) {
    if (!op || typeof op !== 'object' || Array.isArray(op) || typeof op.type !== 'string') {
      throw new CliError('usage', `Each op needs a string type (ops[${index}]).`, 2, 'Run honeyvid edit apply --help.', false, { index });
    }
  }
  return ops;
}

/** Explain edit-specific API failures so an agent knows the next step. @param {string} id */
function editFailure(error, base, id) {
  if (!(error instanceof CliError)) throw error;
  const body = error.body && typeof error.body === 'object' ? error.body : {};
  if (error.code === 'stale') {
    error.message = `Project ${id} changed${Number.isFinite(body.version) ? ` (now version ${body.version})` : ''}. Nothing was written.`;
    error.suggestion = `Run honeyvid edit show ${id}, then apply again with the new --base-version.`;
    error.retryable = true;
    if (Number.isFinite(body.version)) error.details = { ...error.details, version: body.version };
  } else if (error.code === 'rate_limited') {
    const seconds = error.details.retryAfter;
    if (seconds !== undefined) error.message = `${error.message.replace(/[.!]?$/, '.')} Retry after ${seconds} seconds.`;
    error.suggestion = 'Wait for retryAfter seconds, then send the same ops again. Batch ops into fewer requests.';
  } else if (Number.isInteger(body.index)) {
    error.code = 'invalid_op';
    if (!error.message.includes(`ops[${body.index}]`)) error.message += ` (ops[${body.index}])`;
    error.suggestion = `Fix ops[${body.index}] and apply again; nothing was written.`;
    error.details = { ...error.details, index: body.index };
  }
  error.details = { ...error.details, projectId: id, watchUrl: watchUrl(base, id) };
  throw error;
}

/** @param {import('./api.mjs').Api} api @param {string} id @param {object[]} ops @param {{baseVersion?:number,note?:string}} extra */
async function applyOps(api, id, ops, { baseVersion, note } = {}) {
  const body = JSON.stringify({ ops, ...(baseVersion === undefined ? {} : { baseVersion }), ...(note ? { note } : {}) });
  if (Buffer.byteLength(body) > MAX_BODY) throw usage('The ops request is over 64 KB; split it into smaller applies.');
  try {
    const data = await api.request(path(id, '/actions'), json(body));
    if (!Number.isInteger(data.version)) throw new CliError('invalid_response', 'HoneyVid returned an invalid edit result.');
    return { version: data.version, summaries: Array.isArray(data.summaries) ? data.summaries : [],
      changed: data.changed ?? { clipIds: [], trackIds: [] } };
  } catch (error) { return editFailure(error, api.base, id); }
}

/** @param {string} value @param {string} flag */
function checkNote(value, flag) {
  if (!value.trim() || value.length > MAX_NOTE) throw usage(`${flag} must contain 1–${MAX_NOTE} characters.`);
}

/** @param {string} command @param {string[]} args @param {object} options @param {import('./api.mjs').Api} api */
export async function edit(command, args, options, api) {
  const base = api.base;
  const [id] = args;
  if (command === 'edit list') {
    const data = await api.request('/api/edits');
    const projects = data.projects ?? data.edits;
    if (!Array.isArray(projects)) throw new CliError('invalid_response', 'HoneyVid returned an invalid edit project list.');
    return { projects: projects.map(project => ({ ...project, watchUrl: watchUrl(base, String(project.id)) })) };
  }
  if (command === 'edit create') {
    if (!options.name.trim()) throw usage('--name must not be empty.');
    const data = await api.request('/api/edits', json(JSON.stringify({ name: options.name.trim() })));
    const project = data.project ?? data;
    if (!project || (typeof project.id !== 'string' && typeof project.id !== 'number')) {
      throw new CliError('invalid_response', 'HoneyVid returned an invalid edit project.');
    }
    const projectId = String(project.id);
    const result = { projectId, project, watchUrl: watchUrl(base, projectId) };
    if (!options.sourceKeys.length) return { ...result, version: project.version, summaries: [] };
    try {
      return { ...result, ...await applyOps(api, projectId, options.sourceKeys.map(key => ({ type: 'add_clip', key }))) };
    } catch (error) {
      if (error instanceof CliError) error.suggestion = `The project was created without clips. ${error.suggestion}`;
      throw error;
    }
  }
  if (command === 'edit show') {
    try {
      const data = await api.request(path(id));
      return { ...data, watchUrl: watchUrl(base, id) };
    } catch (error) { return editFailure(error, base, id); }
  }
  if (command === 'edit apply') {
    if (options.note !== undefined) checkNote(options.note, '--note');
    const ops = await readOps(options.ops);
    return { projectId: id, ...await applyOps(api, id, ops, { baseVersion: options['base-version'], note: options.note }),
      watchUrl: watchUrl(base, id) };
  }
  if (command === 'edit note') {
    checkNote(args[1], 'The message');
    try {
      await api.request(path(id, '/notes'), json(JSON.stringify({ message: args[1], ...(options.tone ? { tone: options.tone } : {}) })));
    } catch (error) { return editFailure(error, base, id); }
    return { projectId: id, sent: true, watchUrl: watchUrl(base, id) };
  }
  throw usage('Choose an edit command.');
}

/** Print the watch URL and open it only for a person at a terminal. @param {string} base @param {string} id @param {object} options */
export async function openEditor(base, id, options) {
  const url = watchUrl(base, id);
  let opened = false;
  if (process.stdout.isTTY && !options.json && !options['no-browser'] && !(process.platform === 'linux' && !process.env.DISPLAY)) {
    try { await openBrowser(url); opened = true; }
    catch { console.error('Could not open the browser. Open the watch URL yourself.'); }
  }
  return { projectId: id, watchUrl: url, opened };
}

const seconds = value => Number.isFinite(value) ? `${Math.round(value * 1000) / 1000}s` : '-';

/** Terminal view of edit show: tracks and their clips with ids and times in seconds. @param {Record<string, any>} data */
export function editTable(data) {
  const project = data.project && typeof data.project === 'object' ? data.project : data;
  const doc = project.doc ?? data.doc ?? {};
  const tracks = Array.isArray(doc.tracks) ? doc.tracks : [];
  const clips = Array.isArray(doc.clips) ? doc.clips : [];
  const lines = [`Project ${project.id ?? ''}${project.name ? ` "${project.name}"` : ''} · version ${project.version ?? data.version ?? '?'}` +
    `${Number.isFinite(project.seconds ?? doc.seconds) ? ` · ${seconds(project.seconds ?? doc.seconds)}` : ''}`, `Watch: ${data.watchUrl}`];
  for (const track of tracks) {
    const own = Array.isArray(track.clips) ? track.clips : clips.filter(clip => (clip.track ?? clip.trackId) === track.id);
    const level = `${track.muted ? ' muted' : ''}${Number.isFinite(track.volume) && track.volume !== 1 ? ` volume ${track.volume}` : ''}`;
    lines.push('', `Track ${track.id}${track.kind ? ` (${track.kind})` : ''}${level}`);
    if (!own.length) lines.push('  (empty)');
    for (const clip of [...own].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
      lines.push(`  clip ${String(clip.id).padEnd(5)} at ${seconds(clip.at).padEnd(8)} start ${seconds(clip.start).padEnd(8)} end ${seconds(clip.end).padEnd(8)} ${clip.key ?? ''}`);
    }
  }
  if (!tracks.length) lines.push('', 'No tracks yet. Add clips with honeyvid edit apply.');
  return `${lines.join('\n')}\n`;
}
