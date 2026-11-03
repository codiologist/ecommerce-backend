import { audit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginationMeta, toSkipTake, type OffsetPagination } from '../../utils/pagination.js';
import { lowStockVariantWhere } from '../products/products.repository.js';

import type { StockAdjustmentInput } from './inventory.schema.js';
import type { InventoryMovement } from '@prisma/client';
import type { Request } from 'express';

export type MovementView = {
  id: string;
  variantId: string;
  delta: number;
  stockAfter: number;
  reason: string;
  note: string | null;
  actor: { id: string; name: string } | null;
  createdAt: string;
};

const toMovementView = (
  m: InventoryMovement & { actor: { id: string; name: string } | null },
): MovementView => ({
  id: m.id,
  variantId: m.variantId,
  delta: m.delta,
  stockAfter: m.stockAfter,
  reason: m.reason,
  note: m.note,
  actor: m.actor,
  createdAt: m.createdAt.toISOString(),
});

export const inventoryService = {
  /**
   * Race-safe stock change (requirements §4.2): a single conditional UPDATE
   * (`stock + delta >= 0`) inside a transaction - two concurrent adjustments can never push stock below
   * zero or lose an update. The movement row records the resulting stock.
   */
  async adjust(variantId: string, input: StockAdjustmentInput, req: Request) {
    const actorId = req.auth?.userId ?? null;
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.productVariant.updateMany({
        where: {
          id: variantId,
          deletedAt: null,
          product: { deletedAt: null },
          ...(input.delta < 0 ? { stock: { gte: -input.delta } } : {}),
        },
        data: { stock: { increment: input.delta } },
      });
      if (updated.count !== 1) {
        const variant = await tx.productVariant.findFirst({
          where: { id: variantId, deletedAt: null, product: { deletedAt: null } },
          select: { stock: true },
        });
        if (!variant) throw ApiError.notFound('Variant not found', 'VARIANT_NOT_FOUND');
        throw ApiError.conflict(
          `Not enough stock: ${variant.stock} available, tried to remove ${-input.delta}`,
          'INSUFFICIENT_STOCK',
        );
      }
      const { stock } = await tx.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      });
      const movement = await tx.inventoryMovement.create({
        data: {
          variantId,
          delta: input.delta,
          stockAfter: stock,
          reason: input.reason,
          note: input.note ?? null,
          actorId,
        },
        include: { actor: { select: { id: true, name: true } } },
      });
      return { stock, movement };
    });
    await audit(
      {
        action: 'inventory.adjust',
        actorId,
        targetType: 'ProductVariant',
        targetId: variantId,
        metadata: { delta: input.delta, reason: input.reason, stockAfter: result.stock },
      },
      req,
    );
    return { stock: result.stock, movement: toMovementView(result.movement) };
  },

  async movements(variantId: string, query: OffsetPagination) {
    const exists = await prisma.productVariant.count({ where: { id: variantId } });
    if (!exists) throw ApiError.notFound('Variant not found', 'VARIANT_NOT_FOUND');
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await prisma.$transaction([
      prisma.inventoryMovement.findMany({
        where: { variantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: { actor: { select: { id: true, name: true } } },
      }),
      prisma.inventoryMovement.count({ where: { variantId } }),
    ]);
    return { items: rows.map(toMovementView), meta: paginationMeta(query, total) };
  },

  /** Variants at or below their low-stock threshold (dashboard alerts in Phase 8 reuse this). */
  async lowStock(query: OffsetPagination) {
    const where = { ...lowStockVariantWhere, product: { deletedAt: null } };
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await prisma.$transaction([
      prisma.productVariant.findMany({
        where,
        orderBy: [{ stock: 'asc' }, { id: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          sku: true,
          stock: true,
          lowStockThreshold: true,
          isActive: true,
          product: { select: { id: true, name: true, status: true } },
        },
      }),
      prisma.productVariant.count({ where }),
    ]);
    return { items: rows, meta: paginationMeta(query, total) };
  },
};
