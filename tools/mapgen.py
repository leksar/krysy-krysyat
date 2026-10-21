# Генератор карт «Крысы крысят» → packages/sim/src/maps.ts
# Карта описывается платформами и метками; скрипт собирает текстовую сетку и ПРОВЕРЯЕТ проходимость:
# крыса ходит, прыгает вверх ≤2 тайла (тап) / ≤3 (зажатый прыжок) при просвете ≤3, падает куда угодно.
# Все Выходы, предметы и люди должны быть достижимы со спавна — иначе скрипт ругается.
# Запуск: python tools/mapgen.py
import json, sys
from collections import deque

JUMP_UP, JUMP_GAP = 3, 3

class M:
    def __init__(self, id, name, desc, cols, rows, pigeons):
        self.id, self.name, self.desc, self.cols, self.rows, self.pigeons = id, name, desc, cols, rows, pigeons
        self.g = [['.'] * cols for _ in range(rows)]
        for c in range(cols): self.g[0][c] = '#'; self.g[rows - 1][c] = '#'
        for r in range(rows): self.g[r][0] = '#'; self.g[r][cols - 1] = '#'
    def box(self, r0, r1, c0, c1):
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1): self.g[r][c] = '#'
    def ledge(self, r, c0, c1): self.box(r, r, c0, c1)
    def wall(self, c, r0, r1): self.box(r0, r1, c, c)
    def stairs(self, r_bottom, c, n, dir=1, step=2, width=3):
        """лесенка: n ступеней по step рядов вверх, каждая width шириной, смещение dir*(width+1)"""
        for i in range(n):
            self.ledge(r_bottom - i * step, c + i * dir * (width + 1), c + i * dir * (width + 1) + width - 1)
    def mark(self, r, c, ch):
        # если клетка в тайле — поднимаем метку вверх до первой пустой и предупреждаем
        r0 = r
        while self.g[r][c] == '#' and r > 1: r -= 1
        if r != r0: print(f'  {self.id}: {ch} ({r0},{c}) было в тайле → поставлено на ({r},{c})')
        assert self.g[r][c] == '.', f'{self.id}: ({r},{c}) занято {self.g[r][c]!r} для {ch}'
        self.g[r][c] = ch
    def marks(self, ch, cells):
        for r, c in cells: self.mark(r, c, ch)
    def rows_text(self): return [''.join(r) for r in self.g]

    def solid(self, r, c): return r < 0 or c < 0 or r >= self.rows or c >= self.cols or self.g[r][c] == '#'
    def reach(self):
        """BFS по клеткам-стойкам (пусто, под ней тайл). Крыса 1 тайл высотой."""
        stand = lambda r, c: not self.solid(r, c) and self.solid(r + 1, c)
        starts = [(r, c) for r in range(self.rows) for c in range(self.cols) if self.g[r][c] == 'S']
        # спавн может быть в воздухе — падаем
        def fall(r, c):
            while not stand(r, c) and not self.solid(r + 1, c) and r < self.rows - 2: r += 1
            return (r, c) if stand(r, c) else None
        seen = set(); dq = deque()
        for s in starts:
            f = fall(*s)
            if f and f not in seen: seen.add(f); dq.append(f)
        while dq:
            r, c = dq.popleft()
            cand = []
            for dc in (-1, 1):  # шаг в сторону (и падение)
                if not self.solid(r, c + dc): cand.append((r, c + dc))
            for up in range(1, JUMP_UP + 1):  # прыжок вверх + сдвиг
                if any(self.solid(r - k, c) for k in range(1, up + 1)): break
                for dc in range(-JUMP_GAP - 1, JUMP_GAP + 2):
                    cc = c + dc
                    if 0 < cc < self.cols - 1 and not self.solid(r - up, cc): cand.append((r - up, cc))
            for dc in range(-JUMP_GAP - 1, JUMP_GAP + 2):  # прыжок через просвет на том же уровне
                cc = c + dc
                if 0 < cc < self.cols - 1 and not self.solid(r, cc) and not self.solid(r - 1, cc): cand.append((r, cc))
            for (rr, cc) in cand:
                f = fall(rr, cc)
                if f and f not in seen: seen.add(f); dq.append(f)
        return seen
    def check(self):
        seen = self.reach()
        bad = []
        for r in range(self.rows):
            for c in range(self.cols):
                ch = self.g[r][c]
                if ch in '123fmoPDKZ~c':
                    # предмет/человек стоит на тайле под собой (или падает на него)
                    rr = r
                    while not self.solid(rr + 1, c) and rr < self.rows - 2: rr += 1
                    if (rr, c) not in seen: bad.append((ch, r, c))
        total = sum(1 for r in range(self.rows) for c in range(self.cols) if not self.solid(r, c) and self.solid(r + 1, c))
        print(f'{self.name}: достижимо стоек {len(seen)}/{total}; недостижимых меток: {len(bad)} {bad[:10]}')
        return not bad

