import { sha256Text } from './hash.js';

export function slugifyName(input: string, fallback = 'conversation'): string {
  const cleaned = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '');
  return cleaned || fallback;
}

export function stableConversationDir(label: string, stableKey: string): string {
  return `${slugifyName(label)}--${sha256Text(stableKey).slice(0, 8)}`;
}
