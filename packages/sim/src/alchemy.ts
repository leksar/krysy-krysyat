// Алхимия: Свойства Ингредиентов, Зелья, Модификаторы Вылазки, Мутации и ДНК (docs/design/alchemy.md).
// Чистые функции — используются сервером (авторитет) и клиентом (показ).

export const PROPS = ['Едкое', 'Гнилое', 'Живое', 'Сладкое', 'Жирное', 'Заразное', 'Шумное', 'Липкое'] as const;
export type Prop = (typeof PROPS)[number];

/** Свойства Ингредиентов — по таблице docs/design/ingredients.md */
export const ITEM_PROPS: Record<string, Prop[]> = {
  bread: ['Сладкое'], bone: ['Жирное'], gum: ['Липкое', 'Сладкое'], donut: ['Сладкое', 'Жирное'],
  butt: ['Едкое'], feather: ['Живое'], ketchup: ['Липкое', 'Сладкое'], mask: ['Заразное'], battery: ['Едкое', 'Живое'], cracker: ['Шумное'],
  snot: ['Заразное'], sock: ['Гнилое', 'Жирное'], kidsnot: ['Заразное', 'Сладкое'], drool: ['Едкое', 'Заразное'], pus: ['Заразное', 'Гнилое', 'Живое'], tear: ['Живое', 'Сладкое'],
  kidney: ['Едкое', 'Живое'], lung: ['Гнилое'], tooth: ['Живое', 'Сладкое'], liver: ['Жирное', 'Едкое'], heart: ['Живое', 'Шумное'], carcass: ['Живое', 'Гнилое'],
  brain: ['Заразное', 'Живое', 'Шумное'], bile: ['Едкое', 'Жирное', 'Гнилое'], kidheart: ['Живое', 'Сладкое', 'Заразное'],
};

export type Potion = { id: number; from: string[]; props: Partial<Record<Prop, number>> };
export function brew(id: number, kinds: string[]): Potion {
  const props: Partial<Record<Prop, number>> = {};
  for (const k of kinds) for (const p of ITEM_PROPS[k] ?? []) props[p] = (props[p] ?? 0) + 1;
  return { id, from: kinds.slice(), props };
}
export function dominant(p: Potion): Prop | null {
  let best: Prop | null = null, n = 0;
  for (const pr of PROPS) { const v = p.props[pr] ?? 0; if (v > n) { n = v; best = pr; } }
  return best;
}

// ---------- ДНК и Мутации ----------
export type DNA = Record<Prop, number>;
export type Mutations = Partial<Record<Prop, number>>; // семейство → Ступень
export function newDNA(rand: () => number): DNA {
  const dna = {} as DNA; for (const p of PROPS) dna[p] = 3 + Math.floor(rand() * 8);
  const idx = [...PROPS].sort(() => rand() - 0.5).slice(0, 3);
  for (const p of idx) dna[p] = 20 + Math.floor(rand() * 21);
  return dna;
}
/** Выпить: Доминанта → Ступень семейства (+1, до 3; Жирное без предела); каждое вхождение Свойства → Ген +10. */
export function drink(dna: DNA, mut: Mutations, p: Potion): { family: Prop | null; tier: number } {
  const fam = dominant(p);
  for (const pr of PROPS) if (p.props[pr]) dna[pr] += 10 * p.props[pr]!;
  if (!fam) return { family: null, tier: 0 };
  const cur = mut[fam] ?? 0;
  mut[fam] = fam === 'Жирное' ? cur + 1 : Math.min(3, cur + 1);
  return { family: fam, tier: mut[fam]! };
}
export const geneMul = (dna: DNA, p: Prop) => 0.5 + (dna[p] ?? 0) / 100;

