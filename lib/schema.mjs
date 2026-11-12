import { readFileSync } from 'node:fs';
import { usage } from './errors.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const flag = (type, description, extra = {}) => ({ type, description, ...extra });
const quality = flag('string', 'Video quality.', { enum: ['standard', 'high'], required: true });
const source = {
  template: flag('string', 'Template ID; choose exactly one of --template and --upload.'),
  upload: flag('string', 'Own video upload ID; choose exactly one of --template and --upload.'),
  quality,
};
const waiting = {
  wait: flag('boolean', 'Wait for completion; poll every 5 seconds.'),
  timeout: flag('number', 'Maximum wait in seconds (positive; fractional allowed).', { default: 600 }),
  output: flag('string', 'Download completed media here; extension follows Content-Type. Extra images use -2, -3 suffixes. Never overwrite files.'),
};
const maxCredits = flag('integer', 'Maximum credits allowed; checked by the server.', { minimum: 0, required: true });
const key = flag('string', 'Reuse this key to replay the same request safely.', { pattern: '^[A-Za-z0-9_-]{8,100}$', default: 'random UUID' });
const limit = flag('integer', 'Maximum number of returned items.', { minimum: 1, default: 10 });
const kind = flag('string', 'Media kind.', { enum: ['video', 'image'] });
const generation = {
  model: flag('string', 'Model ID from honeyvid models.', { required: true }),
  prompt: flag('string', 'Generation prompt.', { required: true }),
  set: flag('string', 'Model setting key=value; repeatable. Numbers and booleans are typed.', { repeatable: true }),
  image: flag('string', 'Reference character ID; repeatable.', { repeatable: true }),
  'max-credits': maxCredits, 'dry-run': flag('boolean', 'Quote without creating or spending credits.'),
  'idempotency-key': key, ...waiting,
};
const jobShape = { job: { id: 'string', status: 'processing|completed|failed', credits: 'number',
  accountUrl: 'permanent signed-in account result link; share this with the user', resultUrl: 'temporary media download URL?', kind: 'image?', images: ['image URL'], templateTitle: 'string?', additionalFields: 'server job fields' }, path: 'first absolute path, when downloaded', paths: ['all absolute paths, when downloaded'] };

