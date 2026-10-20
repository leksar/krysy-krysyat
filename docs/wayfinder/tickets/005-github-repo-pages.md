---
id: 005
title: GitHub-репозиторий и включённые Pages
type: task
status: closed
assignee:
blocked_by: []
---
## Вопрос

Git уже инициализирован (`main`), `gh` залогинен как `leksar` — тикет AFK. Создать репозиторий на GitHub (приватный или публичный — публичный нужен для бесплатных Pages на free-плане, уточнить), запушить, включить GitHub Pages через Actions. Выход: URL репозитория и URL Pages, записанные в карту; пустая страница открывается с телефона по https.

## Резолюция

- Репозиторий: https://github.com/leksar/krysy-krysyat (публичный — на free-плане Pages работает только для публичных).
- Pages: https://leksar.github.io/krysy-krysyat/ — деплой из Actions (`.github/workflows/pages.yml`), источник — папка `site/`. Когда появится Vite-клиент, workflow меняется на сборку и `path: dist`; `base` в Vite = `/krysy-krysyat/`.
- Проверено: страница отдаёт 200 по https после первого прогона workflow.
