# Движок клиента и мобильные ограничения (PWA, тач, GitHub Pages)

Тикет: [003-engine-and-mobile](../wayfinder/tickets/003-engine-and-mobile.md). Дата исследования: 2026-10-20.
Контекст: мобильный реалтайм-платформер «Крысы крысят» на 2–6 телефонов (Android-браузеры в первую очередь), джойстик + кнопки, клиент — статика на GitHub Pages, сервер на Node (`wss://`), та же физика желательно должна крутиться на сервере.

## TL;DR — рекомендация

**PixiJS 8 (рендер) + собственный модуль симуляции на чистом TypeScript (`packages/sim`), общий для клиента и Node-сервера. Сборка Vite + TS, PWA через `vite-plugin-pwa`, деплой GitHub Actions → Pages.**

Почему не «движок с физикой»:

- Главное требование — одна и та же физика на клиенте и сервере. Ни один из рассмотренных движков этого не даёт штатно: Phaser `HEADLESS` «всё равно требует DOM, предназначен для unit-тестов, а не для запуска Phaser на сервере» ([docs.phaser.io, константа HEADLESS](https://docs.phaser.io/api-documentation/namespace/phaser#headless)); Arcade Physics включается на уровне Scene и работает только с GameObjects ([Arcade concepts](https://docs.phaser.io/phaser/concepts/physics/arcade)). У KAPLAY физика тоже компонент сцены (`area()`, `body()`), серверного режима нет ([README](https://github.com/kaplayjs/kaplay)).
- Платформерная физика для нашего случая (AABB-тела против тайловой сетки, гравитация, прыжок, «лежишь — поднимают») — это 200–400 строк детерминированного кода с фиксированным шагом. Её всё равно придётся писать для сервера; дублировать её движком на клиенте — ловушка рассинхрона.
- Значит, от движка нужен только рендер, ввод, ассеты. Здесь PixiJS — самый «тонкий» и живой вариант, а Phaser 4 тянет 1.37 МБ минифицированного кода с неиспользуемыми Arcade/Matter.

Запасной вариант: **Phaser 4** как «батарейки в комплекте» (тайлмапы Tiled, камера, Scale Manager с fullscreen/ориентацией, звук, твины) — если в прототипе 010 окажется, что на Pixi слишком долго собирать обвязку. Но и тогда симуляция остаётся в `packages/sim`, Phaser только рисует.

## Сравнение кандидатов

Данные о релизах — с GitHub Releases / npm registry на 2026-10-20.

| | Phaser 4 | PixiJS 8 | KAPLAY | Чистый canvas |
|---|---|---|---|---|
| Текущая версия | 4.2.1 (2026-07-09), 4.0.0 вышел 2026-04-10 ([releases](https://api.github.com/repos/phaserjs/phaser/releases)) | 8.22.0 (2026-10-01), 8.21.0 (2026-09-17) ([releases](https://api.github.com/repos/pixijs/pixijs/releases)) | 3001.0.19 (2025-06-15, `latest`); 4000.0.0-alpha.27.1 (2026-05-12, `next`) ([dist-tags](https://registry.npmjs.org/-/package/kaplay/dist-tags), [CHANGELOG](https://github.com/kaplayjs/kaplay/blob/master/CHANGELOG.md)) | — |
| Активность | релиз каждые 1–2 месяца после 4.0; 40.5k ★ | релизы каждые ~2 недели; 48.4k ★ | стабильная ветка не обновлялась >1 года, вся работа в alpha; 1.8k ★ | — |
| Размер | `dist/phaser.min.js` 1 375 976 Б; `phaser-arcade-physics.min.js` 1 266 396 Б ([jsDelivr](https://data.jsdelivr.com/v1/packages/npm/phaser@4.2.1)); монолит | ~925 КБ min / ~265 КБ gzip за весь пакет ([bundlephobia](https://bundlephobia.com/api/size?package=pixi.js@8.22.0)), ESM, tree-shaking | `dist/kaplay.mjs` 188 534 Б (не минифицирован) | 0 |
| Рендер | WebGL (новый node-based рендерер, без WebGPU) ([Phaser 3 vs 4](https://phaser.io/news/2026/05/phaser-3-vs-phaser-4)) | WebGL по умолчанию, WebGPU опционально (`preference`) ([Application](https://pixijs.com/8.x/guides/components/application)) | WebGL | Canvas 2D |
| Физика | Arcade + Matter, привязаны к Scene | нет | area/body, в v4000 переписывается (GJK, broadphase), ломающие изменения в alpha.25/26 | нет |
| Сервер / headless | HEADLESS требует DOM, только для тестов | не нужен: sim отдельно | нет | — |
| Тач | единое API мышь/тач, `activePointers` (по умолчанию 1 тач-поинтер, для джойстика+кнопок нужно `addPointer`) ([Input](https://docs.phaser.io/phaser/concepts/input), [GameConfig](https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig)) | EventSystem, «Full Mouse & Multi-touch Support» ([intro](https://pixijs.com/8.x/guides/getting-started/intro)); для джойстика проще слушать Pointer Events на canvas напрямую | Buttons API (клавиатура/мышь/геймпад), виртуальных кнопок нет | Pointer Events вручную |
| TypeScript / Vite | полные d.ts; официальный `template-vite-ts` ([templates](https://docs.phaser.io/phaser/getting-started/project-templates)) | написан на TS; `npm create pixi.js@latest` ([README](https://github.com/pixijs/pixijs)) | d.ts есть | — |
| Батарейки | тайлмапы (в т.ч. TilemapGPULayer одним квадом), камера, Scale Manager (fullscreen, lockOrientation), звук, твины, загрузчик | сцена-граф, спрайт-батчинг, Assets, фильтры; камеры/тайлмапы/звук — свои или сторонние | сцены, компоненты, спрайты, звук | всё своё |

Выводы по каждому:

- **Phaser 4** — зрелый, свежий (4.0 вышел в апреле 2026, официально «нет причин начинать на Phaser 3»), много готового для платформера. Минусы под наши критерии: монолитный бандл, физика непереносима на сервер, инпут-слой абстрагирует Pointer Events (лишний слой между пальцем и симуляцией). Хороший запасной вариант.
- **PixiJS 8** — только рендер, зато самый активный проект, маленький бандл, естественно ложится на архитектуру «sim отдельно, view отдельно». Нужно самим: камера (контейнер с отрицательным смещением), тайлмап (спрайты из атласа, статичный слой можно запечь в RenderTexture), звук (Web Audio / howler), загрузка (есть `Assets`). Советы по производительности для слабых устройств: атласы, `antialias: false`, меньше Graphics/фильтров, BitmapText ([performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips)).
- **KAPLAY** — форк Kaboom (в v3001 `kaboom()` переименован в `kaplay()`), приятный API, но: стабильная ветка год без релизов, вся разработка в alpha с ломающими изменениями физики, маленькое сообщество. Для прототипа за вечер — да, для проекта на месяцы — нет.
- **Чистый canvas 2D** — для пиксель-арта 6 крыс + голуби + тайлы на средних Android потянет, но батчинг/атласы/масштабирование придётся делать самим, а выигрыша перед Pixi (0 зависимостей vs 265 КБ gzip) для приватной игры нет. Годится как «план Z» или для HUD поверх WebGL-канваса.

## Архитектура под рекомендацию

```
packages/sim      чистый TS, tsconfig lib: ["es2022"] без "dom" — гарантия, что он запустится в Node
                  fixed-step (например 30 или 60 Гц), детерминированный, вход = снимок кнопок/оси джойстика
apps/client       Vite + TS, PixiJS 8, PWA; рендерит состояние sim с интерполяцией
apps/server       Node, ws; гоняет тот же sim (детали — тикет 001)
```

- Цикл клиента: `requestAnimationFrame` вызывается с частотой дисплея (60/90/120 Гц), поэтому симуляцию двигать аккумулятором фиксированного шага, а не «один апдейт на кадр»; в фоновой вкладке rAF останавливается — при возврате зажимать накопленное время ([MDN rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)).
- Ввод не «по событиям», а «снимок состояния на тик»: обработчики Pointer Events только обновляют структуру `{axisX, axisY, jump, action}`, sim читает её на каждом шаге. Это убирает зависимость от частоты событий и даёт одинаковый вход для предсказания на клиенте и сервера.

## Мобильные грабли и решения

### 1. GitHub Pages: базовый путь, SPA, HTTPS

- Сайт живёт на `https://<user>.github.io/<repo>/` → в `vite.config.ts` `base: '/<repo>/'` (для `<user>.github.io` или своего домена — `/`) ([Vite static deploy](https://vite.dev/guide/static-deploy)). Все ссылки на ассеты — через импорты/`import.meta.env.BASE_URL`, не абсолютные `/`.
- Официальный workflow Vite: `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`, источник Pages — «GitHub Actions» (там же). Конкретика репозитория — тикет 005.
- Pages не умеет SPA-rewrite, только кастомный `404.html` ([docs.github.com](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site)). Нам маршрутизация не нужна: одна страница, экраны (Нора/Вылазка/лобби) — состояние внутри игры; код комнаты — в `?room=` или `#room=`.
- HTTPS на `github.io` включён автоматически, есть «Enforce HTTPS» ([docs.github.com](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)). Это обязательное условие для service worker, Wake Lock, `pointerrawupdate`, `getCoalescedEvents`.

### 2. PWA: манифест и service worker

- `vite-plugin-pwa` (v1.2.0) генерирует манифест, SW через workbox и скрипт регистрации; `scope` манифеста выводится из Vite `base` — отдельно настраивать не надо ([guide](https://vite-pwa-org.netlify.app/guide/), [minimal requirements](https://vite-pwa-org.netlify.app/guide/pwa-minimal-requirements)). SW ляжет в `/<repo>/sw.js` и по правилам scope контролирует `/<repo>/` и ниже — ровно то, что нужно; шире без заголовка `Service-Worker-Allowed` нельзя, а Pages заголовки не настраивает ([MDN Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)).
- Минимум манифеста: `name`/`short_name`, `description`, `theme_color` (совпадает с `<meta name="theme-color">`), иконки 192 и 512 (плюс `maskable`), `start_url` относительно base, `display` ([minimal requirements](https://vite-pwa-org.netlify.app/guide/pwa-minimal-requirements), [Chrome install criteria](https://web.dev/articles/install-criteria)).
- `display: "fullscreen"` — браузер падает по цепочке `fullscreen → standalone → minimal-ui → browser`; реальный режим читать через `@media (display-mode: …)` ([MDN display](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/display)). `orientation: "landscape"` в манифесте — единственный надёжный способ зафиксировать альбомную ориентацию для установленного приложения ([MDN orientation](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/orientation)).
- Chrome: пункт «Установить приложение» в меню доступен без SW с `fetch`-обработчиком (с Chrome 108 на мобильных), но автоматический install-prompt всё ещё требует `fetch`-обработчик ([Chrome blog, 2023](https://developer.chrome.com/blog/update-install-criteria)). `generateSW` его даёт.
- **Обновления**: стратегия `generateSW` + `registerType`. `autoUpdate` перезагружает страницу при обнаружении новой версии ([strategies & behaviors](https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors)) — посреди Вылазки это катастрофа. Брать `prompt`, проверять обновление и применять его только в Норе/лобби; плюс сервер должен отвергать клиента с несовместимой версией протокола (тикет 001).
- Клиент и сервер на разных origin (`github.io` ↔ `sslip.io`) — для WebSocket CORS не нужен; но если будет HTTP-запрос (логин ник+код), серверу понадобится CORS.

### 3. Полноэкранный режим

- `element.requestFullscreen()` требует transient user activation и возвращает промис, который может быть отклонён ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen)). Поэтому: стартовый экран «Нажми, чтобы войти в Нору» — один тап разблокирует fullscreen, AudioContext и Wake Lock разом.
- Поддержка: Chrome Android и Samsung Internet ≥ 10.1 — полная; Safari iOS — «partial» на всех версиях ([caniuse fullscreen](https://caniuse.com/fullscreen)); на iPhone рассчитывать на Fullscreen API нельзя, там fullscreen только через установку PWA (`display`). Android — основная цель, iOS — «как получится».
- В Phaser это `scene.scale.startFullscreen()` из `pointerup` ([Scale Manager](https://docs.phaser.io/phaser/concepts/scale-manager)); в Pixi/канвасе — сами на `document.documentElement`.

### 4. Блокировка ориентации

- Современный API — `screen.orientation.lock('landscape')`; `Screen.lockOrientation()` устарел ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen/lockOrientation)). `lock()` обычно работает только на мобильных и в fullscreen-контексте, кидает `NotSupportedError`/`SecurityError` ([MDN lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock)); MDN помечает его «Limited availability».
- Практика: (а) манифест `orientation: landscape` для установленного PWA; (б) после входа в fullscreen — `lock('landscape').catch(() => {})`; (в) всегда — CSS-оверлей «поверни телефон» по `@media (orientation: portrait)`, потому что в обычной вкладке/на iOS блокировка не сработает.
- Фиксируем ли вообще landscape — решение геймдизайна, но для платформера с джойстиком слева и кнопками справа альбомная ориентация — очевидный выбор.

### 5. Wake Lock (экран не гаснет)

- `navigator.wakeLock.request('screen')`: только HTTPS, только видимый документ; лок автоматически снимается при уходе вкладки в фон → повторно запрашивать на `visibilitychange` ([MDN Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)). Baseline 2025.
- Поддержка: Chrome Android, Firefox Android, Samsung Internet ≥ 14, Safari iOS ≥ 16.4 ([caniuse wake-lock](https://caniuse.com/wake-lock)). Запрашивать в том же тапе «войти», обёрнуто в try/catch (может отказать при энергосбережении).

### 6. Задержка и корректность тача

- На canvas: `touch-action: none` — браузер не начинает пан/зум и не шлёт `pointercancel`, наши `pointermove` живут до конца жеста ([MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)). Плюс `overscroll-behavior: none` на `html/body` (pull-to-refresh), `user-select: none`, `-webkit-tap-highlight-color: transparent`.
- Использовать **Pointer Events**, не Touch Events: `pointerId` различает пальцы (джойстик левым, прыжок правым одновременно), `isPrimary`, `setPointerCapture` держит палец за элементом; на тач-устройствах capture выдаётся неявно на `pointerdown`; Baseline с 2020 ([MDN Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)).
- Если всё же вешать `touchmove`/`touchstart` на `document`/`window`/`body` — они по умолчанию **passive**, `preventDefault()` игнорируется; нужен явный `{ passive: false }` ([MDN addEventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)). С `touch-action: none` на canvas это не требуется.
- `pointerrawupdate` приходит чаще и раньше, чем `pointermove` (меньше коалесценции), но те же координаты; HTTPS-only, ограниченная поддержка ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerrawupdate_event)). Для джойстика не нужен: мы и так читаем состояние на тик. `getCoalescedEvents` — тоже не нужен (это для рисования).
- Джойстик: «плавающий» (центр там, где палец коснулся левой половины экрана), мёртвая зона ~15 %, радиус ~60–80 CSS px; кнопки — большие зоны в правой половине, срабатывание на `pointerdown` (не на `up`), чтобы прыжок не ждал отпускания. Зоны HUD — в DOM поверх канваса или в самом канвасе: в DOM проще с safe-area, в канвасе — один источник событий. Для прототипа 010 — DOM-оверлей.
- Safe area: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` + отступы HUD через `env(safe-area-inset-*)` ([MDN env](https://developer.mozilla.org/en-US/docs/Web/CSS/env)) — чтобы кнопки не уехали под вырез/жестовую полосу.
- Вибрация на тап/урон: `navigator.vibrate()` — Android да, iOS нет; вызывать после пользовательской активации ([MDN Vibration](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)).

### 7. Производительность на средних Android

- DPR: число пикселей растёт квадратично (390×844 CSS при DPR 3 ≈ 3 Мпикс) ([MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)). Для пиксель-арта рисуем мир в низком внутреннем разрешении (например 480×270 или 640×360) с `nearest`-фильтрацией и растягиваем на экран целым числом — и чётко, и дёшево. В Pixi: `resolution: 1` + `autoDensity`, nearest scale mode для текстур; HUD в DOM остаётся резким сам.
- Атласы (Pixi батчит до 16 текстур за draw call), `antialias: false`, без фильтров/масок в игровом слое, статичные тайлы — одним RenderTexture/слоем ([performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips)).
- WebGPU не нужен: WebGL по умолчанию и у Pixi, и у Phaser; выигрыша для спрайтовой 2D на телефонах нет, а поддержка на Android неровная.
- Тестовая матрица: Chrome Android, Samsung Internet (отстаёт по версиям — см. Wake Lock ≥ 14, fullscreen ≥ 10.1), Firefox Android; iOS Safari — smoke-тест.

### 8. Прочее

- Звук: AudioContext разблокируется только после жеста — тот же тап «войти».
- Приложение в фоне: rAF стоит, WebSocket может жить; при возврате — ресинк состояния с сервера, не «догонять» накопленные тики (тикет 001).

## Vite + TypeScript: стартовая конфигурация

- Монорепо на npm workspaces: `packages/sim`, `apps/client`, `apps/server`. У `sim` — `"lib": ["es2022"]`, без `dom`, тесты на vitest в Node: это и есть проверка «физика крутится на сервере».
- Клиент: `npm create vite@latest -- --template vanilla-ts` + `pixi.js` + `vite-plugin-pwa`; или `npm create pixi.js@latest` (официальные шаблоны Pixi, есть Vite). Для Phaser-запасного варианта — `npm create @phaserjs/game@latest` → `template-vite-ts`.
- `vite.config.ts`: `base: '/<repo>/'`, `VitePWA({ registerType: 'prompt', manifest: { display: 'fullscreen', orientation: 'landscape', … } })`.
- `.github/workflows/deploy.yml` — по образцу из Vite docs (checkout → setup-node lts → `npm ci` → `npm run build` → upload `dist` → deploy-pages).

## Что проверяет прототип (тикет 010)

1. Pixi 8 + DOM-джойстик на реальном среднем Android: задержка от касания до движения спрайта субъективно «мгновенная», 60 fps при 6 крысах + 20 голубях + тайловый Двор.
2. `packages/sim` гоняется в vitest под Node и в браузере даёт побитово тот же результат на одном входе.
3. Fullscreen + `orientation.lock` + Wake Lock из одного тапа на Chrome Android и Samsung Internet; оверлей «поверни телефон» в обычной вкладке.
4. Установка PWA с `github.io/<repo>/`, запуск с иконки в `fullscreen`/`standalone`, обновление по `prompt` из Норы.

Если п. 1 проваливается по срокам (слишком много обвязки) — переключаемся на Phaser 4 с тем же `packages/sim`.

## Источники

- Phaser: [releases](https://api.github.com/repos/phaserjs/phaser/releases), [npm dist-tags](https://registry.npmjs.org/-/package/phaser/dist-tags), [Phaser 3 vs Phaser 4](https://phaser.io/news/2026/05/phaser-3-vs-phaser-4), [v4.0.0 release](https://github.com/phaserjs/phaser/releases/tag/v4.0.0), [HEADLESS](https://docs.phaser.io/api-documentation/namespace/phaser#headless), [GameConfig](https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig), [Input](https://docs.phaser.io/phaser/concepts/input), [Scale Manager](https://docs.phaser.io/phaser/concepts/scale-manager), [Arcade](https://docs.phaser.io/phaser/concepts/physics/arcade), [templates](https://docs.phaser.io/phaser/getting-started/project-templates), [размеры dist](https://data.jsdelivr.com/v1/packages/npm/phaser@4.2.1)
- PixiJS: [releases](https://api.github.com/repos/pixijs/pixijs/releases), [GitHub](https://github.com/pixijs/pixijs), [intro](https://pixijs.com/8.x/guides/getting-started/intro), [Application](https://pixijs.com/8.x/guides/components/application), [performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips), [bundlephobia](https://bundlephobia.com/api/size?package=pixi.js@8.22.0)
- KAPLAY: [GitHub](https://github.com/kaplayjs/kaplay), [CHANGELOG](https://github.com/kaplayjs/kaplay/blob/master/CHANGELOG.md), [dist-tags](https://registry.npmjs.org/-/package/kaplay/dist-tags), [docs](https://kaplayjs.com/docs/)
- Web API (MDN): [requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen), [ScreenOrientation.lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock), [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API), [Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events), [pointerrawupdate](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerrawupdate_event), [touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action), [addEventListener passive](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener), [env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env), [devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio), [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), [Manifest display](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/display), [Manifest orientation](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/orientation), [Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [Vibration](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)
- caniuse: [fullscreen](https://caniuse.com/fullscreen), [screen-orientation](https://caniuse.com/screen-orientation), [wake-lock](https://caniuse.com/wake-lock)
- Деплой/PWA: [Vite static deploy](https://vite.dev/guide/static-deploy), [vite-plugin-pwa guide](https://vite-pwa-org.netlify.app/guide/), [strategies & behaviors](https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors), [minimal requirements](https://vite-pwa-org.netlify.app/guide/pwa-minimal-requirements), [Chrome install criteria](https://web.dev/articles/install-criteria), [Chrome: install criteria update](https://developer.chrome.com/blog/update-install-criteria), [GitHub Pages 404](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site), [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
