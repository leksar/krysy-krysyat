# Звуки и музыка: список событий v1, свободные источники, воспроизведение на телефоне

Тикет: [015-sounds](../wayfinder/tickets/015-sounds.md). Дата проверки источников: 2026-10-20.
Контекст: мобильный пиксель-арт платформер (PixiJS 8 + Vite, Android-браузеры в первую очередь, iOS — «как получится»), один тап «войти» уже разблокирует fullscreen/orientation/Wake Lock ([engine-and-mobile.md](engine-and-mobile.md)). События игры — по [raid-rules.md](../design/raid-rules.md), термины — по [CONTEXT.md](../../CONTEXT.md).
Как и в [pixel-assets.md](pixel-assets.md): каждая ссылка открыта, лицензия снята со страницы ассета (поле «License» на OpenGameArt/Kenney, «Creative Commons 0» на freesound). Ничего не скачивалось: имена файлов внутри архивов, которых нет на странице, помечены «н/у» и проверяются после скачивания.

## TL;DR

- **~40 событий** в шести группах (ниже таблица). Больше половины «игровых» звуков (прыжок, укус, подбор, UI-пики, пороги Переполоха) дешевле и стилистически правильнее **сгенерировать в jsfxr** (sfxr.me, Unlicense) — они будут одинаково 8-битными. Записанный фоли берём только там, где нужен узнаваемый живой звук: крыса пищит, голубь хлопает и воркует, кот шипит, ребёнок кричит, метла шаркает, двор шумит.
- Основные пакеты: **Kenney Interface Sounds / Impact Sounds / RPG Audio** (CC0), **Juhani Junkala «512 Sound Effects (8-bit style)»** (CC0, с папками Jumping and Landing / Footsteps / Alarms / Fanfares / Menu…), точечные CC0 с OpenGameArt (Squeaky Rat, Meow, Thwack, Swishes, 7 Eating Crunches, 80 creature SFX) и freesound с фильтром CC0 (голубь, крыса, кот, ребёнок, метла, двор).
- **Музыка**: Нора — «Rat Sewer» (HaelDB, CC0, луп с капелью — буквально про крыс в норе); высокий Переполох — Juhani Junkala «5 Chiptunes (Action)», трек Level 3 (CC0, бесшовный луп). Запасные: «Uneasy town» (CC0), «Tense Future Loop» (CC0), «Mysterious Sewer» (CC0).
- **Воспроизведение**: своя обёртка над Web Audio API (~150 строк), без howler и без `@pixi/sound`. Причины: howler 2.2.4 — последний релиз сентябрь 2023, 420 открытых issue; `@pixi/sound` 6.0.1 — июль 2024, репозиторий без пушей с сентября 2024; обе библиотеки решают проблемы, которых у нас нет (HTML5-fallback, авто-unlock по любому тапу), и не решают те, что есть (iOS-состояние `interrupted`, фон по `visibilitychange`). Один аудиоспрайт `.ogg` + `.m4a` (для iOS < 18.4), декодируется один раз, звук играет через `AudioBufferSourceNode.start(0, offset, duration)`; AudioContext создаётся/`resume()` в том же тапе «войти»; в фоне — `suspend()`, при возврате — `resume()` с обработкой `interrupted`.

## Принципы

1. **Стиль.** Арт — пиксельный на сетке 16 px, значит звук «коротко и сухо»: 8-битные sfxr-пики для действий игрока и UI, живой фоли — для существ и среды. Смешивать можно, если фоли обрезать коротко (≤ 0,5 с) и чуть понизить битность/частоту (sfxr.me умеет экспорт в 22 кГц/8 бит, записи можно прогнать через ffmpeg `-ar 22050`).
2. **Лицензии.** Допущены CC0 и CC-BY (строка в титрах). CC-BY-SA и GPL — не берём (заражают производные). Все CC-BY ведём в `CREDITS.md` рядом с Calciumtrice из тикета 002.
3. **Объём.** Все sfx в один спрайт ≈ 40 звуков × 0,3–1 с ≈ 30–40 с аудио ≈ 400–600 КБ в Vorbis q4. Два музыкальных лупа по 1–2 МБ. Итого < 3 МБ, грузится после входа в Нору, не блокирует старт.
4. **Триггер → событие.** Клиент получает от sim/сервера события (`RatJumped`, `HumanPanicked`, `PigeonStole`…) и маппит их в имена спрайтов. Для своей Крысы прыжок/укус/шаги озвучиваются **по предсказанию клиента** сразу на `pointerdown` (иначе +50–100 мс RTT, см. [net-architecture.md](net-architecture.md)); чужие — по событиям с сервера.

## Таблица событий v1

