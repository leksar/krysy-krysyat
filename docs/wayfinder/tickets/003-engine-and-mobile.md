---
id: 003
title: Движок клиента и мобильные ограничения (PWA, тач, GitHub Pages)
type: research
status: closed
assignee:
blocked_by: []
---
## Вопрос

На чём писать клиент мобильного web-платформера: Phaser 3/4, PixiJS + своя физика, Kaplay, чистый canvas? Критерии: тач-управление (виртуальный джойстик + кнопки без задержки), производительность на средних Android, возможность запускать ту же физику на сервере (общий TS-модуль), размер бандла, деплой как статика на GitHub Pages (пути, SPA, PWA-манифест и service worker, полноэкранный режим, блокировка ориентации, wake lock). Выход: рекомендация стека клиента + список мобильных граблей с решениями.

## Резолюция

Клиент: **PixiJS 8 (только рендер) + собственная детерминированная симуляция на чистом TS (`packages/sim`)**, общая для браузера и Node-сервера; Vite + TS, PWA через `vite-plugin-pwa` (`registerType: 'prompt'`, обновление только в Норе), деплой GitHub Actions → Pages с `base: '/<repo>/'`. Phaser 4 (4.2.1, июль 2026) — запасной вариант «с батарейками», но его физика непереносима на сервер (HEADLESS требует DOM); KAPLAY — стабильная ветка год без релизов, v4000 в alpha; чистый canvas — без выигрыша перед Pixi. Мобильные грабли: один тап «войти» разблокирует fullscreen + `screen.orientation.lock` + Wake Lock + звук; манифест `display: fullscreen`, `orientation: landscape`, CSS-оверлей «поверни телефон»; Pointer Events с `pointerId` и `touch-action: none` на канвасе, ввод читается снимком на фиксированный тик; низкое внутреннее разрешение с nearest-апскейлом вместо полного DPR; на iOS Fullscreen API и вибрация не работают. Проверяет прототип 010.

Подробности: [docs/research/engine-and-mobile.md](../../research/engine-and-mobile.md).
