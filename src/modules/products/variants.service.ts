import { InventoryReason, ProductStatus } from '@prisma/client';

import { audit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { defined } from '../../utils/object.js';
import { retiredUnique } from '../catalog/common.js';

import { productDetailInclude, productsRepository } from './products.repository.js';
import { toVariantView, type VariantView } from './products.views.js';
import { assertSkusFree, optionsKey, resolveOptions } from './variant-rules.js';

import type { CreateVariantInput, UpdateVariantInput } from './products.schema.js';
import type { Request } from 'express';

const actor = (req: Request) => req.auth?.userId ?? null;

const variantInclude = productDetailInclude.variants.include;

async function getVariantOrThrow(variantId: string) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, deletedAt: null, product: { deletedAt: null } },
    include: { ...variantInclude, product: { select: { id: true, status: true } } },
  });
  if (!variant) throw ApiError.notFound('Variant not found', 'VARIANT_NOT_FOUND');
  return variant;
}

/** Combination keys of the product's other variants (to reject duplicates like two "M / Red"). */
async function siblingKeys(productId: string, exceptVariantId?: string): Promise<Set<string>> {
  const siblings = await prisma.productVariant.findMany({
    where: {
      productId,
      deletedAt: null,
      ...(exceptVariantId ? { id: { not: exceptVariantId } } : {}),
    },
    select: { attributeValues: { select: { attributeValueId: true } } },
  });
  return new Set(siblings.map((s) => optionsKey(s.attributeValues)));
}

async function assertKeepsSellable(productId: string, status: ProductStatus, variantId: string) {
  if (
    status === ProductStatus.ACTIVE &&
    (await productsRepository.activeVariantCount(productId, variantId)) === 0
  ) {
    throw ApiError.conflict(
      'A published product needs at least one active variant. Unpublish it first.',
      'LAST_ACTIVE_VARIANT',
    );
  }
}

export const variantsService = {
  async create(productId: string, input: CreateVariantInput, req: Request): Promise<VariantView> {
    const product = await productsRepository.findBasic(productId);
    if (!product) throw ApiError.notFound('Product not found', 'PRODUCT_NOT_FOUND');
    await assertSkusFree([input.sku]);
    const options = await resolveOptions(input.attributeValueIds, 'body.attributeValueIds');
    if ((await siblingKeys(productId)).has(optionsKey(options))) {
      throw ApiError.conflict(
        'Variants of the same product must differ by their options (e.g. Size or Color)',
        'VARIANT_COMBINATION_EXISTS',
      );
    }
    const userId = actor(req);
    const hasDefault =
      (await prisma.productVariant.count({
        where: { productId, deletedAt: null, isDefault: true },
      })) > 0;
    const makeDefault = input.isDefault === true || !hasDefault;

    const variant = await prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.productVariant.updateMany({
          where: { productId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await tx.productVariant.create({
        data: {
          ...defined({
            compareAtPrice: input.compareAtPrice,
            lowStockThreshold: input.lowStockThreshold,
            weightGrams: input.weightGrams,
            isActive: input.isActive,
            sortOrder: input.sortOrder,
          }),
          productId,
          sku: input.sku,
          price: input.price,
          stock: input.initialStock,
          isDefault: makeDefault,
          attributeValues: { create: options },
        },
        include: variantInclude,
      });
      if (input.initialStock > 0) {
        await tx.inventoryMovement.create({
          data: {
            variantId: created.id,
            delta: input.initialStock,
            stockAfter: input.initialStock,
            reason: InventoryReason.RESTOCK,
            note: 'Initial stock',
            actorId: userId,
          },
        });
      }
      return created;
    });
    await audit(
      {
        action: 'catalog.variant.create',
        actorId: userId,
        targetType: 'ProductVariant',
        targetId: variant.id,
      },
      req,
    );
    return toVariantView(variant);
  },

  /** Stock is NOT editable here - use stock adjustments (keeps the inventory history complete). */
  async update(variantId: string, input: UpdateVariantInput, req: Request): Promise<VariantView> {
    const existing = await getVariantOrThrow(variantId);
    const price = input.price ?? existing.price;
    const compareAt =
      input.compareAtPrice === undefined ? existing.compareAtPrice : input.compareAtPrice;
    if (compareAt !== null && compareAt <= price) {
      throw ApiError.validation([
        { path: 'body.compareAtPrice', message: 'Compare-at price must be higher than the price' },
      ]);
    }
    if (input.sku && input.sku !== existing.sku) await assertSkusFree([input.sku], variantId);
    if (input.isActive === false)
      await assertKeepsSellable(existing.productId, existing.product.status, variantId);

    let options: Awaited<ReturnType<typeof resolveOptions>> | undefined;
    if (input.attributeValueIds) {
      options = await resolveOptions(input.attributeValueIds, 'body.attributeValueIds');
      if ((await siblingKeys(existing.productId, variantId)).has(optionsKey(options))) {
        throw ApiError.conflict(
          'Variants of the same product must differ by their options (e.g. Size or Color)',
          'VARIANT_COMBINATION_EXISTS',
        );
      }
    }

    const { attributeValueIds: _ids, isDefault, ...fields } = input;
    const variant = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.productVariant.updateMany({
          where: { productId: existing.productId, isDefault: true, id: { not: variantId } },
          data: { isDefault: false },
        });
      }
      if (options) {
        await tx.variantAttributeValue.deleteMany({ where: { variantId } });
        await tx.variantAttributeValue.createMany({
          data: options.map((o) => ({ ...o, variantId })),
        });
      }
      return tx.productVariant.update({
        where: { id: variantId },
        // isDefault can only be switched ON here (switching it off would leave no default).
        data: { ...defined(fields), ...(isDefault === true ? { isDefault: true } : {}) },
        include: variantInclude,
      });
    });
    await audit(
      {
        action: 'catalog.variant.update',
        actorId: actor(req),
        targetType: 'ProductVariant',
        targetId: variantId,
        metadata: { fields: Object.keys(input) },
      },
      req,
    );
    return toVariantView(variant);
  },

  async remove(variantId: string, req: Request): Promise<void> {
    const variant = await getVariantOrThrow(variantId);
    await assertKeepsSellable(variant.productId, variant.product.status, variantId);
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data: {
          deletedAt: new Date(),
          isActive: false,
          isDefault: false,
          sku: retiredUnique(variant.sku, 64),
        },
      });
      await tx.productImage.updateMany({ where: { variantId }, data: { variantId: null } });
      if (variant.isDefault) {
        const next = await tx.productVariant.findFirst({
          where: { productId: variant.productId, deletedAt: null },
          orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        if (next)
          await tx.productVariant.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    await audit(
      {
        action: 'catalog.variant.delete',
        actorId: actor(req),
        targetType: 'ProductVariant',
        targetId: variantId,
      },
      req,
    );
  },
};
