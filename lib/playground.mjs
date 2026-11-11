import { CliError, usage } from './errors.mjs';

/** Parse repeatable flags before making any request. */
export function generationInput(kind, options) {
  const settings = Object.create(null);
  for (const entry of options.set || []) {
    const equal = entry.indexOf('=');
    if (equal < 1) throw usage('--set needs key=value.');
    const key = entry.slice(0, equal);
    const value = entry.slice(equal + 1);
    if (!key.trim() || Object.hasOwn(settings, key)) throw usage(`Invalid or duplicate setting: ${key}`);
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
    if (numeric && !Number.isFinite(Number(value))) throw usage(`Invalid number for setting: ${key}`);
    settings[key] = value === 'true' ? true : value === 'false' ? false : numeric ? Number(value) : value;
  }
  const images = (options.image || []).map(value => {
    const parts = value.split(':');
    if (!parts[0].trim() || parts.length > (kind === 'video' ? 2 : 1) ||
        (parts.length === 2 && !['start', 'end', 'ref'].includes(parts[1]))) {
      throw usage(kind === 'video' ? '--image needs characterId[:start|end|ref].' : '--image needs a character ID without a role.');
    }
    return { characterId: parts[0], ...(parts[1] ? { role: parts[1] } : {}) };
  });
  let video;
  if (options.video) {
    const match = /^(upload|template):([^:]+)$/.exec(options.video);
    if (!match || !match[2].trim()) throw usage('--video needs upload:<id> or template:<id>.');
    video = { source: match[1], id: match[2] };
  }
  return { model: options.model, prompt: options.prompt, settings, images, ...(video ? { video } : {}) };
}

export async function models(api, options) {
  const data = await api.request('/api/playground/models');
  if (!Array.isArray(data.models) || data.models.some(model => !model || typeof model.id !== 'string' ||
      typeof model.name !== 'string' || !['video', 'image'].includes(model.kind) ||
      !Array.isArray(model.fields) || !model.images || typeof model.images.max !== 'number' ||
      !model.prompt || typeof model.prompt.max !== 'number' || typeof model.prompt.required !== 'boolean')) {
    throw new CliError('invalid_response', 'HoneyVid returned an invalid model list.');
  }
  const available = data.models.filter(model => !options.kind || model.kind === options.kind);
  if (!options.model) return { models: available };
  const model = available.find(model => model.id === options.model);
  if (!model) throw new CliError('not_found', 'The requested model is unavailable.', 4, 'Run honeyvid models to see available IDs.');
  return { model };
}

/** A compact terminal view; piped output always uses the JSON envelope. */
export function modelTable(models) {
  const rows = [['ID', 'KIND', 'NAME', 'IMAGES', 'DESCRIPTION'], ...models.map(model => [
    model.id, model.kind, model.name, String(model.images.max), model.description || '',
  ])].map(row => row.map(value => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')));
  const widths = [0, 1, 2, 3].map(index => Math.max(...rows.map(row => row[index].length)));
  return `${rows.map(row => row.map((value, index) => index < 4 ? value.padEnd(widths[index]) : value).join('  ').trimEnd()).join('\n')}\n`;
}
