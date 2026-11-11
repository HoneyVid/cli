import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { CliError, apiError, safeUrl, signedOut, usage } from './errors.mjs';

/** @typedef {{access_token:string,refresh_token:string,expires_at:number}} Tokens */
/** @typedef {{verifier:string,state:string,redirectUri:string,createdAt:number,tokenEndpoint:string,authorizationEndpoint?:string,code?:string}} Pending */
/** @typedef {{tokens?:Tokens,pending?:Pending,environment?:{hash:string,tokens:Tokens}}} Account */
/** @typedef {{accounts:Record<string,Account>}} Store */

const hash = value => createHash('sha256').update(value).digest('base64url');
const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'honeyvid');
const authPath = () => join(configDir(), 'auth.json');

/** @returns {Promise<Store>} */
async function readStore() {
  try {
    const store = JSON.parse(await readFile(authPath(), 'utf8'));
    if (!store || typeof store.accounts !== 'object' || Array.isArray(store.accounts) || !store.accounts) {
      throw new Error('Invalid accounts');
    }
    return store;
  } catch (error) {
    if (error.code === 'ENOENT') return { accounts: {} };
    throw new CliError('auth_storage', 'Cannot read the local auth file.', 1, 'Check permissions and JSON in the HoneyVid auth.json file.');
  }
}

/** Serialize read/refresh/write across CLI processes using the same config directory.
 * @template T @param {()=>Promise<T>} work @param {AbortSignal=} signal @returns {Promise<T>} */
async function withStoreLock(work, signal = AbortSignal.timeout(45_000)) {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await chmod(configDir(), 0o700);
  const lock = join(configDir(), '.auth.lock');
  while (true) {
    signal.throwIfAborted();
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        // Requests are bounded to at most 120 seconds. Recover a lock left by a crashed process.
        if (Date.now() - (await stat(lock)).mtimeMs > 300_000) { await rm(lock, { recursive: true, force: true }); continue; }
      } catch (inspection) { if (inspection.code !== 'ENOENT') throw inspection; }
      await delay(100, undefined, { signal });
    }
  }
  try { return await work(); }
  finally { await rm(lock, { recursive: true, force: true }); }
}

/** Caller must hold the config lock. @param {string} base @param {(account:Account)=>Account|undefined} update */
async function writeAccount(base, update) {
  const store = await readStore();
  const account = update(store.accounts[base] || {});
  if (account) store.accounts[base] = account;
  else delete store.accounts[base];
  const temporary = join(configDir(), `.auth-${randomBytes(12).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(store)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, authPath());
  } finally {
    await rm(temporary, { force: true });
  }
}

/** @param {string} base @param {(account:Account)=>Account|undefined} update */
async function updateAccount(base, update) {
  return withStoreLock(() => writeAccount(base, update));
}

/** @param {string} base */
export async function logout(base) {
  await updateAccount(base, () => undefined);
  return { loggedOut: true, baseUrl: base };
}

/** Launch the system browser without invoking a shell. @param {string} url */
export async function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', timeout: 15_000 });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new CliError('browser_open', 'Could not open the browser.', 1, 'Run honeyvid login --no-browser.')));
  });
}

/** @param {string} base @param {AbortSignal=} signal */
async function endpoints(base, signal = AbortSignal.timeout(10_000)) {
  const fallback = { authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token` };
  let response;
  try {
    response = await fetch(`${base}/.well-known/oauth-authorization-server`, { signal, redirect: 'error' });
  } catch {
    signal.throwIfAborted();
    return fallback;
  }
  if (!response.ok) { await response.body?.cancel(); return fallback; }
  const data = await response.json();
  if (typeof data.authorization_endpoint !== 'string' || typeof data.token_endpoint !== 'string') {
    throw new CliError('oauth_metadata', 'OAuth discovery is missing endpoints.');
  }
  return {
    authorization_endpoint: safeUrl(data.authorization_endpoint).href,
    token_endpoint: safeUrl(data.token_endpoint).href,
  };
}

/** @param {string} base @param {string} endpoint @param {Record<string,string>} fields @param {string=} previousRefresh @param {AbortSignal=} signal
 * @returns {Promise<Tokens>} */
async function exchange(base, endpoint, fields, previousRefresh, signal = AbortSignal.timeout(30_000)) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'honeyvid-cli', resource: `${base}/api`, ...fields }),
    signal, redirect: 'error',
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 || body.error === 'invalid_grant') throw signedOut();
    throw apiError(response, body);
  }
  const refresh = body.refresh_token || previousRefresh;
  if (typeof body.access_token !== 'string' || !body.access_token || typeof refresh !== 'string' || !refresh ||
      (body.token_type && String(body.token_type).toLowerCase() !== 'bearer')) {
    throw new CliError('oauth_response', 'The token endpoint returned invalid tokens.');
  }
  return { access_token: body.access_token, refresh_token: refresh,
    expires_at: Date.now() + (Number.isFinite(Number(body.expires_in)) ? Number(body.expires_in) * 1000 : 0) };
}

const loginLifetimeMs = 600_000;

