# Генерация недостающих ассетов (тикет 016)

Папка: `tools/gen-assets/`. Результаты складываются в `assets/generated/` (`raw/` — как пришло от модели, корень — после пост-обработки).

Что нужно сгенерировать (не покрыто бесплатными паками, см. `docs/research/pixel-assets.md`):

| Что | Размер в игре | id в `prompts.json` |
|---|---|---|
| Тайлсет Кухни (сайд-скроллер) | сетка 16 px, лист 256×256 | `kitchen_tileset` |
| Выделения (3 вида иконок) | 16×16 | `secretion_drop`, `secretion_puddle`, `secretion_smear` |
| Прыжок крысы (2 кадра) | 32×32 | `rat_jump_1`, `rat_jump_2` |
| Паника человека (3 кадра) | 32×48 | `human_panic_1..3` |
| Параллакс Двор / Кухня / Крыша (по 3 слоя) | 480×270 | `bg_yard_*`, `bg_kitchen_*`, `bg_roof_*` |

## Что проверено 2026-10-21

- **Codex CLI установлен**: `npm i -g @openai/codex` → `codex-cli 0.163.0`, бинарник `%APPDATA%\npm\codex` (`.ps1`/`.cmd` для PowerShell, shim для Git Bash). Работает в обоих шеллах.
- **Codex CLI умеет генерировать картинки сам.** Официальная страница «Image generation» (https://developers.openai.com/codex/image-generation): встроенная генерация использует модель `gpt-image-2`; в CLI — «describe the image in an interactive session, or include `$imagegen` in the prompt»; референс прикладывается через `-i/--image`. Локально это подтверждается: `codex features list` → `image_generation  stable  true`; в бинарнике есть встроенный тул `image_gen` (файлы сохраняются в `~/.codex/generated_images/`) и запасной скрипт `~/.codex/skills/.system/imagegen/scripts/image_gen.py` (Images API, требует `OPENAI_API_KEY`).
  Это исправляет формулировку в тикете 016 («сам он изображения не делает») — она устарела.
- **Тарификация** (https://developers.openai.com/codex/pricing): на плане ChatGPT **Free генерация недоступна**; на платных планах (Plus/Pro/Business/Enterprise) она расходует общий лимит Codex; **с API-ключом действуют цены Images API**.
- **Ограничение `gpt-image-2`**: не поддерживает `background=transparent` (из текста встроенного навыка). Для спрайтов с прозрачностью либо просить ровный magenta-фон и снимать его хромакеем (`post.mjs --chroma ff00ff`), либо идти через API с `gpt-image-1.5` (поддерживает `--background transparent`).
- **Неинтерактивный режим есть**: `codex exec "<задача>"` (https://developers.openai.com/codex/noninteractive), флаги `--json`, `-o <файл>`, `--sandbox workspace-write`, `--skip-git-repo-check` (папка проекта — не git-репозиторий, флаг понадобится). Генерация картинок в `codex exec` в документации отдельно не описана — первые прогоны делать интерактивно.
- Ничего из этого не запускалось с авторизацией: вход не выполнялся, ключи не вводились.

## Шаг 0. Авторизация (делает пользователь сам)

Вариант A — подписка ChatGPT (Plus/Pro/Business/Enterprise), рекомендуемый документацией:

```powershell
codex login            # откроется браузер
codex login status     # проверить
```

Если браузерный колбэк не срабатывает: `codex login --device-auth` (нужно включить device-code login в настройках безопасности ChatGPT).

Вариант B — API-ключ (оплата по тарифам API, подходит для скриптов):

```powershell
# PowerShell, ключ только на текущую сессию, в репозиторий не попадает
$env:OPENAI_API_KEY = "<ключ>"
$env:OPENAI_API_KEY | codex login --with-api-key
```

```bash
# Git Bash
export OPENAI_API_KEY="<ключ>"
printenv OPENAI_API_KEY | codex login --with-api-key
```

Ключ в чат, в файлы проекта и в `prompts.json` не вставлять. Хранилище токенов Codex — `~/.codex/auth.json`, беречь как пароль.

## Путь (a): через Codex CLI

Подходит, если есть платный план ChatGPT и не хочется платить за API отдельно. Минус: меньше контроля над параметрами (размер, прозрачность), файлы падают в `~/.codex/generated_images/`, потом их нужно прогнать через `post.mjs`.

```powershell
cd D:\web-apatia
codex -C D:\web-apatia --sandbox workspace-write
```

Дальше в интерактивной сессии — промпты. Префикс `$imagegen` явно включает навык генерации. Примеры (английский даёт более предсказуемый пиксель-арт):

```
$imagegen Pixel art for a 2D side-scrolling platformer, strict 16x16 pixel grid, flat colors, no anti-aliasing,
16-color palette, 1-px dark outline. A KITCHEN tileset sheet on a 16x16 grid of square tiles: checkered floor
with edge variants, tiled wall, wooden counter top (platform) left/middle/right, lower and upper cabinets,
white gas stove, tall fridge 2x3 tiles, steel sink, shelf with jars, baseboard, vent, door frame, night window.
Square 1024x1024, flat magenta #FF00FF background between tiles. Save the result to assets/generated/raw/kitchen_tileset.png
```

```
$imagegen Single inventory icon, pixel art, 16x16 grid look, flat colors, 6 colors total: a glossy teardrop blob of acid-green
rat slime with one white highlight, centered, on a flat magenta #FF00FF background. Then make two more icons in the same style:
a flat puddle of dark green slime with two satellite drops; a small pile of three dark-brown rat droppings with pale-green stink wisps.
Save as assets/generated/raw/secretion_drop.png, secretion_puddle.png, secretion_smear.png
```

```
$imagegen Two sprite frames of the same grey street rat, side view facing right, pixel art, 32x32 box each, 8 colors,
black outline, flat magenta #FF00FF background. Frame 1: crouched take-off, hind legs compressed, tail curled.
Frame 2: mid-air leap, body stretched horizontally, paws extended. Save as rat_jump_1.png and rat_jump_2.png in assets/generated/raw/
```

```
$imagegen Three run-cycle frames of the same chubby cook in a stained white apron, side view facing left, PANICKING
(arms up, mouth open, sweat drops), pixel art 32x48 box, 10 colors, black outline, flat magenta background.
Save as human_panic_1.png .. human_panic_3.png in assets/generated/raw/
```

```
$imagegen Three parallax layers for a BACKYARD DUMP level of a pixel-art platformer, each 16:9, horizontally tileable,
flat colors, 16-color muted grey-brown palette. FAR: dusk sky, silhouette of Soviet panel apartment blocks with lit windows.
MID: concrete fence with graffiti, leafless tree, street lamp, row of green dumpsters at the bottom 20%, everything above magenta #FF00FF.
NEAR: only ground clutter in the bottom 15% (dry grass, bottle, newspaper, puddle), rest magenta.
Save as bg_yard_far.png, bg_yard_mid.png, bg_yard_near.png in assets/generated/raw/
```

Те же три слоя для Кухни (кремовая плитка + окно; верхние шкафы и полки; швабра, крошки, таракан) и Крыши (плоские полосы закатного неба + силуэты антенн; соседние крыши с трубами и бельём; перила и лужа) — готовые тексты лежат в `prompts.json` (`bg_kitchen_*`, `bg_roof_*`), их можно копировать в сессию как есть.

Если Codex положил файлы в `~/.codex/generated_images/`, а не в проект — скопировать их в `assets/generated/raw/` с именами из таблицы (или указать папку через `--in`), затем:

```powershell
cd D:\web-apatia\tools\gen-assets
npm install                         # один раз, ставит sharp
node post.mjs --chroma ff00ff --preview 4
```

Неинтерактивно (после того как интерактивный режим подтвердил, что генерация работает под вашим планом):

```powershell
codex exec --skip-git-repo-check --sandbox workspace-write -C D:\web-apatia -o assets\generated\last.md "$imagegen <промпт из prompts.json> Save the file to assets/generated/raw/<id>.png"
```

## Путь (b): прямой скрипт на Images API

Подходит, если есть API-ключ. Плюсы: точные размеры, `background=transparent` без хромакея (на `gpt-image-1.5`/`gpt-image-1`), повторяемость, батч за одну команду.

```powershell
cd D:\web-apatia\tools\gen-assets
npm install                              # sharp нужен только для post.mjs; gen.mjs — чистый Node 20+

node gen.mjs --dry-run                   # напечатать итоговые промпты, без запросов
$env:OPENAI_API_KEY = "<ключ>"           # только на эту сессию
node gen.mjs --group icons               # дёшево проверить стиль на 16×16 иконках
node gen.mjs --group sprites
node gen.mjs --group backgrounds --quality high
node gen.mjs --only kitchen_tileset --force

node post.mjs --preview 4                # даунскейл + квантование; preview/ — увеличенные x4 для глаза
```

Параметры `gen.mjs`: `--model` (по умолчанию `gpt-image-1.5`; допустимы `gpt-image-1`, `gpt-image-1-mini` — дешевле, `gpt-image-2` — без прозрачности, тогда скрипт сам дописывает в промпт magenta-фон, а снимать его надо `post.mjs --chroma ff00ff`), `--quality low|medium|high`, `--group`, `--only id1,id2`, `--force`, `--out <папка>`, `--prompts <файл>`. Для каждого id пишутся `raw/<id>.png` и `raw/<id>.json` (параметры, `revised_prompt`, `usage`) — по ним потом ведётся учёт затрат и сравнение версий.

Размеры запросов: `gpt-image-1.x` принимает только `1024x1024`, `1536x1024`, `1024x1536` — поэтому фоны запрашиваются 1536×1024 и в `post.mjs` обрезаются по центру до 16:9 (`crop: "cover"`), затем ужимаются до 480×270. Для `gpt-image-2` размеры свободнее (кратно 16 px, отношение сторон ≤ 3:1), можно запрашивать сразу 1920×1088 и ужимать ровно в 4 раза.

## Пост-обработка: что делает `post.mjs` и что докручивать руками

1. **Даунскейл до пиксельной сетки.** Модель рисует «большие пиксели» неровно, поэтому честный даунскейл в N раз даёт грязь. Правила: для спрайтов/иконок/тайлов — `kernel: nearest` (берёт центр каждой клетки; если сетка «плавает», попробовать `lanczos3`, потом всё равно подчистить вручную); для фонов 480×270 — `lanczos3`, там мелкая грязь не видна.
2. **Квантование палитры** — PNG с палитрой на N цветов без дизеринга (`colors` в `prompts.json`, по умолчанию 16). Дизеринг выключен специально: он убивает пиксель-арт. Чтобы все слои одного уровня жили в одной палитре, после генерации открыть результат в Aseprite/LibreSprite и применить одну общую палитру (`Sprite → Color Mode → Indexed` с общим `.gpl`); скрипт это не делает.
3. **Удаление фона.** `background=transparent` на `gpt-image-1.5` даёт альфу сразу, но края часто полупрозрачные — после квантования пройтись порогом альфы (в Aseprite: `Layer → Remove alpha` / порог 50%). Для `gpt-image-2` и Codex CLI — `--chroma ff00ff --chroma-tolerance 60`.
4. **Кадры анимации.** Модель не держит персонажа одинаковым между запросами. Для `rat_jump_*` и `human_panic_*` практичнее: сгенерировать 1 удачный кадр, а остальные кадры дорисовать руками поверх него (или через `POST /v1/images/edits` с референсом — в `gen.mjs` не реализовано, при необходимости добавить `image` + `prompt` к `/images/edits`).
5. **Тайлсет.** Сетка 16 px у модели не совпадёт с реальной. Ожидать, что `kitchen_tileset.png` — это источник отдельных предметов (плита, холодильник, раковина) для ручной нарезки, а не готовый лист. Бесшовные стыки пола/стен проще нарисовать самим.
6. **Бесшовность фонов.** «Horizontally tileable» модели выполняют плохо. Проверить стык: в `post.mjs` нет авто-проверки; в Aseprite — `Edit → Shift` на половину ширины и замазать шов.

## Как решить «годится / дорисовывать руками» (выход тикета 016)

Прогон по возрастающей цене: `icons` (3 запроса) → `sprites` (5) → `backgrounds` (9) → `kitchen_tileset` (1). После каждого — смотреть `assets/generated/preview/*.png`. Критерии:

- Иконки 16×16: читаются ли силуэты на 1× без подписи. Если нет после 2 итераций промпта — руками быстрее (3 иконки = ~час).
- Кадры: совпадает ли персонаж с базовым спрайтом из паков (Calciumtrice / Urban Character Pack). Скорее всего нет — тогда ИИ-кадр используется как референс позы, рисуется руками.
- Фоны 480×270: это самый вероятный успех — слои FAR почти наверняка годятся, MID/NEAR — после подчистки шва и альфы.
- Тайлсет: ожидаемо «источник предметов», не лист.

Вердикт записать в тикет 016, туда же — суммарный `usage` из `raw/*.json`.

## Ленты спрайтов (крысы и Люди, 2026-10-21)

Codex рисует 6 кадров в ряд на magenta одной картинкой 1536×1024; мутантные варианты — тем же промптом с референсом `-i assets/generated/raw/rat_base_strip.png`
(позы и раскладка сохраняются). Codex в `exec` не может писать в проект («read-only workspace») — файл остаётся в `~/.codex/generated_images/<thread>/`,
путь есть в его ответе; копируем руками. Резка в лист:

```bash
node tools/gen-assets/split-strip.mjs --in assets/generated/raw/rat_base_strip.png --out apps/client/public/sprites/rat_base.png --cell 48x24 --frames 6 --preview 4
node tools/gen-assets/split-strip.mjs --in assets/generated/raw/human_P_strip.png --out apps/client/public/sprites/human_P.png --cell 24x32 --frames 6 --fit height
```

Хвосты крыс почти касаются соседнего кадра, поэтому при `--frames N` разрезы ищутся по самым пустым колонкам около границ ячеек, а не по чистым промежуткам.

Сетки иконок (предметы): `--rows R --cols C` вместо `--frames` — ячейки режутся по самым пустым линиям у границ и идут в лист в порядке строк:

```bash
node tools/gen-assets/split-strip.mjs --in assets/generated/raw/items_a_grid.png --out apps/client/public/sprites/items_a.png --cell 16x16 --rows 4 --cols 4 --anchor center --scale 0.95
```

Если Codex вернул путь с обратными слэшами (`C:\Users\...\generated_images\...`), grep по `generated_images/` его не найдёт — брать путь из лога руками.
