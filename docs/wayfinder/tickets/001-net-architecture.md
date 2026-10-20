---
id: 001
title: Сетевая архитектура онлайн-платформера на телефонах
type: research
status: closed
assignee:
blocked_by: []
---
## Вопрос

Как синхронизировать реалтайм-платформер (гравитация, прыжки, 2–6 игроков, у каждого своя камера) между телефонами через Node-сервер на VPS так, чтобы прыжки не ощущались ватными при 50–150 мс пинга? Сравнить: server-authoritative + client prediction/reconciliation vs host-authoritative (один телефон симулирует, сервер — релей) vs lockstep. Какие библиотеки реально живы в 2026 (Colyseus, nengi, geckos.io, свой ws + общий модуль физики)? Рекомендуемый tick rate, формат снапшотов, интерполяция чужих крыс. Выход: рекомендация с обоснованием + ссылки на первоисточники.

## Резолюция

- Модель: **server-authoritative + client-side prediction/reconciliation** для своей Крысы, snapshot-интерполяция (~100 мс) для чужих. Lockstep отклонён (задержка = худший пир, нужна побитовая детерминированность на зоопарке Android), host-authoritative отклонён (два пинга до авторитета, сон вкладки хоста, миграция).
- Транспорт: **WebSocket (wss за nginx)**; WebRTC (geckos.io) требует UDP-диапазона и TURN на общем VPS, WebTransport на сервере пока experimental. nginx: заголовки Upgrade + proxy_read_timeout/ping (дефолт 60 с).
- Библиотека: **Colyseus 0.18** (0.18.0 — май 2026, релизы еженедельно, MIT, Node ≥ 22): `setFixedTimestep`, `defineInput`, `Predict`/`reconciler`, `attachAll` lerp 100 мс, `allowRewindState`, автореконнект. nengi — только rc без стабильного 2.0, geckos.io — ~1 релиз в год. Запасной путь: свой `ws` + тот же общий `step`.
- Параметры: tick 30 Гц, 1 инпут на шаг, patchRate 30 Гц (или 20), интерполяция 100–150 мс, `smoothMs` ≈ 1 патч, `snap` ≈ 1 тайл.
- Симуляция: один TypeScript-модуль `step(ctx, state, input)` на клиенте и сервере, своя AABB-физика, без `Math.random`/`Date.now` внутри шага; coyote time / jump buffer внутри `step`.
- Снапшот: дельта-патчи Schema по Крысе `x, y, vx, vy, facing, state, grounded`; ввод — плоские флаги `seq, moveX, jump, jumpHeld, action`.
- Первый спайк: две Крысы на двух телефонах через 4G с симулятором задержки 150 мс / 2 % потерь + reconnect после сворачивания вкладки.

Подробно: [docs/research/net-architecture.md](../../research/net-architecture.md).
