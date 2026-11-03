import { randomBytes } from 'node:crypto';

const MAX_SLUG = 120;

/**
 * URL-safe ASCII slug. Latin accents are folded ("Café" → "cafe"). Names with no Latin characters
 * (e.g. Bangla) produce an empty base, in which case callers fall back to a random slug.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
}

export const slugSchemaPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Returns `base` or `base-2`, `base-3`… - the first one `exists()` says is free.
 * Uniqueness is still guaranteed by the DB unique index (P2002 → 409 on a race).
 */
export async function uniqueSlug(
  source: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(source) || `item-${randomBytes(4).toString('hex')}`;
  if (!(await exists(base))) return base;
  for (let n = 2; n < 50; n += 1) {
    const candidate = `${base.slice(0, MAX_SLUG - 4)}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base.slice(0, MAX_SLUG - 9)}-${randomBytes(4).toString('hex')}`;
}
