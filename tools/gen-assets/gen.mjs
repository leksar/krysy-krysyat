#!/usr/bin/env node
// Генерация картинок через OpenAI Images API (POST /v1/images/generations).
// Ключ берётся ТОЛЬКО из переменной окружения OPENAI_API_KEY. Никаких ключей в файлах репозитория.
//
// Использование (из любой папки):
//   node tools/gen-assets/gen.mjs --dry-run                 # показать промпты, ничего не запрашивать
//   node tools/gen-assets/gen.mjs --group backgrounds       # только одна группа
//   node tools/gen-assets/gen.mjs --only rat_jump_1,rat_jump_2
//   node tools/gen-assets/gen.mjs --model gpt-image-1 --quality low --force
//
// Результат: <out>/raw/<id>.png + <out>/raw/<id>.json (параметры запроса и revised_prompt).
// Дальше: node tools/gen-assets/post.mjs  (даунскейл до пиксельной сетки, квантование, хромакей).

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

const promptsPath = resolve(args.prompts ?? join(here, 'prompts.json'));
const outDir = resolve(args.out ?? join(here, '..', '..', 'assets', 'generated'));
const rawDir = join(outDir, 'raw');
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const only = args.only ? String(args.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
const group = args.group ? String(args.group) : null;

const spec = JSON.parse(await readFile(promptsPath, 'utf8'));
const defaults = spec.defaults ?? {};
let items = spec.items ?? [];
if (group) items = items.filter((it) => it.group === group);
if (only) items = items.filter((it) => only.includes(it.id));
if (items.length === 0) {
  console.error('Нечего генерировать: фильтры --group/--only не совпали ни с одним item в', promptsPath);
  process.exit(2);
}

const model = String(args.model ?? defaults.model ?? 'gpt-image-1.5');
const quality = String(args.quality ?? defaults.quality ?? 'medium');
const apiBase = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');

const apiKey = process.env.OPENAI_API_KEY;
if (!dryRun && !apiKey) {
  console.error(
    'Нет OPENAI_API_KEY в окружении.\n' +
      '  PowerShell:  $env:OPENAI_API_KEY = "<ключ>"   (только на текущую сессию)\n' +
      '  Git Bash:    export OPENAI_API_KEY="<ключ>"\n' +
      'Либо запустите с --dry-run, чтобы только посмотреть промпты.',
  );
  process.exit(1);
}

await mkdir(rawDir, { recursive: true });
console.log(`Модель: ${model}, качество: ${quality}, элементов: ${items.length}, вывод: ${rawDir}${dryRun ? '  [DRY RUN]' : ''}`);

let okCount = 0;
let skipCount = 0;
let failCount = 0;

for (const it of items) {
  const pngPath = join(rawDir, `${it.id}.png`);
  const metaPath = join(rawDir, `${it.id}.json`);
  const fullPrompt = [defaults.stylePrefix, it.prompt, defaults.styleSuffix].filter(Boolean).join('\n\n');
  const background = it.background ?? defaults.background ?? 'auto';

  const body = {
    model,
    prompt: fullPrompt,
    n: 1,
    size: it.size ?? defaults.size ?? '1024x1024',
    quality,
    output_format: 'png',
  };
  // background=transparent поддерживают gpt-image-1 / gpt-image-1.5 / gpt-image-1-mini (png/webp).
  // gpt-image-2 параметр не принимает: для него фон задаётся промптом (ровный magenta #FF00FF) и снимается в post.mjs --chroma.
  if (background !== 'auto' && !/gpt-image-2/.test(model)) body.background = background;
  if (/gpt-image-2/.test(model) && background === 'transparent') {
    body.prompt += '\n\nBackground: a perfectly flat solid magenta (#FF00FF) color filling every pixel that is not part of the subject; no shadows on the background.';
  }

  if (!force && (await exists(pngPath))) {
    console.log(`  = ${it.id}: уже есть, пропуск (используйте --force)`);
    skipCount++;
    continue;
  }

  if (dryRun) {
    console.log(`\n--- ${it.id} [${it.group}] ${body.size} bg=${background} -> ${it.target?.w}x${it.target?.h}\n${body.prompt}`);
    continue;
  }

  try {
    const t0 = Date.now();
    const data = await generateWithRetry(body);
    const img = data?.data?.[0];
    if (!img?.b64_json) throw new Error('В ответе нет data[0].b64_json: ' + JSON.stringify(data).slice(0, 300));
    await writeFile(pngPath, Buffer.from(img.b64_json, 'base64'));
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          id: it.id,
          group: it.group,
          model,
          request: { ...body, prompt: undefined },
          prompt: body.prompt,
          revised_prompt: img.revised_prompt ?? null,
          usage: data.usage ?? null,
          target: it.target ?? null,
          colors: it.colors ?? defaults.colors ?? null,
          generatedAt: new Date().toISOString(),
          ms: Date.now() - t0,
        },
        null,
        2,
      ),
    );
    console.log(`  + ${it.id}: ${pngPath} (${Math.round((Date.now() - t0) / 1000)} c)`);
    okCount++;
  } catch (err) {
    console.error(`  ! ${it.id}: ${err.message}`);
    failCount++;
  }
}

if (!dryRun) console.log(`\nГотово: ${okCount} сгенерировано, ${skipCount} пропущено, ${failCount} с ошибкой.`);

// ---------------------------------------------------------------------------

async function generateWithRetry(body, attempts = 4) {
  let delay = 5000;
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${apiBase}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || i === attempts) {
      throw new Error(`HTTP ${res.status}: ${safeErr(text)}`);
    }
    const ra = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : delay;
    console.warn(`    HTTP ${res.status}, повтор через ${Math.round(wait / 1000)} c (${i}/${attempts})`);
    await new Promise((r) => setTimeout(r, wait));
    delay *= 2;
  }
}

function safeErr(text) {
  try {
    const j = JSON.parse(text);
    return j.error?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split('=', 2);
    if (inline !== undefined) out[k] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}
