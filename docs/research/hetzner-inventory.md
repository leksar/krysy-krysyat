# Инвентаризация сервера Hetzner (тикет 004)

Снято 2026-10-20, только чтение. Доступ: `ssh -i ~/.ssh/krysy_hetzner root@89.167.106.105` (порт 22, ключ `claude@krysy-krysyat` в `/root/.ssh/authorized_keys`).

## Железо и ОС

| | |
|---|---|
| Hostname | `ubuntu-4gb-hel1-1` (Hetzner Cloud, Хельсинки) |
| ОС | Ubuntu 26.04 LTS, ядро 7.0 |
| CPU / RAM | 2 vCPU, 3.7 GiB (свободно ~2 GiB), **swap нет** |
| Диск | 38 GB, **занято 83 %** (6.4 GB свободно) |
| Uptime | 119 дней |
| Docker | 29.6, Compose v5.1.4 |
| Node на хосте | **нет** — всё живёт в контейнерах |
| Firewall | ufw неактивен, iptables INPUT ACCEPT — любой опубликованный порт виден всему интернету |
| SSH | порт 22, вход по паролю включён (root) |

Диск: 5.7 GB — образы Docker, из них **15 GB reclaimable build cache** (`docker system df`) — чужой, не чистить без владельца; но это главный резерв места, если понадобится.

## Что крутится (всё — Docker Compose, всё чужое)

| Контейнер | Проект | Каталог | Сеть | Порты наружу | Память |
|---|---|---|---|---|---|
| `council` | council | `/opt/council` | `council_net-main` | — | ~290 MB |
| `council-caddy` | council | `/opt/council` | `council_net-main` | **80, 443** | ~45 MB |
| `void` | void | `/opt/void` | `void_default` | — | ~100 MB |
| `void-daughter` | void | `/opt/void` | `void_default` | — | ~120 MB |

Оба проекта — Telegram-боты пользователя (`leksar/council`, `leksar/void` на GitHub), `restart: always`.

### Как они деплоятся — главный факт

`/opt/council` и `/opt/void` — git-чекауты. GitHub Actions (`deploy.yml`) по пушу в `main` заходит по SSH и делает:

```
git fetch origin <sha> && git reset --hard <sha>
docker compose up -d --build
docker image prune -f
```

**Следствие: любая правка файлов внутри `/opt/council` или `/opt/void` на сервере будет стёрта следующим деплоем.** А деплои частые: у council работает петля само-фикса (`bin/selffix-nightly.sh`, крон каждые 20 мин) — ИИ сам коммитит в репо, CI сам деплоит. Последний такой коммит — сегодня утром.

Хост-крон (root), все скрипты из `/opt/council/bin` и `/opt/void/bin`:

```
*/5   watchdog-council.sh, watchdog-void.sh   — живость контейнеров, диск <90 %, алерт в Telegram
*/10  void backup-kb.sh                        — пуш данных в GitHub
*/15  backup-council.sh                        — пуш данных + sqlite backup в /root/council-backups
*/20  council selffix-nightly.sh               — само-фикс (коммит → CI → деплой)
4:30  void selffix-nightly.sh
```

Watchdog шлёт алерт при диске > 90 % — у нас запас ~2.5 GB до этого порога. Образ игры должен быть маленьким (alpine + node, без build cache на сервере — лучше собирать в GitHub Actions и тянуть готовый образ).

## HTTPS и прокси

Единственный вход на 80/443 — `council-caddy` (Caddy 2.11, образ `caddy:2`, `caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`, без `--watch`). Конфиг — `/opt/council/Caddyfile` (bind-mount `:ro`, **файл в git-репо council**):

```
89-167-106-105.sslip.io {
	reverse_proxy council:8100
}
```

Сертификат Let's Encrypt на `89-167-106-105.sslip.io` в volume `council_caddy-data`. Caddy сидит в сети `council_net-main` — чтобы проксировать на наш контейнер, он должен быть в той же сети (`networks: council_net-main: external: true`).

`krysy.89-167-106-105.sslip.io` резолвится в тот же IP (проверено). **Но** `sslip.io` не в Public Suffix List → лимит Let's Encrypt «50 сертификатов в неделю на домен» делится между всеми пользователями sslip.io в мире; новый поддомен может упереться в лимит. Путь без нового сертификата — маршрут по пути на существующем хосте: `89-167-106-105.sslip.io/krysy/*`.

## Что можно трогать — правило для всех следующих тикетов

**Нельзя:**
- Править что-либо внутри `/opt/council`, `/opt/void`, `/opt/*-fix`, `/root/*backups*` — сотрётся деплоем и/или сломает чужие петли.
- Перезапускать/пересоздавать чужие контейнеры (кроме `caddy reload`, см. ниже).
- Публиковать порты игры на хост (`ports:`) — файрвола нет, всё будет открыто; трафик только через Caddy.
- `docker system prune` / `builder prune` — чужой кэш; только с явного согласия пользователя.
- Трогать crontab (чужие скрипты просят «добавлять строкой, не перезаписывая»; нам крон пока не нужен).

**Можно:**
- Свой каталог `/opt/krysy` со своим `docker-compose.yml`, своим образом, своей БД (SQLite в volume).
- Подключить свой контейнер к внешней сети `council_net-main`.
- `docker exec council-caddy caddy reload --config /etc/caddy/Caddyfile` — применяет изменения конфига без перезапуска контейнера и без обрыва council.
- Новый SSH-ключ для деплоя игры из GitHub Actions (отдельный, не чужой `github-council-push`).

**Единственная необходимая правка чужого — Caddyfile**, и делать её надо **через репозиторий `leksar/council`** (коммит/PR), а не на сервере: иначе первый же деплой council вернёт старый конфиг и игра пропадёт из сети. Предлагаемая форма — одна строка `import /etc/caddy/sites/*.caddy` в Caddyfile + bind-mount `/opt/krysy/caddy:/etc/caddy/sites:ro` в сервис `caddy` в compose council; дальше наш маршрут живёт в `/opt/krysy/caddy/krysy.caddy` и council больше не трогаем. Это разовое изменение потребует пересоздания `council-caddy` (несколько секунд без HTTPS у council). Решение по форме — в тикете 012.

## Открытые вопросы для тикета 012

1. Маршрут по пути (`/krysy/*`, без нового сертификата) или поддомен (`krysy.89-167-106-105.sslip.io`, риск лимита LE)?
2. Сборка образа: на сервере (`docker compose build`, растит build cache на почти полном диске) или в GitHub Actions → GHCR → `docker compose pull` на сервере (рекомендуется).
3. Деплой-ключ: отдельная пара только для `/opt/krysy`, секреты в репо `krysy-krysyat`.
4. Пусть пользователь решит, чистить ли 15 GB build cache (`docker builder prune`) — это чужой кэш council/void, но без него диск останется на 83 %.