Легенда «Источник»: **jsfxr** — сгенерировать в [sfxr.me](https://sfxr.me) пресетом (указан), сохранить `.wav` + JSON-параметры в репо, чтобы перегенерировать; **512** — Juhani Junkala, «512 Sound Effects (8-bit style)», CC0, папки по [INFO.txt](https://git.uni-greifswald.de/GAIM/gaim/src/branch/main/assets/Sounds/collection1/INFO.txt) пакета; **K-Interface / K-Impact / K-RPG / K-UI** — Kenney, CC0.

### Крыса

| # | Событие | Когда | Источник | Лицензия | Файл / пресет | Примечание |
|---|---|---|---|---|---|---|
| 1 | `rat_step` | каждый N-й кадр бега по земле | K-RPG (теги footstep) или 512 → Movement/Footsteps | CC0 | K-RPG: н/у; 512: `sfx_movement_footsteps1a.wav` | 2–3 варианта, случайный выбор + `playbackRate` 0,9–1,1; не чаще 1 раза в 120 мс |
| 2 | `rat_jump` | отрыв от земли | jsfxr | Unlicense (результат — наш) | пресет **Jump** | короткий, 0,15 с; дублируется в 512 → Movement/Jumping and Landing `sfx_movement_jump1.wav` |
| 3 | `rat_land` | приземление | K-Impact (теги impact, foley) | CC0 | н/у (мягкий удар) | тихо; падение урона не наносит, звук чисто тактильный |
| 4 | `rat_bite` | кнопка Укус | jsfxr + [7 Eating Crunches](https://opengameart.org/content/7-eating-crunches) (StarNinjas) | Unlicense / CC0 | пресет **Hit/hurt** (короткий, square) + `crunch_-_tito.zip` | слой «пик + хруст»; попадание/промах различать высотой |
| 5 | `rat_hurt` | получила урон | [Squeaky Rat](https://opengameart.org/content/squeaky-rat) (qubodup) | CC0 | `qubodupSqueakyRat.7z` → Pain | производное от freesound 143125 (Zabuhailo, CC0) |
| 6 | `rat_down` | HP = 0, лежит | Squeaky Rat → Death | CC0 | там же | + низкий «бум» из K-Impact |
| 7 | `rat_revive` | напарник додержал Действие 3 с | jsfxr | Unlicense | пресет **Powerup** | восходящий арпеджио |
| 8 | `rat_dead` | не подняли за 30 с, карманы высыпались | Squeaky Rat → Death + K-Interface (drop) | CC0 | н/у | россыпь предметов — 3–4 коротких «drop» со сдвигом 40 мс |
| 9 | `rat_drink` | пьёт из лужи/крана | freesound [Drinking water in gulps](https://freesound.org/people/augustclaire2211/sounds/624775/) (augustclaire2211) | CC0 | wav 44,1 кГц, 9,9 с → вырезать 2 глотка | альтернатива: [Liquid Bottle Drink Set](https://opengameart.org/content/liquid-bottle-drink-set) (qubodup, CC0) |
| 10 | `rat_mark` | ставит Метку в Еду | [Dripping water loop](https://opengameart.org/content/dripping-water-loop) (Independent.nu) + jsfxr | CC0 / Unlicense | `atmosbasement.mp3_.flac` → 2–3 капли; поверх пресет **Blip/select** | комичность за счёт «пик-пик» поверх капели |
| 11 | `rat_eat` | съела Еду из Карманов (лечение) | 7 Eating Crunches | CC0 | `crunch_-_tito.zip` | другой файл, чем в укусе |
| 12 | `pickup` | Ингредиент попал в Карманы | jsfxr или 512 → General Sounds/Coins | Unlicense / CC0 | пресет **Pickup/coin**; `sfx_coin_single1.wav` | высота по размеру предмета: Еда выше, Орган ниже |
| 13 | `pockets_full` | предмет не влез | 512 → General Sounds/Negative Sounds | CC0 | `sfx_sounds_error1.wav` | + визуальная тряска Карманов |

### Люди

| # | Событие | Когда | Источник | Лицензия | Файл | Примечание |
|---|---|---|---|---|---|---|
| 14 | `human_panic` | Прохожий увидел крысу | [Aargh! (male screams)](https://opengameart.org/content/aargh-male-screams) (congusbongus) / [Female screams](https://opengameart.org/content/female-screams) (congusbongus) | CC-BY 3.0 (атрибуция по `aargh.txt` внутри архива) | `aargh.zip` (8 криков), `female_screams.zip` | по полу спрайта; обрезать до 0,6 с, прогнать через 22 кГц — иначе выпадет из пиксельного стиля. CC0-вариант: [Girly Scream](https://opengameart.org/content/girly-scream) (Ferk, мультилицензия с CC0) |
| 15 | `child_scream` | Ребёнок кричит (скачок Переполоха) | freesound [Child Scream](https://freesound.org/people/onehugeeye/sounds/511320/) (onehugeeye) | CC0 | wav 48 кГц, 8,1 с → вырезать 1 с | единственный «настоящий» крик в игре — пусть будет заметным |
| 16 | `human_step` | шаги Человека (громче и реже крысиных) | K-RPG footsteps или [Footsteps on different surfaces](https://opengameart.org/content/footsteps-on-different-surfaces) (congusbongus) | CC0 / CC-BY 3.0 | н/у / `footsteps.zip` → concrete | по громкости — индикатор «кто-то рядом», важно для скрытности |
| 17 | `human_stomp` | Прохожий топчет зажатую крысу | K-Impact | CC0 | н/у (тяжёлый глухой удар) | + `rat_hurt` |
| 18 | `broom_swing` | Дворник махнул метлой | [Swishes Sound Pack](https://opengameart.org/content/swishes-sound-pack) (artisticdude) | CC0 | `swishes.zip` (4 лёгких + 9 тяжёлых) | тяжёлый swish; фоновый шарк — freesound [Broom sweeping](https://freesound.org/people/CarikaDarvall/sounds/764462/) (CarikaDarvall, CC0, 19,5 с) для «Дворник ходит и метёт» |
| 19 | `broom_hit` | метла попала | [Thwack Sounds](https://opengameart.org/content/thwack-sounds) (AntumDeluge) | CC0 | `thwack-1.0.zip` | + `rat_hurt` |
| 20 | `slipper_throw` | Бабка кинула тапок | Swishes (лёгкий) | CC0 | `swishes.zip` | |
| 21 | `slipper_hit` | тапок попал | Thwack или [Punch, slap, n' kick](https://opengameart.org/content/punch-slap-n-kick) (CGEffex) | CC0 / CC-BY 3.0 | `thwack-1.0.zip` / `hits.zip` (16 ударов, есть шлепки) | шлепок резины — ближе «slap» из второго пакета |
| 22 | `human_death` | Человека загрызли | Aargh! → другой крик, чем в панике | CC-BY 3.0 | `aargh.zip` | или 512 → Death Screams/Human (CC0), если хотим всё 8-битно |
| 23 | `human_cough` | стадия Болеет (раз в 15 с с Выделениями) | [80 CC0 creature SFX](https://opengameart.org/content/80-cc0-creature-sfx) (rubberduck) | CC0 | `80-CC0-creature-SFX.zip` → cough (3 шт.) | |
| 24 | `human_eat_marked` | Человек съел Меченую еду | 80 CC0 creature SFX → eat (4 шт.) | CC0 | там же | сигнал всей Стае «заражение пошло» — можно добавить `ui_confirm` |
| 25 | `secretion_drop` | Выделения упали на землю | 80 CC0 creature SFX → spit (3 шт.) | CC0 | там же | мерзко, как и надо |

### Голуби

| # | Событие | Когда | Источник | Лицензия | Файл | Примечание |
|---|---|---|---|---|---|---|
| 26 | `pigeon_flap` | взлёт / пикирование | freesound [short pigeon wing flap](https://freesound.org/people/zouzmusic/sounds/414671/) (zouzmusic) | CC0 | wav 48 кГц, 1,36 с | автор советует слоить + задержка для стаи; CC-BY-альтернатива: [Flap, Splat, Poo (Yo Frankie!)](https://opengameart.org/content/flap-splat-poo-yo-frankie) `bird_flap.flac` |
| 27 | `pigeon_coo` | голубь сел рядом / idle | freesound [Pigeon cooing](https://freesound.org/people/Fsu2001/sounds/795558/) (Fsu2001) | CC0 | m4a 48 кГц, 21 с → вырезать 1–2 с | редко, с затуханием по расстоянию |
| 28 | `pigeon_steal` | Воришка выхватил предмет | `pigeon_flap` + jsfxr | CC0 / Unlicense | пресет **Pickup/coin** проигранный с `playbackRate` 0,7 (вниз) | «минус предмет» должно звучать обидно |
| 29 | `pigeon_peck` | Драчун клюнул | jsfxr | Unlicense | пресет **Hit/hurt** (короткий, высокий) | + `rat_hurt` |
| 30 | `pigeon_dead` | голубь убит (Перо/Тушка) | Flap, Splat, Poo → `bird_splat.flac` + `pickup` | CC-BY 3.0 (Blender Foundation) | | CC0-вариант: 512 → Simple Damage Sounds |

### Переполох

| # | Событие | Когда | Источник | Лицензия | Файл | Примечание |
|---|---|---|---|---|---|---|
| 31 | `alert_threshold` | шкала прошла 30 / 60 / 85 % | 512 → General Sounds/Alarms | CC0 | `sfx_alarm_loop1.wav` → первые 0,5 с | один и тот же звук, +1 полутон на каждом пороге |
| 32 | `alert_critical` | 100 % | 512 → General Sounds/Low health Alarms | CC0 | `sfx_lowhealth_alarmloop1.wav` | луп тихо под музыку, пока Вылазка не кончится |
| 33 | `cat_arrive` | 60 %: пришёл Кот | [Meow](https://opengameart.org/content/meow) (IgnasD) | CC0 | `Meow.ogg` (9,8 КБ) | слышно всем на карте, без затухания |
| 34 | `cat_attack` | Кот бросился | freesound [catHisses1.wav](https://freesound.org/people/Zabuhailo/sounds/146963/) (Zabuhailo) | CC0 | wav 96 кГц, 1,5 с | CC-BY-вариант с 8 злыми котами: [Cat SFX](https://opengameart.org/content/cat-sfx) (кредит «SFX by Dan Knoflicek») |
| 35 | `pigeon_flock` | 85 %: Стая голубей | `pigeon_flap` × 4–6 со сдвигом 30–80 мс и разным `playbackRate` | CC0 | — | отдельного файла не нужно |

### UI

| # | Событие | Когда | Источник | Лицензия | Файл | Примечание |
|---|---|---|---|---|---|---|
| 36 | `ui_tap` | любая кнопка в Норе/лобби | K-Interface (click) или K-UI | CC0 | н/у (пакет: 100 OGG — клики, snap, minimize/maximize, confirmation, [описание на OGA](https://opengameart.org/content/interface-sounds)) | игровые кнопки (Прыжок/Укус) UI-звуком **не** озвучивать — у них свои события |
| 37 | `ui_confirm` | выбрали Вылазку, сварили Зелье | K-Interface (confirmation) | CC0 | н/у | |
| 38 | `ui_error` | нельзя (нет Еды на апгрейд и т.п.) | K-Interface (error) или 512 Negative | CC0 | н/у / `sfx_sounds_error1.wav` | |
| 39 | `exit_hold` | Крыса стоит у Выхода (5 с / 1 с) | jsfxr | Unlicense | пресет **Blip/select**, тикает раз в секунду с ростом высоты | отменился — `ui_error` |
| 40 | `exit_done` | вынесла | 512 → General Sounds/Fanfares | CC0 | `sfx_sounds_fanfare1.wav` | слышат все: напарник ушёл |
| 41 | `raid_success` | Вылазка завершена, добыча зачтена | [Music Jingles](https://kenney.nl/assets/music-jingles) (Kenney, 85 файлов) | CC0 | н/у (выбрать короткий мажорный) | экран итогов |
| 42 | `raid_fail` | все лежат/мертвы | Music Jingles (минорный) или 512 Negative | CC0 | н/у | |

### Фон

| # | Событие | Когда | Источник | Лицензия | Файл | Примечание |
|---|---|---|---|---|---|---|
| 43 | `amb_yard` | вся Вылазка на Дворе | freesound [Courtyard ambience with pigeons and city sounds in spring](https://freesound.org/people/Garuda1982/sounds/851386/) (Garuda1982, Лейпциг, 2026) | CC0 | wav 48 кГц, 4:05, 45 МБ → вырезать 30–40 с без явных событий, кроссфейд-луп, Vorbis q3 ≈ 300 КБ | идеально по смыслу: двор + голуби + далёкий город |
| 44 | `amb_nora` | Нора (если музыка выключена или поверх неё тихо) | Dripping water loop (Independent.nu) | CC0 | `atmosbasement.mp3_.flac` (1,3 МБ) | тот же файл, что для Метки |
| 45 | `amb_panic` | слой поверх `amb_yard` при Переполохе ≥ 60 % | freesound [Cartoon Crowd Panic Loop](https://freesound.org/people/abraksil/sounds/727773/) (abraksil) | CC0 | wav 44,1 кГц, 6,7 с, луп | громкость = (Переполох − 60) / 40; CC0-альтернатива с OGA: [Crowd Shouting/Speaking Ambience](https://opengameart.org/content/crowd-shoutingspeaking-ambience) (StarNinjas) |

Итого 45 позиций; обязательный минимум для первой играбельной версии — 1–8, 12, 14, 16, 18–19, 26, 28, 31, 33, 36–40, 43 и два музыкальных лупа (≈ 25 файлов).

## Музыка

| Роль | Трек | Автор | Лицензия | Файл | Почему |
|---|---|---|---|---|---|
| **Нора** (спокойно) | [Rat Sewer](https://opengameart.org/content/rat-sewer) | HaelDB | CC0 (двойная: OGA-BY 3.0 / CC0 — берём CC0) | `ratsrats_0.ogg`, 712 КБ, луп | «Creepy rat sewer… looped, dark, water droplets in the back» — тёмный, но негромкий, капель совпадает с `amb_nora`; тематически — буквально нора крыс |
| Нора, запасной | [Mysterious Sewer](https://opengameart.org/content/mysterious-sewer) | smark | CC0 | `mysterious_sewer_main.mp3` (3,9 МБ) | 8-битный сайдскроллерный «sewer»; луп не заявлен — проверить стык |
| Нора, если нужно светлее | [Two looping retro midi songs (calm, tense)](https://opengameart.org/content/two-looping-retro-midi-songs-calm-tense) → «Happy melody» | tapatilorenzo | CC0 | `happy_melody.mp3` (0:48, луп) | бодрая колокольная тема |
| **Высокий Переполох** (напряжённо) | [5 Chiptunes (Action)](https://opengameart.org/content/5-chiptunes-action) → Level 3 | Juhani Junkala (SubspaceAudio) | CC0 | `level3.mp3` из `5 Action Chiptunes By Juhani Junkala.zip` (49,6 МБ, все 5 — «seamlessly looping») | чистый NES-экшен, автор тот же, что у пакета 512 sfx — звук и музыка в одном стиле |
| Переполох, запасной | тот же пакет → «Uneasy town» | tapatilorenzo | CC0 | `town_uneasy.mp3` (1:18, луп) | «bell, synths, drums to build tension», автор считает его сильнейшим |
| Переполох, запасной | [Tense Future Loop](https://opengameart.org/content/tense-future-loop) | gmason | CC0 | `tensefutureloop.ogg` (1,2 МБ) | дрон-бас, тяжелее; скорее для 100 % |

Схема на Вылазке: до 30 % — только `amb_yard` (музыки нет, слышно шаги и голубей); 30–60 % — Level 1 из того же пакета Junkala тихо; ≥ 60 % (пришёл Кот) — кроссфейд 2 с в Level 3; 100 % — поверх `alert_critical`. Для v1 достаточно двух состояний «тишина / Level 3», остальное — настройка по ощущениям.

Отклонено: [16bit Boss Battle Loop](https://opengameart.org/content/16bit-boss-battle-loop), [Fast Level loop](https://opengameart.org/content/fast-level-loop-8-bit-chiptune), [Funny Chase](https://opengameart.org/content/funny-chase-8-bit-chiptune), [Mug Stage](https://opengameart.org/content/8-bit-level-music-mug-stage-sewer-pipes-underground) — CC-BY-SA; [Chiptune Loops](https://opengameart.org/content/chiptune-loops) — GPL; [6 Chiptune Loops](https://opengameart.org/content/6-chiptune-loops) (CC-BY 4.0) и [Hungry Dino](https://opengameart.org/content/hungry-dino-9-chiptune-tracks-10-sfx) (CC-BY 3.0, «nearly all tracks loop») — годные CC-BY-запасные, если CC0-варианты не понравятся.

## Пакеты-источники (проверенные страницы)

| Пакет | Ссылка | Лицензия со страницы | Состав | Замечание |
|---|---|---|---|---|
| Kenney Interface Sounds | https://kenney.nl/assets/interface-sounds | Creative Commons CC0 | 100 файлов; на OGA-зеркале: OGG, «button clicks, snaps, minimize/maximize, confirmation» | список имён на странице не показан |
| Kenney UI Audio | https://kenney.nl/assets/ui-audio ([OGA](https://opengameart.org/content/51-ui-sound-effects-buttons-switches-and-clicks)) | CC0 | 51 WAV: 5 clicks, 2 mouseclicks, 6 rollovers, 38 switches, «organic» | механические щелчки — для Норы |
| Kenney Impact Sounds | https://kenney.nl/assets/impact-sounds | CC0 | 130 файлов, теги impact/foley | имена н/у; на OGA зеркала нет (404) |
| Kenney RPG Audio | https://kenney.nl/assets/rpg-audio ([OGA](https://opengameart.org/content/50-rpg-sound-effects)) | CC0 | 50 OGG: metal, cloth, book, footstep, creak, coin, knife | |
| Kenney Music Jingles | https://kenney.nl/assets/music-jingles | CC0 | 85 файлов | для `raid_success`/`raid_fail` |
| Juhani Junkala, 512 Sound Effects (8-bit style) | https://opengameart.org/content/512-sound-effects-8-bit-style | CC0 («You can do anything you want with these sounds» в INFO.txt) | 20,6 МБ, WAV 44,1 кГц 16 бит моно, −6 дБ; папки Death Screams, Explosions, General Sounds (Alarms, Buttons, Coins, Fanfares, Impacts, Menu, Negative/Positive, Simple Bleeps, Simple Damage…), Movement (Footsteps, Jumping and Landing, Falling, Doors…), Weapons | «если в имени loop — лупится бесшовно» |
| jsfxr / sfxr.me | https://sfxr.me, https://github.com/chr15m/jsfxr, npm `jsfxr` 1.4.1 (2026-05-05) | The Unlicense; «Unrestricted commercial use» | пресеты Pickup/coin, Laser/shoot, Explosion, Powerup, Hit/hurt, Jump, Click, Blip/select, Synth, Tone; Mutate; экспорт WAV (Free), MP3/OGG (Pro); сериализация параметров в строку/JSON | генерировать офлайн, в игру класть WAV→OGG; рантайм-генерацию (`sfxr.toBuffer`) не использовать — не нужна |
| audiosprite | https://github.com/tonistiigi/audiosprite | MIT | CLI над ffmpeg: склеивает в один файл (ogg/m4a/mp3/ac3), паузы ≥ 1 с и выравнивание по целым секундам, JSON в форматах jukebox/howler/howler2/createjs | последний пуш 2022-10-24 — инструмент простой, можно заменить своим скриптом на ffmpeg |

Атрибуции CC-BY, если возьмём соответствующие строки: congusbongus (Aargh!, Female screams, Footsteps on different surfaces), Blender Foundation / Lamoot (Flap, Splat, Poo — Yo Frankie!), CGEffex (Punch, slap, n' kick), Dan Knoflicek (Cat SFX), koertes (если возьмём [Birdsong background loop](https://opengameart.org/content/birdsong-background-loop), CC-BY 3.0, 16 с).

## Воспроизведение на мобильном вебе

### Что сравнивали

| | howler.js | @pixi/sound | Своя обёртка над Web Audio |
|---|---|---|---|
| Версия / активность | 2.2.4 — 2023-09-19 ([releases](https://api.github.com/repos/goldfire/howler.js/releases), [npm time](https://registry.npmjs.org/howler)); с тех пор коммиты «Update BACKERS.md» (2024-06) и «Update readme» (2025-11-23) ([commits](https://api.github.com/repos/goldfire/howler.js/commits)); 420 открытых issue, 25,4k ★, не archived | 6.0.1 — 2024-07-27, peer `pixi.js ^8.0.0` ([npm](https://registry.npmjs.org/@pixi/sound), [releases](https://api.github.com/repos/pixijs/sound/releases)); последний пуш 2024-09-27, 60 issue ([repo](https://api.github.com/repos/pixijs/sound)) | — |
| Размер | ~7 КБ gzip, 318 КБ unpacked | н/у | ~150 строк TS |
| Спрайты | `sprite: {name: [offsetMs, lengthMs, loop]}`, играет `bufferSource.start(0, seek, duration)` ([howler.core.js](https://raw.githubusercontent.com/goldfire/howler.js/master/src/howler.core.js)) | `sprites` / `addSprites`, `SoundSprite {start, end, loop, speed}` ([docs](https://pixijs.io/sound/docs/)) | то же самое — один вызов `start(0, offset, duration)` |
| Unlock | `autoUnlock` по `touchstart`/`touchend`/`click`/`keydown`: пустой буфер + `ctx.resume()`, плюс пул из 10 HTML5 Audio; **пересоздаёт контекст, если `sampleRate !== 44100`** | по `mousedown`/`touchstart`/`touchend`: `playEmptySound()` + `resume()` ([WebAudioContext.ts](https://raw.githubusercontent.com/pixijs/sound/main/src/webaudio/WebAudioContext.ts)) | явно в обработчике тапа «войти» |
| Фон | нет `visibilitychange`; `_autoSuspend` усыпляет контекст через 30 с тишины — следующий звук ждёт `resume()` | пауза по `blur`/`focus` окна (не по `visibilitychange`), `autoPause` по умолчанию; `interrupted` учитывается только в `onFocus` | `visibilitychange` → `suspend()` / `resume()` + обработка `interrupted` |
| Граф | Web Audio → HTML5 fallback | вставляет `DynamicsCompressor` перед `destination` всегда | что сами положим: шины master / sfx / music / ambience |

### Рекомендация: своя обёртка

Почему не библиотека:

1. **Нам не нужен HTML5-fallback** — единственная историческая причина howler. Web Audio есть во всех целевых браузерах (Chrome Android, Samsung Internet, Firefox Android, Safari iOS).
2. **Unlock у нас уже есть**: тап «Войти в Нору» делает fullscreen + orientation.lock + Wake Lock ([engine-and-mobile.md](engine-and-mobile.md), §3); туда же `new AudioContext()` — создание внутри жеста даёт состояние `running` сразу ([MDN Best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices): «if you create the audio context from inside a click event the state should automatically be set to running»); если контекст создан раньше — `resume()` в том же обработчике ([Chrome autoplay](https://developer.chrome.com/blog/autoplay): AudioContext до жеста создаётся `suspended`, после — `resume()`; советуют опираться на `click`). Авто-unlock «по любому тапу где угодно» нам вреден: Pointer Events джойстика не должны ничего знать о звуке.
3. **Обе библиотеки не делают того, что нужно телефону**: ни одна не слушает `visibilitychange`; iOS-состояние `interrupted` howler не знает вовсе, `@pixi/sound` — частично. Писать это поверх библиотеки = бороться с её собственной логикой (у howler — ещё и с `_autoSuspend`).
4. Howler фактически заморожен (2 года без релиза, 420 issue); `@pixi/sound` — год без коммитов и жёстко привязан к мажору Pixi (6.x ↔ Pixi 8). Для проекта на месяцы — лишняя зависимость с риском.

Если прототип покажет, что своя обёртка упирается в неожиданные грабли (например, декодирование на старом Samsung), запасной вариант — howler: он всё ещё работает и широко используется (~770k скачиваний/нед по Snyk), просто не развивается.

Скелет обёртки (`apps/client/src/audio.ts`):

```ts
type SpriteMap = Record<string, { start: number; end: number; loop?: boolean }>; // секунды, из JSON

class Audio {
  ctx!: AudioContext; master!: GainNode; sfx!: GainNode; music!: GainNode; amb!: GainNode;
  buffer!: AudioBuffer; map!: SpriteMap; lastPlayed = new Map<string, number>();

  // 1. вызывается ИЗ обработчика тапа «войти», вместе с requestFullscreen/wakeLock
  unlock() {
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state !== 'running') void this.ctx.resume();
    // шины: sfx/music/amb → master → destination
  }
  // 2. грузится один раз после входа: fetch → decodeAudioData (не блокирует старт)
  async load(url: string, map: SpriteMap) { this.buffer = await this.ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()); this.map = map; }
  // 3. sfx: один BufferSource на выстрел, без ожидания сети
  play(name: string, { rate = 1, gain = 1, pan = 0 } = {}) {
    const s = this.map[name]; const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.05) return;           // debounce одинаковых
    this.lastPlayed.set(name, now);
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer, playbackRate: rate });
    const g = new GainNode(this.ctx, { gain }); const p = new StereoPannerNode(this.ctx, { pan });
    src.connect(g).connect(p).connect(this.sfx);
    src.start(0, s.start, s.end - s.start);                                // offset + duration из спрайта
  }
  // 4. музыка/эмбиент: отдельные буферы с loop = true, loopStart/loopEnd; смена трека — рампой gain за 2 с
  // 5. фон/возврат
  attachVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.ctx.suspend();
      else this.resumeHard();
    });
  }
  async resumeHard() {                                                      // iOS: interrupted / «running, но currentTime стоит»
    const st = this.ctx.state as string;
    if (st === 'interrupted' || st === 'suspended') await this.ctx.resume();
    const t0 = this.ctx.currentTime; await new Promise(r => setTimeout(r, 250));
    if (this.ctx.currentTime === t0) { await this.ctx.suspend(); await this.ctx.resume(); } // WebKit 276016
  }
}
```

### Аудиоспрайт

- Один файл со всеми sfx вместо ~40 запросов: один `fetch` + один `decodeAudioData`, один буфер в памяти, никакого «первого проигрывания с задержкой» для каждого звука. Музыка и эмбиент — отдельными файлами (они длинные и лупятся через `loop`/`loopStart`/`loopEnd`, а не через спрайт).
- Сборка: `audiosprite` (ffmpeg под капотом, JSON в формате `howler` — `[offsetMs, lengthMs]`, легко сконвертировать в секунды) либо собственный npm-скрипт на ffmpeg `concat` с генерацией JSON. Правило из audiosprite — зазоры ≥ 1 с между звуками и выравнивание по целым секундам — нужно соблюдать и в своём скрипте: хвост реверберации/декодера одного звука не должен попадать в начало другого.
- **MP3 для спрайта не брать**: у MP3 есть encoder delay/padding, и смещения «плывут» на десятки мс. Форматы — ниже.

### Форматы

Поддержка по caniuse (колонки — целевые браузеры, «поддержка в `<audio>`», для `decodeAudioData` та же кодек-база):

| Кодек | Chrome Android | Samsung Internet | Firefox Android | Safari iOS |
|---|---|---|---|---|
| Vorbis (`.ogg`) | да | да (с 4) | да | **нет до 17.3, partial 17.4–18.3, да с 18.4** ([caniuse](https://caniuse.com/ogg-vorbis)) |
| Opus | да | да (с 5) | да | partial 11–18.3, да с 18.4 ([caniuse](https://caniuse.com/opus)); MDN: раньше только в CAF ([Audio codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)) |
| AAC в MP4 (`.m4a`) | да | да | через ОС | да (MDN: «AAC in an MP4 container is supported by all major browsers») |
| MP3 | да | да | да | да |

Решение: спрайт и музыка в **Vorbis `.ogg`** (q3–q4) как основной + **`.m4a` (AAC)** как запасной для iOS < 18.4. Выбор на клиенте: `document.createElement('audio').canPlayType('audio/ogg; codecs=vorbis')` → иначе `.m4a`. Vite: класть в `public/audio/`, пути через `import.meta.env.BASE_URL` (GitHub Pages, `base: '/krysy-krysyat/'`). Исходники WAV хранить в `assets-src/` вне бандла.

### Задержка прыжка и укуса

- Звук своей Крысы играть **в момент `pointerdown`** вместе с предсказанием движения, не по подтверждению сервера. Иначе к аудиозадержке добавится RTT.
- `latencyHint: 'interactive'` — по умолчанию и так, но указать явно: браузер «выбирает минимальную задержку без артефактов» ([MDN AudioContext()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)); подсказка необязательна к исполнению, фактическую задержку читать из `ctx.baseLatency` + `ctx.outputLatency` ([MDN baseLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency); `outputLatency` в Chrome Android с 102) и вывести в debug-оверлей прототипа — это главная метрика, цифр для конкретных Android в первоисточниках нет, меряем на своих телефонах.
- Не давать контексту засыпать во время Вылазки: ни своего `suspend()` по таймеру, ни howler-овского `_autoSuspend` (30 с) — пробуждение контекста стоит десятки мс в самый неподходящий момент. В Норе усыплять можно.
- Все буферы декодированы заранее; `AudioBufferSourceNode` — одноразовый и дешёвый, создавать на каждый выстрел. Никаких `HTMLAudioElement` для sfx (у них задержка старта и лимит одновременных воспроизведений).
- Звук укуса должен быть «атакой» без тихого вступления: в jsfxr — attack 0, sustain 0,05–0,1 с; записанный фоли обрезать по первому пику.

### Фон, блокировка экрана, iOS

- `visibilitychange` — единственное событие, которое надёжно приходит при уходе в другое приложение на телефоне ([MDN visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)); `beforeunload`/`unload` там не работают. На `hidden` — `ctx.suspend()` (музыка и эмбиент в фоне у Chrome Android иначе продолжат играть, пока rAF стоит — странно и жрёт батарею); на `visible` — `resume()`. События симуляции, накопившиеся в фоне, не доигрывать: при возврате и так идёт ресинк с сервера (тикет 001).
- iOS Safari: при уходе со страницы/блокировке экрана контекст переходит в нестандартное состояние **`interrupted`** и требует `resume()` ([MDN BaseAudioContext.state](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state)). В iOS 17.5–18.x есть регрессия: после возврата контекст может числиться `running`, но `currentTime` не идёт и звука нет ([WebKit bug 276016](https://bugs.webkit.org/show_bug.cgi?id=276016), статус NEW на июль 2025); рабочий обход из треда — `suspend()` затем `resume()` при возврате, крайний случай — пересоздать контекст. Это и делает `resumeHard()` выше. Дополнительно `resume()` на первом `pointerdown` после возврата — на случай, если iOS требует новый жест.
- iOS и переключатель «без звука»: Web Audio по умолчанию идёт в канал звонка и глушится переключателем; обход (тихий HTML5-трек на медиаканале) описан в [unmute.js](https://github.com/swevans/unmute) (MIT) — источник сторонний, официального описания у Apple не нашлось. Для нас: iOS вторична, принимаем как есть, в прототипе просто проверить.
- Chrome Android: `sampleRate` контекста — у устройства (обычно 48 000); howler ради этого пересоздаёт контекст под 44 100 — нам не нужно, `decodeAudioData` ресемплирует сам.

### Микс и мелочи

- Четыре шины `GainNode`: `sfx`, `music`, `amb` → `master`. Три ползунка в настройках Норы (+ «без звука»), значения в `localStorage`.
- Дистанция: у каждого своя камера, значит громкость чужих событий = линейное затухание от своей Крысы (полная до 4 тайлов, ноль за 20), панорама через `StereoPannerNode` по знаку Δx. Крики (`child_scream`, `cat_arrive`, `alert_*`, `exit_done`) — без затухания, это сигналы всей Стае.
- Повторяющиеся звуки (`rat_step`, `pigeon_flap`, `human_step`): 2–3 варианта + `playbackRate` ±10 %, debounce 50 мс на имя, не больше 4 одновременных «голосов» одного имени (остальные отбрасывать, не ставить в очередь).
- Вибрация на `rat_hurt`/`rat_down` (`navigator.vibrate`, только Android) — туда же, где играется звук.

## Что проверяет прототип

1. На среднем Android (Chrome, Samsung Internet): задержка от `pointerdown` до звука прыжка субъективно слитна с анимацией; `baseLatency + outputLatency` в debug-оверлее.
2. Спрайт `.ogg` ≈ 500 КБ декодируется < 1 с после входа в Нору; смещения спрайтов не «плывут» (проверить последний звук в файле).
3. Уход в другое приложение и возврат: музыка замолкает и возвращается на Android; на iPhone — возвращается после `resumeHard()` (iOS 17.5+/18).
4. Установленная PWA (`display: fullscreen`): звук работает после тапа «войти», как и во вкладке.

## Источники

- Kenney: [категория Audio](https://kenney.nl/assets/category:Audio), [Interface Sounds](https://kenney.nl/assets/interface-sounds), [UI Audio](https://kenney.nl/assets/ui-audio), [Impact Sounds](https://kenney.nl/assets/impact-sounds), [RPG Audio](https://kenney.nl/assets/rpg-audio), [Music Jingles](https://kenney.nl/assets/music-jingles); OGA-зеркала: [Interface Sounds](https://opengameart.org/content/interface-sounds), [50 RPG sound effects](https://opengameart.org/content/50-rpg-sound-effects), [51 UI sound effects](https://opengameart.org/content/51-ui-sound-effects-buttons-switches-and-clicks)
- OpenGameArt: [512 Sound Effects (8-bit style)](https://opengameart.org/content/512-sound-effects-8-bit-style) + [INFO.txt пакета](https://git.uni-greifswald.de/GAIM/gaim/src/branch/main/assets/Sounds/collection1/INFO.txt), [5 Chiptunes (Action)](https://opengameart.org/content/5-chiptunes-action), [Squeaky Rat](https://opengameart.org/content/squeaky-rat), [Meow](https://opengameart.org/content/meow), [Cat SFX](https://opengameart.org/content/cat-sfx), [Thwack Sounds](https://opengameart.org/content/thwack-sounds), [Swishes Sound Pack](https://opengameart.org/content/swishes-sound-pack), [7 Eating Crunches](https://opengameart.org/content/7-eating-crunches), [80 CC0 creature SFX](https://opengameart.org/content/80-cc0-creature-sfx), [Liquid Bottle Drink Set](https://opengameart.org/content/liquid-bottle-drink-set), [Dripping water loop](https://opengameart.org/content/dripping-water-loop), [Aargh! (male screams)](https://opengameart.org/content/aargh-male-screams), [Female screams](https://opengameart.org/content/female-screams), [Girly Scream](https://opengameart.org/content/girly-scream), [Footsteps on different surfaces](https://opengameart.org/content/footsteps-on-different-surfaces), [Punch, slap, n' kick](https://opengameart.org/content/punch-slap-n-kick), [Flap, Splat, Poo (Yo Frankie!)](https://opengameart.org/content/flap-splat-poo-yo-frankie), [Crowd Shouting/Speaking Ambience](https://opengameart.org/content/crowd-shoutingspeaking-ambience), [Rat Sewer](https://opengameart.org/content/rat-sewer), [Mysterious Sewer](https://opengameart.org/content/mysterious-sewer), [Two looping retro midi songs](https://opengameart.org/content/two-looping-retro-midi-songs-calm-tense), [Tense Future Loop](https://opengameart.org/content/tense-future-loop), [Hungry Dino](https://opengameart.org/content/hungry-dino-9-chiptune-tracks-10-sfx), [6 Chiptune Loops](https://opengameart.org/content/6-chiptune-loops)
- freesound (все — «Creative Commons 0» на странице): [Pigeon cooing](https://freesound.org/people/Fsu2001/sounds/795558/), [short pigeon wing flap](https://freesound.org/people/zouzmusic/sounds/414671/), [Child Scream](https://freesound.org/people/onehugeeye/sounds/511320/), [Broom sweeping](https://freesound.org/people/CarikaDarvall/sounds/764462/), [ratSqueak.wav](https://freesound.org/people/Zabuhailo/sounds/143125/), [catHisses1.wav](https://freesound.org/people/Zabuhailo/sounds/146963/), [Drinking water in gulps](https://freesound.org/people/augustclaire2211/sounds/624775/), [Courtyard ambience with pigeons](https://freesound.org/people/Garuda1982/sounds/851386/), [Cartoon Crowd Panic Loop](https://freesound.org/people/abraksil/sounds/727773/)
- Генерация: [sfxr.me](https://sfxr.me), [chr15m/jsfxr](https://github.com/chr15m/jsfxr) (Unlicense), [npm jsfxr](https://registry.npmjs.org/jsfxr)
- Библиотеки: howler — [GitHub](https://github.com/goldfire/howler.js), [releases](https://api.github.com/repos/goldfire/howler.js/releases), [commits](https://api.github.com/repos/goldfire/howler.js/commits), [npm](https://registry.npmjs.org/howler), [howler.core.js](https://raw.githubusercontent.com/goldfire/howler.js/master/src/howler.core.js); @pixi/sound — [npm](https://registry.npmjs.org/@pixi/sound), [releases](https://api.github.com/repos/pixijs/sound/releases), [repo](https://api.github.com/repos/pixijs/sound), [README](https://github.com/pixijs/sound/blob/main/README.md), [docs](https://pixijs.io/sound/docs/), [WebAudioContext.ts](https://raw.githubusercontent.com/pixijs/sound/main/src/webaudio/WebAudioContext.ts); [audiosprite](https://github.com/tonistiigi/audiosprite); [unmute.js](https://github.com/swevans/unmute)
- Web API: [MDN Web Audio Best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay), [MDN AudioContext()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext), [MDN baseLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency), [MDN BaseAudioContext.state](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state), [MDN visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event), [WebKit bug 276016](https://bugs.webkit.org/show_bug.cgi?id=276016), [MDN Audio codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs), caniuse [ogg-vorbis](https://caniuse.com/ogg-vorbis), [opus](https://caniuse.com/opus)
