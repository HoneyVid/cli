/** An error safe to print in the CLI envelope. */
export class CliError extends Error {
  /** @param {string} code @param {string} message @param {number} exitCode
   * @param {string} suggestion @param {boolean} retryable @param {object} details */
  constructor(code, message, exitCode = 1, suggestion = '', retryable = false, details = {}) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.suggestion = suggestion;
    this.retryable = retryable;
    this.details = details;
  }
}

/** @param {string} message */
export function usage(message) {
  return new CliError('usage', message, 2, 'Run honeyvid <command> --help.');
}

export function signedOut() {
  return new CliError('not_signed_in', 'You are not signed in.', 3, 'Run honeyvid login.');
}

/** @param {Response} response @param {unknown} body */
export function apiError(response, body) {
  if (response.status === 401) return signedOut();
  const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error : `HoneyVid returned HTTP ${response.status}.`;
  const serverCode = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
    ? body.code : `http_${response.status}`;
  const code = response.status === 409 && body && typeof body === 'object' && 'credits' in body
    ? 'price_above_max' : ({ 402: 'insufficient_credits', 403: 'forbidden', 429: 'rate_limited' }[response.status] ?? serverCode);
  if (response.status === 404) return new CliError('not_found', message, 4, 'Check the ID and base URL.');
  if ([402, 409, 429].includes(response.status)) {
    const raw = response.headers.get('retry-after');
    const retryAfter = raw === null ? body?.retryAfter : /^\d+$/.test(raw) ? Number(raw)
      : Math.max(0, Math.ceil((Date.parse(raw) - Date.now()) / 1000));
    return withBody(new CliError(code, message, 5,
      response.status === 429 ? 'Retry after the indicated delay with the same idempotency key.'
        : 'Check the quote, credit balance, and request parameters before retrying.',
      response.status === 429, Number.isFinite(retryAfter) ? { retryAfter } : {}), body);
  }
  return withBody(new CliError(code, message, 1, 'Check the request; reuse the same idempotency key if retrying.', response.status >= 500), body);
}

/** Keep the server body for command-specific handling; it is never printed. @param {CliError} error @param {unknown} body */
function withBody(error, body) {
  error.body = body;
  return error;
}

/** @param {string|URL} value */
export function safeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw usage('Use a valid absolute URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw usage('Use HTTPS (HTTP is allowed only on loopback for local testing).');
  }
  return url;
}