export const commands = {
  login: { purpose: 'Connect your HoneyVid account through the browser.', args: [], flags: {
    'no-browser': flag('boolean', 'Print a Connect URL without opening the browser; keep waiting.'),
    wait: flag('boolean', 'Resume the saved login and wait for browser approval.'),
    code: flag('string', 'Legacy fallback: finish a pending login with a copied OAuth code.'),
  }, output: 'first {url:string,code:XXXX-XXXX,expiresInSeconds:number,next:string}; then account fields after connection', examples: ['login', 'login --no-browser', 'login --wait', 'login --code <code>'] },
  logout: { purpose: 'Delete local credentials for this base URL.', args: [], flags: {}, output: { loggedOut: 'boolean', baseUrl: 'string' }, examples: ['logout'] },
  whoami: { purpose: 'Show the signed-in account.', args: [], flags: {}, output: 'account fields (email, credits, plan fields)', examples: ['whoami --json'] },
  'auth export': { purpose: 'Print the current refresh token (a secret).', args: [], flags: {}, output: { refreshToken: 'string' }, examples: ['auth export --json'] },
  templates: { purpose: 'Find templates and their available qualities.', args: [], flags: {
    search: flag('string', 'Case-insensitive title or category match.'), category: flag('string', 'Case-insensitive exact category match.'), limit,
  }, output: { templates: [{ id: 'string', title: 'string', category: 'string', durationSeconds: 'number',
    posterUrl: 'absolute URL', previewUrl: 'absolute URL?', qualities: [{ id: 'standard|high', label: 'string', credits: 'number' }] }] }, examples: ['templates --search dance --limit 10'] },
  template: { purpose: 'Show one template.', args: ['id'], flags: {}, output: { template: 'template fields, as in templates, plus optional absolute cardPreviewUrl and previewHqUrl' }, examples: ['template <id>'] },
  characters: { purpose: 'List your character photos.', args: [], flags: {}, output: { characters: [{ id: 'string', name: 'string', imageUrl: 'string' }] }, examples: ['characters'] },
  'characters add': { purpose: 'Add a PNG, JPG or WebP character photo (up to 10 MB).', args: ['file?'], flags: {
    name: flag('string', 'Character name (1–60 characters).', { required: true }), url: flag('string', 'HTTPS photo URL, instead of a local file.'),
  }, output: { character: { id: 'string', name: 'string', imageUrl: 'string' } }, examples: ['characters add face.jpg --name Alex', 'characters add --url https://example.com/face.jpg --name Alex'] },
  upload: { purpose: 'Upload your own MP4 clip (up to 100 MB, 3–30 seconds).', args: ['video.mp4'], flags: {}, output: { upload: 'upload fields including id, videoUrl, seconds, qualities' }, examples: ['upload clip.mp4'] },
  quote: { purpose: 'Get the credit cost and estimated time before creating.', args: [], flags: source,
    output: { credits: 'number', quality: 'standard|high', estimatedSeconds: 'number', balance: 'number' }, examples: ['quote --template <id> --quality standard'] },
  create: { purpose: 'Create a video with a price ceiling and an idempotency key.', args: [], flags: { ...source,
    character: flag('string', 'Character ID (required unless --dry-run).', { requiredUnless: 'dry-run' }),
    'max-credits': { ...maxCredits, required: false, requiredUnless: 'dry-run' },
    'idempotency-key': key, 'dry-run': flag('boolean', 'Return a quote without creating or spending credits.'), ...waiting,
  }, output: { ...jobShape, idempotencyKey: 'string; also printed to stderr before submission', dryRun: 'quote fields instead of job when --dry-run' },
  examples: ['create --template <id> --character <id> --quality standard --max-credits 50 --wait --output video.mp4', 'create --upload <id> --quality high --dry-run'] },
  models: { purpose: 'List available Playground models or inspect full model fields.', args: [], flags: {
    kind, model: flag('string', 'Show one model and its full settings schema.'),
  }, output: '{models:[{id,name,kind,description?,prompt,images,video?,fields}]} or {model:full schema}',
  examples: ['models --kind video', 'models --model <id>'] },
  'generate video': { purpose: 'Generate a Playground video with a credit ceiling.', args: [], flags: {
    ...generation, image: { ...generation.image, description: 'Character ID[:start|end|ref]; repeatable.' },
    video: flag('string', 'Source video: upload:<id> or template:<id>.'),
  }, output: { ...jobShape, idempotencyKey: 'string; quote fields instead when --dry-run' },
  examples: ['generate video --model <id> --prompt "A honey river" --set duration=5 --image <id>:start --max-credits 50 --wait --output video.mp4'] },
  'generate image': { purpose: 'Generate Playground images with a credit ceiling.', args: [], flags: generation,
    output: { ...jobShape, idempotencyKey: 'string; quote fields instead when --dry-run' },
    examples: ['generate image --model <id> --prompt "A honey jar" --max-credits 50 --wait --output image.png'] },
  'skills list': { purpose: 'List bundled agent skills. No login needed.', args: [], flags: {},
    output: { skills: [{ name: 'string', path: 'bundled directory' }] }, examples: ['skills list'] },
  'skills install': { purpose: 'Install bundled skills; preserve user files and edits. No login needed.', args: [], flags: {
    agent: flag('string', 'Agent skills directory; defaults to all.', { enum: ['claude', 'codex', 'all'], default: 'all' }),
    dir: flag('string', 'Override the skills root: installs into <path>/<skill-name> once.'),
  }, output: { paths: ['written absolute paths'], skipped: ['preserved absolute paths'] },
    examples: ['skills install', 'skills install --agent codex', 'skills install --dir ./my-skills'] },
  video: { purpose: 'Inspect a video or image job, optionally wait and download.', aliases: ['job'], args: ['job-id'], flags: waiting, output: jobShape, examples: ['video <id> --wait --output video.mp4'] },
  videos: { purpose: 'List your video or image jobs.', args: [], flags: { limit, kind, status: flag('string', 'Filter video status.', { enum: ['processing', 'completed', 'failed'] }) }, output: { jobs: ['job fields, as in video'] }, examples: ['videos --status completed --limit 10', 'videos --kind image'] },
  retry: { purpose: 'Retry a failed video with a credit ceiling.', args: ['job-id'], flags: { 'max-credits': maxCredits,
    'idempotency-key': key, ...waiting }, output: { ...jobShape, idempotencyKey: 'string' }, examples: ['retry <id> --max-credits 50 --wait'] },
  download: { purpose: 'Download a completed video and print its absolute path.', args: ['job-id'], flags: {
    output: flag('string', 'Destination path.', { default: './honeyvid-<id>.mp4' }),
  }, output: { jobId: 'string', path: 'absolute path' }, examples: ['download <id>', 'download <id> --output ./video.mp4'] },
  account: { purpose: 'Show credits, plan and the top-up URL.', args: [], flags: {}, output: 'account fields plus topUpUrl:string', examples: ['account'] },
  setup: { purpose: 'Print remote MCP setup for Claude Code, Codex or Cursor.', args: ['claude|codex|cursor|all?'], flags: {
    apply: flag('boolean', 'Run the Claude command when available; only print config files.'),
  }, output: { url: 'string', next: 'honeyvid skills install', configurations: [{ target: 'claude|codex|cursor', command: 'string?', path: 'string?', config: 'string|object?', applied: 'boolean?', note: 'string?' }] }, examples: ['setup all', 'setup claude --apply'] },
  schema: { purpose: 'Print the complete machine-readable CLI schema.', args: [], flags: {}, output: 'this schema', examples: ['schema'] },
};