/** Числовые эффекты Мутаций для симуляции. Сила × (0.5 + Ген/100). */
export type RatMods = {
  speed: number; jump: number; biteDmg: number; maxHp: number; pockets: number; regen: number;
  wallJump: 0 | 1 | 2 | 3; infect: number; scare: number; stink: 0 | 1 | 2 | 3; stompHalf: boolean;
};
export const BASE_MODS: RatMods = { speed: 1, jump: 1, biteDmg: 1, maxHp: 1, pockets: 0, regen: 0, wallJump: 0, infect: 0, scare: 0, stink: 0, stompHalf: false };
export function ratMods(dna: DNA, mut: Mutations): RatMods {
  const m = { ...BASE_MODS };
  const t = (p: Prop) => mut[p] ?? 0, g = (p: Prop) => geneMul(dna, p);
  if (t('Едкое')) m.biteDmg = 1 + [0, 0.5, 1, 2][Math.min(3, t('Едкое'))] * g('Едкое');
  if (t('Гнилое')) m.stink = Math.min(3, t('Гнилое')) as 0 | 1 | 2 | 3;
  if (t('Живое')) { m.maxHp = 1 + [0, 0.25, 0.5, 1][Math.min(3, t('Живое'))] * g('Живое'); if (t('Живое') >= 2) m.regen = 2 * g('Живое'); }
  if (t('Сладкое')) { m.speed = 1 + 0.1 * Math.min(3, t('Сладкое')) * g('Сладкое'); if (t('Сладкое') >= 2) m.jump = 1.08; }
  if (t('Жирное')) { m.pockets = t('Жирное'); m.speed *= Math.max(0.4, 1 - 0.05 * t('Жирное')); m.stompHalf = t('Жирное') >= 3; }
  if (t('Заразное')) m.infect = [0, 0.1, 0.25, 0.5][Math.min(3, t('Заразное'))] * g('Заразное');
  if (t('Шумное')) m.scare = [0, 3, 5, 8][Math.min(3, t('Шумное'))] * g('Шумное');
  if (t('Липкое')) m.wallJump = Math.min(3, t('Липкое')) as 0 | 1 | 2 | 3;
  return m;
}
export const MUTATION_NAMES: Record<Prop, string> = { Едкое: 'Кислотная пасть', Гнилое: 'Вонючка', Живое: 'Живучка', Сладкое: 'Сахарная', Жирное: 'Жирная мышь', Заразное: 'Чумная', Шумное: 'Визгунья', Липкое: 'Липучка' };
export const MUTATION_DESC: Record<Prop, string[]> = {
  Едкое: ['укус ×1.5', 'укус ×2', 'укус ×3'], Гнилое: ['Воришки облетают', 'все Голуби облетают', 'все Голуби облетают, Люди брезгуют'],
  Живое: ['+25 % HP', '+50 % HP, регенерация на земле', '+100 % HP, регенерация'], Сладкое: ['скорость +10 %', '+20 %, прыжок выше', '+30 %, прыжок выше'],
  Жирное: ['+1 карман, −5 % скорости', '+2, −10 %', '+3, −15 %, топот вдвое слабее; дальше без предела'], Заразное: ['укус заражает 10 %', '25 %', '50 %'],
  Шумное: ['укус пугает Людей в 3 тайлах', 'в 5', 'в 8'], Липкое: ['прыжок от стены', 'скольжение по стене', 'скольжение по стене'],
};

// ---------- Модификаторы Вылазки (вылить Зелье на карту) ----------
export type RaidMods = {
  biteMul: number; panicMul: number; panicStart: number; slippery: number; contagionMul: number; stageMul: number; noticeMul: number;
  humanSpeedMul: number; pigeonsGrounded: boolean; extraP: number; extraK: number; extraV: number; extraFood: number; extraTrash: number; acid: number; sticky: number;
  names: string[];
};
export const BASE_RAID: RaidMods = { biteMul: 1, panicMul: 1, panicStart: 0, slippery: 0, contagionMul: 1, stageMul: 1, noticeMul: 1, humanSpeedMul: 1, pigeonsGrounded: false, extraP: 0, extraK: 0, extraV: 0, extraFood: 0, extraTrash: 0, acid: 0, sticky: 0, names: [] };
export const MODIFIER_NAMES: Record<Prop, string> = { Едкое: 'Кислотный дождь', Гнилое: 'Помойный день', Живое: 'Час пик', Сладкое: 'Праздник во дворе', Жирное: 'Масляный гололёд', Заразное: 'Эпидемия', Шумное: 'Салют', Липкое: 'Жвачка везде' };
export const MODIFIER_DESC: Record<Prop, string> = {
  Едкое: 'лужи кислоты жгут крыс; укусы сильнее', Гнилое: 'Голубей-воришек больше; Люди брезгуют гнаться; Мусора больше', Живое: 'Людей больше, Переполох быстрее; больше Органов',
  Сладкое: 'Детей вдвое больше, их крик громче; сладкая Еда повсюду', Жирное: 'асфальт скользкий для всех; Люди роняют всё', Заразное: 'Заражение быстрее и заразнее; кот приходит раньше',
  Шумное: 'Переполох стартует выше, но Люди оглушены — замечают только вплотную', Липкое: 'Люди и Голуби вязнут; крысы — чуть-чуть',
};
export function raidMods(potions: Potion[]): RaidMods {
  const m: RaidMods = { ...BASE_RAID, names: [] };
  const sum: Partial<Record<Prop, number>> = {};
  for (const p of potions) for (const pr of PROPS) if (p.props[pr]) sum[pr] = (sum[pr] ?? 0) + p.props[pr]!;
  for (const pr of PROPS) {
    const t = Math.min(3, sum[pr] ?? 0); if (!t) continue;
    m.names.push(`${MODIFIER_NAMES[pr]} ${t}`);
    switch (pr) {
      case 'Едкое': m.acid = t; m.biteMul *= 1 + 0.25 * t; break;
      case 'Гнилое': m.extraV += t; m.noticeMul *= 0.8; m.extraTrash += 4 * t; break;
      case 'Живое': m.extraP += 2 * t; m.panicMul *= 1 + 0.3 * t; break;
      case 'Сладкое': m.extraK += t + 1; m.extraFood += 5 * t; break;
      case 'Жирное': m.slippery = t; break;
      case 'Заразное': m.contagionMul *= 1 + 2 * t; m.stageMul *= 1 / (1 + 0.5 * t); break;
      case 'Шумное': m.panicStart += 10 * t; m.noticeMul *= 0.5; break;
      case 'Липкое': m.sticky = t; m.humanSpeedMul *= 1 - 0.15 * t; m.pigeonsGrounded = t >= 2; break;
    }
  }
  return m;
}
