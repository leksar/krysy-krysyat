# Wayfinder — локальный трекер

Трекер задач не настроен, поэтому карта и тикеты живут здесь как markdown.

- `MAP.md` — карта (`wayfinder:map`).
- `tickets/NNN-slug.md` — тикеты, дочерние к карте. Frontmatter:
  - `type`: research | prototype | grilling | task
  - `status`: open | closed
  - `assignee`: пусто = не взят; имя = взят (claim ставится ДО работы)
  - `blocked_by`: список id тикетов
- **Фронтир** = `status: open`, `assignee` пустой, все `blocked_by` закрыты.
- Резолюция пишется в конец тикета в раздел `## Резолюция`, статус → `closed`,
  в `MAP.md` → строка в «Решения».
- Исследования складываются в `docs/research/<slug>.md` и линкуются из тикета.
