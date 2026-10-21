// Интерфейс алхимии и мутаций — «мини-игра» внутри Норы: Склад по категориям, Котёл со спектром свойств и
// предпросмотром результата, Полка с колбами и сравнением «до/после», карточка крысы с галереей мутаций,
// и экран-откровение новой Мутации. Чистый HTML/CSS поверх данных сервера; правила — из @krysy/sim.
import { KINDS, PROPS, ITEM_PROPS, MUTATION_NAMES, MUTATION_DESC, MODIFIER_NAMES, MODIFIER_DESC, RULES, dominant, brew, type Potion, type Prop } from '@krysy/sim';
import { itemIcon } from './sprites';

export type PropMeta = { color: string; icon: string; blurb: string };
export const PROP_META: Record<Prop, PropMeta> = {
  Едкое: { color: '#8ef05a', icon: '🧪', blurb: 'жжёт: укус сильнее' },
  Гнилое: { color: '#a8b060', icon: '🤢', blurb: 'воняет: Голуби и Люди брезгуют' },
  Живое: { color: '#ff6a6a', icon: '❤️', blurb: 'живучесть и сила' },
  Сладкое: { color: '#ff9ad0', icon: '🍬', blurb: 'скорость и прыжок' },
  Жирное: { color: '#f0d060', icon: '🥓', blurb: 'карманы и сила, но медленнее' },
  Заразное: { color: '#c080ff', icon: '☣️', blurb: 'укус заражает' },
  Шумное: { color: '#ffa040', icon: '📢', blurb: 'укус пугает Людей' },
  Липкое: { color: '#60e0e0', icon: '🕸️', blurb: 'прыжок от стены' },
};
const TYPE_RU: Record<string, string> = { food: 'Еда', trash: 'Мусор', secr: 'Выделения', organ: 'Органы' };
const TYPE_ICON: Record<string, string> = { food: '🍞', trash: '🗑️', secr: '💧', organ: '🫀' };
const TYPE_ORDER = ['food', 'trash', 'secr', 'organ'];

export type NoraLike = { stash: Record<string, number>; potions: Potion[]; cauldron: number; builds: Record<string, { name: string; desc: string; level: number; max: number; cost: Record<string, number> | null; requires?: string | null }>; log: string[] };
export type ProfileLike = { name: string; dna: Record<string, number>; mut: Record<string, number>; raids: number; banked: number; pockets?: number };
export type Ctx = {
  nora: NoraLike; me: ProfileLike | null; myId: string; host: boolean; pour: number[];
  profiles: Record<string, ProfileLike>;
  cauldron: string[]; // выбранные Ингредиенты (локально, до «Сварить»)
  brewing: string[] | null; // идёт варка: эти Ингредиенты показываем в слотах с пузырями
  portrait: (id: string, mut?: Record<string, number>) => string; // dataURL портрета с (опционально) другими Мутациями
  send: (m: unknown) => void; play: (s: string) => void; rerender: () => void; esc: (s: string) => string;
  costHtml: (cost: Record<string, number> | null) => string;
};

