import { InventoryReason, ProductStatus, Role, type Prisma } from '@prisma/client';

import { audit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { REAUTH_MAX_AGE_MS } from '../../middlewares/rbac.js';
import { ApiError } from '../../utils/ApiError.js';
import { defined } from '../../utils/object.js';
import { paginationMeta, toSkipTake } from '../../utils/pagination.js';
import { uniqueSlug } from '../../utils/slug.js';
import { retiredUnique } from '../catalog/common.js';

import {
  lowStockVariantWhere,
  productDetailInclude,
  productsRepository,
} from './products.repository.js';
import {
  toProductDetailView,
  toProductListItemView,
  type ProductDetailView,
} from './products.views.js';
import { assertSkusFree, optionsKey, resolveOptions } from './variant-rules.js';

import type {
  BulkProductsInput,
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from './products.schema.js';
import type { Request } from 'express';

const actor = (req: Request) => req.auth?.userId ?? null;

async function getDetailOrThrow(id: string) {
  const product = await productsRepository.findDetail(id);
  if (!product) throw ApiError.notFound('Product not found', 'PRODUCT_NOT_FOUND');
  return product;
}

async function assertRelations(input: {
  categoryId?: string | null | undefined;
  brandId?: string | null | undefined;
}) {
  if (input.categoryId && !(await productsRepository.categoryExists(input.categoryId))) {
    throw ApiError.validation([{ path: 'body.categoryId', message: 'Category not found' }]);
  }
  if (input.brandId && !(await productsRepository.brandExists(input.brandId))) {
    throw ApiError.validation([{ path: 'body.brandId', message: 'Brand not found' }]);
  }
}

async function resolveSlug(
  input: { slug?: string | undefined; name?: string | undefined },
  exceptId?: string,
) {
  if (input.slug) {
    if (await productsRepository.slugExists(input.slug, exceptId)) {
      throw ApiError.conflict('This slug is already used by another product', 'SLUG_TAKEN');
    }
    return input.slug;
  }
  return input.name
    ? uniqueSlug(input.name, (s) => productsRepository.slugExists(s, exceptId))
    : undefined;
}

const cleanDescription = (description: string | null | undefined) =>
  description === undefined
    ? undefined
    : description === null
      ? null
      : sanitizeRichText(description) || null;

const NOT_SELLABLE = 'A product needs at least one active variant before it can be published';

/** Bulk "delete" is gated inside the handler because the other bulk actions are allowed for STAFF. */
function assertCanDelete(req: Request): void {
  const auth = req.auth;
  if (!auth || (auth.role !== Role.ADMIN && auth.role !== Role.SUPER_ADMIN)) {
    throw ApiError.forbidden('You do not have permission to perform this action');
  }
  if (!auth.reauthAt || Date.now() - auth.reauthAt.getTime() > REAUTH_MAX_AGE_MS) {
    throw ApiError.forbidden('Please confirm your password to continue', 'REAUTH_REQUIRED');
  }
}

export const productsService = {
  async list(query: ListProductsQuery) {
    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.isFeatured !== undefined ? { isFeatured: query.isFeatured } : {}),
      ...(query.lowStock ? { variants: { some: lowStockVariantWhere } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              {
                variants: {
                  some: { deletedAt: null, sku: { contains: query.search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await productsRepository.list(
      where,
      [{ [query.sort]: query.order }, { id: 'asc' }],
      skip,
      take,
    );
    return { items: rows.map(toProductListItemView), meta: paginationMeta(query, total) };
  },

  async get(id: string): Promise<ProductDetailView> {
    return toProductDetailView(await getDetailOrThrow(id));
  },

  async create(input: CreateProductInput, req: Request): Promise<ProductDetailView> {
    await assertRelations(input);

    // Variants: SKUs unique (in payload and DB), options valid, combinations unique.
    const skus = input.variants.map((v) => v.sku);
    if (new Set(skus).size !== skus.length) {
      throw ApiError.validation([
        { path: 'body.variants', message: 'Each variant needs a different SKU' },
      ]);
    }
    await assertSkusFree(skus);
    const options = await Promise.all(
      input.variants.map((v, i) =>
        resolveOptions(v.attributeValueIds, `body.variants.${i}.attributeValueIds`),
      ),
    );
    const keys = options.map(optionsKey);
    if (new Set(keys).size !== keys.length) {
      throw ApiError.validation([
        {
          path: 'body.variants',
          message: 'Variants of the same product must differ by their options (e.g. Size or Color)',
        },
      ]);
    }

    const status = input.status ?? ProductStatus.DRAFT;
    if (status === ProductStatus.ACTIVE && !input.variants.some((v) => v.isActive !== false)) {
      throw ApiError.badRequest(NOT_SELLABLE, 'PRODUCT_NOT_SELLABLE');
    }
    const slug = (await resolveSlug(input)) ?? input.name;
    const defaultIndex = Math.max(
      0,
      input.variants.findIndex((v) => v.isDefault),
    );
    const userId = actor(req);

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          ...defined({
            shortDescription: input.shortDescription,
            categoryId: input.categoryId,
            brandId: input.brandId,
            seoTitle: input.seoTitle,
            seoDescription: input.seoDescription,
            isFeatured: input.isFeatured,
            description: cleanDescription(input.description),
          }),
          name: input.name,
          slug,
          status,
          specifications: input.specifications ?? [],
          publishedAt: status === ProductStatus.ACTIVE ? new Date() : null,
        },
      });
      for (const [i, v] of input.variants.entries()) {
        const variant = await tx.productVariant.create({
          data: {
            ...defined({
              compareAtPrice: v.compareAtPrice,
              lowStockThreshold: v.lowStockThreshold,
              weightGrams: v.weightGrams,
              isActive: v.isActive,
            }),
            productId: created.id,
            sku: v.sku,
            price: v.price,
            stock: v.initialStock,
            isDefault: i === defaultIndex,
            sortOrder: v.sortOrder ?? i,
            attributeValues: { create: options[i] ?? [] },
          },
        });
        if (v.initialStock > 0) {
          await tx.inventoryMovement.create({
            data: {
              variantId: variant.id,
              delta: v.initialStock,
              stockAfter: v.initialStock,
              reason: InventoryReason.RESTOCK,
              note: 'Initial stock',
              actorId: userId,
            },
          });
        }
      }
      return tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: productDetailInclude,
      });
    });

    await audit(
      {
        action: 'catalog.product.create',
        actorId: userId,
        targetType: 'Product',
        targetId: product.id,
      },
      req,
    );
    return toProductDetailView(product);
  },

  /** Product fields only: variants, stock and images have their own endpoints. */
  async update(id: string, input: UpdateProductInput, req: Request): Promise<ProductDetailView> {
    const existing = await getDetailOrThrow(id);
    await assertRelations(input);
    if (input.status === ProductStatus.ACTIVE && !existing.variants.some((v) => v.isActive)) {
      throw ApiError.badRequest(NOT_SELLABLE, 'PRODUCT_NOT_SELLABLE');
    }
    const slug = input.slug ? await resolveSlug({ slug: input.slug }, id) : undefined;
    const { slug: _s, description, specifications, ...rest } = input;
    await productsRepository.update(id, {
      ...defined(rest),
      ...defined({ description: cleanDescription(description), specifications }),
      ...(slug ? { slug } : {}),
      ...(input.status === ProductStatus.ACTIVE && !existing.publishedAt
        ? { publishedAt: new Date() }
        : {}),
    });
    await audit(
      {
        action: 'catalog.product.update',
        actorId: actor(req),
        targetType: 'Product',
        targetId: id,
        metadata: { fields: Object.keys(input) },
      },
      req,
    );
    return this.get(id);
  },

  /** Soft delete: keeps the row for future order history; frees the slug and SKUs for reuse. */
  async remove(id: string, req: Request): Promise<void> {
    const product = await getDetailOrThrow(id);
    const now = new Date();
    await prisma.$transaction([
      prisma.product.update({
        where: { id },
        data: {
          deletedAt: now,
          status: ProductStatus.ARCHIVED,
          slug: retiredUnique(product.slug, 220),
        },
      }),
      ...product.variants.map((v) =>
        prisma.productVariant.update({
          where: { id: v.id },
          data: {
            deletedAt: now,
            isActive: false,
            isDefault: false,
            sku: retiredUnique(v.sku, 64),
          },
        }),
      ),
    ]);
    await audit(
      {
        action: 'catalog.product.delete',
        actorId: actor(req),
        targetType: 'Product',
        targetId: id,
      },
      req,
    );
  },

  async bulk(input: BulkProductsInput, req: Request) {
    if (input.action === 'delete') assertCanDelete(req);
    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const id of input.ids) {
      const product = await productsRepository.findDetail(id);
      if (!product) {
        skipped.push({ id, reason: 'Product not found' });
        continue;
      }
      if (input.action === 'delete') {
        await this.remove(id, req);
      } else if (input.action === 'publish') {
        if (!product.variants.some((v) => v.isActive)) {
          skipped.push({ id, reason: NOT_SELLABLE });
          continue;
        }
        await productsRepository.update(id, {
          status: ProductStatus.ACTIVE,
          ...(product.publishedAt ? {} : { publishedAt: new Date() }),
        });
      } else {
        await productsRepository.update(id, {
          status: input.action === 'draft' ? ProductStatus.DRAFT : ProductStatus.ARCHIVED,
        });
      }
      updated.push(id);
    }

    await audit(
      {
        action: 'catalog.product.bulk',
        actorId: actor(req),
        metadata: { action: input.action, updated, skipped },
      },
      req,
    );
    return { updated, skipped };
  },
};
