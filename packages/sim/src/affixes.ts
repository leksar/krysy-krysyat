// Врождённые аффиксы Вылазки (как аффиксы карт в PoE): каждая карта получает 2 случайных из пула по сиду,
// независимо от Зелий — чтобы Вылазки отличались всегда. Вылитые Зелья добавляются сверху.
import type { RaidMods } from './alchemy.js';

export type Affix = { id: string; name: string; desc: string; visual?: 'night' | 'rain' | 'fog' | 'heat'; apply: (m: RaidMods) => void };

export const AFFIXES: Affix[] = [
  { id: 'night', name: 'Ночь', desc: 'темно: Люди замечают вдвое хуже, Голуби спят, но и вам видно меньше', visual: 'night', apply: (m) => { m.noticeMul *= 0.5; m.pigeonsGrounded = true; } },
  { id: 'rain', name: 'Дождь', desc: 'скользко, Голуби не летают, лужи повсюду', visual: 'rain', apply: (m) => { m.slippery = Math.max(m.slippery, 1); m.pigeonsGrounded = true; m.extraWater = (m.extraWater ?? 0) + 3; } },
  { id: 'fog', name: 'Туман', desc: 'Люди видят на треть хуже, кот приходит позже — но и вы видите мало', visual: 'fog', apply: (m) => { m.noticeMul *= 0.65; m.catAt = 75; } },
  { id: 'strike', name: 'Дворники бастуют', desc: 'ни одного Дворника, зато Прохожих больше и Переполох растёт быстрее', apply: (m) => { m.noDvornik = true; m.extraP += 3; m.panicMul *= 1.3; } },
  { id: 'kids', name: 'Детский праздник', desc: 'детей втрое больше, крики громче, сладкого навалом', apply: (m) => { m.extraK += 3; m.panicKidMul = 1.5; m.extraFood += 6; } },
  { id: 'wedding', name: 'Голубиная свадьба', desc: 'голубей вдвое больше с самого начала', apply: (m) => { m.extraV += 2; m.extraF += 2; } },
  { id: 'rush', name: 'Час пик', desc: 'Людей больше, Органов больше, Переполох быстрее', apply: (m) => { m.extraP += 3; m.panicMul *= 1.25; } },
  { id: 'dump', name: 'День помойки', desc: 'Мусора вдвое больше, Люди брезгуют гнаться', apply: (m) => { m.extraTrash += 10; m.noticeMul *= 0.85; } },
  { id: 'quiet', name: 'Тихий час', desc: 'Людей меньше, Переполох медленнее — зато Голубей больше', apply: (m) => { m.extraP -= 3; m.panicMul *= 0.6; m.extraF += 2; } },
  { id: 'siren', name: 'Тревога', desc: 'Переполох стартует с 25 %, Люди бегают быстрее', apply: (m) => { m.panicStart += 25; m.humanSpeedMul *= 1.2; } },
  { id: 'ice', name: 'Гололёд', desc: 'все скользят: и крысы, и Люди', apply: (m) => { m.slippery = Math.max(m.slippery, 2); m.humanSpeedMul *= 0.85; } },
  { id: 'poison', name: 'Крысиный яд', desc: 'лужи отравы на земле жгут крыс; зато Органы с Людей чаще редкие', visual: 'heat', apply: (m) => { m.acid = Math.max(m.acid, 1); m.rareOrgan = true; } },
  { id: 'sleepy', name: 'Сонное царство', desc: 'половина Прохожих спит — уязвимы одиночке', apply: (m) => { m.sleepers = true; } },
  { id: 'hungry', name: 'Голодный день', desc: 'Люди жрут всё, что видят — Меченая еда уходит мгновенно; Еды меньше', apply: (m) => { m.hungry = true; m.extraFood -= 4; } },
];

/** Выбор 2 различных аффиксов по сиду (детерминированно, та же xorshift, что в генераторе). */
export function pickAffixes(seed: number, n = 2): Affix[] {
  let x = (seed | 0) || 1; const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x |= 0; return ((x >>> 0) % 100000) / 100000; };
  const pool = AFFIXES.slice(); const out: Affix[] = [];
  while (out.length < n && pool.length) { const i = Math.floor(rnd() * pool.length); out.push(pool.splice(i, 1)[0]); }
  // несовместимые пары: ночь + туман одновременно слишком темно
  if (out.some((a) => a.id === 'night') && out.some((a) => a.id === 'fog')) out.splice(out.findIndex((a) => a.id === 'fog'), 1, AFFIXES.find((a) => a.id === 'rush')!);
  return out;
}