const globalFlags = {
  json: flag('boolean', 'Print compact JSON; default when stdout is not a TTY.'),
  'base-url': flag('string', 'HoneyVid base URL.', { default: 'HONEYVID_URL or https://honeyvid.ai' }),
  help: flag('boolean', 'Show help for the selected command.'),
};
export const schema = {
  name: 'honeyvid', version, commands, globalFlags,
  environment: { HONEYVID_URL: 'Default base URL.', HONEYVID_TOKEN: 'Refresh token overriding local login (secret).',
    HOME: 'Home directory for agent skills; --dir overrides the skills root.', XDG_CONFIG_HOME: 'Config parent directory; defaults to ~/.config.', DISPLAY: 'Linux browser detection; missing means headless.' },
  authentication: { clientId: 'honeyvid-cli', pkce: 'S256', scopes: ['videos:read', 'videos:create', 'offline_access'],
    resource: '<base>/api', storage: '<XDG_CONFIG_HOME or ~/.config>/honeyvid/auth.json (0600; directory 0700)', pendingLoginSeconds: 600 },
  envelopes: { success: { ok: true, data: 'command output above' }, failure: { ok: false,
    error: { code: 'string', message: 'string', suggestion: 'string', retryable: 'boolean', retryAfter: 'seconds? (429)',
      idempotencyKey: 'string? (create/retry/generate)', jobId: 'string? (waiting/download errors)' } } },
  exitCodes: { 0: 'Success', 1: 'Error', 2: 'Usage error', 3: 'Not signed in; run honeyvid login', 4: 'Not found',
    5: 'Credits, limit, conflict, rate limit or price above maximum', 6: 'Job failed', 7: 'Wait timed out; job still running' },
  constraints: ['Never prompts for input.', 'Choose exactly one of --template and --upload for quote/create.',
    'create requires --character and --max-credits except with --dry-run.', 'characters add requires exactly one file or --url.',
    'generate requires --model, --prompt and --max-credits, including --dry-run.',
    'Repeated --set keys are rejected; image generation accepts character IDs without roles.',
    '--output on generate/create/video/retry requires a completed job or --wait.', 'Progress and secrets warning go to stderr.',
    'Create/retry/generate never retry network or 5xx errors automatically; reuse the printed idempotency key.',
    'Requests rejected with 401 refresh once and replay once with the same idempotency key.'],
};

/** Parse long flags strictly; reject typos before any network or paid request.
 * @param {string[]} argv */
