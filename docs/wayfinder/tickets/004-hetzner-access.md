---
id: 004
title: Доступ на Hetzner и инвентаризация сервера
type: task
status: closed
assignee:
blocked_by: []
---
## Вопрос

Получить от пользователя SSH-доступ (ключ, пользователь, порт) к `89-167-106-105.sslip.io` и, **ничего не меняя**, выяснить: ОС и ресурсы, что за 3–4 приложения крутятся и как (Docker? systemd?), какой реверс-прокси отдаёт HTTPS (Caddy / nginx / Traefik) и как добавить новый маршрут/поддомен (`*.sslip.io` даёт любой поддомен бесплатно), свободные порты, есть ли Node/Docker, где логи. Выход: `docs/research/hetzner-inventory.md` с фактами и правилом «что можно трогать».

## Резолюция

- Доступ есть: `ssh -i ~/.ssh/krysy_hetzner root@89.167.106.105`, порт 22 (ключ добавил пользователь после сброса пароля root в панели).
- Ubuntu 26.04, 2 vCPU, 3.7 GiB RAM (~2 свободно, swap нет), диск 38 GB занят на **83 %** (15 GB — чужой docker build cache). Node на хосте нет, всё в Docker 29 / Compose v5. Файрвола нет.
- Крутятся два чужих compose-проекта: `council` (+ `council-caddy` на 80/443) в `/opt/council` и `void` (2 бота) в `/opt/void`. Оба деплоятся GitHub Actions через `git reset --hard` + `compose up --build`; у council — ИИ-само-фикс каждые 20 мин, коммитит и деплоит сам.
- HTTPS только через `council-caddy`; Caddyfile лежит в git council → **править его можно только коммитом в `leksar/council`**, иначе сотрётся. Наш контейнер подключается к внешней сети `council_net-main`, маршрут — через их Caddy (`caddy reload` разрешён). `sslip.io` не в PSL → новый поддомен рискует лимитом Let's Encrypt; безопаснее путь `/krysy/*` на существующем хосте.
- Правила «что можно / нельзя» и открытые вопросы для деплоя — в [docs/research/hetzner-inventory.md](../../research/hetzner-inventory.md).