const tier = (m: Record<string, number> | undefined, p: Prop) => m?.[p] ?? 0;
const dot = (p: Prop) => `<i class="pdot" style="background:${PROP_META[p].color}" title="${p}"></i>`;
/** Чип Ингредиента: иконка, имя, количество и точки Свойств — видно, что он даст в Котле */
export function chip(kind: string, count?: number, extra = '') {
  const k = KINDS[kind]; if (!k) return '';
  return `<span class="chip ${k.type}" data-kind="${kind}" ${extra}><img src="${itemIcon(kind)}" alt=""/>${k.name}${count !== undefined ? ` <b>×${count}</b>` : ''}<span class="pdots">${(ITEM_PROPS[kind] ?? []).map(dot).join('')}</span></span>`;
}
/** Итоги Склада по категориям: Еда ×N · Мусор ×N · Выделения ×N · Органы ×N */
export function stashTotals(stash: Record<string, number>): Record<string, number> {
  const t: Record<string, number> = { food: 0, trash: 0, secr: 0, organ: 0 };
  for (const [k, n] of Object.entries(stash)) if (n > 0 && KINDS[k]) t[KINDS[k].type] = (t[KINDS[k].type] ?? 0) + n;
  return t;
}
export function stashTotalsText(stash: Record<string, number>, short = false): string {
  const SHORT: Record<string, string> = { food: 'Еда', trash: 'Мусор', secr: 'Выдел.', organ: 'Органы' };
  const t = stashTotals(stash); const parts = TYPE_ORDER.filter((ty) => t[ty]).map((ty) => `${short ? SHORT[ty] : TYPE_RU[ty]} ${t[ty]}`); // в мире Pixi-текст без эмодзи: только слова
  return parts.join(' · ');
}
function grouped(stash: Record<string, number>, minus: string[] = []) {
  const groups: Record<string, [string, number][]> = {};
  for (const [k, n0] of Object.entries(stash)) { const n = n0 - minus.filter((c) => c === k).length; if (n <= 0 || !KINDS[k]) continue; (groups[KINDS[k].type] ??= []).push([k, n]); }
  return TYPE_ORDER.filter((ty) => groups[ty]).map((ty) => ({ type: ty, items: groups[ty].sort((a, b) => b[1] - a[1]) }));
}
/** Склад: плитки категорий с итогами + сгруппированные чипы */
export function stashHtml(ctx: Ctx, pickable = false): string {
  const t = stashTotals(ctx.nora.stash); const all = Object.values(t).reduce((a, b) => a + b, 0);
  const tiles = TYPE_ORDER.map((ty) => `<div class="cat ${ty} ${t[ty] ? '' : 'empty'}"><span class="ci">${TYPE_ICON[ty]}</span><b>${t[ty]}</b><span>${TYPE_RU[ty]}</span></div>`).join('');
  if (!all) return `<div class="cats">${tiles}</div><div class="muted">Пусто. Всё, что вынесете с Вылазки через Выход, ляжет сюда.</div>`;
  const groups = grouped(ctx.nora.stash, pickable ? ctx.cauldron : []);
  return `<div class="cats">${tiles}</div>${groups.map((g) => `<div class="grp"><div class="grph">${TYPE_ICON[g.type]} ${TYPE_RU[g.type]} <span class="muted">×${g.items.reduce((a, [, n]) => a + n, 0)}</span></div>${g.items.map(([k, n]) => chip(k, n)).join('')}</div>`).join('')}`;
}

