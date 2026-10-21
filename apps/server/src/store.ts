// Хранилище: аккаунты Крыс (ник + секретный код) и Норы — у каждой комнаты (кода) своя: Склад, Зелья, постройки, журнал.
// JSON-файл в volume, атомарная запись с задержкой. Старая общая Нора при первом запуске переезжает в комнату LEGACY_ROOM.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { KINDS, PROPS, newDNA, type DNA, type Mutations, type Potion } from '@krysy/sim';

export type Profile = { code: string; name: string; dna: DNA; mut: Mutations; created: number; raids: number; banked: number; pockets: number };
export type Builds = { pockets: number; cauldron: number; shelf: number; rack: number; kitchen: number; roof: number }; // cauldron: 0 = не построен, 1 = 3 слота, 2–3 = +слот; остальные 0|1
export type Nora = { stash: Record<string, number>; potions: Potion[]; nextPotion: number; builds: Builds; log: string[] };
type Data = { profiles: Record<string, Profile>; noras: Record<string, Nora>; nora?: Nora };
export const LEGACY_ROOM = '3773';

export type Cost = Record<'food' | 'trash' | 'secr' | 'organ', number>;
export const BUILD_INFO: Record<keyof Builds, { name: string; desc: (lvl: number) => string; max: number; requires?: keyof Builds; cost: (lvl: number) => Cost }> = {
  cauldron: { name: 'Котёл', desc: (l) => l === 0 ? 'построить Котёл: варить Зелья из 3 Ингредиентов' : `+1 слот Котла (${3 + l} Ингредиента в Зелье)`, max: 3, cost: (l) => l === 0 ? { food: 4, trash: 8, secr: 0, organ: 0 } : { food: 0, trash: 4, secr: 4 + 2 * l, organ: l } },
  shelf: { name: 'Полка Зелий', desc: () => 'построить Полку: хранить Зелья, пить их и лить на карту', max: 1, requires: 'cauldron', cost: () => ({ food: 2, trash: 6, secr: 2, organ: 0 }) },
  rack: { name: 'Стойка Карманов', desc: () => 'построить Стойку: шить сумки — личные Карманы каждой Крысе', max: 1, requires: 'cauldron', cost: () => ({ food: 0, trash: 6, secr: 0, organ: 1 }) },
  pockets: { name: 'Карманы', desc: (l) => `+1 ячейка Карманов этой Крысе (сейчас +${l})`, max: 3, requires: 'rack', cost: (l) => ({ food: 6 + 4 * l, trash: 6 + 4 * l, secr: 0, organ: 0 }) },
  kitchen: { name: 'Лаз на Кухню', desc: () => 'прокопать лаз в столовую: открывает карту «Кухня»', max: 1, cost: () => ({ food: 6, trash: 10, secr: 0, organ: 0 }) },
  roof: { name: 'Лаз на Крышу', desc: () => 'прогрызть ход на крышу: открывает карту «Крыша»', max: 1, requires: 'kitchen', cost: () => ({ food: 0, trash: 12, secr: 2, organ: 2 }) },
};

export class Store {
  data: Data;
  private timer: NodeJS.Timeout | null = null;
  constructor(private path: string) {
    if (existsSync(path)) {
      try { this.data = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error('store: битый файл, начинаем заново', e); this.data = fresh(); }
    } else this.data = fresh();
    this.data.noras ??= {};
    if (this.data.nora) { if (!this.data.noras[LEGACY_ROOM]) this.data.noras[LEGACY_ROOM] = this.data.nora; delete this.data.nora; console.log(`store: общая Нора переехала в комнату ${LEGACY_ROOM}`); this.save(); }
    for (const n of Object.values(this.data.noras)) { n.builds ??= { pockets: 0, cauldron: 0, shelf: 0, rack: 0, kitchen: 0, roof: 0 }; const b = n.builds; b.shelf ??= 0; b.rack ??= 0; b.kitchen ??= 0; b.roof ??= 0; n.log ??= []; }
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path + '.tmp', JSON.stringify(this.data)); renameSync(this.path + '.tmp', this.path); }
      catch (e) { console.error('store: не записалось', e); }
    }, 1000);
  }
  flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } try { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path + '.tmp', JSON.stringify(this.data)); renameSync(this.path + '.tmp', this.path); } catch {} }

  /** Аккаунт по секретному коду: есть — вернуть (ник обновить), нет — создать с случайной ДНК. */
  profile(code: string, name: string): Profile {
    let p = this.data.profiles[code];
    if (!p) { p = { code, name, dna: newDNA(Math.random), mut: {}, created: Date.now(), raids: 0, banked: 0, pockets: 0 }; this.data.profiles[code] = p; }
    else { if (name && p.name !== name) p.name = name; p.pockets ??= 0; }
    this.save(); return p;
  }
  /** Нора комнаты; новая комната начинает с пустого Склада и стройплощадок */
  nora(code: string): Nora { return (this.data.noras[code] ??= freshNora()); }
  log(code: string, line: string) { const l = this.nora(code).log; l.push(`${new Date().toISOString().slice(5, 16).replace('T', ' ')} ${line}`); while (l.length > 30) l.shift(); }

  addLoot(code: string, kinds: string[]) { const st = this.nora(code).stash; for (const k of kinds) st[k] = (st[k] ?? 0) + 1; this.save(); }
  take(code: string, kinds: string[]): boolean {
    const st = this.nora(code).stash; const need: Record<string, number> = {}; for (const k of kinds) need[k] = (need[k] ?? 0) + 1;
    for (const [k, n] of Object.entries(need)) if ((st[k] ?? 0) < n) return false;
    for (const [k, n] of Object.entries(need)) { st[k] -= n; if (!st[k]) delete st[k]; }
    this.save(); return true;
  }
  /** Списать стоимость постройки по типам Ингредиентов (берём что есть, дешёвое первым). */
  payByType(code: string, cost: Record<'food' | 'trash' | 'secr' | 'organ', number>): boolean {
    const stash = this.nora(code).stash;
    const byType = (t: string) => Object.entries(stash).filter(([k]) => KINDS[k]?.type === t).sort((a, b) => KINDS[a[0]].size - KINDS[b[0]].size);
    for (const [t, n] of Object.entries(cost)) if (n > 0 && byType(t).reduce((s, [, c]) => s + c, 0) < n) return false;
    for (const [t, n] of Object.entries(cost)) { let left = n; for (const [k, c] of byType(t)) { if (left <= 0) break; const d = Math.min(c, left); stash[k] -= d; left -= d; if (!stash[k]) delete stash[k]; } }
    this.save(); return true;
  }
  cauldronSize(code: string) { const c = this.nora(code).builds.cauldron; return c ? 2 + c : 0; }
  built(code: string, k: keyof Builds) { return this.nora(code).builds[k] > 0; }
}
function freshNora(): Nora { return { stash: {}, potions: [], nextPotion: 1, builds: { pockets: 0, cauldron: 0, shelf: 0, rack: 0, kitchen: 0, roof: 0 }, log: [] }; }
function fresh(): Data { return { profiles: {}, noras: {} }; }
export const PROP_LIST = PROPS;
