import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from './errors.mjs';

const bundled = fileURLToPath(new URL('../skills/', import.meta.url));
const marker = '.honeyvid-cli.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function info(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

export async function listSkills() {
  const entries = await readdir(bundled, { withFileTypes: true });
  return { skills: entries.filter(entry => entry.isDirectory()).map(entry => ({
    name: entry.name, path: join(bundled, entry.name),
  })).sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Check every existing ancestor before creating anything; only an explicit root may follow symlinks. */
async function checkDirectory(path, explicitRoot) {
  if (path === explicitRoot) return;
  const parent = resolve(path, '..');
  if (parent !== path) await checkDirectory(parent, explicitRoot);
  const existing = await info(path);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new CliError('skills_conflict', `Refusing unsafe skills directory: ${path}.`, 1,
      'Choose another --dir or replace the symlink with a directory.');
  }
}

async function bundledFiles(path, prefix = '') {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await bundledFiles(join(path, entry.name), relative));
    else if (entry.isFile() && entry.name !== marker) files.push(relative);
  }
  return files;
}

async function ownership(path) {
  const existing = await info(path);
  if (!existing) return { exists: false, files: {} };
  if (existing.isFile() && !existing.isSymbolicLink()) {
    let data;
    try { data = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    if (data?.owner === 'honeyvid-cli' && data.files && typeof data.files === 'object' && !Array.isArray(data.files) &&
        Object.values(data.files).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
      return { exists: true, files: data.files };
    }
  }
  throw new CliError('skills_conflict', 'An unrecognized skills ownership file already exists.', 1,
    `Choose another --dir or inspect ${path}.`);
}

/** Only files created by this installer and unchanged since installation may be replaced. */
export async function installSkills(options) {
  const agents = !options.agent || options.agent === 'all' ? ['claude', 'codex'] : [options.agent];
  const roots = options.dir ? [resolve(options.dir)] : agents.map(agent => resolve(process.env.HOME || homedir(), `.${agent}`, 'skills'));
  const result = { paths: [], skipped: [] };
  const skills = await Promise.all((await listSkills()).skills.map(async skill => ({ ...skill, files: await bundledFiles(skill.path) })));
  // Preflight all roots and bundled paths so a later symlink cannot leave a partial installation.
  for (const root of roots) {
    await checkDirectory(root, options.dir ? root : undefined);
    for (const skill of skills) {
      for (const relative of [marker, ...skill.files]) {
        await checkDirectory(resolve(root, skill.name, relative, '..'), options.dir ? root : undefined);
      }
    }
  }
  for (const root of roots) {
    await mkdir(root, { recursive: true });
    for (const skill of skills) {
      const target = join(root, skill.name);
      await mkdir(target, { recursive: true });
      const manifestPath = join(target, marker);
      const owned = await ownership(manifestPath);
      const files = { ...owned.files };
      for (const relative of skill.files) {
        const destination = join(target, relative);
        const parent = resolve(destination, '..');
        await mkdir(parent, { recursive: true });
        const existing = await info(destination);
        if (existing && (!existing.isFile() || existing.isSymbolicLink() || !Object.hasOwn(files, relative) ||
            hash(await readFile(destination)) !== files[relative])) {
          result.skipped.push(destination);
          continue;
        }
        const bytes = await readFile(join(skill.path, relative));
        await writeFile(destination, bytes, { flag: existing ? 'w' : 'wx' });
        files[relative] = hash(bytes);
        result.paths.push(destination);
      }
      await writeFile(manifestPath, `${JSON.stringify({ owner: 'honeyvid-cli', files })}\n`, { flag: owned.exists ? 'w' : 'wx' });
    }
  }
  return result;
}