# ------------------------------------------------------------------ ДВОР 120×28
def yard():
    m = M('yard', 'Двор', 'Двор, гаражи, пятиэтажка с балконами и подвал. Базовая карта.', 120, 28, {'V': 1, 'F': 1})
    G = 23  # ряд, на котором стоим во дворе; земля — ряд 24; подвал — ряды 25–26
    m.ledge(G + 1, 1, 118)
    for c in (30, 31, 88, 89): m.g[G + 1][c] = '.'       # дыры в подвал
    for c in range(17, 118, 17): m.ledge(G + 3, c, c)     # низкие опоры в подвале — перепрыгиваются
    # песочница, лавка, урна
    m.ledge(G - 1, 6, 9); m.ledge(G - 1, 14, 17); m.box(G - 2, G, 20, 21)
    # лесенка горки → дерево
    m.stairs(G - 1, 24, 4, dir=1)
    m.wall(44, G - 9, G); m.wall(45, G - 9, G)
    m.ledge(G - 4, 38, 43); m.ledge(G - 7, 46, 52); m.ledge(G - 10, 40, 48); m.ledge(G - 12, 49, 54)
    # гаражи с ящиками и трубой
    m.box(G - 5, G, 56, 66); m.box(G - 5, G, 68, 78)
    m.ledge(G - 1, 53, 54); m.ledge(G - 3, 54, 55); m.ledge(G - 7, 62, 65)
    # водосточная труба-лесенка и карнизы к козырьку
    m.stairs(G - 1, 82, 5, dir=1, step=2, width=2)
    m.ledge(G - 12, 97, 99); m.ledge(G - 15, 94, 96); m.ledge(G - 18, 96, 99); m.ledge(G - 20, 88, 93)
    # мусорные баки
    m.box(G - 2, G, 92, 94); m.box(G - 2, G, 96, 98)
    # пятиэтажка: балконы через 2 ряда, чередуются; карниз под крышей
    m.box(G - 20, G, 112, 118)
    for i, r in enumerate(range(G - 2, G - 20, -2)):
        c0 = 106 if i % 2 == 0 else 101
        m.ledge(r, c0, c0 + 4)
    m.ledge(G - 19, 108, 110)
    # метки
    m.marks('S', [(G, 2), (G, 3), (G, 4)])
    m.mark(G, 110, '1'); m.mark(2, 115, '2'); m.mark(26, 110, '3')
    m.marks('~', [(G, 29), (17, 70)])
    m.marks('P', [(G, 12), (G, 36), (G, 50), (17, 75), (G, 104), (17, 103), (11, 103), (8, 108)])
    m.marks('D', [(17, 58), (G, 86)])
    m.marks('K', [(G, 8), (G, 27), (21, 7)])
    m.marks('Z', [(21, 15), (17, 72)])
    m.mark(G, 100, 'c')
    m.marks('b', [(4, 20), (4, 50), (4, 80), (9, 42), (14, 60), (1, 100)])
    m.marks('f', [(G, 6), (21, 8), (G, 22), (18, 40), (15, 48), (17, 60), (17, 66), (G, 84), (20, 108), (14, 108), (5, 103), (26, 20), (26, 75)])
    m.marks('m', [(G, 18), (G, 33), (12, 44), (10, 52), (15, 64), (G, 80), (20, 93), (20, 97), (17, 105), (11, 101), (5, 105), (2, 90), (26, 10), (26, 45), (26, 95), (G, 67)])
    m.marks('o', [(4, 97), (26, 50)])
    return m