// ---------- Котёл ----------
function spectrum(props: Partial<Record<Prop, number>>, dom: Prop | null, max = 4): string {
  return `<div class="spec">${PROPS.map((p) => { const v = props[p] ?? 0; return `<div class="sp ${v ? 'on' : ''} ${p === dom ? 'dom' : ''}" style="--c:${PROP_META[p].color}"><i style="height:${Math.min(100, (v / max) * 100)}%"></i><b>${v || ''}</b><span>${PROP_META[p].icon}</span></div>`; }).join('')}</div>`;
}
export function cauldronHtml(ctx: Ctx): string {
  const n = ctx.nora; const cb = n.builds.cauldron;
  if (!(cb?.level > 0)) return `<div class="build"><b>Стройплощадка: Котёл</b> <span class="muted">— ${cb.desc}. Цена: ${ctx.costHtml(cb.cost)}</span> <button class="small primary" data-build="cauldron">Построить</button></div>${stashHtml(ctx)}`;
  const sel = ctx.brewing ?? ctx.cauldron; const pot = brew(0, sel); const dom = sel.length >= 2 ? dominant(pot) : null;
  let slots = ''; for (let i = 0; i < n.cauldron; i++) slots += `<span class="slot big ${sel[i] ? 'full' : ''}" data-i="${i}" style="${sel[i] ? `--c:${PROP_META[(ITEM_PROPS[sel[i]] ?? ['Живое'])[0]].color}` : ''}">${sel[i] ? `<img src="${itemIcon(sel[i])}" alt=""/>` : `<em>${i + 1}</em>`}</span>`;
  let result = '';
  if (sel.length >= 2 && dom) {
    const cur = tier(ctx.me?.mut, dom), next = dom === 'Жирное' ? cur + 1 : Math.min(3, cur + 1);
    const eff = MUTATION_DESC[dom][Math.min(2, next - 1)];
    const mods = PROPS.filter((p) => pot.props[p]).map((p) => `<span class="ptag" style="--c:${PROP_META[p].color}">${MODIFIER_NAMES[p]}</span>`).join(' ');
    result = `<div class="result"><div class="rline"><span class="rk">🧬 Выпить →</span> <b style="color:${PROP_META[dom].color}">${MUTATION_NAMES[dom]} ${next}</b> <span class="muted">${cur >= 3 && dom !== 'Жирное' ? '(уже максимум — только ДНК)' : eff}</span></div>
      <div class="rline"><span class="rk">🌧 Вылить на карту →</span> ${mods}</div>
      <div class="rline muted">ДНК: ${PROPS.filter((p) => pot.props[p]).map((p) => `${p} +${10 * pot.props[p]!}`).join(', ')}</div></div>`;
  } else if (sel.length === 1) result = `<div class="result muted">Добавь ещё хотя бы один Ингредиент. Доминанта — Свойство, которого больше всего; при равенстве побеждает первое по кругу.</div>`;
  else result = `<div class="result muted">Положи 2–${n.cauldron} Ингредиента. Сварится Зелье с суммой их Свойств: <b>выпить</b> — Мутация по Доминанте, <b>вылить</b> — Модификаторы Вылазки.</div>`;
  const legend = `<div class="legend">${PROPS.map((p) => `<span><i class="pdot" style="background:${PROP_META[p].color}"></i>${p} <em>${PROP_META[p].blurb}</em></span>`).join('')}</div>`;
  const picker = `<div class="pick">${grouped(n.stash, sel).map((g) => `<div class="grp"><div class="grph">${TYPE_ICON[g.type]} ${TYPE_RU[g.type]}</div>${g.items.map(([k, c]) => chip(k, c, 'data-pick="1"')).join('')}</div>`).join('') || '<span class="muted">Склад пуст — неси добычу с Вылазки</span>'}</div>`;
  const upgrade = `<div class="build" style="margin-top:8px"><b>Улучшить Котёл</b> ${cb.level}/${cb.max} <span class="muted">— ${cb.desc}. Цена: ${ctx.costHtml(cb.cost)}</span> ${cb.cost ? `<button class="small" data-build="cauldron">Построить</button>` : ''}</div>`;
  return `<div class="cauldron"><div class="cpot ${ctx.brewing ? 'brewing' : ''}"><div class="slots">${slots}</div><div class="bubbles"><i></i><i></i><i></i><i></i><i></i></div></div>
    <div class="cside">${spectrum(pot.props, dom)}${result}<div class="row"><button id="brewBtn" class="primary" ${sel.length < 2 || ctx.brewing ? 'disabled' : ''}>${ctx.brewing ? 'Варится…' : 'Сварить'}</button>${sel.length && !ctx.brewing ? '<button id="clearBtn" class="small">Высыпать</button>' : ''}<span class="muted">${stashTotalsText(n.stash)}</span></div></div></div>
    ${picker}<details class="muted" style="margin-top:4px"><summary>Что значат Свойства</summary>${legend}</details>${upgrade}`;
}

