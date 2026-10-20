# Схема деплоя клиента и сервера (тикет 012)

Тикет: [012-deploy-scheme](../wayfinder/tickets/012-deploy-scheme.md). Дата проверки источников: 2026-10-20. Бумажный дизайн: к серверу не подключались, ничего не запускали. Факты о сервере и правила «что можно трогать» — из [hetzner-inventory.md](hetzner-inventory.md); они здесь не пересматриваются, а исполняются.

## Итог в пяти строках

1. **Маршрут по пути**: `https://89-167-106-105.sslip.io/krysy/*` → наш контейнер `krysy:2567` через существующий `council-caddy` (`handle_path` снимает префикс). Новый сертификат, DNS и поддомен не нужны.
2. **Единственная правка чужого** — один коммит в `leksar/council`: строка `import /etc/caddy/sites/*.caddy` внутри блока сайта в Caddyfile + bind-mount `/opt/krysy/caddy:/etc/caddy/sites:ro` в сервис caddy. Дальше наш маршрут живёт в `/opt/krysy/caddy/krysy.caddy`, применяется `docker exec council-caddy caddy reload …`, и council больше не трогаем.
3. **Образ собирает GitHub Actions** и пушит в GHCR (`ghcr.io/leksar/krysy-server:sha-<7>` + `latest`); затем workflow по SSH (отдельный ключ с `restrict,command="/opt/krysy/bin/deploy.sh"`) делает на сервере `docker compose pull && up -d`. На сервере ничего не собирается — диск на 83 %.
4. **Клиент** узнаёт адрес сервера из `VITE_SERVER_URL=wss://89-167-106-105.sslip.io/krysy` (`.env.production` в репо), `base: '/krysy-krysyat/'`; Pages-workflow меняется на `npm ci → vite build → upload apps/client/dist`.
5. **SQLite** в именованном volume `krysy_data` (`/data/krysy.sqlite`, встроенный `node:sqlite`, без нативных модулей); ежедневный онлайн-бэкап `sqlite.backup()` в тот же volume + бэкап перед каждым деплоем + команда «забрать копию на ноутбук». Крон хоста не трогаем.

Разделение ответственности: раздел «A» — разовое, **требует OK пользователя** (касается репо council и `authorized_keys` root); раздел «B» — наше, в своём каталоге и репо.

---

## 1. Путь `/krysy/*` или поддомен `krysy.89-167-106-105.sslip.io`

| | Путь на существующем хосте | Новый поддомен |
|---|---|---|
| Сертификат | уже есть, ничего не выпускается | новый выпуск + продление каждые ~60 дней силами `council-caddy` |
| Лимиты Let's Encrypt | не затрагиваются | «50 сертификатов на registered domain в 7 дней», registered domain определяется по Public Suffix List; `sslip.io` в PSL **нет** (проверен весь файл списка: `github.io` есть, `sslip.io`/`nip.io` нет) → лимит общий на всех пользователей sslip.io. Смягчение: сайт nip.io/sslip.io пишет, что LE поднял им лимит «с 50 до 250 000»; плюс Caddy при отказе LE автоматически пробует ZeroSSL. Риск низкий, но ненулевой и вне нашего контроля |
| Правка Caddyfile council | 1 директива внутри существующего блока | новый блок сайта (тот же `import`, но на верхнем уровне) |
| Что надо на стороне приложения | снять префикс (`handle_path`) — клиент Colyseus умеет путь в endpoint (см. §4) | ничего |
| Что «ломается» | ничего: cookies/SW не используем, у клиента другой origin в любом случае | ничего |

**Решение: путь `/krysy/*`.** Он не создаёт ни одного нового криптографического/DNS-события и держит council-Caddyfile минимальным. Поддомен остаётся запасным вариантом (если когда-нибудь понадобится отдельный origin): тогда в `/opt/krysy/caddy/krysy.caddy` пишется полный блок сайта, а `import` переносится на верхний уровень Caddyfile.

