#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, help } from '../lib/schema.mjs';
import { modelTable } from '../lib/playground.mjs';
import { run } from '../lib/commands.mjs';
import { CliError, safeUrl } from '../lib/errors.mjs';

export async function main(argv = process.argv.slice(2)) {
  let compact = !process.stdout.isTTY || argv.includes('--json');
  try {
    const { command, args, options } = parseArgs(argv);
    compact = compact || Boolean(options.json);
    if (options.help || !command) process.stdout.write(help(command));
    else {
      const url = safeUrl(options['base-url'] || process.env.HONEYVID_URL || 'https://honeyvid.ai');
      if (url.search || url.hash) throw new CliError('usage', 'The base URL cannot contain a query or fragment.', 2, 'Use the HoneyVid site URL.');
      const base = url.href.replace(/\/+$/, '');
      const data = await run(command, args, options, base);
      process.stdout.write(command === 'models' && !options.model && !compact ? modelTable(data.models)
        : `${JSON.stringify({ ok: true, data }, null, compact ? undefined : 2)}\n`);
    }
  } catch (error) {
    // Never print raw fetch errors, URLs with signed query strings, or token responses.
    const failure = error instanceof CliError ? error : new CliError('request_failed',
      ['ENOENT', 'EACCES', 'EPERM'].includes(error.code) ? 'Cannot access a required file or command.' : 'The request could not be completed.',
      1, 'Check file permissions, network access and the base URL.', error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError);
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: failure.code, message: failure.message,
      suggestion: failure.suggestion, retryable: failure.retryable, ...failure.details } }, null, compact ? undefined : 2)}\n`);
    return failure.exitCode;
  }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
