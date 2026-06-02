export type RepairMode = 'auto' | 'off';

const MOJIBAKE_MARKERS = /[ÃÂâðÐÑÌï�]/u;
const C1_CONTROL_RE = /[\u0080-\u009F]/u;
const REPLACEMENT_RE = /�/gu;
const COMMON_MOJIBAKE_RE = /(?:Ã.|Â.|â.|ð.|Ð.|Ñ.|Ì.|ï.)/gu;

export function decodeMetaString(value: unknown, mode: RepairMode = 'auto'): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeUnicode(value);
  if (mode === 'off' || !looksRepairable(normalized)) return normalized;

  let best = normalized;
  let bestScore = mojibakeScore(best);
  let current = normalized;
  for (let i = 0; i < 2; i++) {
    const repaired = normalizeUnicode(Buffer.from(current, 'latin1').toString('utf8'));
    const score = mojibakeScore(repaired);
    if (score < bestScore) {
      best = repaired;
      bestScore = score;
      current = repaired;
      continue;
    }
    break;
  }
  return best;
}

function looksRepairable(s: string): boolean {
  return MOJIBAKE_MARKERS.test(s) || C1_CONTROL_RE.test(s);
}

function normalizeUnicode(s: string): string {
  return s.normalize('NFC');
}

function mojibakeScore(s: string): number {
  const common = s.match(COMMON_MOJIBAKE_RE)?.length ?? 0;
  const controls = s.match(/[\u0080-\u009F]/gu)?.length ?? 0;
  const replacement = s.match(REPLACEMENT_RE)?.length ?? 0;
  return common * 8 + controls * 12 + replacement * 25;
}