// ---------- Полка ----------
function vial(p: Potion): string {
  const d = dominant(p); const total = PROPS.reduce((a, x) => a + (p.props[x] ?? 0), 0);
  const stops = PROPS.filter((x) => p.props[x]).map((x) => PROP_META[x].color);
  const grad = stops.length > 1 ? `linear-gradient(to top, ${stops.join(', ')})` : (stops[0] ?? '#888');
  return `<div class="vial" title="${d ?? ''}"><i style="height:${Math.min(100, 30 + total * 12)}%;background:${grad}"></i><b>#${p.id}</b></div>`;
}
export function shelfHtml(ctx: Ctx): string {
  const n = ctx.nora; const sb = n.builds.shelf;
  if (!(sb?.level > 0)) return `<div class="build"><b>Стройплощадка: Полка Зелий</b> <span class="muted">— ${sb.desc}. Цена: ${ctx.costHtml(sb.cost)}${sb.requires ? ` · сначала: ${sb.requires}` : ''}</span> ${sb.requires ? '' : '<button class="small primary" data-build="shelf">Построить</button>'}</div>`;
  if (!n.potions.length) return '<div class="muted">Полка пуста — свари Зелье в Котле.</div>';
  return `<div class="potions">${n.potions.map((p) => {
    const d = dominant(p); const cur = tier(ctx.me?.mut, d ?? 'Живое'); const onTable = ctx.pour.includes(p.id);
    const next = d ? (d === 'Жирное' ? cur + 1 : Math.min(3, cur + 1)) : 0;
    return `<div class="pcard ${onTable ? 'pour' : ''}" style="--c:${d ? PROP_META[d].color : '#888'}">${vial(p)}<div class="pbody">
      <div class="ptitle"><b>${d ? `${PROP_META[d].icon} ${MUTATION_NAMES[d]}` : 'Муть без Доминанты'}</b> <span class="props">${PROPS.filter((x) => p.props[x]).map((x) => `<span class="ptag ${x === d ? 'dom' : ''}" style="--c:${PROP_META[x].color}">${x} ${p.props[x]}</span>`).join('')}</span></div>
      <div class="muted" style="font-size:11px">из: ${p.from.map((k) => KINDS[k]?.name ?? k).join(', ')}</div>
      ${d ? `<div class="pfx">выпить → <b>${MUTATION_NAMES[d]} ${next}</b>: ${MUTATION_DESC[d][Math.min(2, next - 1)]}</div><div class="pfx">вылить → ${PROPS.filter((x) => p.props[x]).map((x) => MODIFIER_NAMES[x]).join(', ')}</div>` : '<div class="pfx muted">выпить — только ДНК; вылить — ничего</div>'}
      <div class="row"><button class="small primary" data-drink="${p.id}">Выпить</button>${ctx.host ? `<button class="small" data-pour="${p.id}">${onTable ? '✓ На столе — снять' : 'На стол — вылить на карту'}</button>` : onTable ? '<span class="muted">на столе</span>' : ''}</div></div></div>`;
  }).join('')}</div>`;
}

// ---------- Карточка крысы ----------
function ingredientsFor(p: Prop, stash: Record<string, number>): string {
  const ks = Object.keys(ITEM_PROPS).filter((k) => ITEM_PROPS[k].includes(p) && KINDS[k]);
  ks.sort((a, b) => (stash[b] ?? 0) - (stash[a] ?? 0));
  return ks.slice(0, 4).map((k) => `<span class="${stash[k] ? 'have' : ''}">${KINDS[k].name}${stash[k] ? ` ×${stash[k]}` : ''}</span>`).join(', ');
}
export function mutationCards(pr: ProfileLike, stash: Record<string, number>, mine: boolean): string {
  const maxGene = Math.max(100, ...PROPS.map((p) => pr.dna[p] ?? 0));
  return `<div class="mgrid">${PROPS.map((p) => {
    const t = tier(pr.mut, p); const g = pr.dna[p] ?? 0; const mul = 0.5 + g / 100;
    const pips = p === 'Жирное' && t > 3 ? `<span class="pips"><b>●</b><b>●</b><b>●</b> +${t - 3}</span>` : `<span class="pips">${[1, 2, 3].map((i) => (i <= t ? '<b>●</b>' : '<b class="off">○</b>')).join('')}</span>`;
    const cur = t ? MUTATION_DESC[p][Math.min(2, t - 1)] : 'нет';
    const next = t >= 3 && p !== 'Жирное' ? 'максимум' : MUTATION_DESC[p][Math.min(2, t)];
    return `<div class="mcard ${t ? 'on' : ''}" style="--c:${PROP_META[p].color}"><div class="mh"><span class="mi">${PROP_META[p].icon}</span><b>${MUTATION_NAMES[p]}</b>${pips}</div>
      <div class="gene"><i><b style="width:${(g / maxGene) * 100}%"></b></i><span>Ген ${g} · сила ×${mul.toFixed(2)}</span></div>
      <div class="mnow">${t ? `<b>${t} ст.</b> ${cur}` : `<span class="muted">${PROP_META[p].blurb}</span>`}</div>
      <div class="mnext muted">→ ${next}</div>
      ${mine ? `<div class="ming muted">${p}: ${ingredientsFor(p, stash)}</div>` : ''}</div>`;
  }).join('')}</div>`;
}
export function ratCardHtml(ctx: Ctx, id: string, snapLine: string): string {
  const pr = ctx.profiles[id]; if (!pr) return '<h2>Крыса</h2><div class="muted">нет данных</div>';
  const mine = id === ctx.myId;
  const dom = [...PROPS].sort((a, b) => (pr.dna[b] ?? 0) - (pr.dna[a] ?? 0)).slice(0, 2);
  const muts = PROPS.filter((p) => tier(pr.mut, p));
  return `<div class="ratcard"><div class="portrait"><img src="${ctx.portrait(id)}" alt="${ctx.esc(pr.name)}"/><div class="pname">${mine ? 'Ты: ' : ''}${ctx.esc(pr.name)}</div>
    <div class="ptags">${muts.length ? muts.map((p) => `<span class="ptag" style="--c:${PROP_META[p].color}">${PROP_META[p].icon} ${MUTATION_NAMES[p]} ${pr.mut[p]}</span>`).join('') : '<span class="muted">без Мутаций</span>'}</div></div>
    <div class="ratinfo"><div class="muted">Вылазок: ${pr.raids} · вынесено: ${pr.banked} · карманов: ${RULES.pockets + (pr.pockets ?? 0) + (pr.mut['Жирное'] ?? 0)}${snapLine}</div>
    <div class="muted" style="font-size:12px;margin:4px 0 6px">Порода по ДНК: <b>${dom.map((p) => `<span style="color:${PROP_META[p].color}">${p}</span>`).join(' + ')}</b> — Мутации этих семейств у неё сильнее. Ген растёт от каждого выпитого Зелья с этим Свойством (+10 за вхождение).</div>
    ${mutationCards(pr, ctx.nora.stash, mine)}</div></div>`;
}

