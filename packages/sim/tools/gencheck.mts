// Проверка генератора: 300 карт на тему — сколько попыток, провалы, причины. Запуск: npx tsx packages/sim/tools/gencheck.mts
import { generateLevel, lastGenAttempts, lastFailReason } from '../src/gen.ts';
const stats: Record<string, any> = {};
for (const theme of ['yard', 'kitchen', 'roof']) {
  const s = (stats[theme] = { ok: 0, fail: 0, att: 0, maxAtt: 0, reasons: {} as Record<string, number> });
  for (let seed = 1; seed <= 300; seed++) {
    generateLevel(theme, seed * 104729 + 7);
    if (lastGenAttempts < 0) s.fail++; else { s.ok++; s.att += lastGenAttempts; s.maxAtt = Math.max(s.maxAtt, lastGenAttempts); }
    if (lastGenAttempts !== 1) s.reasons[lastFailReason] = (s.reasons[lastFailReason] ?? 0) + 1;
  }
  s.att = +(s.att / Math.max(1, s.ok)).toFixed(2);
}
console.log(JSON.stringify(stats));
