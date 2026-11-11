import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { format } from 'node:util';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { main } from '../bin/honeyvid.mjs';
import { media, playgroundModels, template } from './fixtures';
import { mockPollingClock } from './clock';

vi.mock('node:timers/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:timers/promises')>();
  return { ...original, setTimeout: vi.fn(original.setTimeout) };
});
const realDelay = (await vi.importActual<typeof import('node:timers/promises')>('node:timers/promises')).setTimeout;

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}
interface Envelope {
  ok: boolean;
  data: Record<string, unknown>;
  error: { code: string; message: string; suggestion: string; retryable: boolean; idempotencyKey?: string; retryAfter?: number };
}
interface AuthFile {
  accounts: Record<string, {
    pending?: { verifier: string; state: string; redirectUri: string; createdAt: number };
    tokens?: { refresh_token: string };
  }>;
}
const cli = resolve('bin/honeyvid.mjs');

interface CliHarness {
  server: Server; base: string; directory: string; tokenRequests: URLSearchParams[]; authorization: URL | undefined;
  unauthorizedOnce: boolean; processingForever: boolean; jobFailed: boolean; queuedCreate: boolean; polls: number;
  jobPosts: { path: string; body: Record<string, unknown>; key: string | undefined }[];
  uploads: { contentType: string | undefined; length: string | undefined; bytes: Buffer }[];
  characterUploads: { contentType: string | undefined; bytes: Buffer }[]; rateLimited: boolean;
  postKeys: (string | undefined)[]; loginPollStatuses: number[]; loginStates: string[]; slowJobBody: boolean; slowJobBodyAfter: number;
  strictRefresh: boolean; refreshConsumed: boolean; playgroundQuotes: Record<string, unknown>[]; jobQueries: string[];
  forcedError: { status: number; body: Record<string, unknown> } | undefined; imageContentType: string;
  run(args: string[], extraEnv?: Record<string, string>, nodeArgs?: string[]): Promise<Result>;
  runSpawn(args: string[], extraEnv?: Record<string, string>, nodeArgs?: string[], entry?: string): Promise<Result>;
  parse(result: Result): Envelope; startedData(result: Result): Envelope; authPath(): string;
  readAuth(): Promise<AuthFile>; beginLogin(): Promise<Result>; login(): Promise<Result>;
}

