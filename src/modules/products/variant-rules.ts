import { ApiError } from '../../utils/ApiError.js';

import { productsRepository } from './products.repository.js';

export type ResolvedOptions = { attributeValueId: string; attributeId: string }[];

/** Checks that all attribute values exist and that a variant has at most one value per attribute. */
export async function resolveOptions(
  ids: string[] | undefined,
  path: string,
): Promise<ResolvedOptions> {
  if (!ids || ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const rows = await productsRepository.attributeValuesByIds(unique);
  if (rows.length !== unique.length) {
    throw ApiError.validation([{ path, message: 'One or more attribute values do not exist' }]);
  }
  const attributes = new Set(rows.map((r) => r.attributeId));
  if (attributes.size !== rows.length) {
    throw ApiError.validation([
      { path, message: 'A variant can have only one value per attribute (e.g. one size)' },
    ]);
  }
  return rows.map((r) => ({ attributeValueId: r.id, attributeId: r.attributeId }));
}

/** Stable key for "same combination of options" checks. */
export const optionsKey = (options: { attributeValueId: string }[]) =>
  options
    .map((o) => o.attributeValueId)
    .sort()
    .join('|');

export async function assertSkusFree(skus: string[], exceptVariantId?: string): Promise<void> {
  const taken = await productsRepository.existingSkus(skus, exceptVariantId);
  if (taken.length > 0) {
    throw ApiError.conflict(`SKU already in use: ${taken.join(', ')}`, 'SKU_TAKEN');
  }
}