// ---------- Модалка «выпить» и экран новой Мутации ----------
export function drinkModalHtml(ctx: Ctx, p: Potion): string {
  const d = dominant(p); const me = ctx.me;
  const cur = d ? tier(me?.mut, d) : 0; const next = d ? (d === 'Жирное' ? cur + 1 : Math.min(3, cur + 1)) : 0;
  const after = { ...(me?.mut ?? {}) }; if (d) after[d] = next;
  const gains = PROPS.filter((x) => p.props[x]).map((x) => `<span class="ptag" style="--c:${PROP_META[x].color}">${x} +${10 * p.props[x]!}</span>`).join(' ');
  return `<div class="dm"><h2>Выпить Зелье #${p.id}?</h2>
    <div class="cmp"><div><img src="${ctx.portrait(ctx.myId)}" alt=""/><div class="muted">сейчас</div><div>${d ? (cur ? `${MUTATION_NAMES[d]} ${cur}` : '—') : '—'}</div></div><div class="arrow">→</div>
      <div><img src="${ctx.portrait(ctx.myId, after)}" alt=""/><div class="muted">после</div><div style="color:${d ? PROP_META[d].color : 'inherit'}"><b>${d ? `${MUTATION_NAMES[d]} ${next}` : 'без Мутации'}</b></div></div></div>
    ${d ? `<div class="pfx">${cur >= 3 && d !== 'Жирное' ? 'Ступень уже максимальная — вырастет только Ген.' : MUTATION_DESC[d][Math.min(2, next - 1)]}</div>` : ''}
    <div class="pfx">ДНК: ${gains}</div>
    <div class="muted" style="font-size:12px">Мутации навсегда. Зелье исчезнет с Полки.</div>
    <div class="row" style="justify-content:flex-end"><button id="dmNo">Не пить</button><button id="dmYes" class="primary">Выпить залпом</button></div></div>`;
}
export function revealHtml(ctx: Ctx, fam: Prop | null, t: number): string {
  if (!fam) return `<div class="rv"><div class="rvt">Муть…</div><img src="${ctx.portrait(ctx.myId)}" alt=""/><div class="rvd">Без Доминанты — Мутации нет, только ДНК подросла.</div><div class="muted">тапни, чтобы закрыть</div></div>`;
  return `<div class="rv" style="--c:${PROP_META[fam].color}"><div class="rvt">МУТАЦИЯ!</div><img src="${ctx.portrait(ctx.myId)}" alt=""/><div class="rvn">${PROP_META[fam].icon} ${MUTATION_NAMES[fam]} <b>${t}</b></div><div class="rvd">${MUTATION_DESC[fam][Math.min(2, t - 1)]}</div><div class="muted">тапни, чтобы закрыть</div></div>`;
}
export const MODIFIER_HINT = MODIFIER_DESC;
