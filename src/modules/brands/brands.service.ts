import { audit } from '../../lib/audit.js';
import { removeStoredFile } from '../../lib/storage/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { defined } from '../../utils/object.js';
import { paginationMeta, toSkipTake } from '../../utils/pagination.js';
import { uniqueSlug } from '../../utils/slug.js';
import { retiredUnique, storeImage, type UploadedFile } from '../catalog/common.js';

import { brandsRepository } from './brands.repository.js';

import type { CreateBrandInput, ListBrandsQuery, UpdateBrandInput } from './brands.schema.js';
import type { Brand } from '@prisma/client';
import type { Request } from 'express';

export type BrandView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
};

function toView(b: Brand & { _count?: { products: number } }): BrandView {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    logoUrl: b.logoUrl,
    sortOrder: b.sortOrder,
    isActive: b.isActive,
    productCount: b._count?.products ?? 0,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

async function getOrThrow(id: string): Promise<Brand> {
  const brand = await brandsRepository.findById(id);
  if (!brand) throw ApiError.notFound('Brand not found', 'BRAND_NOT_FOUND');
  return brand;
}

async function explicitSlug(slug: string, exceptId?: string): Promise<string> {
  if (await brandsRepository.slugExists(slug, exceptId)) {
    throw ApiError.conflict('This slug is already used by another brand', 'SLUG_TAKEN');
  }
  return slug;
}

const actor = (req: Request) => req.auth?.userId ?? null;

export const brandsService = {
  async list(query: ListBrandsQuery) {
    const where = {
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await brandsRepository.list(
      where,
      [{ [query.sort]: query.order }, { name: 'asc' }],
      skip,
      take,
    );
    return { items: rows.map(toView), meta: paginationMeta(query, total) };
  },

  async get(id: string): Promise<BrandView> {
    return toView(await getOrThrow(id));
  },

  async create(input: CreateBrandInput, req: Request): Promise<BrandView> {
    const slug = input.slug
      ? await explicitSlug(input.slug)
      : await uniqueSlug(input.name, (s) => brandsRepository.slugExists(s));
    const { slug: _s, ...data } = input;
    const brand = await brandsRepository.create({ ...defined(data), name: input.name, slug });
    await audit(
      {
        action: 'catalog.brand.create',
        actorId: actor(req),
        targetType: 'Brand',
        targetId: brand.id,
      },
      req,
    );
    return toView(brand);
  },

  async update(id: string, input: UpdateBrandInput, req: Request): Promise<BrandView> {
    await getOrThrow(id);
    const slug = input.slug ? await explicitSlug(input.slug, id) : undefined;
    const { slug: _s, ...data } = input;
    const brand = await brandsRepository.update(id, {
      ...defined(data),
      ...(slug ? { slug } : {}),
    });
    await audit(
      {
        action: 'catalog.brand.update',
        actorId: actor(req),
        targetType: 'Brand',
        targetId: id,
        metadata: { fields: Object.keys(input) },
      },
      req,
    );
    return toView(brand);
  },

  async remove(id: string, req: Request): Promise<void> {
    const brand = await getOrThrow(id);
    if ((await brandsRepository.countActiveProducts(id)) > 0) {
      throw ApiError.conflict(
        'Reassign or delete this brand’s products first',
        'BRAND_HAS_PRODUCTS',
      );
    }
    await brandsRepository.update(id, {
      deletedAt: new Date(),
      isActive: false,
      slug: retiredUnique(brand.slug, 140),
    });
    await audit(
      { action: 'catalog.brand.delete', actorId: actor(req), targetType: 'Brand', targetId: id },
      req,
    );
  },

  async setLogo(id: string, file: UploadedFile, req: Request): Promise<BrandView> {
    const brand = await getOrThrow(id);
    const stored = await storeImage(file, 'brands');
    const updated = await brandsRepository.update(id, { logoUrl: stored.url, logoKey: stored.key });
    await removeStoredFile(brand.logoKey);
    await audit(
      {
        action: 'catalog.brand.update',
        actorId: actor(req),
        targetType: 'Brand',
        targetId: id,
        metadata: { logo: 'set' },
      },
      req,
    );
    return toView(updated);
  },

  async removeLogo(id: string, req: Request): Promise<BrandView> {
    const brand = await getOrThrow(id);
    const updated = await brandsRepository.update(id, { logoUrl: null, logoKey: null });
    await removeStoredFile(brand.logoKey);
    await audit(
      {
        action: 'catalog.brand.update',
        actorId: actor(req),
        targetType: 'Brand',
        targetId: id,
        metadata: { logo: 'removed' },
      },
      req,
    );
    return toView(updated);
  },
};