Источники: [LE rate limits](https://letsencrypt.org/docs/rate-limits/) («Up to 50 certificates can be issued per registered domain … every 7 days», registered domain — по PSL; ARI-продления из лимитов исключены); [PSL](https://publicsuffix.org/list/public_suffix_list.dat); [nip.io / sslip.io](https://nip.io/) (sslip.io редиректит на nip.io — сервисы объединены; «bumped our limit from 50 to 250,000»; wildcard-сертификатов нет; рекомендуют HTTP-01); [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https) (по умолчанию два issuer — Let's Encrypt и ZeroSSL, при отказе одного пробуется другой).

## 2. Как маршрут попадает в council-caddy и переживает их деплои

### Почему именно `import` + bind-mount

Варианты и почему отклонены:

- **Править Caddyfile на сервере** — стирается `git reset --hard` при следующем деплое council (каждые ~20 мин). Отклонено (правило инвентаризации).
- **Захардкодить `handle_path /krysy/* { reverse_proxy krysy:2567 }` прямо в Caddyfile council** — тоже один коммит, но каждая наша будущая правка маршрута = ещё один коммит в чужое репо и чужой деплой. Отклонено в пользу `import`.
- **Admin API Caddy (`POST /load`, `/config/…`) из нашего контейнера** — конфиг живёт в памяти, пропадает при пересоздании `council-caddy`; плюс admin API слушает `localhost:2019` внутри их контейнера и снаружи недоступен. Отклонено.
- **Свой Caddy/Traefik** — 80/443 заняты, публиковать порты нельзя. Отклонено.
- **`caddy run --watch`** — всё равно требует правки их compose и не решает вопрос «где лежит наш файл». Отклонено.

**Выбрано:** `import` абсолютного глоба из каталога, который смонтирован из нашего `/opt/krysy/caddy`. Проверенные свойства Caddy, на которых это держится:

- `import <pattern>` «can appear anywhere in the Caddyfile», в том числе внутри блока сайта; файлы/глобы резолвятся относительно файла, где стоит `import` — мы используем абсолютный путь, так что это не важно. **Глоб, не нашедший файлов, — не ошибка** («an empty glob pattern is not an error»): council-caddy стартует, даже если нашего файла ещё нет. ([import](https://caddyserver.com/docs/caddyfile/directives/import))
- `handle_path /krysy/*` = `handle /krysy/* { uri strip_prefix /krysy … }`: бэкенд видит `/matchmake/…` и `/<processId>/<roomId>`. ([handle_path](https://caddyserver.com/docs/caddyfile/directives/handle_path))
- Порядок директив внутри блока сайта фиксирован и не зависит от места в файле: `handle_path` стоит в группе «routing & dispatching» **раньше** `reverse_proxy`; `reverse_proxy` внутри `handle_path` завершает цепочку. Значит `/krysy/*` уйдёт к нам, всё остальное — в `reverse_proxy council:8100`, где бы в блоке ни стояла строка `import`. ([Directive order](https://caddyserver.com/docs/caddyfile/directives))
- `reverse_proxy` проксирует WebSocket сам: «performing the HTTP upgrade request then transitioning the connection to a bidirectional tunnel»; `stream_timeout` по умолчанию без лимита (аналог nginx `proxy_read_timeout 86400` не нужен). **При reload конфига WebSocket-соединения принудительно закрываются** (по умолчанию `stream_close_delay` = 0). ([reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy))
- `caddy reload --config <path>` — «the correct, semantic way to change/reload the running configuration», требует включённого admin endpoint (по умолчанию `localhost:2019` внутри контейнера); при ошибке в новом конфиге старый продолжает работать. Официальный образ рекомендует `docker exec -w /etc/caddy <container> caddy reload`. ([command-line](https://caddyserver.com/docs/command-line), [API](https://caddyserver.com/docs/api), [hub.docker.com/_/caddy](https://hub.docker.com/_/caddy))
- Compose при bind-mount в короткой записи **сам создаёт каталог на хосте**, если его нет (`create_host_path: true` по умолчанию) — если council задеплоится раньше, чем мы создадим `/opt/krysy/caddy`, получим пустой root-каталог, не ошибку. ([compose volumes](https://docs.docker.com/reference/compose-file/services/#volumes))
- Контейнер, подключённый к сети, «discoverable by the service's name» для других контейнеров в той же сети; `external: true` — Compose сеть не создаёт и не удаляет, а при её отсутствии даёт ошибку. Имя `krysy` не должно совпадать с именами сервисов council в `council_net-main` (`council`, `caddy`) — не совпадает. ([compose networks](https://docs.docker.com/reference/compose-file/networks/))

### Жизненный цикл

1. **Разово** (раздел A): коммит в `leksar/council` → их CI делает `git reset --hard && docker compose up -d --build` → compose видит изменённую конфигурацию сервиса caddy (новый volume) и **пересоздаёт `council-caddy`** (несколько секунд без 80/443 у council). Новый Caddy читает Caddyfile с `import`, глоб находит `/opt/krysy/caddy/krysy.caddy` (или ничего — тоже ок).
2. **Наши правки маршрута** (редко): меняем `/opt/krysy/caddy/krysy.caddy` → `docker exec council-caddy caddy validate --config /etc/caddy/Caddyfile && docker exec council-caddy caddy reload --config /etc/caddy/Caddyfile`. Это закроет текущие WebSocket-сессии игры → делать между Вылазками.
3. **Последующие деплои council** ничего не меняют: `import` в их git, файл — в нашем каталоге; Compose пересоздаёт caddy только при изменении его конфигурации/образа, а при пересоздании он снова читает наш файл.
4. **Деплои игры** Caddy не касаются вовсе: `reverse_proxy krysy:2567` резолвит имя через DNS Docker при каждом соединении, новый контейнер с новым IP подхватывается сам.

### Точное содержимое правки council (для PR)

`Caddyfile` (сейчас — из инвентаризации):

```caddyfile
89-167-106-105.sslip.io {
	import /etc/caddy/sites/*.caddy
	reverse_proxy council:8100
}
```

`docker-compose.yml` council, сервис caddy (имя сервиса и существующие строки — сверить по месту; инвентаризация видела только `container_name: council-caddy`, порты 80/443, bind-mount Caddyfile `:ro` и volume `council_caddy-data`):

```yaml
  caddy:
    # …без изменений…
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro        # уже есть
      - /opt/krysy/caddy:/etc/caddy/sites:ro       # + одна строка
      # …остальные (caddy-data, caddy-config) без изменений…
```

Откат: revert коммита → их CI пересоздаст caddy без import, игра пропадёт из сети, council не пострадает.

## 3. Сборка образа и выкатка на сервер

### Почему GitHub Actions → GHCR → `pull`, а не `build` на сервере

Сервер: диск 83 %, 15 GB чужого build cache, watchdog алертит при 90 %. `docker compose build` на сервере растил бы кэш и память (2 vCPU, без swap). В Actions сборка бесплатна для публичного репо, образ тянется готовым (ожидаемо ~60–70 MB сжатый на `node:24-alpine` без нативных модулей). На сервере остаются только наш образ + предыдущий до prune.

### Архитектура CPU — проверить один раз

У Hetzner два плана «2 vCPU / 4 GB / 40 GB NVMe»: **CX23 — x86**, **CAX11 — Arm64 (Ampere)**; по инвентаризации (имя `ubuntu-4gb-hel1-1`) план не определить. Перед первым деплоем: `ssh -i ~/.ssh/krysy_hetzner root@89.167.106.105 uname -m` → `x86_64` ⇒ `linux/amd64`, `aarch64` ⇒ `linux/arm64`. В workflow ниже по умолчанию собираются обе платформы (зависимости чисто JS, `npm ci` выполняется один раз на платформе раннера через `--platform=$BUILDPLATFORM`, эмуляция QEMU почти не нагружается); после проверки можно оставить одну. ([Hetzner Cost-Optimized](https://www.hetzner.com/cloud/cost-optimized/), [build-push-action](https://github.com/docker/build-push-action))

### Видимость пакета GHCR

Новый пакет по умолчанию **private** («When you first publish a package, the default visibility is private»). Чтобы сервер тянул образ без `docker login` (не хотим класть PAT в `/root/.docker/config.json` на общем хосте), после первого пуша один раз: страница пакета → Package settings → Danger Zone → Change visibility → **Public** (необратимо; репо и так публичный, нового ничего не раскрываем). Label `org.opencontainers.image.source` (его ставит `docker/metadata-action`) привязывает пакет к репо, и workflow'ы репо получают к нему доступ автоматически. ([access control & visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility), [publish Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images))

### Деплой-ключ с принудительной командой

Отдельная пара ed25519 только для CI. В `authorized_keys` root публичный ключ добавляется **одной строкой через `>>`** с опциями `restrict,command="/opt/krysy/bin/deploy.sh"`: OpenSSH тогда исполняет только эту команду, а то, что CI «попросил» выполнить (у нас — тег образа), приходит в `SSH_ORIGINAL_COMMAND`; `restrict` отключает проброс портов/агента/X11 и PTY. Утечка ключа из GitHub даёт злоумышленнику ровно одну возможность — передеплоить игру тегом, который уже есть в GHCR. ([sshd(8) AUTHORIZED_KEYS FILE FORMAT](https://man.openbsd.org/sshd#AUTHORIZED_KEYS_FILE_FORMAT))

В workflow — обычный `ssh` с закреплённым host key (секрет `DEPLOY_KNOWN_HOSTS`), без сторонних action. Альтернатива — `appleboy/ssh-action@v1` (входы `host`, `username`, `key`, `script`, `fingerprint`; `script_stop` удалён, вместо него `set -e`) — работает, но добавляет внешнюю зависимость с доступом к ключу. ([appleboy/ssh-action](https://github.com/appleboy/ssh-action))

### Чистка старых образов — только своих

`docker image prune -f` без `-a` удаляет лишь dangling-образы, а наши старые образы останутся с тегами `sha-*` и будут копиться. Поэтому `docker image prune -af --filter "label=org.opencontainers.image.source=https://github.com/leksar/krysy-krysyat"` — `-a` удаляет неиспользуемые образы, фильтр `label=` ограничивает **только образами с нашей меткой**; чужие образы и build cache не затрагиваются. ([docker image prune](https://docs.docker.com/reference/cli/docker/image/prune/))

### Тег образа и откат

Compose-файл на сервере берёт `image: ghcr.io/leksar/krysy-server:${IMAGE_TAG:-latest}`; `.env` рядом с compose-файлом хранит `IMAGE_TAG=sha-<7>` (Compose читает `.env` из каталога проекта, `${VAR:-default}` даёт значение по умолчанию). Откат = вызвать deploy.sh со старым тегом. ([compose interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), [compose up](https://docs.docker.com/reference/cli/docker/compose/up/) — контейнер пересоздаётся при изменении конфигурации или образа)

## 4. Клиент: адрес сервера, Vite `base`, Pages-workflow

- **Endpoint с путём поддерживается клиентом Colyseus**: конструктор `Client("wss://host/krysy")` разбирает URL, сохраняет `pathname` (хвостовой `/` срезается), HTTP-матчмейкинг идёт на `https://host${pathname}/matchmake/<method>/<room>`, WebSocket — на `wss://host${pathname}/<processId>/<roomId>?…`; `wss:`/`https:` ⇒ `secure = true`. Сервер же монтирует матчмейкинг в корне (`matchmakeRoute: 'matchmake'`), поэтому префикс обязан сниматься на прокси — что и делает `handle_path`. ([colyseus.js Client.ts](https://github.com/colyseus/colyseus.js/blob/master/src/Client.ts), [@colyseus/core controller.ts](https://github.com/colyseus/colyseus/blob/master/packages/core/src/matchmaker/controller.ts))
- **CORS**: клиент на origin `https://leksar.github.io`, сервер — на `https://89-167-106-105.sslip.io`; матчмейкинг — кросс-доменный `fetch`. Colyseus: «CORS is enabled by default», `getCorsHeaders` по умолчанию возвращает `Access-Control-Allow-Origin: <Origin запроса> || *`. Работает из коробки; для приватной игры сужаем до `https://leksar.github.io` через `matchMaker.controller.getCorsHeaders` (и, по желанию, `verifyClient` транспорта проверяет `Origin` у WebSocket). ([HTTP routes / CORS](https://docs.colyseus.io/server/http-routes), [WebSocketTransport](https://docs.colyseus.io/server/transport/ws): `pingInterval` 3000 мс, `pingMaxRetries` 2, `maxPayload` 4 KB)
- **Как клиент узнаёт URL**: `apps/client/.env.production` (в git): `VITE_SERVER_URL=wss://89-167-106-105.sslip.io/krysy`; `apps/client/.env.development`: `VITE_SERVER_URL=ws://localhost:2567`. Vite отдаёт в бандл только `VITE_*`, файл режима приоритетнее общего `.env`, `*.local` — в `.gitignore`. Для тестов с телефона на домашний ноут — переопределение `?server=ws://192.168.x.x:2567` в URL. ([Vite env & mode](https://vite.dev/guide/env-and-mode))
- **`base`**: `vite.config.ts` → `base: '/krysy-krysyat/'` (проектный сайт `https://<user>.github.io/<repo>/`); пути к ассетам — через импорты или `import.meta.env.BASE_URL`. ([Vite static deploy](https://vite.dev/guide/static-deploy))
- **Pages-workflow** после появления клиента: `checkout → setup-node (24, cache npm) → npm ci → npm run build -w apps/client → configure-pages → upload-pages-artifact (path: apps/client/dist) → deploy-pages`; текущие мажоры в репо (`configure-pages@v5`, `upload-pages-artifact@v3`, `deploy-pages@v4`) рабочие, в Vite docs сейчас `v6 / v5 / v5` — обновить вместе с переходом на сборку. Папка `site/` после этого не нужна. Фильтр `paths:` — чтобы серверные коммиты не пересобирали клиент (и наоборот), но `packages/sim` триггерит оба.

## 5. SQLite: volume и бэкап

- **Драйвер**: встроенный `node:sqlite` — с Node 22.13/23.4 без флага, Stability 1.2 (release candidate); нативных модулей нет ⇒ образ `node:24-alpine` без компиляции и без проблем с musl/мультиархом. Node 24 — текущий LTS. ([node:sqlite](https://nodejs.org/api/sqlite.html), [Node releases](https://nodejs.org/en/about/previous-releases))
- **Где лежит**: именованный volume `krysy_data` → `/data/krysy.sqlite` (+ `-wal`, `-shm`; включаем WAL). Volume переживает `compose up -d`/пересоздание контейнера; `docker compose down -v` **не** использовать.
- **Онлайн-бэкап**: `sqlite.backup(sourceDb, path)` (Node ≥ 22.16/23.8) — обёртка над `sqlite3_backup_*`, база остаётся рабочей во время копирования. Используем дважды: (а) из процесса сервера раз в сутки в `/data/backups/krysy-YYYY-MM-DD.sqlite`, хранить 7; (б) из `deploy.sh` перед каждым `up -d` в `/data/backups/pre-deploy-<tag>.sqlite` (отдельный процесс `node -e` внутри работающего контейнера). Альтернатива в SQL — `VACUUM INTO 'file'` (транзакционный снимок; целевой файл не должен существовать), но у нас нет `sqlite3`-бинарника в образе, API Node проще. ([sqlite.backup](https://nodejs.org/api/sqlite.html#sqlitebackupsourcedb-path-options), [VACUUM INTO](https://sqlite.org/lang_vacuum.html))
- **Почему не крон хоста**: правило инвентаризации — crontab не трогать. Таймер в процессе + бэкап при деплое его заменяют. Данные — килобайты–мегабайты (ники, коды, прогресс Стаи), диск не нагружают.
- **Копия вне сервера** (вручную, своим ключом, по желанию раз в неделю): команда в B.7 — архив volume на ноутбук. Не выкладывать бэкапы как артефакты Actions: в публичном репо их может скачать любой залогиненный пользователь, а внутри — секретные коды аккаунтов.

---

## A. Разово, нужен OK пользователя

### A.1. Коммит в `leksar/council` (PR или прямой коммит в `main`)

Что меняется — см. §2 «Точное содержимое правки council»: `Caddyfile` +1 строка внутри блока, `docker-compose.yml` +1 строка volume у сервиса caddy. Последствие: их CI пересоздаст `council-caddy`, council без HTTPS на несколько секунд; само-фикс council не затрагивается (правка в файлах, которые он не генерирует). Желательно сделать **после** A.2, чтобы к моменту рестарта наш файл уже лежал на месте (не обязательно: пустой глоб — не ошибка, каталог Compose создаст сам).

```bash
# с ноутбука, в чекауте leksar/council
git switch -c krysy-route
# Caddyfile: добавить строку "	import /etc/caddy/sites/*.caddy" первой внутри блока 89-167-106-105.sslip.io
# docker-compose.yml: в volumes сервиса caddy добавить "- /opt/krysy/caddy:/etc/caddy/sites:ro"
git add Caddyfile docker-compose.yml
git commit -m "caddy: import site snippets from /etc/caddy/sites (krysy route)"
gh pr create --fill   # или git push -u origin krysy-route и merge в main
```

Проверка после их деплоя (только чтение):

```bash
ssh -i ~/.ssh/krysy_hetzner root@89.167.106.105 \
  'docker inspect council-caddy --format "{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{if .RW}}rw{{else}}ro{{end}}){{println}}{{end}}"; \
   docker exec council-caddy caddy validate --config /etc/caddy/Caddyfile'
```

### A.2. Каталог `/opt/krysy` и деплой-ключ на сервере

Касается только нашего каталога и **одной добавленной строки** в `/root/.ssh/authorized_keys` (уже чужие строки `github-council-push`, `claude@krysy-krysyat` не трогаем). Делается нашим ключом `krysy_hetzner`.

```bash
# 1) ключ деплоя — на ноутбуке, без passphrase (его будет читать CI)
ssh-keygen -t ed25519 -N '' -C 'krysy-deploy@github-actions' -f ~/.ssh/krysy_deploy

# 2) host key сервера — для pinning в CI (проверить отпечаток с тем, что показывает ваш ssh)
ssh-keyscan -t ed25519 89.167.106.105 > /tmp/krysy_known_hosts

# 3) каталог и файлы на сервере (содержимое файлов — раздел B)
ssh -i ~/.ssh/krysy_hetzner root@89.167.106.105 'mkdir -p /opt/krysy/caddy /opt/krysy/bin && chmod 755 /opt/krysy'
scp -i ~/.ssh/krysy_hetzner deploy/docker-compose.yml root@89.167.106.105:/opt/krysy/docker-compose.yml
scp -i ~/.ssh/krysy_hetzner deploy/krysy.caddy      root@89.167.106.105:/opt/krysy/caddy/krysy.caddy
scp -i ~/.ssh/krysy_hetzner deploy/deploy.sh        root@89.167.106.105:/opt/krysy/bin/deploy.sh
ssh -i ~/.ssh/krysy_hetzner root@89.167.106.105 'chmod 755 /opt/krysy/bin/deploy.sh && echo IMAGE_TAG=latest > /opt/krysy/.env'

# 4) публичный ключ деплоя — ОДНОЙ строкой в конец authorized_keys, с принудительной командой
PUB=$(cat ~/.ssh/krysy_deploy.pub)
ssh -i ~/.ssh/krysy_hetzner root@89.167.106.105 \
  "printf '%s\n' 'restrict,command=\"/opt/krysy/bin/deploy.sh\" $PUB' >> /root/.ssh/authorized_keys"

# 5) проверка: ключ может только деплоить
ssh -i ~/.ssh/krysy_deploy root@89.167.106.105 latest      # запустит deploy.sh с тегом latest
ssh -i ~/.ssh/krysy_deploy root@89.167.106.105 'id; ls /'  # должно выполниться тоже как deploy.sh ("bad tag"), не как shell
```

### A.3. Секреты репозитория `leksar/krysy-krysyat`

```bash
gh secret set DEPLOY_SSH_KEY     --repo leksar/krysy-krysyat < ~/.ssh/krysy_deploy
gh secret set DEPLOY_KNOWN_HOSTS --repo leksar/krysy-krysyat < /tmp/krysy_known_hosts
gh secret set DEPLOY_HOST        --repo leksar/krysy-krysyat --body 89.167.106.105
```

([gh secret set](https://cli.github.com/manual/gh_secret_set), [using secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions))

### A.4. После первого прогона workflow: пакет → Public

`https://github.com/users/leksar/packages/container/krysy-server/settings` → Danger Zone → Change visibility → Public. До этого `docker compose pull` на сервере упадёт с `denied` — это ожидаемо; после переключения перезапустить workflow (`gh run rerun <id>` или `workflow_dispatch`).

### A.5. Решения, которые остаются за пользователем

- `uname -m` на сервере → оставить одну платформу в `platforms:` (быстрее сборка) или обе.
- 15 GB чужого build cache: для нашей схемы **не требуется** (на сервере только `pull`, образ ~170 MB распакованный + предыдущий до prune — укладывается в запас до 90 %). Чистить или нет — отдельный вопрос, не наш.

## B. Наше: файлы и команды

Файлы ниже лежат в репо `krysy-krysyat` в `deploy/` (кроме workflow'ов) и копируются в `/opt/krysy` командами A.2. Структура монорепо (`apps/server`, `apps/client`, `packages/sim`) — из тикета 003; Dockerfile — эскиз под неё, уточнится вместе с тикетом 011.

### B.1. `/opt/krysy/docker-compose.yml`

```yaml
name: krysy

services:
  krysy:
    image: ghcr.io/leksar/krysy-server:${IMAGE_TAG:-latest}
    container_name: krysy
    restart: unless-stopped
    init: true
    environment:
      NODE_ENV: production
      PORT: "2567"
      DB_PATH: /data/krysy.sqlite
      ALLOWED_ORIGIN: https://leksar.github.io
    volumes:
      - data:/data
    networks:
      - council_net-main
    # без ports: — наружу только через council-caddy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:2567/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }   # диск 83 %, логи не копим
    deploy:
      resources:
        limits: { memory: 512M }

networks:
  council_net-main:
    external: true

volumes:
  data:          # => volume krysy_data
```

### B.2. `/opt/krysy/caddy/krysy.caddy`

```caddyfile
# Импортируется строкой `import /etc/caddy/sites/*.caddy` внутри блока 89-167-106-105.sslip.io
# в /opt/council/Caddyfile. Применить: docker exec council-caddy caddy reload --config /etc/caddy/Caddyfile
handle_path /krysy/* {
	reverse_proxy krysy:2567
}
```

Снаружи: `https://89-167-106-105.sslip.io/krysy/health` → контейнер видит `GET /health`; `wss://…/krysy/<pid>/<rid>` → `/<pid>/<rid>`.

### B.3. `/opt/krysy/bin/deploy.sh`

```bash
#!/usr/bin/env bash
# Вызывается CI через ssh с принудительной командой: тег образа приходит в SSH_ORIGINAL_COMMAND.
# Локально на сервере: SSH_ORIGINAL_COMMAND=sha-abc1234 /opt/krysy/bin/deploy.sh
set -euo pipefail
cd /opt/krysy

TAG="${SSH_ORIGINAL_COMMAND:-latest}"
[[ "$TAG" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "bad tag: $TAG" >&2; exit 2; }

echo "== backup before deploy"
docker exec krysy node -e '
  const {DatabaseSync, backup} = require("node:sqlite"); const fs = require("fs");
  fs.mkdirSync("/data/backups", {recursive: true});
  backup(new DatabaseSync(process.env.DB_PATH, {readOnly: true}), "/data/backups/pre-deploy-" + process.argv[1] + ".sqlite")
    .then(p => console.log("backup pages:", p));' "$TAG" \
  || echo "(контейнер ещё не запущен или бэкап не удался — продолжаем)"

echo "== deploy $TAG"
printf 'IMAGE_TAG=%s\n' "$TAG" > .env
docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -af --filter "label=org.opencontainers.image.source=https://github.com/leksar/krysy-krysyat" >/dev/null

docker compose ps
docker exec krysy wget -qO- http://127.0.0.1:2567/health && echo
```

Откат: `ssh -i ~/.ssh/krysy_deploy root@89.167.106.105 sha-<старый>` (теги видны на странице пакета в GHCR).

### B.4. `Dockerfile` (корень репо, эскиз)

```dockerfile
# syntax=docker/dockerfile:1
# Зависимости чисто JS (node:sqlite встроен) => ставим их один раз на платформе раннера,
# а в финальный слой копируем под целевую платформу.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace packages/sim --workspace apps/server --include-workspace-root
COPY packages/sim packages/sim
COPY apps/server apps/server
RUN npm run build --workspace packages/sim --workspace apps/server \
 && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production PORT=2567 DB_PATH=/data/krysy.sqlite
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 2567
CMD ["node", "apps/server/dist/index.js"]
```

`.dockerignore`: `node_modules`, `apps/client`, `site`, `docs`, `.git`. Если когда-нибудь появится нативная зависимость — убрать `--platform=$BUILDPLATFORM` (сборка пойдёт под QEMU) или оставить одну платформу.

### B.5. `.github/workflows/server.yml`

```yaml
name: Build and deploy server

on:
  push:
    branches: [main]
    paths:
      - "apps/server/**"
      - "packages/sim/**"
      - "package.json"
      - "package-lock.json"
      - "Dockerfile"
      - ".github/workflows/server.yml"
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: server-deploy
  cancel-in-progress: false

env:
  IMAGE: ghcr.io/leksar/krysy-server

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.vars.outputs.tag }}
    steps:
      - uses: actions/checkout@v6
      - id: vars
        run: echo "tag=sha-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
      - uses: docker/setup-qemu-action@v4        # не нужен, если platforms одна и совпадает с раннером
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE }}
          tags: |
            type=raw,value=${{ steps.vars.outputs.tag }}
            type=raw,value=latest
      - uses: docker/build-push-action@v7
        with:
          context: .
          platforms: linux/amd64,linux/arm64   # после `uname -m` оставить одну
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}   # в т.ч. org.opencontainers.image.source => привязка к репо и фильтр prune
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: hetzner
    steps:
      - name: Deploy over SSH (forced command on the server runs /opt/krysy/bin/deploy.sh)
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
          HOST: ${{ secrets.DEPLOY_HOST }}
          TAG: ${{ needs.build.outputs.tag }}
        run: |
          set -euo pipefail
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/deploy_key && chmod 600 ~/.ssh/deploy_key
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=yes -o BatchMode=yes "root@$HOST" "$TAG"
```

`metadata-action` ставит label `org.opencontainers.image.source=https://github.com/leksar/krysy-krysyat` — тот самый, по которому `deploy.sh` чистит только наши образы. Строка `environment: hetzner` даёт отдельную страницу деплоев и место для required reviewers, если захочется ручного подтверждения.

### B.6. `.github/workflows/pages.yml` после появления Vite-клиента

```yaml
name: Deploy client to GitHub Pages
on:
  push:
    branches: [main]
    paths:
      - "apps/client/**"
      - "packages/sim/**"
      - "package.json"
      - "package-lock.json"
      - ".github/workflows/pages.yml"
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build --workspace apps/client     # vite build, base '/krysy-krysyat/', .env.production
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: apps/client/dist
      - id: deployment
        uses: actions/deploy-pages@v5
```

Клиентский код:

```ts
// apps/client/src/net.ts
import { Client } from "colyseus.js";
const fromQuery = new URLSearchParams(location.search).get("server");
export const serverUrl = fromQuery ?? import.meta.env.VITE_SERVER_URL; // wss://89-167-106-105.sslip.io/krysy
export const client = new Client(serverUrl);
```

```ini
# apps/client/.env.production   (в git)
VITE_SERVER_URL=wss://89-167-106-105.sslip.io/krysy
# apps/client/.env.development  (в git)
VITE_SERVER_URL=ws://localhost:2567
```

Серверная сторона (эскиз, `apps/server/src/index.ts`): `server.listen(Number(process.env.PORT ?? 2567))`; маршрут `GET /health` → `200 {"ok":true,"version":<protocolVersion>}`; `matchMaker.controller.getCorsHeaders = (h) => ({ "Access-Control-Allow-Origin": h.get("origin") === process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN : "null" })` (в dev `ALLOWED_ORIGIN` не задан → оставить дефолт); `new DatabaseSync(process.env.DB_PATH)` + `PRAGMA journal_mode=WAL`; `setInterval(dailyBackup, 24h)` с ротацией 7 файлов в `/data/backups`.

### B.7. Эксплуатация (вручную, ключом `krysy_hetzner`)

```bash
H='ssh -i ~/.ssh/krysy_hetzner root@89.167.106.105'

# статус и логи
$H 'cd /opt/krysy && docker compose ps && docker logs --tail 100 krysy'

# проверка маршрута снаружи (с ноутбука)
curl -i https://89-167-106-105.sslip.io/krysy/health      # 200 от игры
curl -sI https://89-167-106-105.sslip.io/ | head -1        # council по-прежнему отвечает

# применить изменённый krysy.caddy (между Вылазками: reload рвёт WebSocket)
$H 'docker exec council-caddy caddy validate --config /etc/caddy/Caddyfile && docker exec council-caddy caddy reload --config /etc/caddy/Caddyfile'

# забрать копию данных на ноутбук (архив всего volume вместе с /data/backups)
$H 'docker run --rm -v krysy_data:/data:ro alpine tar cz -C /data .' > "krysy-data-$(date +%F).tgz"

# откат на предыдущий образ
ssh -i ~/.ssh/krysy_deploy root@89.167.106.105 sha-<7символов>

# остановить игру, не трогая данные (volume остаётся)
$H 'cd /opt/krysy && docker compose down'
```

## Порядок первого запуска

1. (B) В репо `krysy-krysyat`: `deploy/`, `Dockerfile`, `.github/workflows/server.yml`; клиент и `pages.yml` — когда появится `apps/client`.
2. (A.2) Ключ деплоя, `/opt/krysy/*`, строка в `authorized_keys`. (A.3) Секреты.
3. Пуш в `main` → `server.yml` собирает образ → (A.4) пакет → Public → перезапуск workflow → `deploy.sh` поднимает контейнер. Снаружи он пока недоступен (Caddy ещё не знает маршрут) — проверка `docker exec krysy wget -qO- http://127.0.0.1:2567/health`.
4. (A.1) Коммит в council → их CI пересоздаёт `council-caddy` → `curl https://89-167-106-105.sslip.io/krysy/health` → 200.
5. Клиент с Pages подключается к `wss://89-167-106-105.sslip.io/krysy`; проверить с двух телефонов (критерии — тикет 001/011).

## Риски и ограничения

- **Reload Caddy рвёт WebSocket** (дефолт Caddy). Наш `krysy.caddy` меняется редко; пересоздание `council-caddy` их деплоем случается только при изменении конфигурации сервиса caddy. При желании — `stream_close_delay 5m` внутри `reverse_proxy` (держит старые соединения после reload), но это удлиняет жизнь старого конфига.
- **Пакет GHCR private по умолчанию** — первый деплой упадёт на `pull` до A.4. Это нормально.
- **Арх сервера неизвестен** — до `uname -m` собираем обе платформы.
- **Единственная внешняя зависимость от чужого** — строка `import` и строка volume в council; если их случайно удалит само-фикс council, игра пропадёт из сети без потери данных (контейнер и volume на месте), лечится повторным PR.
- **Secrets в Actions**: ключ без passphrase, но с `restrict,command=`; host key закреплён (`StrictHostKeyChecking=yes`).

## Источники

- Caddy: [import](https://caddyserver.com/docs/caddyfile/directives/import), [handle_path](https://caddyserver.com/docs/caddyfile/directives/handle_path), [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Directive order](https://caddyserver.com/docs/caddyfile/directives), [Caddyfile concepts](https://caddyserver.com/docs/caddyfile/concepts), [command-line (`caddy reload`)](https://caddyserver.com/docs/command-line), [Admin API](https://caddyserver.com/docs/api), [Automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Docker image](https://hub.docker.com/_/caddy)
- Docker: [compose networks (`external`, `name`)](https://docs.docker.com/reference/compose-file/networks/), [compose services (`volumes`, `create_host_path`, `aliases`)](https://docs.docker.com/reference/compose-file/services/), [compose up (`--pull`, пересоздание)](https://docs.docker.com/reference/cli/docker/compose/up/), [variable interpolation / `.env`](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), [docker image prune](https://docs.docker.com/reference/cli/docker/image/prune/), [docker/build-push-action](https://github.com/docker/build-push-action)
- GitHub: [Publishing Docker images (GHCR)](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images), [Package access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility), [Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions), [gh secret set](https://cli.github.com/manual/gh_secret_set), [appleboy/ssh-action](https://github.com/appleboy/ssh-action)
- OpenSSH: [sshd(8) AUTHORIZED_KEYS FILE FORMAT](https://man.openbsd.org/sshd#AUTHORIZED_KEYS_FILE_FORMAT)
- Colyseus: [colyseus.js `Client.ts`](https://github.com/colyseus/colyseus.js/blob/master/src/Client.ts), [`matchmaker/controller.ts`](https://github.com/colyseus/colyseus/blob/master/packages/core/src/matchmaker/controller.ts), [HTTP Routes / CORS](https://docs.colyseus.io/server/http-routes), [WebSocket transport](https://docs.colyseus.io/server/transport/ws), [Server](https://docs.colyseus.io/server), [Deployment](https://docs.colyseus.io/deployment)
- Vite: [Static deploy (GitHub Pages)](https://vite.dev/guide/static-deploy), [Env variables and modes](https://vite.dev/guide/env-and-mode)
- TLS: [Let's Encrypt rate limits](https://letsencrypt.org/docs/rate-limits/), [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat), [nip.io / sslip.io](https://nip.io/), [cunnie/sslip.io](https://github.com/cunnie/sslip.io)
- Node/SQLite: [node:sqlite](https://nodejs.org/api/sqlite.html), [Node.js releases](https://nodejs.org/en/about/previous-releases), [SQLite VACUUM INTO](https://sqlite.org/lang_vacuum.html)
- Hetzner: [Cloud Cost-Optimized plans](https://www.hetzner.com/cloud/cost-optimized/)
