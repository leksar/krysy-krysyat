// Хранилище: аккаунты Крыс (ник + секретный код) и общая Нора Стаи. JSON-файл в volume, атомарная запись с задержкой.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { KINDS, PROPS, newDNA, type DNA, type Mutations, type Potion } from '@krysy/sim';

export type Profile = { code: string; name: string; dna: DNA; mut: Mutations; created: number; raids: number; banked: number; pockets: number };
export type Builds = { pockets: number; cauldron: number };
export type Nora = { stash: Record<string, number>; potions: Potion[]; nextPotion: number; builds: Builds; log: string[] };
type Data = { profiles: Record<string, Profile>; nora: Nora };

export const BUILD_INFO: Record<keyof Builds, { name: string; desc: string; max: number; cost: (lvl: number) => Record<'food' | 'trash' | 'secr' | 'organ', number> }> = {
  pockets: { name: 'Карманы', desc: '+1 ячейка Карманов этой Крысе (личная постройка)', max: 3, cost: (l) => ({ food: 6 + 4 * l, trash: 6 + 4 * l, secr: 0, organ: 0 }) },
  cauldron: { name: 'Котёл', desc: '+1 слот Котла (больше Ингредиентов в Зелье)', max: 2, cost: (l) => ({ food: 0, trash: 4, secr: 4 + 2 * l, organ: 1 + l }) },
};

export class Store {
  data: Data;
  private timer: NodeJS.Timeout | null = null;
  constructor(private path: string) {
    if (existsSync(path)) {
      try { this.data = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error('store: битый файл, начинаем заново', e); this.data = fresh(); }
    } else this.data = fresh();
    this.data.nora.builds ??= { pockets: 0, cauldron: 0 };
    this.data.nora.log ??= [];
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
    if (!p) { p = { code, name, dna: newDNA(Math.random), mut: {}, created: Date.now(), raids: 0, banked: 0, pockets: 0 }; this.data.profiles[code] = p; this.log(`родилась крыса ${name}`); }
    else { if (name && p.name !== name) p.name = name; p.pockets ??= 0; }
    this.save(); return p;
  }
  get nora() { return this.data.nora; }
  log(line: string) { const l = this.data.nora.log; l.push(`${new Date().toISOString().slice(5, 16).replace('T', ' ')} ${line}`); while (l.length > 30) l.shift(); }

  addLoot(kinds: string[]) { for (const k of kinds) this.data.nora.stash[k] = (this.data.nora.stash[k] ?? 0) + 1; this.save(); }
  take(kinds: string[]): boolean {
    const need: Record<string, number> = {}; for (const k of kinds) need[k] = (need[k] ?? 0) + 1;
    for (const [k, n] of Object.entries(need)) if ((this.data.nora.stash[k] ?? 0) < n) return false;
    for (const [k, n] of Object.entries(need)) { this.data.nora.stash[k] -= n; if (!this.data.nora.stash[k]) delete this.data.nora.stash[k]; }
    this.save(); return true;
  }
  /** Списать стоимость постройки по типам Ингредиентов (берём что есть, дешёвое первым). */
  payByType(cost: Record<'food' | 'trash' | 'secr' | 'organ', number>): boolean {
    const stash = this.data.nora.stash;
    const byType = (t: string) => Object.entries(stash).filter(([k]) => KINDS[k]?.type === t).sort((a, b) => KINDS[a[0]].size - KINDS[b[0]].size);
    for (const [t, n] of Object.entries(cost)) if (n > 0 && byType(t).reduce((s, [, c]) => s + c, 0) < n) return false;
    for (const [t, n] of Object.entries(cost)) { let left = n; for (const [k, c] of byType(t)) { if (left <= 0) break; const d = Math.min(c, left); stash[k] -= d; left -= d; if (!stash[k]) delete stash[k]; } }
    this.save(); return true;
  }
  cauldronSize() { return 3 + this.data.nora.builds.cauldron; }
}
function fresh(): Data { return { profiles: {}, nora: { stash: {}, potions: [], nextPotion: 1, builds: { pockets: 0, cauldron: 0 }, log: [] } }; }
export const PROP_LIST = PROPS;
