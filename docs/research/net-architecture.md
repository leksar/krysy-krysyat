# Сетевая архитектура онлайн-платформера на телефонах

Тикет: [001-net-architecture](../wayfinder/tickets/001-net-architecture.md). Дата: 2026-10-20.

## Вопрос

Как синхронизировать реалтайм-платформер (гравитация, прыжки, 2–6 Крыс, у каждой своя камера) между Android-телефонами через Node-сервер на Hetzner VPS так, чтобы прыжки не ощущались ватными при 50–150 мс пинга. Сравнить server-authoritative + prediction/reconciliation, host-authoritative (телефон симулирует, сервер — релей) и lockstep. Какие библиотеки живы в 2026, tick rate, формат снапшотов, интерполяция чужих Крыс.

## Короткий ответ

**Server-authoritative с client-side prediction + reconciliation для своей Крысы и snapshot-интерполяцией для чужих. Транспорт — WebSocket (wss через nginx). Библиотека — Colyseus 0.18 (с мая 2026 в нём встроены prediction/reconciliation/интерполяция — ровно наш сценарий), запасной вариант — свой `ws` + тот же общий модуль симуляции на TypeScript.** Tick 30 Гц, патчи состояния 20–30 Гц, интерполяция чужих с задержкой ~100 мс, своя Крыса — мгновенно (предсказана локально). Физика — своя детерминированная «платформерная» (AABB, фиксированный dt), без тяжёлого физдвижка.

## 1. Три модели и почему побеждает server-authoritative + prediction

### 1.1 Lockstep (детерминированный, только инпуты)

Все машины гоняют одну детерминированную симуляцию и обмениваются только вводом; кадр `n` считается только когда есть ввод `n` от всех. Плюс — трафик не зависит от числа объектов. Минусы, по Gaffer on Games:

- Задержка = худший пир + playout-буфер: любой потерянный/опоздавший пакет останавливает симуляцию у всех. Поверх TCP (а WebSocket — это TCP) потеря пакета стоит ~2 RTT, и симуляция «икает». ([Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/))
- Нужна побитовая детерминированность на всех устройствах — float, порядок итераций, RNG. Автор получил стабильность только «на той же машине, бинарнике и ОС». У нас — зоопарк Android-телефонов с разными JIT.
- Исторически lockstep в экшенах умер именно из-за ожидания самого медленного соединения (Doom по модему). ([What Every Programmer Needs To Know About Game Networking](https://gafferongames.com/post/what_every_programmer_needs_to_know_about_game_networking/))

Рабочий lockstep требует UDP с избыточной отправкой инпутов — в браузере это WebRTC DataChannel или WebTransport (см. §3). Для 2–6 игроков со своими камерами и физикой прыжков он даёт худший из возможных input lag: минимум RTT до самого дальнего игрока + буфер. **Отклоняем.**

### 1.2 Host-authoritative (один телефон — хост, сервер — релей)

Формально это тот же client/server, только «сервер» — телефон одного из игроков, а VPS лишь пересылает пакеты. Для хоста всё мгновенно, для остальных путь = телефон → VPS → телефон-хост → VPS → телефон, т.е. **два пинга вместо одного** (при 50–150 мс до VPS — 100–300 мс RTT до авторитета). Хост может свернуть вкладку/уйти в сон (Android троттлит фоновые вкладки), нужна хост-миграция, а сохранение прогресса Стаи всё равно хочется вести на сервере. «Не доверять клиенту» (Gambetta, [Part I](https://www.gabrielgambetta.com/client-server-game-architecture.html)) для частной игры не критично, но и выигрыша нет: единственный плюс — не писать симуляцию на Node, а у нас TypeScript и так общий. **Отклоняем.**

### 1.3 Server-authoritative + client-side prediction + reconciliation (QuakeWorld-модель)

Клиент отправляет инпуты с порядковыми номерами и сразу применяет их локально к своей Крысе (prediction). Сервер гоняет ту же функцию шага и рассылает состояние + номер последнего обработанного инпута. Клиент выбрасывает подтверждённые инпуты, накладывает серверное состояние и **переигрывает** неподтверждённые поверх него (reconciliation). Если симуляции совпадают, коррекций почти нет; они возникают только при внешних воздействиях (у нас — удар Голубя, падение с движущейся платформы). ([Gambetta, Part II](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html); [Gaffer, What Every Programmer…](https://gafferongames.com/post/what_every_programmer_needs_to_know_about_game_networking/))

Что это даёт для «неватного» прыжка: нажал — Крыса прыгнула в этом же кадре локально, независимо от пинга. Пинг 50–150 мс влияет только на то, как скоро чужие увидят прыжок и как быстро придёт коррекция. Задержка по своему вводу — ноль сетевых миллисекунд.

Чужие Крысы: entity interpolation — клиент хранит последние снапшоты и рисует чужих с задержкой ~100 мс между двумя реальными позициями, не экстраполируя. ([Gambetta, Part III](https://www.gabrielgambetta.com/entity-interpolation.html)) Для кооператива это безболезненно: нет «выстрелов», где важно попасть в 100 мс прошлого. Единственное место, где это заметно — «напарник поднимает лежащую Крысу»: проверку делаем на сервере по серверным позициям с щедрым радиусом (или через lag compensation, см. §4).

**Выбираем.** Именно эту модель в 2026 нативно поддерживает Colyseus 0.18 (§4).

## 2. Детерминированность и общий модуль симуляции

Prediction работает только если клиент и сервер гоняют одну функцию шага с одинаковым фиксированным `dt`. Контракт Colyseus (применим и к самописному варианту):

- одна функция `step(ctx, state, input)` импортируется и на клиенте, и на сервере; никаких двух копий;
- всё, что читает шаг, лежит во входе или состоянии — никаких `Math.random()`, `Date.now()`, DOM, итераций по неупорядоченным коллекциям;
- никаких побочных эффектов (звук, партиклы) внутри шага — он выполняется несколько раз при replay; одноразовые события помечать (`ctx.isReplay`, `ctx.memo`);
- фиксированный `dt` берётся с сервера, не хардкодится;
- если используется физдвижок — одна и та же сборка на обеих сторонах, иначе float расходится. ([Colyseus Netcode: Determinism & The Contract](https://docs.colyseus.io/netcode/determinism))

Для платформера не нужен Box2D/Rapier: достаточно своей AABB-физики (тайлы, гравитация, прыжок, движущиеся платформы), она тривиально детерминирована при одинаковом коде и `dt`. Если когда-нибудь понадобится ригид-боди, Rapier JS/WASM заявляет кросс-платформенную детерминированность (с оговоркой про `Math.sin/cos`). ([Rapier: Determinism](https://rapier.rs/docs/user_guides/javascript/determinism))

Чувство прыжка — отдельно от сети. «Прощающие» механики Celeste (coyote time, jump buffering, половинная гравитация на пике при зажатом прыжке, corner correction) — это логика внутри `step`, и она же предсказывается на клиенте. ([Maddy Thorson, Celeste & Forgiveness](https://maddymakesgames.com/articles/celeste_and_forgiveness/index.html)) Jump buffering особенно важен на тач-кнопках.

## 3. Транспорт: WebSocket vs WebRTC vs WebTransport

| | WebSocket (TCP) | WebRTC DataChannel (geckos.io) | WebTransport (QUIC) |
|---|---|---|---|
| Head-of-line blocking | да: потерянный пакет задерживает всё за ним ([Gaffer](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/)) | нет (unreliable/unordered) | нет между стримами; datagrams |
| Сервер на VPS | один порт за nginx, `wss` из коробки ([nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)) | открытый диапазон UDP-портов (по умолчанию 1025–65535, сужать `portRange`), свои STUN/TURN в проде ([geckos.io README](https://github.com/geckosio/geckos.io)) | HTTP/3 на сервере, сертификаты; в Colyseus — `@colyseus/h3-transport`, помечен experimental ([docs](https://docs.colyseus.io/server/transport/webtransport)) |
| Поддержка Android Chrome | везде | везде | да (caniuse: Chrome for Android 155, Samsung Internet 18+, Safari iOS 26.4+; глобально ~92 %) ([caniuse](https://caniuse.com/webtransport)) |

На нашем VPS уже живут чужие приложения, и «порты только добавлять» — диапазон UDP под WebRTC и собственный TURN — лишнее администрирование и риск. WebTransport в 2026 уже baseline в браузерах, но серверная сторона в Node и в Colyseus — experimental.

Вывод: **WebSocket**. HoL-блокировка при 2–6 игроках на 20–30 патчах/с и prediction для своей Крысы даст редкие «подтягивания» чужих Крыс при потере пакета, но не ватность своего прыжка. Снижаем ущерб: мелкие пакеты, патчи-дельты, интерполяционный буфер 100 мс (≈3 патча при 30 Гц). Если на практике Wi-Fi/4G у компании окажется с ощутимыми потерями — апгрейд на WebTransport в Colyseus это смена транспорта, не архитектуры.

nginx: обязательны заголовки `Upgrade`/`Connection`, и либо `proxy_read_timeout` > 60 с, либо ping-фреймы с сервера (дефолтный простой — 60 с, после чего nginx рвёт соединение). ([nginx](https://nginx.org/en/docs/http/websocket.html))

## 4. Библиотеки: что живо в октябре 2026

Данные с registry.npmjs.org (поле `time`), снято 2026-10-20.

| Библиотека | Последняя версия | Дата | Статус |
|---|---|---|---|
| **colyseus** | 0.18.9 (0.17.0 — 2026-01-09, 0.18.0 — 2026-05-22) | 2026-09-30 | активна, релизы еженедельно; MIT; Node ≥ 22; транспорт `@colyseus/ws-transport`, опционально uWebSockets |
| @colyseus/schema | 5.0.42 | 2026-10-20 | активна |
| **ws** | 8.22.0 | 2026-09-26 | активна, стандарт де-факто |
| @geckos.io/server | 3.1.0 (3.0.2 — 2025-04-19) | 2026-03-27 | жива, но ~1 релиз в год; WebRTC/UDP, см. §3 |
| nengi | latest 2.0.0-alpha.173 (2024-05-19); тег `rc`: 2.0.0-rc.128 | 2026-10-05 | разработка идёт (rc ежемесячно), но стабильного 2.0 нет, репо GitHub не обновлялся с 2022 (1.27.0); Apache-2.0; документация 2.x скудная |

**Colyseus 0.18** ([блог 0.18, 2026-08-20](https://colyseus.io/blog/colyseus-018-is-here/); [блог 0.17, 2026-02-06](https://colyseus.io/blog/colyseus-017-is-here/)):

- `setFixedTimestep(step, tickRate, { subSteps })` — фиксированный шаг на сервере, tickRate отдаётся клиенту при join; ввод через `defineInput()` с буфером (`bufferMaxSize` 32) и `sanitize`. ([Server Input & Timestep](https://docs.colyseus.io/netcode/server-input))
- `Predict.get(room)`, `predict.reconciler(self, { input, step, smoothMs })` — предсказание своей сущности, rewind + replay неподтверждённых инпутов, сглаживание ошибки (`smoothMs` по умолчанию = один интервал патча), `snap`-порог для телепорта. ([Client Prediction](https://docs.colyseus.io/netcode/client-prediction))
- `predict.attachAll("players", { mode: "lerp", fields: ["x","y"] })` — интерполяция чужих с задержкой по умолчанию **100 мс**; режимы `lerp`/`extrapolate`/`damped`/`reckon`.
- `allowRewindState()` — lag compensation (пригодится для «поднять напарника» и ударов по Голубям).
- Автореконнект с 0.17 (`onDrop`/`onReconnect`, `allowReconnection`) — критично на телефонах (свернул вкладку, переключился Wi-Fi → 4G).
- `patchRate` по умолчанию 50 мс (20 Гц), `setSimulationInterval` по умолчанию 16.6 мс; для предсказания рекомендуют `setFixedTimestep`. ([Room](https://docs.colyseus.io/room))
- Состояние — `@colyseus/schema`, бинарные дельта-патчи только изменившихся полей; `StateView` для фильтрации видимости по клиенту.
- Debug-панель с телеметрией дрейфа и симулятором задержки — проверять «ватность» на реальных телефонах.

Риск: netcode-API появился в 0.18 (май 2026); 0.18 заявлен как «последний перед 1.0», часть компонентов (admin, новые SDK, `t.stream()`) — beta. Ядро prediction/reconciler не в списке beta, но молодое. Запасной путь (свой `ws` + тот же общий `step` + ручная очередь инпутов по Gambetta) остаётся дешёвым, потому что контракт симуляции одинаковый.

## 5. Рекомендуемые параметры

| Параметр | Значение | Обоснование |
|---|---|---|
| Серверный tick (`setFixedTimestep`) | **30 Гц** (dt = 33.3 мс) | примеры Colyseus 0.18 — 30 Гц; хватает для платформерной AABB-физики; при необходимости `subSteps: 2` даёт 60 Гц физики при 30 Гц ввода |
| Частота ввода с клиента | = tick, ровно 1 инпут на фиксированный шаг | контракт Colyseus; клиент на 60 fps шлёт инпут каждые 2 кадра |
| `patchRate` | **30 Гц** (33 мс); дефолт 20 Гц, если трафик жмёт | Gaffer: при 30 Гц суммарная задержка интерполяции ~150 мс против ~350 мс при 10 Гц; «увеличивайте send rate, а не экстраполируйте» ([Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)) |
| Интерполяционная задержка чужих | **100 мс** (дефолт Colyseus; Gambetta), на плохой сети до 150 мс = 3 патча при 20 Гц | Gaffer: буфер ≈ 3 интервала отправки + 1–2 кадра на джиттер |
| Сглаживание коррекций своей Крысы | `smoothMs` ≈ 1 патч (33–50 мс), `snap` ≈ 1 тайл | дефолты Colyseus; телепорт при больших рассинхронах |
| Формат ввода | плоские примитивы: `seq`, `moveX ∈ {-1,0,1}`, `jump`, `jumpHeld`, `action` (битовые флаги) | контракт: никаких вложенных схем; квантованные поля |
| Формат снапшота | дельта-патч Schema: по Крысе `x, y` (квантованные, напр. 1/16 px), `vx, vy` (нужны reconciler'у и dead-reckoning), `facing`, `anim/state`, `grounded`; Голуби/Люди — то же; статичная карта не в состоянии | Gaffer: снапшот = только меняющееся; Colyseus `adopt` пересеивает только скаляры, скорость обязательна |
| Фильтр видимости | не нужен при 6 Крысах на «Дворе»; `StateView`, если карты вырастут | |
| Reconnect | `allowReconnection(client, 20–30 с)` | 0.17 |

Оценка трафика: 6 Крыс + ~20 NPC × ~12 байт дельты × 30 Гц ≈ 10 КБ/с на клиента вниз, вверх — 30 инпутов/с по ~6 байт. Пренебрежимо для 4G.

## 6. Что проверить прототипом (первый спайк)

1. Colyseus 0.18: комната с `setFixedTimestep(step, 30)`, общий `step` в пакете `sim`, две Крысы, тайловая карта, прыжок с coyote time и jump buffer.
2. Открыть на двух Android-телефонах через 4G с debug-панелью Colyseus и симулятором задержки 150 мс / 2 % потерь: своя Крыса прыгает без задержки, чужая — плавно с ~100 мс отставанием, коррекции не дёргают.
3. nginx `wss://89-167-106-105.sslip.io/<path>` → Node, `proxy_read_timeout` + ping; свернуть вкладку на 15 с и вернуться — `onReconnect` должен отработать.
4. Если prediction-API 0.18 окажется сырым — тот же `step` переносится на `ws` + ручная очередь по Gambetta за день-два.

## Источники

- Gabriel Gambetta, Fast-Paced Multiplayer: [Part I](https://www.gabrielgambetta.com/client-server-game-architecture.html), [Part II: Client-Side Prediction and Server Reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html), [Part III: Entity Interpolation](https://www.gabrielgambetta.com/entity-interpolation.html)
- Gaffer on Games: [What Every Programmer Needs To Know About Game Networking](https://gafferongames.com/post/what_every_programmer_needs_to_know_about_game_networking/), [Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/), [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/), [Why can't I send UDP packets from a browser?](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/)
- Colyseus: [0.17 is here (2026-02-06)](https://colyseus.io/blog/colyseus-017-is-here/), [0.18 is here (2026-08-20)](https://colyseus.io/blog/colyseus-018-is-here/), [Netcode overview](https://docs.colyseus.io/netcode), [Client Prediction](https://docs.colyseus.io/netcode/client-prediction), [Determinism & The Contract](https://docs.colyseus.io/netcode/determinism), [Server Input & Timestep](https://docs.colyseus.io/netcode/server-input), [Room](https://docs.colyseus.io/room), [WebTransport transport](https://docs.colyseus.io/server/transport/webtransport), [GitHub releases](https://github.com/colyseus/colyseus/releases)
- npm registry (поле `time`): [colyseus](https://registry.npmjs.org/colyseus), [@colyseus/schema](https://registry.npmjs.org/@colyseus/schema), [ws](https://registry.npmjs.org/ws), [@geckos.io/server](https://registry.npmjs.org/@geckos.io/server), [nengi](https://registry.npmjs.org/nengi)
- [geckos.io README](https://github.com/geckosio/geckos.io); [timetocode/nengi commits](https://github.com/timetocode/nengi/commits/master)
- [Rapier JS: Determinism](https://rapier.rs/docs/user_guides/javascript/determinism)
- [caniuse: WebTransport](https://caniuse.com/webtransport)
- [nginx: WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)
- [Maddy Thorson, Celeste & Forgiveness](https://maddymakesgames.com/articles/celeste_and_forgiveness/index.html)