export function cliHarness(register: (harness: CliHarness) => void) {
  describe('customer CLI', () => {
  let server: Server;
  let base: string;
  let directory: string;
  let tokenRequests: URLSearchParams[];
  let authorization: URL | undefined;
  let unauthorizedOnce: boolean;
  let processingForever: boolean;
  let jobFailed: boolean;
  let queuedCreate: boolean;
  let polls: number;
  let jobPosts: { path: string; body: Record<string, unknown>; key: string | undefined }[];
  let uploads: { contentType: string | undefined; length: string | undefined; bytes: Buffer }[];
  let characterUploads: { contentType: string | undefined; bytes: Buffer }[];
  let rateLimited: boolean;
  let postKeys: (string | undefined)[];
  let loginPollStatuses: number[];
  let loginStates: string[];
  let slowJobBody: boolean;
  let slowJobBodyAfter: number;
  let strictRefresh: boolean;
  let refreshConsumed: boolean;
  let playgroundQuotes: Record<string, unknown>[];
  let jobQueries: string[];
  let forcedError: { status: number; body: Record<string, unknown> } | undefined;
  let imageContentType: string;

  function captureAuthorization(args: string[], stdout: string) {
    const first = stdout.split('\n')[0];
    if (stdout.includes('\n') && first.startsWith('{"') && args[0] === 'login') {
      const output = JSON.parse(first);
      if (output.data?.url) authorization = new URL(output.data.url);
    }
  }

  async function run(args: string[], extraEnv: Record<string, string> = {}, nodeArgs: string[] = []): Promise<Result> {
    if (nodeArgs.length) return runSpawn(args, extraEnv, nodeArgs);
    let stdout = '';
    let stderr = '';
    const tty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { stdout += chunk.toString(); captureAuthorization(args, stdout); return true; });
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { stderr += chunk.toString(); return true; });
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...values) => { stderr += `${format(...values)}\n`; });
    for (const [key, value] of Object.entries({ HONEYVID_TOKEN: '', HONEYVID_URL: base, XDG_CONFIG_HOME: directory, ...extraEnv })) vi.stubEnv(key, value);
    const restoreClock = args[0] === 'login' || args.includes('--wait') ? mockPollingClock() : undefined;
    try {
      return { code: await main(args), stdout, stderr };
    } finally {
      restoreClock?.();
      vi.mocked(delay).mockReset().mockImplementation(realDelay);
      if (tty) Object.defineProperty(process.stdout, 'isTTY', tty);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
      consoleError.mockRestore();
      vi.unstubAllEnvs();
    }
  }

  async function runSpawn(args: string[], extraEnv: Record<string, string> = {}, nodeArgs: string[] = [], entry = cli): Promise<Result> {
    return new Promise((complete, reject) => {
      const child = spawn(process.execPath, [...nodeArgs, entry, ...args], {
        env: { ...process.env, HONEYVID_TOKEN: '', HONEYVID_URL: base, XDG_CONFIG_HOME: directory, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
        captureAuthorization(args, stdout);
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
        if (args[0] === 'login' && stderr.includes('/oauth/authorize?')) authorization = new URL(stderr.match(/https?:\/\/\S+/)?.[0] ?? '');
      });
      child.on('error', reject);
      child.on('close', code => complete({ code, stdout, stderr }));
    });
  }
  const parse = (result: Result): Envelope => JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '');
  const startedData = (result: Result): Envelope => JSON.parse(result.stdout.split('\n')[0]);
  const authPath = () => join(directory, 'honeyvid', 'auth.json');
  const readAuth = async (): Promise<AuthFile> => JSON.parse(await readFile(authPath(), 'utf8'));

  // Interrupt a real process after it saves pending state, before it can poll.
  async function beginLogin() {
    return new Promise<Result>((complete, reject) => {
      const child = spawn(process.execPath, [cli, 'login', '--no-browser'], {
        env: { ...process.env, HONEYVID_TOKEN: '', HONEYVID_URL: base, XDG_CONFIG_HOME: directory }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.on('error', reject);
      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
        if (stdout.includes('\n')) {
          authorization = new URL(String(startedData({ code: 0, stdout, stderr: '' }).data.url));
          child.kill();
        }
      });
      child.on('close', () => complete({ code: 0, stdout, stderr: '' }));
    });
  }
  async function login() {
    const result = await run(['login', '--no-browser']);
    expect(result.code, result.stderr || result.stdout).toBe(0);
    return result;
  }

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'honeyvid-cli-test-')));
    tokenRequests = [];
    unauthorizedOnce = false;
    processingForever = false;
    jobFailed = false;
    queuedCreate = false;
    polls = 0;
    jobPosts = [];
    uploads = [];
    characterUploads = [];
    rateLimited = false;
    postKeys = [];
    loginPollStatuses = [];
    loginStates = [];
    slowJobBody = false;
    slowJobBodyAfter = 0;
    strictRefresh = false;
    refreshConsumed = false;
    authorization = undefined;
    playgroundQuotes = [];
    jobQueries = [];
    forcedError = undefined;
    imageContentType = 'image/png';
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', base);
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        const json = (body: unknown, status = 200) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(body));
        };
        if (url.pathname === '/.well-known/oauth-authorization-server') {
          return json({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token` });
        }
        if (url.pathname === '/oauth/authorize') {
          authorization = url;
          response.writeHead(200, { 'content-type': 'text/plain' });
          return response.end('Connect');
        }
        if (url.pathname === '/oauth/cli/poll') {
          const { state } = JSON.parse(bytes.toString());
          loginStates.push(state);
          const status = loginPollStatuses.shift() ?? 200;
          if (status !== 200) return json(status === 403 ? { error: 'access_denied' } : { pending: status === 202 }, status);
          return json({ code: 'test-code' });
        }
        if (url.pathname === '/oauth/token') {
          const form = new URLSearchParams(bytes.toString());
          tokenRequests.push(form);
          if (form.get('client_id') !== 'honeyvid-cli') return json({ error: 'invalid_client' }, 400);
          if (form.has('client_secret')) return json({ error: 'public_client_only' }, 400);
          if (form.get('grant_type') === 'authorization_code') {
            const verifier = form.get('code_verifier') ?? '';
            if (!authorization || form.get('code') !== 'test-code'
              || createHash('sha256').update(verifier).digest('base64url') !== authorization.searchParams.get('code_challenge')
              || form.get('redirect_uri') !== authorization.searchParams.get('redirect_uri')) {
              return json({ error: 'invalid_grant' }, 400);
            }
            return json({ access_token: 'initial-access', refresh_token: 'initial-refresh', token_type: 'Bearer', expires_in: 3600 });
          }
          if (form.get('grant_type') === 'refresh_token'
            && ['initial-refresh', 'ci-refresh', 'rotated-refresh'].includes(form.get('refresh_token') ?? '')) {
            if (strictRefresh) {
              if (refreshConsumed || form.get('refresh_token') !== 'ci-refresh') return json({ error: 'invalid_grant' }, 400);
              refreshConsumed = true;
              // Make overlap predictable: the first process holds its refresh request open.
              await realDelay(100);
            }
            return json({ access_token: 'fresh-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 });
          }
          return json({ error: 'invalid_grant' }, 400);
        }
        if (url.pathname === '/result.png' || url.pathname === '/second.png') {
          response.writeHead(200, { 'content-type': imageContentType });
          return response.end(url.pathname === '/result.png' ? 'first image' : 'second image');
        }
        if (url.pathname === '/result.mp4') {
          response.writeHead(200, { 'content-type': 'video/mp4' });
          return response.end(media);
        }
        if (url.pathname.startsWith('/api/')) {
          if (request.method === 'POST' && ['/api/jobs', '/api/playground/jobs', '/api/playground/images/jobs'].includes(url.pathname)) {
            const key = request.headers['idempotency-key'];
            postKeys.push(Array.isArray(key) ? key[0] : key);
          }
          if (unauthorizedOnce) {
            unauthorizedOnce = false;
            return json({ error: 'Access token expired' }, 401);
          }
          if (!['Bearer initial-access', 'Bearer fresh-access'].includes(request.headers.authorization ?? '')) {
            return json({ error: 'Not signed in' }, 401);
          }
          if (forcedError) return json(forcedError.body, forcedError.status);
        }
        if (url.pathname === '/api/playground/models') return json({ models: playgroundModels });
        if (url.pathname === '/api/playground/quote') {
          playgroundQuotes.push(JSON.parse(bytes.toString()));
          return json({ credits: 12, balance: 100, estimatedSeconds: 120 });
        }
        if (url.pathname === '/api/jobs/image-1') {
          polls += 1;
          return json({ job: { id: 'image-1', status: 'completed', kind: 'image', credits: 12,
            images: [`${base}/result.png`, `${base}/second.png`], resultUrl: `${base}/result.png` } });
        }
        if (url.pathname === '/api/me') return json({ email: 'agent@example.test', credits: 100, plan: 'creator' });
        if (url.pathname === '/api/templates') return json({ templates: [template, { ...template, id: 'sport', title: 'Sport', category: 'sport' }] });
        if (url.pathname === '/api/templates/dance') return json({ template });
        if (url.pathname === '/api/characters') {
          const character = { id: 'char-1', name: 'Alex', imageUrl: 'https://example.test/alex.png' };
          if (request.method === 'POST') {
            characterUploads.push({ contentType: request.headers['content-type'], bytes });
            return json({ character }, 201);
          }
          return json({ characters: [character] });
        }
        if (url.pathname === '/api/jobs/quote') {
          return json({ credits: url.searchParams.get('quality') === 'high' ? 24 : 12, quality: url.searchParams.get('quality'), estimatedSeconds: 120, balance: 100 });
        }
        if (request.method === 'POST' && ['/api/jobs', '/api/jobs/job-1/retry', '/api/playground/jobs', '/api/playground/images/jobs'].includes(url.pathname)) {
          const body: Record<string, unknown> = JSON.parse(bytes.toString());
          const key = request.headers['idempotency-key'];
          jobPosts.push({ path: url.pathname, body, key: Array.isArray(key) ? key[0] : key });
          if (rateLimited) {
            response.setHeader('retry-after', '60');
            return json({ error: 'Hourly limit reached' }, 429);
          }
          if (typeof body.maxCredits === 'number' && body.maxCredits < 12) return json({ error: 'Price is 12 credits, above maxCredits 1', credits: 12 }, 409);
          if (url.pathname === '/api/playground/images/jobs') return json({ job: { id: 'image-1', kind: 'image', status: 'processing', credits: 12 } }, 202);
          return json({ job: { id: 'job-1', status: queuedCreate ? 'queued' : 'processing', credits: 12, templateTitle: template.title } }, 202);
        }
        if (url.pathname === '/api/jobs/job-1') {
          polls += 1;
          if (slowJobBody && polls > slowJobBodyAfter) {
            response.writeHead(200, { 'content-type': 'application/json', 'x-test-stalled-body': 'true' });
            response.write('{"job":');
            return;
          }
          return json({ job: { id: 'job-1', status: jobFailed ? 'failed' : processingForever ? 'processing' : 'completed', credits: 12, resultUrl: `${base}/result.mp4` } });
        }
        if (url.pathname === '/api/jobs') {
          jobQueries.push(url.search);
          return json({ jobs: url.searchParams.get('kind') === 'image'
            ? [{ id: 'image-1', status: 'completed', kind: 'image', credits: 12, images: [`${base}/result.png`] }]
            : [{ id: 'job-1', status: queuedCreate ? 'queued' : 'completed', credits: 12, resultUrl: `${base}/result.mp4` }] });
        }
        if (url.pathname === '/api/uploads' && request.method === 'POST') {
          uploads.push({ contentType: request.headers['content-type'], length: request.headers['content-length'], bytes });
          return json({ upload: { id: 'upload-1', seconds: 5, qualities: template.qualities } }, 201);
        }
        return json({ error: 'Not found' }, 404);
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    });
    await new Promise<void>(complete => server.listen(0, '127.0.0.1', complete));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((complete, reject) => server.close(error => error ? reject(error) : complete()));
    await rm(directory, { recursive: true, force: true });
  });

  const harness = {
    get server() { return server; },
    set server(value: typeof server) { server = value; },
    get base() { return base; },
    set base(value: typeof base) { base = value; },
    get directory() { return directory; },
    set directory(value: typeof directory) { directory = value; },
    get tokenRequests() { return tokenRequests; },
    set tokenRequests(value: typeof tokenRequests) { tokenRequests = value; },
    get authorization() { return authorization; },
    set authorization(value: typeof authorization) { authorization = value; },
    get unauthorizedOnce() { return unauthorizedOnce; },
    set unauthorizedOnce(value: typeof unauthorizedOnce) { unauthorizedOnce = value; },
    get processingForever() { return processingForever; },
    set processingForever(value: typeof processingForever) { processingForever = value; },
    get jobFailed() { return jobFailed; },
    set jobFailed(value: typeof jobFailed) { jobFailed = value; },
    get queuedCreate() { return queuedCreate; },
    set queuedCreate(value: typeof queuedCreate) { queuedCreate = value; },
    get polls() { return polls; },
    set polls(value: typeof polls) { polls = value; },
    get jobPosts() { return jobPosts; },
    set jobPosts(value: typeof jobPosts) { jobPosts = value; },
    get uploads() { return uploads; },
    set uploads(value: typeof uploads) { uploads = value; },
    get characterUploads() { return characterUploads; },
    set characterUploads(value: typeof characterUploads) { characterUploads = value; },
    get rateLimited() { return rateLimited; },
    set rateLimited(value: typeof rateLimited) { rateLimited = value; },
    get postKeys() { return postKeys; },
    set postKeys(value: typeof postKeys) { postKeys = value; },
    get loginPollStatuses() { return loginPollStatuses; },
    set loginPollStatuses(value: typeof loginPollStatuses) { loginPollStatuses = value; },
    get loginStates() { return loginStates; },
    set loginStates(value: typeof loginStates) { loginStates = value; },
    get slowJobBody() { return slowJobBody; },
    set slowJobBody(value: typeof slowJobBody) { slowJobBody = value; },
    get slowJobBodyAfter() { return slowJobBodyAfter; },
    set slowJobBodyAfter(value: typeof slowJobBodyAfter) { slowJobBodyAfter = value; },
    get strictRefresh() { return strictRefresh; },
    set strictRefresh(value: typeof strictRefresh) { strictRefresh = value; },
    get refreshConsumed() { return refreshConsumed; },
    set refreshConsumed(value: typeof refreshConsumed) { refreshConsumed = value; },
    get playgroundQuotes() { return playgroundQuotes; },
    set playgroundQuotes(value: typeof playgroundQuotes) { playgroundQuotes = value; },
    get jobQueries() { return jobQueries; },
    set jobQueries(value: typeof jobQueries) { jobQueries = value; },
    get forcedError() { return forcedError; },
    set forcedError(value: typeof forcedError) { forcedError = value; },
    get imageContentType() { return imageContentType; },
    set imageContentType(value: typeof imageContentType) { imageContentType = value; },
    get run() { return run; },
    get runSpawn() { return runSpawn; },
    get parse() { return parse; },
    get startedData() { return startedData; },
    get authPath() { return authPath; },
    get readAuth() { return readAuth; },
    get beginLogin() { return beginLogin; },
    get login() { return login; },
  };
  register(harness);
  });
}
