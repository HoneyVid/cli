import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { media, playgroundModels, template } from './fixtures';
import { cliHarness } from './harness';

cliHarness(h => {
  it('exposes machine-readable schema and help without login', async () => {
    const result = await h.runSpawn(['schema']);
    expect(result.code).toBe(0);
    expect(h.parse(result).ok).toBe(true);
    for (const command of ['login', 'templates', 'characters', 'create', 'retry', 'download', 'setup']) expect(result.stdout).toContain(command);
    const cli = resolve('bin/honeyvid.mjs');
    const alias = join(h.directory, 'honeyvid.mjs'); await symlink(cli, alias);
    expect(await h.runSpawn(['schema'], {}, [], alias)).toEqual(result);
    const packageAlias = join(h.directory, 'cli'); await symlink(resolve('.'), packageAlias, 'dir');
    expect(await h.runSpawn(['schema'], {}, ['--preserve-symlinks-main'], join(packageAlias, 'bin/honeyvid.mjs'))).toEqual(result);
    const help = await h.runSpawn(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('honeyvid');
  });
  it('returns JSON and exit 3 when not signed in', async () => {
    const result = await h.runSpawn(['whoami']);
    expect(result.code).toBe(3);
    expect(h.parse(result)).toMatchObject({ ok: false, error: { suggestion: expect.stringContaining('honeyvid login'), retryable: false } });
  });
  it('prints per-command help and MCP setup without signing in or editing config', async () => {
    const help = await h.run(['create', '--help']);
    expect(help.code).toBe(0);
    for (const text of ['--max-credits', 'Examples:', 'HONEYVID_TOKEN', 'Exit codes:']) expect(help.stdout).toContain(text);
    const result = await h.run(['setup', 'all']);
    expect(result.code).toBe(0);
    expect(h.parse(result).data).toMatchObject({
      url: `${h.base}/mcp`,
      next: 'honeyvid skills install',
      configurations: [
        { target: 'claude', command: `claude mcp add --transport http honeyvid ${h.base}/mcp`, applied: false },
        { target: 'codex', path: '~/.codex/config.toml', config: expect.stringContaining('[mcp_servers.honeyvid]') },
        { target: 'cursor', path: '~/.cursor/mcp.json', config: { mcpServers: { honeyvid: { url: `${h.base}/mcp` } } } },
      ],
    });
    await expect(stat(h.authPath())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(h.tokenRequests).toHaveLength(0);
  });
  it('lists filtered templates as JSON and fetches template detail', async () => {
    await h.login();
    const result = await h.run(['templates', '--json', '--search', 'honey', '--category', 'dance', '--limit', '1']);
    expect(result.code).toBe(0);
    const summary = { id: template.id, title: template.title, category: template.category, durationSeconds: 5,
      posterUrl: `${h.base}/media/t/poster.jpg`, previewUrl: `${h.base}/media/t/preview.mp4`,
      qualities: template.qualities.map(({ id, label, credits }) => ({ id, label, credits })) };
    expect(h.parse(result).data.templates).toEqual([summary]);
    const detail = await h.run(['template', 'dance']);
    expect(h.parse(detail).data.template).toEqual({ ...summary, cardPreviewUrl: `${h.base}/media/t/card.mp4`, previewHqUrl: template.previewHqUrl });
  });

  it.each([
    { status: 409, body: { error: 'Above price cap', credits: 12 }, code: 'price_above_max', exit: 5 },
    { status: 402, body: { error: 'Out of credits' }, code: 'insufficient_credits', exit: 5 },
    { status: 429, body: { error: 'Too many requests' }, code: 'rate_limited', exit: 5 },
    { status: 409, body: { error: 'Generation closed', code: 'generation_closed' }, code: 'generation_closed', exit: 5 },
    { status: 404, body: { error: 'Missing' }, code: 'not_found', exit: 4 },
    { status: 403, body: { error: 'No access' }, code: 'forbidden', exit: 1 },
  ])('maps HTTP $status to stable $code with exit $exit', async ({ status, body, code, exit }) => {
    await h.login();
    h.forcedError = { status, body };
    const result = await h.run(['whoami']);
    expect(result.code).toBe(exit);
    expect(h.parse(result).error.code).toBe(code);
  });
  it('quotes generation and lets dry-run skip job creation', async () => {
    await h.login();
    const quote = await h.run(['quote', '--template', 'dance', '--quality', 'high']);
    expect(quote.code).toBe(0);
    expect(h.parse(quote).data).toMatchObject({ credits: 24, quality: 'high', estimatedSeconds: 120, balance: 100 });
    const dry = await h.run(['create', '--template', 'dance', '--character', 'char-1', '--quality', 'standard', '--max-credits', '12', '--dry-run']);
    expect(dry.code).toBe(0);
    expect(h.parse(dry).data).toMatchObject({ credits: 12, quality: 'standard' });
    expect(h.jobPosts).toHaveLength(0);
  });
  it('returns exit 5 for price above max and prints its idempotency key', async () => {
    await h.login();
    const result = await h.run(['create', '--template', 'dance', '--character', 'char-1', '--quality', 'standard', '--max-credits', '1']);
    expect(result.code).toBe(5);
    expect(h.parse(result).ok).toBe(false);
    const key = h.parse(result).error.idempotencyKey;
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    if (h.jobPosts.length) expect(h.jobPosts[0].key).toBe(key);
  });
  it('normalizes newly queued videos to processing and can read their later completion', async () => {
    await h.login();
    h.queuedCreate = true;
    const created = await h.run(['create', '--template', 'dance', '--character', 'char-1', '--quality', 'standard', '--max-credits', '12']);
    expect(created.code, created.stdout).toBe(0);
    expect(h.parse(created).data.job).toMatchObject({ id: 'job-1', status: 'processing' });
    const listed = await h.run(['videos', '--status', 'processing']);
    expect(listed.code, listed.stdout).toBe(0);
    expect(h.parse(listed).data.jobs).toEqual([expect.objectContaining({ id: 'job-1', status: 'processing' })]);
    const completed = await h.run(['video', 'job-1', '--wait']);
    expect(completed.code).toBe(0);
    expect(h.parse(completed).data.job).toMatchObject({ id: 'job-1', status: 'completed' });
  });
  it('waits for completion and downloads to the requested file', async () => {
    await h.login();
    const output = join(h.directory, 'video.mp4');
    const result = await h.run(['create', '--template', 'dance', '--character', 'char-1', '--quality', 'standard', '--max-credits', '12', '--idempotency-key', 'agent-create-1', '--wait', '--timeout', '15', '--output', output]);
    expect(result.code, result.stdout || result.stderr).toBe(0);
    expect(h.parse(result).data.idempotencyKey).toBe('agent-create-1');
    expect(result.stdout).toContain('completed');
    expect(await readFile(output)).toEqual(media);
    expect(h.jobPosts).toEqual([{ path: '/api/jobs', key: 'agent-create-1', body: { templateId: 'dance', characterId: 'char-1', quality: 'standard', maxCredits: 12 } }]);
    expect(h.polls).toBeGreaterThan(0);
  }, 20_000);
  it('returns exit 7 on a wait deadline with a command to resume', async () => {
    await h.login();
    h.processingForever = true;
    const result = await h.run(['video', 'job-1', '--wait', '--timeout', '0.1']);
    expect(result.code).toBe(7);
    expect(h.parse(result)).toMatchObject({ ok: false, error: { retryable: true, suggestion: expect.stringContaining('honeyvid video job-1 --wait') } });
  });
  it.each([{ timeout: '0.5', completedPolls: 0 }, { timeout: '5.1', completedPolls: 1 }])('returns exit 7 when the wait deadline expires while reading a slow JSON response body', async ({ timeout, completedPolls }) => {
    await h.login();
    h.processingForever = true;
    h.slowJobBody = true;
    h.slowJobBodyAfter = completedPolls;
    const result = await h.run(['video', 'job-1', '--wait', '--timeout', timeout]);
    expect(result.code, result.stdout || result.stderr).toBe(7);
    expect(h.parse(result)).toMatchObject({ ok: false, error: { code: 'wait_timeout', message: 'Job job-1 is still processing.', retryable: true, suggestion: expect.stringContaining('honeyvid video job-1 --wait') } });
    expect(h.polls).toBe(completedPolls + 1);
  });
  it('maps missing videos to exit 4 and failed videos to exit 6', async () => {
    await h.login();
    const missing = await h.run(['video', 'missing']);
    expect(missing.code).toBe(4);
    expect(h.parse(missing)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    h.jobFailed = true;
    const failed = await h.run(['job', 'job-1', '--wait']);
    expect(failed.code).toBe(6);
    expect(h.parse(failed).ok).toBe(false);
  });
  it('sends MP4 uploads as raw video/mp4 with the exact content length', async () => {
    await h.login();
    const path = join(h.directory, 'source.mp4');
    await writeFile(path, media);
    const result = await h.run(['upload', path]);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data.upload).toMatchObject({ id: 'upload-1' });
    expect(h.uploads).toEqual([{ contentType: 'video/mp4', length: String(media.length), bytes: media }]);
  });
  it('lists characters and uploads a named image as multipart form data', async () => {
    await h.login();
    const listed = await h.run(['characters']);
    expect(listed.code).toBe(0);
    expect(h.parse(listed).data.characters).toEqual([{ id: 'char-1', name: 'Alex', imageUrl: 'https://example.test/alex.png' }]);
    const photo = join(h.directory, 'character.png');
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    await writeFile(photo, png);
    const added = await h.run(['characters', 'add', photo, '--name', 'Alex']);
    expect(added.code, added.stdout).toBe(0);
    expect(h.parse(added).data.character).toMatchObject({ id: 'char-1', name: 'Alex' });
    expect(h.characterUploads).toHaveLength(1);
    expect(h.characterUploads[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(h.characterUploads[0].bytes.includes(png)).toBe(true);
    expect(h.characterUploads[0].bytes.toString()).toContain('name="name"\r\n\r\nAlex');
  });
  it('rejects ambiguous sources, missing price caps, and invalid idempotency keys before creating', async () => {
    await h.login();
    for (const args of [
      ['quote', '--template', 'dance', '--upload', 'upload-1', '--quality', 'standard'],
      ['create', '--template', 'dance', '--character', 'char-1', '--quality', 'standard'],
      ['create', '--template', 'dance', '--character', 'char-1', '--quality', 'standard', '--max-credits', '12', '--idempotency-key', 'bad'],
    ]) {
      const result = await h.run(args);
      expect(result.code, result.stdout).toBe(2);
      expect(h.parse(result).ok).toBe(false);
    }
    expect(h.jobPosts).toHaveLength(0);
  });
  it('preserves a caller retry key and enforces maxCredits', async () => {
    await h.login();
    const result = await h.run(['retry', 'job-1', '--max-credits', '12', '--idempotency-key', 'agent-retry-1']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data.idempotencyKey).toBe('agent-retry-1');
    expect(h.jobPosts).toEqual([{ path: '/api/jobs/job-1/retry', key: 'agent-retry-1', body: { maxCredits: 12 } }]);
  });
  it('replays an unauthorized create with the same idempotency key', async () => {
    await h.login();
    h.unauthorizedOnce = true;
    const result = await h.run(['create', '--template', 'dance', '--character', 'char-1', '--quality', 'standard', '--max-credits', '12', '--idempotency-key', 'auth-replay-1']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.postKeys).toEqual(['auth-replay-1', 'auth-replay-1']);
    expect(h.jobPosts).toHaveLength(1);
    expect(h.tokenRequests.at(-1)?.get('grant_type')).toBe('refresh_token');
  });
  it('downloads a complete video without overwriting an existing output', async () => {
    await h.login();
    const output = join(h.directory, 'existing.mp4');
    await writeFile(output, 'keep this file');
    const result = await h.run(['download', 'job-1', '--output', output]);
    expect(result.code).toBe(1);
    expect(h.parse(result)).toMatchObject({ ok: false, error: { code: 'output_exists' } });
    expect(await readFile(output, 'utf8')).toBe('keep this file');
  });
  it('maps rate limits to exit 5 with Retry-After and no automatic replay', async () => {
    await h.login();
    h.rateLimited = true;
    const result = await h.run(['create', '--template', 'dance', '--character', 'char-1', '--quality', 'standard', '--max-credits', '12']);
    expect(result.code).toBe(5);
    expect(h.parse(result)).toMatchObject({ ok: false, error: { code: 'rate_limited', retryable: true, retryAfter: 60 } });
    expect(h.parse(result).error.idempotencyKey).toBe(h.jobPosts[0].key);
    expect(h.jobPosts).toHaveLength(1);
  });
  it('exports the refresh token with a stderr warning and logs out locally', async () => {
    await h.login();
    const result = await h.run(['auth', 'export']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('initial-refresh');
    expect(result.stderr.toLowerCase()).toContain('secret');
    expect((await h.run(['logout'])).code).toBe(0);
    expect((await h.run(['whoami'])).code).toBe(3);
  });
  it('lists models by kind, prints a compact terminal table, and returns full model fields', async () => {
    await h.login();
    const listed = await h.run(['models', '--kind', 'image']);
    expect(listed.code, listed.stdout).toBe(0);
    expect(h.parse(listed).data.models).toEqual([playgroundModels[1]]);
    const detail = await h.run(['models', '--model', 'video-model']);
    expect(h.parse(detail).data.model).toEqual(playgroundModels[0]);
    expect((await h.run(['models', '--model', 'missing'])).code).toBe(4);
    const bootstrap = join(h.directory, 'tty.mjs');
    await writeFile(bootstrap, "Object.defineProperty(process.stdout, 'isTTY', { value: true });\n");
    const table = await h.run(['models'], {}, ['--import', bootstrap]);
    expect(table.code).toBe(0);
    expect(table.stdout).toContain('IMAGES');
    expect(table.stdout).toContain('video-model');
    expect(table.stdout).not.toContain('"ok"');
    const explicitJson = await h.run(['models', '--json'], {}, ['--import', bootstrap]);
    expect(h.parse(explicitJson).data.models).toEqual(playgroundModels);
  });
  it('quotes Playground video settings and references without submitting or spending', async () => {
    await h.login();
    const result = await h.run(['generate', 'video', '--model', 'video-model', '--prompt', 'Honey river',
      '--set', 'duration=5', '--set', 'audio=true', '--set', 'aspect=16:9', '--image', 'char-1:start',
      '--video', 'upload:upload-1', '--max-credits', '12', '--dry-run']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toEqual({ credits: 12, balance: 100, estimatedSeconds: 120 });
    expect(h.playgroundQuotes).toEqual([{ kind: 'video', model: 'video-model', prompt: 'Honey river',
      settings: { duration: 5, audio: true, aspect: '16:9' }, images: [{ characterId: 'char-1', role: 'start' }],
      video: { source: 'upload', id: 'upload-1' } }]);
    expect(h.jobPosts).toHaveLength(0);
    expect(result.stderr).not.toContain('Idempotency-Key');
  });
  it('submits Playground video with typed settings, roles, source, cap and a stable replay key', async () => {
    await h.login();
    h.unauthorizedOnce = true;
    const result = await h.run(['generate', 'video', '--model', 'video-model', '--prompt', 'Honey river',
      '--set', 'duration=5', '--set', 'audio=false', '--set', 'guidance=2.5', '--set', 'seed=-1',
      '--set', 'ratio=16:9', '--set', 'strength=1e-2', '--set', 'title=hello=world',
      '--image', 'char-1:start', '--image', 'char-2:end', '--image', 'char-3:ref', '--image', 'char-4',
      '--video', 'template:dance', '--max-credits', '20', '--idempotency-key', 'playground-replay-1']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data.idempotencyKey).toBe('playground-replay-1');
    expect(result.stderr).toContain('Idempotency-Key: playground-replay-1');
    expect(h.postKeys).toEqual(['playground-replay-1', 'playground-replay-1']);
    expect(h.jobPosts).toEqual([{ path: '/api/playground/jobs', key: 'playground-replay-1', body: {
      model: 'video-model', prompt: 'Honey river', maxCredits: 20,
      settings: { duration: 5, audio: false, guidance: 2.5, seed: -1, ratio: '16:9', strength: 0.01, title: 'hello=world' },
      images: [{ characterId: 'char-1', role: 'start' }, { characterId: 'char-2', role: 'end' },
        { characterId: 'char-3', role: 'ref' }, { characterId: 'char-4' }], video: { source: 'template', id: 'dance' },
    } }]);
  });
  it('returns exit 5 and preserves the generated Playground key on maxCredits 409', async () => {
    await h.login();
    const result = await h.run(['generate', 'video', '--model', 'video-model', '--prompt', 'Honey', '--max-credits', '1']);
    expect(result.code).toBe(5);
    expect(h.parse(result).error.message).toBe('Price is 12 credits, above maxCredits 1');
    expect(h.parse(result).error.code).toBe('price_above_max');
    expect(h.parse(result).error.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(h.jobPosts[0].key).toBe(h.parse(result).error.idempotencyKey);
    expect(result.stderr).toContain(`Idempotency-Key: ${h.jobPosts[0].key}`);
    expect(h.jobPosts).toHaveLength(1);
  });
  it('generates images, waits, and downloads every image with numbered suffixes', async () => {
    await h.login();
    const output = join(h.directory, 'image.png');
    const result = await h.run(['generate', 'image', '--model', 'image-model', '--prompt', 'Honey jar',
      '--image', 'char-1', '--set', 'size=square', '--max-credits', '12', '--wait', '--output', output]);
    expect(result.code, result.stdout || result.stderr).toBe(0);
    expect(h.parse(result).data).toMatchObject({ job: { kind: 'image', images: [`${h.base}/result.png`, `${h.base}/second.png`] },
      path: output, paths: [output, join(h.directory, 'image-2.png')] });
    expect(await readFile(output, 'utf8')).toBe('first image');
    expect(await readFile(join(h.directory, 'image-2.png'), 'utf8')).toBe('second image');
    expect(h.jobPosts[0]).toEqual({ path: '/api/playground/images/jobs', key: h.parse(result).data.idempotencyKey, body: {
      model: 'image-model', prompt: 'Honey jar', images: [{ characterId: 'char-1' }], settings: { size: 'square' }, maxCredits: 12,
    } });
    expect(h.polls).toBe(1);
  }, 10_000);
  it('lists image jobs and reads or downloads them with the video command', async () => {
    await h.login();
    const listed = await h.run(['videos', '--kind', 'image']);
    expect(listed.code, listed.stdout).toBe(0);
    expect(h.parse(listed).data.jobs).toEqual([expect.objectContaining({ id: 'image-1', kind: 'image' })]);
    expect(h.jobQueries).toEqual(['?kind=image']);
    const output = join(h.directory, 'saved.png');
    const result = await h.run(['video', 'image-1', '--output', output]);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toMatchObject({ job: { images: [`${h.base}/result.png`, `${h.base}/second.png`] }, path: output });
    expect(await readFile(join(h.directory, 'saved-2.png'), 'utf8')).toBe('second image');
  });

  it('corrects JPEG image output extensions and reports every saved path', async () => {
    await h.login();
    h.imageContentType = 'image/jpeg; charset=binary';
    const requested = join(h.directory, 'photo.png');
    const paths = [join(h.directory, 'photo.jpg'), join(h.directory, 'photo-2.jpg')];
    const result = await h.run(['video', 'image-1', '--output', requested]);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toMatchObject({ path: paths[0], paths });
    expect(result.stderr).toContain(paths[0]);
    expect(result.stderr).toContain(paths[1]);
    expect(await readFile(paths[0], 'utf8')).toBe('first image');
    await expect(stat(requested)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('corrects video extensions and preserves files at the corrected destination', async () => {
    await h.login();
    const requested = join(h.directory, 'clip.png');
    const actual = join(h.directory, 'clip.mp4');
    const result = await h.run(['download', 'job-1', '--output', requested]);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toMatchObject({ path: actual, paths: [actual] });
    expect(result.stderr).toContain(actual);
    expect(await readFile(actual)).toEqual(media);
    const repeated = await h.run(['download', 'job-1', '--output', requested]);
    expect(h.parse(repeated).error.code).toBe('output_exists');
    expect(await readFile(actual)).toEqual(media);
    expect(await readdir(h.directory)).not.toContain(expect.stringMatching(/\.part$/));
  });

  it('rejects invalid Playground flags before any request', async () => {
    const common = ['--model', 'video-model', '--prompt', 'Honey', '--max-credits', '12'];
    for (const args of [
      ['generate', 'video', '--model', 'video-model', '--prompt', 'Honey'],
      ['generate', 'video', ...common, '--set', 'duration'],
      ['generate', 'video', ...common, '--set', 'x=1', '--set', 'x=2'],
      ['generate', 'video', ...common, '--set', 'x=1e999'],
      ['generate', 'video', ...common, '--image', 'char:wrong'],
      ['generate', 'video', ...common, '--video', 'bad:source'],
      ['generate', 'image', ...common, '--image', 'char:start'],
      ['generate', 'image', ...common, '--video', 'upload:source'],
      ['models', '--kind', 'audio'],
    ]) {
      const result = await h.run(args);
      expect(result.code, result.stdout).toBe(2);
    }
    expect(h.tokenRequests).toHaveLength(0);
    expect(h.jobPosts).toHaveLength(0);
    expect(h.playgroundQuotes).toHaveLength(0);
  });
  it('lists and installs bundled skills to both agents using HOME, preserving user files and edits', async () => {
    const listed = await h.run(['skills', 'list']);
    expect(listed.code, listed.stdout).toBe(0);
    expect(h.parse(listed).data.skills).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'honeyvid' })]));
    const home = join(h.directory, 'home');
    const installed = await h.run(['skills', 'install'], { HOME: home });
    expect(installed.code, installed.stdout).toBe(0);
    const claude = join(home, '.claude', 'skills', 'honeyvid', 'SKILL.md');
    const codex = join(home, '.codex', 'skills', 'honeyvid', 'SKILL.md');
    expect(h.parse(installed).data.paths).toEqual(expect.arrayContaining([claude, codex]));
    expect(await readFile(claude, 'utf8')).toBe(await readFile(codex, 'utf8'));
    await writeFile(claude, 'my edited skill');
    const custom = join(home, '.codex', 'skills', 'honeyvid', 'custom.txt');
    await writeFile(custom, 'my extra file');
    const again = await h.run(['skills', 'install', '--agent', 'all'], { HOME: home });
    expect(again.code, again.stdout).toBe(0);
    expect(h.parse(again).data.skipped).toContain(claude);
    expect(await readFile(claude, 'utf8')).toBe('my edited skill');
    expect(await readFile(custom, 'utf8')).toBe('my extra file');
    expect(h.parse(again).data.paths).toContain(codex);
    expect(h.tokenRequests).toHaveLength(0);
  });
  it('supports a custom skills root, preserves existing skills and refuses skill symlinks', async () => {
    const root = join(h.directory, 'custom-skills');
    await mkdir(join(root, 'honeyvid'), { recursive: true });
    const existing = join(root, 'honeyvid', 'SKILL.md');
    await writeFile(existing, 'user skill');
    const result = await h.run(['skills', 'install', '--dir', root]);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data.skipped).toContain(existing);
    expect(await readFile(existing, 'utf8')).toBe('user skill');
    const otherRoot = join(h.directory, 'linked-skills');
    await mkdir(otherRoot);
    await symlink(join(root, 'honeyvid'), join(otherRoot, 'honeyvid'));
    const linked = await h.run(['skills', 'install', '--dir', otherRoot]);
    expect(linked.code, linked.stdout).toBe(1);
    expect(h.parse(linked)).toMatchObject({ ok: false, error: { code: 'skills_conflict' } });
    expect(await readdir(otherRoot)).toEqual(['honeyvid']);
    expect(await readFile(existing, 'utf8')).toBe('user skill');
    const codexOnly = await h.run(['skills', 'install', '--agent', 'codex'], { HOME: join(h.directory, 'codex-only') });
    expect(codexOnly.code, codexOnly.stdout).toBe(0);
    await expect(stat(join(h.directory, 'codex-only', '.claude'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['.claude', '.claude/skills', '.codex/skills'])('refuses a symlinked default %s before writing either agent root', async relative => {
    const home = join(h.directory, 'linked-home');
    const outside = join(h.directory, 'outside');
    const link = join(home, relative);
    await mkdir(resolve(link, '..'), { recursive: true });
    await mkdir(outside);
    await symlink(outside, link);
    const result = await h.run(['skills', 'install'], { HOME: home });
    expect(result.code, result.stdout).toBe(1);
    expect(h.parse(result)).toMatchObject({ ok: false, error: { code: 'skills_conflict' } });
    expect(await readdir(outside)).toEqual([]);
    if (relative.startsWith('.codex')) await expect(stat(join(home, '.claude'))).rejects.toMatchObject({ code: 'ENOENT' });
    else await expect(stat(join(home, '.codex'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('allows an explicit symlinked root but refuses symlinked child ancestors before writing', async () => {
    const root = join(h.directory, 'explicit-root');
    const linked = join(h.directory, 'explicit-link');
    await mkdir(root);
    await symlink(root, linked);
    const installed = await h.run(['skills', 'install', '--dir', linked]);
    expect(installed.code, installed.stdout).toBe(0);
    const skill = join(root, 'honeyvid', 'SKILL.md');
    expect(await readFile(skill, 'utf8')).toContain('HoneyVid');
    const references = join(root, 'honeyvid-video-generation', 'references');
    const outside = join(h.directory, 'outside-references');
    await rm(references, { recursive: true });
    await mkdir(outside);
    await symlink(outside, references);
    const missingSkill = join(root, 'honeyvid-batch');
    await rm(missingSkill, { recursive: true });
    await writeFile(skill, 'unchanged before rejected install');
    const rejected = await h.run(['skills', 'install', '--dir', linked]);
    expect(rejected.code, rejected.stdout).toBe(1);
    expect(h.parse(rejected)).toMatchObject({ ok: false, error: { code: 'skills_conflict' } });
    expect(await readdir(outside)).toEqual([]);
    await expect(stat(missingSkill)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(skill, 'utf8')).toBe('unchanged before rejected install');
  });
});