export function parseArgs(argv) {
  const words = [];
  const options = {};
  const allFlags = { ...globalFlags, ...Object.assign({}, ...Object.values(commands).map(command => command.flags)) };
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { literal = true; continue; }
    if (!literal && (arg.startsWith('--') || arg === '-h')) {
      const equal = arg.indexOf('=');
      const name = arg === '-h' ? 'help' : arg.slice(2, equal < 0 ? undefined : equal);
      const spec = allFlags[name];
      if (!spec) throw usage(`Unknown flag: --${name}`);
      if (Object.hasOwn(options, name) && !spec.repeatable) throw usage(`Duplicate flag: --${name}`);
      if (spec.type === 'boolean') {
        if (equal >= 0) throw usage(`--${name} does not take a value.`);
        options[name] = true;
      } else {
        const value = equal >= 0 ? arg.slice(equal + 1) : argv[++i];
        if (!value || value.startsWith('--')) throw usage(`--${name} needs a value.`);
        options[name] = spec.repeatable ? [...(options[name] || []), value] : value;
      }
    } else if (!literal && arg.startsWith('-')) throw usage(`Unknown flag: ${arg}`);
    else words.push(arg);
  }
  let command = words.shift() || '';
  if (command === 'job') command = 'video';
  if (['auth', 'characters', 'generate', 'skills'].includes(command) && Object.hasOwn(commands, `${command} ${words[0]}`)) command += ` ${words.shift()}`;
  if (command && !Object.hasOwn(commands, command)) throw usage(`Unknown command: ${command}`);
  if (!command && !options.help && argv.length) throw usage('Choose a command.');
  const spec = commands[command];
  const allowed = { ...globalFlags, ...(spec?.flags || {}) };
  for (const name of Object.keys(options)) if (!Object.hasOwn(allowed, name)) throw usage(`--${name} is not valid for ${command}.`);
  if (spec && !options.help) {
    const required = spec.args.filter(arg => !arg.endsWith('?')).length;
    if (words.length < required || words.length > spec.args.length) throw usage(`Usage: honeyvid ${command} ${spec.args.join(' ')}`);
    for (const [name, rule] of Object.entries(spec.flags)) {
      if (rule.required && !Object.hasOwn(options, name)) throw usage(`Missing --${name}.`);
      if (rule.requiredUnless && !options[rule.requiredUnless] && !Object.hasOwn(options, name)) throw usage(`Missing --${name}.`);
      if (options[name] === undefined) continue;
      if (rule.enum && !rule.enum.includes(options[name])) throw usage(`--${name} must be ${rule.enum.join(' or ')}.`);
      if (rule.type === 'integer' || rule.type === 'number') {
        const number = Number(options[name]);
        if (!Number.isFinite(number) || (rule.type === 'integer' && !Number.isSafeInteger(number)) ||
            number < (rule.minimum ?? Number.MIN_SAFE_INTEGER) || (name === 'timeout' && number <= 0)) throw usage(`Invalid --${name}.`);
        options[name] = number;
      }
      if (rule.pattern && !new RegExp(rule.pattern).test(options[name])) throw usage(`Invalid --${name}.`);
    }
    if (command === 'quote' || command === 'create') {
      if (Boolean(options.template) === Boolean(options.upload)) throw usage('Choose exactly one of --template and --upload.');
    }
    if (command === 'characters add' && Boolean(words[0]) === Boolean(options.url)) throw usage('Choose one local file or --url.');
    if (command === 'login' && options.code && (options['no-browser'] || options.wait)) throw usage('Use --code alone, without --no-browser or --wait.');
    if (command === 'setup' && words[0] && !['claude', 'codex', 'cursor', 'all'].includes(words[0])) throw usage('Choose claude, codex, cursor or all.');
  }
  return { command, args: words, options };
}

/** @param {string} command */
export function help(command = '') {
  const spec = commands[command];
  const lines = spec ? [`honeyvid ${command} ${spec.args.join(' ')}`, spec.purpose, '', 'Flags:',
    ...Object.entries({ ...globalFlags, ...spec.flags }).map(([name, rule]) => `  --${name}${rule.type === 'boolean' ? '' : ` <${rule.type}>`}  ${rule.description}`),
    '', 'Examples:', ...spec.examples.map(example => `  honeyvid ${example}`)]
    : ['honeyvid — drive your HoneyVid account', '', 'Usage: honeyvid <command> [flags]', '',
      ...Object.entries(commands).map(([name, rule]) => `  ${name.padEnd(16)} ${rule.purpose}`),
      '', 'Use honeyvid <command> --help for flags and examples. Alias: job = video.',
      'Global flags: --json, --base-url <url>, --help', 'Examples: honeyvid login --no-browser; honeyvid templates --json'];
  lines.push('', 'Environment:', ...Object.entries(schema.environment).map(([name, description]) => `  ${name}: ${description}`),
    '', 'Exit codes:', ...Object.entries(schema.exitCodes).map(([code, description]) => `  ${code}: ${description}`),
    '', 'JSON: {ok:true,data:...} or {ok:false,error:{code,message,suggestion,retryable,...}}.',
    'JSON is the default for scripts. Progress goes to stderr. Never prompts for input.');
  return `${lines.join('\n')}\n`;
}