# ------------------------------------------------------------------ КУХНЯ 100×26 (два этажа)
def kitchen():
    m = M('kitchen', 'Кухня', 'Столовая: кухня внизу, зал наверху, лифт для еды. Много Еды, мало Голубей.', 100, 26, {'V': 1, 'F': 0})
    F1 = 22   # пол кухни (стоим на 22)
    F2 = 11   # пол зала (стоим на 11), перекрытие на 12
    m.ledge(F1 + 1, 1, 98)
    m.ledge(F2 + 1, 1, 40); m.ledge(F2 + 1, 46, 98)   # перекрытие с шахтой лифта cols 41-45
    # кухня: столы-разделочные (2 выс.), плита, холодильники
    for c0 in (6, 20, 34, 56, 72, 86): m.box(F1 - 1, F1, c0, c0 + 6)
    m.box(F1 - 3, F1, 48, 52)                     # плита (4 выс.) — на неё через табурет
    m.ledge(F1 - 1, 47, 47)                       # табурет вплотную к плите
    m.box(F1 - 5, F1, 92, 98)                     # холодильник у стены
    m.ledge(F1 - 3, 89, 90)                       # ящик к холодильнику
    # полки над столами
    m.ledge(F1 - 4, 4, 12); m.ledge(F1 - 6, 15, 24); m.ledge(F1 - 4, 28, 38); m.ledge(F1 - 7, 30, 36)
    m.ledge(F1 - 5, 58, 66); m.ledge(F1 - 8, 60, 68); m.ledge(F1 - 6, 74, 82)
    # шахта лифта: ступени внутри (полки лифта) cols 41-45, от F1 до F2
    for i, r in enumerate(range(F1 - 1, F2 + 1, -2)):
        m.ledge(r, 41 if i % 2 == 0 else 44, 42 if i % 2 == 0 else 45)
    # зал наверху: столики (1 выс.) со стульями
    for c0 in (6, 18, 30, 50, 62, 74, 86):
        m.ledge(F2 - 1, c0, c0 + 4); m.ledge(F2 - 1, c0 - 2, c0 - 2); m.ledge(F2 - 1, c0 + 6, c0 + 6)
    m.ledge(F2 - 4, 10, 16); m.ledge(F2 - 6, 24, 30); m.ledge(F2 - 4, 56, 64); m.ledge(F2 - 7, 70, 78)   # люстры/балки
    m.ledge(F2 - 9, 36, 48)  # вентиляционный короб под потолком
    m.ledge(6, 19, 21); m.ledge(4, 33, 35); m.ledge(5, 66, 68)   # переходы между балками
    m.ledge(19, 54, 55); m.ledge(18, 70, 71)                    # ящики к верхним полкам кухни
    # метки
    m.marks('S', [(F1, 2), (F1, 3), (F1, 4)])
    m.mark(F2 - 10, 42, '1')          # вентиляция под потолком зала
    m.mark(F1, 55, '2')               # слив на кухне
    m.mark(F2, 97, '3')               # щель под дверью зала
    m.marks('~', [(F1, 14), (F2, 44)])
    m.marks('P', [(F1, 16), (F1, 30), (F1, 70), (F2, 14), (F2, 36), (F2, 58), (F2, 82), (F2, 94)])
    m.marks('D', [(F1, 44), (F2, 26)])
    m.marks('K', [(F2, 8), (F2, 66), (F1, 84)])
    m.marks('Z', [(F1 - 2, 24), (F2 - 2, 50)])
    m.mark(F1, 90, 'c')
    m.marks('b', [(3, 20), (3, 80), (F1 - 9, 50)])
    m.marks('f', [(F1 - 2, 8), (F1 - 2, 22), (F1 - 2, 36), (F1 - 2, 58), (F1 - 2, 74), (F1 - 2, 88), (F1 - 4, 50), (F1 - 5, 6), (F1 - 7, 18), (F1 - 8, 32), (F1 - 9, 62), (F1 - 6, 94),
                   (F2 - 2, 7), (F2 - 2, 19), (F2 - 2, 31), (F2 - 2, 51), (F2 - 2, 63), (F2 - 2, 75), (F2 - 2, 87), (F2 - 5, 12), (F2 - 7, 27), (F2 - 8, 74)])
    m.marks('m', [(F1, 12), (F1, 40), (F1, 78), (F1 - 5, 34), (F1 - 7, 80), (F2, 22), (F2, 46), (F2, 70), (F2 - 5, 60), (F2 - 10, 38)])
    m.marks('o', [(F1 - 9, 66), (F2 - 10, 47)])
    return m

