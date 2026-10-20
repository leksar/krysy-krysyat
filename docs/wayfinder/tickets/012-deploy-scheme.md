---
id: 012
title: Схема деплоя клиента и сервера
type: research
status: closed
assignee:
blocked_by: [004, 005]
---
## Вопрос

Исходя из инвентаризации сервера (004) и репозитория (005): как сервер игры живёт на Hetzner рядом с чужими приложениями (Docker-контейнер или systemd, свой поддомен `*.sslip.io`, маршрут в существующем прокси, `wss://`), как клиент собирается и выкладывается на GitHub Pages через Actions, как клиент узнаёт адрес сервера, как выкатывать обновления, не трогая чужое. Выход: пошаговая схема + список команд, готовых к исполнению.

## Резолюция

- Маршрут **по пути** `https://89-167-106-105.sslip.io/krysy/*` → контейнер `krysy:2567` через существующий `council-caddy` (`handle_path` снимает префикс; клиент Colyseus умеет путь в endpoint). Поддомен отклонён: новый сертификат, `sslip.io` не в PSL (проверено по полному списку), лимит LE общий — ненужный риск.
- **Единственная правка чужого** — один коммит в `leksar/council`: `import /etc/caddy/sites/*.caddy` внутри блока сайта + bind-mount `/opt/krysy/caddy:/etc/caddy/sites:ro` у сервиса caddy (пустой глоб — не ошибка, Compose создаст каталог сам). Их CI разово пересоздаст `council-caddy`; дальше маршрут живёт в `/opt/krysy/caddy/krysy.caddy`, применяется `docker exec council-caddy caddy reload …` (рвёт WebSocket — делать между Вылазками).
- Образ собирает GitHub Actions → GHCR `ghcr.io/leksar/krysy-server:sha-<7>` (+`latest`, пакет разово сделать Public); деплой — `ssh` деплой-ключом с `restrict,command="/opt/krysy/bin/deploy.sh"` (тег через `SSH_ORIGINAL_COMMAND`), на сервере `docker compose pull && up -d` + prune только образов с нашей меткой. На сервере ничего не собирается; перед первым деплоем `uname -m` (CX23 x86 / CAX11 Arm64).
- Клиент: `VITE_SERVER_URL=wss://89-167-106-105.sslip.io/krysy` в `apps/client/.env.production`, `base: '/krysy-krysyat/'`; `pages.yml` переходит на `npm ci → build → upload apps/client/dist`. CORS у Colyseus включён по умолчанию, сужаем до `https://leksar.github.io`.
- SQLite через встроенный `node:sqlite` в volume `krysy_data` (`/data/krysy.sqlite`); бэкап `sqlite.backup()` раз в сутки из процесса + перед каждым деплоем; крон хоста не трогаем; копия на ноутбук — `docker run … alpine tar` через ssh.
- Полная схема с файлами (compose, `krysy.caddy`, `deploy.sh`, Dockerfile, оба workflow) и командами, разделённая на «A: разово, нужен OK пользователя» и «B: наше»: [docs/research/deploy-scheme.md](../../research/deploy-scheme.md).
