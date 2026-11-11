import { createHash } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { cliHarness } from './harness';

cliHarness(h => {
  it('saves PKCE state, exchanges a code as a public client, and secures local auth', async () => {
    const started = await h.beginLogin();
    expect(h.startedData(started).data.next).toBe('Open the url and click Connect. Check the code matches.');
    expect(h.startedData(started).data).toMatchObject({ code: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/), expiresInSeconds: 600 });
    expect(h.authorization?.pathname).toBe('/oauth/authorize');
    expect(h.authorization?.searchParams.get('client_id')).toBe('honeyvid-cli');
    expect(h.authorization?.searchParams.get('scope')).toBe('videos:read videos:create offline_access');
    expect(h.authorization?.searchParams.get('resource')).toBe(`${h.base}/api`);
    expect(h.authorization?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(h.authorization?.searchParams.get('redirect_uri')).toBe(`${h.base}/connect/code`);
    const pending = (await h.readAuth()).accounts[h.base].pending;
    expect(pending?.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pending?.state).toBe(h.authorization?.searchParams.get('state'));
    const digest = BigInt(`0x${createHash('sha256').update(`display:${pending?.state}`).digest('hex').slice(0, 10)}`);
    const matching = Array.from({ length: 8 }, (_, i) => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Number((digest >> BigInt(35 - i * 5)) & 31n)]).join('');
    expect(h.startedData(started).data.code).toBe(`${matching.slice(0, 4)}-${matching.slice(4)}`);
    const finished = await h.run(['login', '--code', 'test-code']);
    expect(finished.code, finished.stdout).toBe(0);
    expect(finished.stdout).toContain('agent@example.test');
    expect(h.tokenRequests).toHaveLength(1);
    expect(h.tokenRequests[0].get('code_verifier')).toBe(pending?.verifier);
    expect((await h.readAuth()).accounts[h.base].tokens?.refresh_token).toBe('initial-refresh');
    expect((await stat(h.authPath())).mode & 0o777).toBe(0o600);
    expect((await stat(join(h.directory, 'honeyvid'))).mode & 0o777).toBe(0o700);
  });
  it('finishes browser login through polling without a loopback listener', async () => {
    const opener = join(h.directory, process.platform === 'darwin' ? 'open' : 'xdg-open');
    await writeFile(opener, `#!${process.execPath}\nfetch(process.argv[2]).catch(() => { process.exitCode = 1; });\n`, { mode: 0o755 });
    const bootstrap = join(h.directory, 'tty.mjs');
    await writeFile(bootstrap, "Object.defineProperty(process.stdout, 'isTTY', { value: true });\n");
    const result = await h.run(['login', '--json'], { PATH: `${h.directory}:${process.env.PATH}`, DISPLAY: ':test' }, ['--import', bootstrap]);
    expect(result.code, result.stdout || result.stderr).toBe(0);
    expect(h.parse(result).data.email).toBe('agent@example.test');
    expect(h.authorization?.searchParams.get('redirect_uri')).toBe(`${h.base}/connect/code`);
    expect(h.loginStates).toEqual([h.authorization?.searchParams.get('state')]);
    expect(h.tokenRequests[0].get('grant_type')).toBe('authorization_code');
    expect((await h.readAuth()).accounts[h.base].pending).toBeUndefined();
  });
  it('prints human connection instructions to stderr in a terminal', async () => {
    const bootstrap = join(h.directory, 'human-tty.mjs');
    await writeFile(bootstrap, "Object.defineProperty(process.stdout, 'isTTY', { value: true });\n");
    const result = await h.run(['login', '--no-browser'], {}, ['--import', bootstrap]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).data.email).toBe('agent@example.test');
    expect(result.stderr).toMatch(/Check the code matches\.[\s\S]*Code: [0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/);
  });
  it('resumes a saved login after six minutes and preserves its matching code', async () => {
    const started = await h.beginLogin();
    const saved = await h.readAuth();
    const pending = saved.accounts[h.base].pending;
    if (!pending) throw new Error('Expected pending login');
    pending.createdAt -= 6 * 60_000;
    await writeFile(h.authPath(), JSON.stringify(saved));
    const resumed = await h.run(['login', '--wait']);
    expect(resumed.code, resumed.stdout).toBe(0);
    expect(h.startedData(resumed).data.code).toBe(h.startedData(started).data.code);
    expect(h.startedData(resumed).data.expiresInSeconds).toBeLessThanOrEqual(240);
    expect(h.loginStates.at(-1)).toBe(pending.state);
    expect(h.tokenRequests.at(-1)?.get('code_verifier')).toBe(pending.verifier);
    expect(h.parse(resumed).data.email).toBe('agent@example.test');
  });
  it('waits through an unknown state before the browser starts consent', async () => {
    h.loginPollStatuses = [410, 202];
    const result = await h.login();
    expect(result.code).toBe(0);
    expect(h.loginStates).toHaveLength(3);
    expect(new Set(h.loginStates).size).toBe(1);
  }, 10_000);
  it('reports cancellation and an expired recognized login without exchanging tokens', async () => {
    h.loginPollStatuses = [403];
    const cancelled = await h.run(['login', '--no-browser']);
    expect(h.parse(cancelled).error.code).toBe('oauth_denied');
    expect((await h.readAuth()).accounts[h.base].pending).toBeUndefined();
    h.loginPollStatuses = [202, 410];
    const expired = await h.run(['login', '--no-browser']);
    expect(h.parse(expired).error.code).toBe('login_timeout');
    expect(h.tokenRequests).toHaveLength(0);
  });
  it('rejects saved logins at ten minutes for both resume and legacy code', async () => {
    await h.beginLogin();
    const saved = await h.readAuth();
    const pending = saved.accounts[h.base].pending;
    if (!pending) throw new Error('Expected pending login');
    pending.createdAt -= 600_001;
    await writeFile(h.authPath(), JSON.stringify(saved));
    for (const args of [['--wait'], ['--code', 'test-code']]) {
      const result = await h.run(['login', ...args]);
      expect(result.code).toBe(2);
      expect(h.parse(result).error.message).toContain('No current login');
    }
    expect(h.tokenRequests).toHaveLength(0);
  });
  it('refreshes once after 401, retries, and saves the rotated refresh token', async () => {
    await h.login();
    h.unauthorizedOnce = true;
    const result = await h.run(['whoami']);
    expect(result.code, result.stdout).toBe(0);
    expect(h.parse(result).data.email).toBe('agent@example.test');
    expect(h.tokenRequests).toHaveLength(2);
    expect(h.tokenRequests[1].get('grant_type')).toBe('refresh_token');
    expect(h.tokenRequests[1].get('refresh_token')).toBe('initial-refresh');
    expect((await h.readAuth()).accounts[h.base].tokens?.refresh_token).toBe('rotated-refresh');
  });
  it('uses HONEYVID_TOKEN as a refresh token without a stored login', async () => {
    const result = await h.run(['account'], { HONEYVID_TOKEN: 'ci-refresh' });
    expect(result.code, result.stdout).toBe(0);
    expect(result.stdout).toContain('agent@example.test');
    expect(result.stdout).toContain(`${h.base}/pricing`);
    expect(h.tokenRequests[0].get('refresh_token')).toBe('ci-refresh');
    expect(h.tokenRequests[0].get('client_id')).toBe('honeyvid-cli');
  });
  it('keeps environment token rotation separate from the stored login across invocations', async () => {
    await h.login();
    expect((await h.runSpawn(['whoami'], { HONEYVID_TOKEN: 'ci-refresh' })).code).toBe(0);
    expect(h.tokenRequests[1].get('refresh_token')).toBe('ci-refresh');
    const count = h.tokenRequests.length;
    expect((await h.runSpawn(['whoami'], { HONEYVID_TOKEN: 'ci-refresh' })).code).toBe(0);
    expect(h.tokenRequests).toHaveLength(count);
    h.unauthorizedOnce = true;
    expect((await h.runSpawn(['whoami'], { HONEYVID_TOKEN: 'ci-refresh' })).code).toBe(0);
    expect(h.tokenRequests.at(-1)?.get('refresh_token')).toBe('rotated-refresh');
    expect((await h.readAuth()).accounts[h.base].tokens?.refresh_token).toBe('initial-refresh');
  });
  it('serializes parallel environment-token refresh so both commands succeed with a single-use token', async () => {
    h.strictRefresh = true;
    const results = await Promise.all([
      h.runSpawn(['whoami'], { HONEYVID_TOKEN: 'ci-refresh' }),
      h.runSpawn(['whoami'], { HONEYVID_TOKEN: 'ci-refresh' }),
    ]);
    for (const result of results) {
      expect(result.code, result.stdout || result.stderr).toBe(0);
      expect(h.parse(result).data.email).toBe('agent@example.test');
    }
    expect(h.tokenRequests).toHaveLength(1);
    expect(h.tokenRequests[0].get('refresh_token')).toBe('ci-refresh');
    expect((await stat(h.authPath())).mode & 0o777).toBe(0o600);
  });
});