# ------------------------------------------------------------------ КРЫША 120×26 (три дома)
def roof():
    m = M('roof', 'Крыша', 'Три дома разной высоты, чердаки, антенны и голубиное царство. Много Мусора.', 120, 26, {'V': 2, 'F': 1})
    # дом A (низкий, слева): крыша на ряду 19 (стоим на 18), cols 1-38
    m.box(19, 24, 1, 38)
    # дом B (высокий, середина): крыша на 11, cols 44-80, стена вниз до земли
    m.box(11, 24, 44, 80)
    # дом C (средний, справа): крыша на 15, cols 86-118
    m.box(15, 24, 86, 118)
    # провалы между домами — внизу карнизы, чтобы падение не было смертью, но было дорогой назад
    m.ledge(23, 39, 43); m.ledge(23, 81, 85)
    m.stairs(22, 40, 1); m.ledge(21, 41, 42)  # ящики в провале A-B
    # подъём с A на B: пожарная лестница из ступеней по стене B
    m.stairs(17, 36, 4, dir=1, step=2, width=2)   # 36→... заканчивается у 11-12 ряда рядом с крышей B
    m.ledge(13, 42, 43)
    # с B на C: спуск по карнизам
    m.ledge(13, 82, 84)
    # на крышах: вентшахты (2 выс.), чердачные будки (4 выс. с крышей-ступенью), антенны (мачта + перекладины)
    m.box(17, 18, 8, 10); m.box(17, 18, 24, 26)                  # вентшахты A
    m.box(15, 18, 30, 34); m.ledge(17, 28, 28); m.ledge(16, 29, 29)  # будка A с лесенкой
    m.box(9, 10, 50, 52); m.box(9, 10, 70, 72)                   # вентшахты B
    m.box(7, 10, 58, 64)  # будка B
    m.ledge(8, 56, 57)
    m.wall(66, 2, 10); m.ledge(5, 63, 65); m.ledge(3, 67, 70); m.ledge(7, 67, 69)   # антенна B
    m.box(13, 14, 92, 94); m.box(13, 14, 108, 110)               # вентшахты C
    m.box(11, 14, 100, 104)
    m.ledge(12, 98, 99)
    m.wall(114, 8, 14); m.ledge(11, 107, 108); m.ledge(9, 111, 113); m.ledge(7, 115, 117)   # антенна C
    # бельевые верёвки = тонкие платформы над домом A
    m.ledge(15, 12, 20); m.ledge(13, 3, 9)
    # метки
    m.marks('S', [(18, 2), (18, 3), (18, 4)])
    m.mark(18, 37, '3')              # водосток на краю дома A (быстрый, но Органы не пролазят)
    m.mark(6, 60, '2')               # люк на крыше будки B
    m.mark(14, 117, '1')             # пожарная лестница вниз на доме C
    m.marks('~', [(18, 22), (10, 68), (14, 96)])
    m.marks('P', [(18, 14), (10, 48), (10, 76), (14, 90), (14, 106)])
    m.marks('D', [(10, 55), (14, 112)])
    m.marks('Z', [(14, 31), (10, 74)])
    m.marks('K', [(18, 28)])
    m.mark(14, 88, 'c')
    m.marks('b', [(3, 10), (3, 30), (2, 50), (2, 75), (3, 95), (3, 112), (12, 20), (6, 68), (8, 112)])
    m.marks('f', [(18, 6), (16, 30), (12, 6), (10, 62), (6, 61), (4, 68), (14, 98), (10, 102), (8, 116)])
    m.marks('m', [(18, 12), (18, 20), (16, 9), (16, 25), (14, 14), (12, 15), (10, 46), (10, 54), (8, 51), (8, 71), (6, 59), (2, 68), (6, 67), (14, 94), (14, 104), (12, 93), (12, 109), (6, 116), (22, 40), (22, 82), (10, 78)])
    m.marks('o', [(2, 69), (6, 117)])
    return m

maps = [yard(), kitchen(), roof()]
ok = all([m.check() for m in maps])
out = ['// СГЕНЕРИРОВАНО tools/mapgen.py — правь генератор, не этот файл.',
       '// Легенда: # тайл; S спавн; 1 Щель (всегда), 2 Люк (от Переполоха), 3 Водосток (1 с, без Органов);',
       '// P Прохожий, D Дворник, K Ребёнок, Z Пьяный, c кот (60 %); b насест; f Еда, m Мусор, o редкий Орган; ~ вода.',
       'export type MapDef = { id: string; name: string; desc: string; pigeons: { V: number; F: number }; grid: string[] };',
       'export const MAPS: Record<string, MapDef> = {']
for m in maps:
    out.append(f"  {m.id}: {{ id: '{m.id}', name: '{m.name}', desc: '{m.desc}', pigeons: {json.dumps(m.pigeons)}, grid: [")
    for row in m.rows_text(): out.append(f"    '{row}',")
    out.append('  ] },')
out.append('};')
if '--print' in sys.argv:
    for m in maps: print(m.name); print('\n'.join(m.rows_text())); print()
if ok:
    open('packages/sim/src/maps.ts', 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
    print('maps.ts записан')
else:
    print('ЕСТЬ НЕДОСТИЖИМЫЕ МЕТКИ — maps.ts не записан'); sys.exit(1)
