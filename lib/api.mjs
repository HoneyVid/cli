import { CliError, apiError } from './errors.mjs';

export class Api {
  /** @param {string} base @param {import('./auth.mjs').Auth} auth */
  constructor(base, auth) { this.base = base; this.auth = auth; }

  /** Bodies are factories so streams can be reopened after a 401.
   * @param {string} path @param {{method?:string,headers?:Record<string,string>,body?:()=>BodyInit,timeout?:number}} options */
  async request(path, { method = 'GET', headers = {}, body, timeout = 30_000 } = {}) {
    const signal = AbortSignal.timeout(Math.max(1, Math.ceil(timeout)));
    let token = await this.auth.accessToken(false, signal);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${this.base}${path}`, {
        method, headers: { ...headers, Authorization: `Bearer ${token}` },
        ...(body ? { body: body(), duplex: 'half' } : {}),
        signal, redirect: 'error',
      });
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        token = await this.auth.accessToken(true, signal);
        continue;
      }
      if (response.status === 204) {
        await response.body?.cancel();
        return {};
      }
      let data;
      try { data = await response.json(); }
      catch {
        signal.throwIfAborted();
        if (!response.ok) throw apiError(response, null);
        throw new CliError('invalid_response', `HoneyVid returned a non-JSON response (HTTP ${response.status}).`, 1,
          'Check the base URL; reuse the same idempotency key if retrying.', response.status >= 500);
      }
      if (!response.ok) throw apiError(response, data);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CliError('invalid_response', 'HoneyVid returned an invalid API response.');
      return data;
    }
    throw new CliError('auth_retry', 'Authentication retry failed.', 3, 'Run honeyvid login.');
  }
}
