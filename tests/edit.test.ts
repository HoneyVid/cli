import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { editDoc, editProject } from './fixtures';
import { cliHarness } from './harness';

cliHarness(h => {
  const watch = (id = 'edit-1') => `${h.base}/editor/${id}`;
  const splitOp = { type: 'split', clip: 1, at: 2.5 };

  it('documents the edit commands in schema and per-command help', async () => {
    const schema = await h.run(['schema']);
    const commands = h.parse(schema).data.commands as Record<string, unknown>;
    for (const name of ['edit list', 'edit create', 'edit show', 'edit apply', 'edit note', 'edit open']) expect(commands).toHaveProperty([name]);
    const help = await h.run(['edit', 'apply', '--help']);
    expect(help.code).toBe(0);
    for (const text of ['--ops', '--base-version', '--note', 'add_clip', 'watchUrl', 'export the MP4']) expect(help.stdout).toContain(text);
  });

  it('lists projects with a watch URL each', async () => {
    await h.login();
    const result = await h.run(['edit', 'list']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toEqual({ projects: [{ ...editProject, watchUrl: watch() }] });
  });

  it('creates a project and appends --video and --source keys in flag order with one actions call', async () => {
    await h.login();
    const result = await h.run(['edit', 'create', '--name', ' Launch cut ', '--source', 'character:char-1', '--video', 'job-1',
      '--source', 'image:image-1:0']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toMatchObject({ projectId: 'edit-1', version: 4, watchUrl: watch(),
      summaries: ['add_clip 0', 'add_clip 1', 'add_clip 2'], changed: { clipIds: [3], trackIds: [1] } });
    expect(h.editPosts).toEqual([
      { path: '/api/edits', body: { name: 'Launch cut' } },
      { path: '/api/edits/edit-1/actions', body: { ops: [
        { type: 'add_clip', key: 'character:char-1' }, { type: 'add_clip', key: 'job:job-1' }, { type: 'add_clip', key: 'image:image-1:0' },
      ] } },
    ]);
  });

  it('creates an empty project without an actions call', async () => {
    await h.login();
    const result = await h.run(['edit', 'create', '--name', 'Empty']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toMatchObject({ projectId: 'edit-1', version: 1, summaries: [], watchUrl: watch() });
    expect(h.editPosts.map(post => post.path)).toEqual(['/api/edits']);
  });

  it('reports the created project when appending sources fails', async () => {
    await h.login();
    h.editError = { status: 400, body: { error: 'Source not found (ops[1])', index: 1 } };
    const result = await h.run(['edit', 'create', '--name', 'Cut', '--video', 'job-1', '--video', 'missing']);
    expect(result.code).toBe(1);
    expect(h.parse(result).error).toMatchObject({ code: 'invalid_op', index: 1, projectId: 'edit-1', watchUrl: watch(),
      suggestion: expect.stringContaining('created without clips') });
  });

  it('shows the full state as JSON and tracks with clip times in a terminal', async () => {
    await h.login();
    const result = await h.run(['edit', 'show', 'edit-1']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toEqual({ project: { ...editProject, doc: editDoc }, watchUrl: watch() });
    const bootstrap = join(h.directory, 'tty.mjs');
    await writeFile(bootstrap, "Object.defineProperty(process.stdout, 'isTTY', { value: true });\n");
    const table = await h.run(['edit', 'show', 'edit-1'], {}, ['--import', bootstrap]);
    expect(table.code, table.stdout).toBe(0);
    expect(table.stdout).not.toContain('"ok"');
    for (const text of ['Project edit-1 "Launch cut" · version 3 · 7.5s', `Watch: ${watch()}`, 'Track 1', 'Track 2 muted volume 0.5']) {
      expect(table.stdout).toContain(text);
    }
    const lines = table.stdout.split('\n');
    const clip = (id: number) => lines.findIndex(line => line.trim().startsWith(`clip ${id} `));
    expect(clip(1)).toBeLessThan(clip(2));
    expect(lines[clip(3)]).toMatch(/at 0s\s+start 1\.25s\s+end 5s\s+job:job-1/);
    const missing = await h.run(['edit', 'show', 'missing']);
    expect(missing.code).toBe(4);
    expect(h.parse(missing).error).toMatchObject({ code: 'not_found', projectId: 'missing', watchUrl: watch('missing') });
  });

  it('applies inline ops with base version and note, and prints summaries and the new version', async () => {
    await h.login();
    const result = await h.run(['edit', 'apply', 'edit-1', '--ops', JSON.stringify([splitOp, { type: 'delete', clips: [2] }]),
      '--base-version', '3', '--note', 'Tightened the intro']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toEqual({ projectId: 'edit-1', version: 4, summaries: ['split 0', 'delete 1'],
      changed: { clipIds: [3], trackIds: [1] }, watchUrl: watch() });
    expect(h.editPosts).toEqual([{ path: '/api/edits/edit-1/actions', body: { ops: [splitOp, { type: 'delete', clips: [2] }], baseVersion: 3, note: 'Tightened the intro' } }]);
  });

  it('reads ops from a file, a single op object or {ops}', async () => {
    await h.login();
    const file = join(h.directory, 'ops.json');
    await writeFile(file, JSON.stringify({ ops: [splitOp] }));
    expect((await h.run(['edit', 'apply', 'edit-1', '--ops', `@${file}`])).code).toBe(0);
    expect((await h.run(['edit', 'apply', 'edit-1', '--ops', JSON.stringify(splitOp)])).code).toBe(0);
    expect(h.editPosts.map(post => post.body)).toEqual([{ ops: [splitOp] }, { ops: [splitOp] }]);
  });

  it('reads ops from stdin', async () => {
    await h.login();
    const result = await new Promise<{ code: number | null; stdout: string }>((complete, reject) => {
      const child = spawn(process.execPath, [resolve('bin/honeyvid.mjs'), 'edit', 'apply', 'edit-1', '--ops', '-'], {
        env: { ...process.env, HONEYVID_TOKEN: '', HONEYVID_URL: h.base, XDG_CONFIG_HOME: h.directory }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.on('error', reject);
      child.on('close', code => complete({ code, stdout }));
      child.stdin.end(JSON.stringify([splitOp]));
    });
    expect(result.code, result.stdout).toBe(0);
    expect(h.editPosts).toEqual([{ path: '/api/edits/edit-1/actions', body: { ops: [splitOp] } }]);
  });

  it('rejects invalid edit input before any request', async () => {
    await h.login();
    const tooMany = JSON.stringify(Array.from({ length: 51 }, () => splitOp));
    const huge = JSON.stringify([{ type: 'add_clip', key: `file:${'x'.repeat(70_000)}` }]);
    for (const args of [
      ['edit', 'apply', 'edit-1', '--ops', 'not json'],
      ['edit', 'apply', 'edit-1', '--ops', '[]'],
      ['edit', 'apply', 'edit-1', '--ops', tooMany],
      ['edit', 'apply', 'edit-1', '--ops', huge],
      ['edit', 'apply', 'edit-1', '--ops', '[{"clip":1}]'],
      ['edit', 'apply', 'edit-1', '--ops', `@${join(h.directory, 'missing.json')}`],
      ['edit', 'apply', 'edit-1', '--ops', '[]', '--base-version', '-1'],
      ['edit', 'apply', 'edit-1', '--ops', JSON.stringify([splitOp]), '--note', 'x'.repeat(141)],
      ['edit', 'apply', 'edit-1'],
      ['edit', 'create'],
      ['edit', 'create', '--name', 'Cut', '--source', 'upload:1'],
      ['edit', 'note', 'edit-1', 'hi', '--tone', 'loud'],
      ['edit', 'note', 'edit-1', 'x'.repeat(141)],
      ['edit', 'show'],
      ['generate', 'video', '--model', 'video-model', '--prompt', 'Honey', '--max-credits', '1', '--video', 'upload:a', '--video', 'upload:b'],
    ]) {
      const result = await h.run(args);
      expect(result.code, `${args.join(' ')}: ${result.stdout}`).toBe(2);
    }
    expect(h.editPosts).toHaveLength(0);
    expect(h.jobPosts).toHaveLength(0);
  });

  it('turns a stale base version into exit 5 telling the agent to re-run show', async () => {
    await h.login();
    h.editError = { status: 409, body: { error: 'Version changed', code: 'stale', version: 7 } };
    const result = await h.run(['edit', 'apply', 'edit-1', '--ops', JSON.stringify([splitOp]), '--base-version', '3']);
    expect(result.code).toBe(5);
    expect(h.parse(result).error).toMatchObject({ code: 'stale', retryable: true, version: 7, projectId: 'edit-1', watchUrl: watch(),
      message: expect.stringContaining('version 7'), suggestion: expect.stringContaining('honeyvid edit show edit-1') });
  });

  it.each([
    { headers: { 'retry-after': '42' }, body: { error: 'Too many edit ops' }, retryAfter: 42 },
    { headers: {}, body: { error: 'Too many edit ops', retryAfter: 9 }, retryAfter: 9 },
  ])('maps 429 to exit 5 with Retry-After $retryAfter in the message', async ({ headers, body, retryAfter }) => {
    await h.login();
    h.editError = { status: 429, body, headers };
    const result = await h.run(['edit', 'apply', 'edit-1', '--ops', JSON.stringify([splitOp])]);
    expect(result.code).toBe(5);
    expect(h.parse(result).error).toMatchObject({ code: 'rate_limited', retryable: true, retryAfter,
      message: `Too many edit ops. Retry after ${retryAfter} seconds.` });
    expect(h.editPosts).toHaveLength(1);
  });

  it('prints the failing op index on 400', async () => {
    await h.login();
    h.editError = { status: 400, body: { error: 'Clip 9 does not exist (ops[1])', index: 1 } };
    const result = await h.run(['edit', 'apply', 'edit-1', '--ops', JSON.stringify([splitOp, { type: 'delete', clips: [9] }])]);
    expect(result.code).toBe(1);
    expect(h.parse(result).error).toMatchObject({ code: 'invalid_op', index: 1, message: 'Clip 9 does not exist (ops[1])',
      suggestion: expect.stringContaining('ops[1]') });
    h.editError = { status: 400, body: { error: 'Bad op', index: 0 } };
    const bare = await h.run(['edit', 'apply', 'edit-1', '--ops', JSON.stringify([splitOp])]);
    expect(h.parse(bare).error).toMatchObject({ code: 'invalid_op', index: 0, message: 'Bad op (ops[0])' });
  });

  it('sends a note with a tone and handles the empty 204 response', async () => {
    await h.login();
    const result = await h.run(['edit', 'note', 'edit-1', 'Trimming the intro', '--tone', 'success']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toEqual({ projectId: 'edit-1', sent: true, watchUrl: watch() });
    expect(h.editPosts).toEqual([{ path: '/api/edits/edit-1/notes', body: { message: 'Trimming the intro', tone: 'success' } }]);
    h.editError = { status: 429, body: { error: 'Slow down' }, headers: { 'retry-after': '5' } };
    const limited = await h.run(['edit', 'note', 'edit-1', 'Again']);
    expect(limited.code).toBe(5);
    expect(h.parse(limited).error).toMatchObject({ retryAfter: 5, message: 'Slow down. Retry after 5 seconds.' });
  });

  it('prints an encoded watch URL without login or browser when piped', async () => {
    const result = await h.run(['edit', 'open', 'a b/c']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data).toEqual({ projectId: 'a b/c', watchUrl: `${h.base}/editor/a%20b%2Fc`, opened: false });
    expect(h.tokenRequests).toHaveLength(0);
    const bootstrap = join(h.directory, 'tty.mjs');
    await writeFile(bootstrap, "Object.defineProperty(process.stdout, 'isTTY', { value: true });\n");
    const terminal = await h.run(['edit', 'open', 'edit-1', '--no-browser'], {}, ['--import', bootstrap]);
    expect(terminal.code).toBe(0);
    expect(terminal.stdout).toContain(watch());
  });
});