/** First 40 hash bits encoded with Crockford base32. @param {string} state */
function displayCode(state) {
  const digest = createHash('sha256').update(`display:${state}`).digest();
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0;
  let value = 0;
  let code = '';
  for (const byte of digest.subarray(0, 5)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; code += alphabet[(value >>> bits) & 31]; }
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** @param {string} base @param {{noBrowser?:boolean,code?:string,wait?:boolean,json?:boolean}} options */
export async function login(base, { noBrowser, code, wait, json }) {
  let pending;
  if (code || wait) {
    pending = (await readStore()).accounts[base]?.pending;
    if (!pending || Date.now() - pending.createdAt >= loginLifetimeMs) {
      throw usage('No current login is waiting. Run honeyvid login again.');
    }
    if (code) { await finishLogin(base, pending, code); return null; }
  } else {
    const metadata = await endpoints(base);
    pending = { verifier: randomBytes(32).toString('base64url'), state: randomBytes(32).toString('base64url'),
      redirectUri: `${base}/connect/code`, createdAt: Date.now(), tokenEndpoint: metadata.token_endpoint, authorizationEndpoint: metadata.authorization_endpoint };
    await updateAccount(base, account => ({ ...account, pending }));
  }
  const url = authorizeUrl(pending.authorizationEndpoint || `${base}/oauth/authorize`, base, pending.verifier, pending.state, pending.redirectUri);
  const details = { url, code: displayCode(pending.state),
    expiresInSeconds: Math.max(0, Math.ceil((pending.createdAt + loginLifetimeMs - Date.now()) / 1000)),
    next: 'Open the url and click Connect. Check the code matches.' };
  if (!process.stdout.isTTY || json) process.stdout.write(`${JSON.stringify({ ok: true, data: details })}\n`);
  else console.error(`${details.next}\n${details.url}\nCode: ${details.code}`);
  if (!wait && !noBrowser && !(process.platform === 'linux' && !process.env.DISPLAY)) {
    try { await openBrowser(url); }
    catch { console.error('Could not open the browser. Open the URL above to connect.'); }
  }
  if (pending.code) await finishLogin(base, pending, pending.code);
  else await pollLogin(base, pending);
  return null;
}

/** @param {string} base @param {Pending} pending */
async function pollLogin(base, pending) {
  const deadline = pending.createdAt + loginLifetimeMs;
  let recognized = false;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/oauth/cli/poll`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: pending.state }),
      signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))), redirect: 'error',
    });
    const body = await response.json();
    if (response.status === 200) {
      if (typeof body.code !== 'string' || !body.code) throw new CliError('oauth_response', 'The login endpoint returned an invalid code.');
      // Keep a claimed code resumable if exchange fails or the process exits before saving tokens.
      await updateAccount(base, account => ({ ...account, pending: { ...pending, code: body.code } }));
      await finishLogin(base, pending, body.code);
      return;
    }
    if (response.status === 403 && body.error === 'access_denied') {
      await updateAccount(base, account => ({ ...account, pending: undefined }));
      throw new CliError('oauth_denied', 'Connection cancelled.', 1, 'Run honeyvid login again.');
    }
    if (response.status === 410 && recognized) break;
    if (response.status === 202) recognized = true;
    else if (response.status !== 410 && response.status !== 429) throw apiError(response, body);
    const retryAfter = Number(response.headers.get('retry-after'));
    await delay(Math.min(Math.max(2000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0), Math.max(0, deadline - Date.now())));
  }
  throw new CliError('login_timeout', 'Login expired after 10 minutes.', 1, 'Run honeyvid login again.');
}

/** @param {string} endpoint @param {string} base @param {string} verifier @param {string} state @param {string} redirectUri */
function authorizeUrl(endpoint, base, verifier, state, redirectUri) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: 'honeyvid-cli',
    redirect_uri: redirectUri, scope: 'videos:read videos:create offline_access', resource: `${base}/api`,
    code_challenge: hash(verifier), code_challenge_method: 'S256', state })) url.searchParams.set(key, value);
  return url.href;
}

/** @param {string} base @param {Pending} pending @param {string} code */
async function finishLogin(base, pending, code) {
  const tokens = await exchange(base, pending.tokenEndpoint, {
    grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri,
  });
  await updateAccount(base, account => ({ ...account, tokens, pending: undefined }));
}

/** Manage a single CLI invocation's credentials; refresh at most once per rejected request. */
export class Auth {
  /** @param {string} base */
  constructor(base) { this.base = base; this.tokens = undefined; }

  /** @param {boolean} force @param {AbortSignal=} signal @returns {Promise<string>} */
  async accessToken(force = false, signal) {
    signal?.throwIfAborted();
    const account = (await readStore()).accounts[this.base];
    const environment = process.env.HONEYVID_TOKEN;
    const fingerprint = environment ? hash(environment) : undefined;
    const saved = environment ? (account?.environment?.hash === fingerprint ? account.environment.tokens : undefined) : account?.tokens;
    const tokens = this.tokens || saved;
    if (!force && tokens?.access_token && tokens.expires_at > Date.now() + 30_000) {
      this.tokens = tokens;
      return tokens.access_token;
    }
    if (!tokens?.refresh_token && !environment) throw signedOut();
    return withStoreLock(async () => {
      // Another process may have refreshed while we waited. Never reuse its old rotating token.
      const latestAccount = (await readStore()).accounts[this.base];
      const latest = environment
        ? (latestAccount?.environment?.hash === fingerprint ? latestAccount.environment.tokens : undefined) : latestAccount?.tokens;
      if (latest?.access_token && latest.expires_at > Date.now() + 30_000 &&
          (!force || latest.access_token !== tokens?.access_token)) {
        this.tokens = latest;
        return latest.access_token;
      }
      const refresh = latest?.refresh_token || environment;
      if (!refresh) throw signedOut();
      const metadata = await endpoints(this.base, signal);
      const next = await exchange(this.base, metadata.token_endpoint, { grant_type: 'refresh_token', refresh_token: refresh }, refresh, signal);
      await writeAccount(this.base, current => environment
        ? { ...current, environment: { hash: fingerprint, tokens: next } } : { ...current, tokens: next });
      this.tokens = next;
      return next.access_token;
    }, signal);
  }

  async exportToken() {
    await this.accessToken();
    console.error('Secret: this refresh token grants access to your HoneyVid account. Store it securely.');
    return { refreshToken: this.tokens.refresh_token };
  }
}
