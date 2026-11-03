import { audit } from '../../lib/audit.js';
import { removeStoredFile } from '../../lib/storage/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { defined } from '../../utils/object.js';
import { uniqueSlug } from '../../utils/slug.js';
import { retiredUnique, storeImage, type UploadedFile } from '../catalog/common.js';

import { categoriesRepository } from './categories.repository.js';

import type {
  CreateCategoryInput,
  ReorderCategoriesInput,
  UpdateCategoryInput,
} from './categories.schema.js';
import type { Category } from '@prisma/client';
import type { Request } from 'express';

export type CategoryView = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
};
export type CategoryNode = CategoryView & { children: CategoryNode[] };

const MAX_DEPTH = 50;

function toView(c: Category & { _count?: { products: number } }): CategoryView {
  return {
    id: c.id,
    parentId: c.parentId,
    name: c.name,
    slug: c.slug,
    description: c.description,
    imageUrl: c.imageUrl,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    seoTitle: c.seoTitle,
    seoDescription: c.seoDescription,
    productCount: c._count?.products ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function buildTree(items: CategoryView[]): CategoryNode[] {
  const nodes = new Map(items.map((c) => [c.id, { ...c, children: [] as CategoryNode[] }]));
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

async function getOrThrow(id: string): Promise<Category> {
  const category = await categoriesRepository.findById(id);
  if (!category) throw ApiError.notFound('Category not found', 'CATEGORY_NOT_FOUND');
  return category;
}

async function resolveSlug(
  input: { slug?: string | undefined; name?: string | undefined },
  exceptId?: string,
) {
  if (input.slug) {
    if (await categoriesRepository.slugExists(input.slug, exceptId)) {
      throw ApiError.conflict('This slug is already used by another category', 'SLUG_TAKEN');
    }
    return input.slug;
  }
  return input.name
    ? uniqueSlug(input.name, (s) => categoriesRepository.slugExists(s, exceptId))
    : undefined;
}

/** A category can't be moved under itself or any of its descendants. */
async function assertValidParent(id: string | null, parentId: string): Promise<void> {
  const parent = await categoriesRepository.findById(parentId);
  if (!parent) throw ApiError.badRequest('Parent category not found', 'PARENT_NOT_FOUND');
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth += 1) {
    if (cursor === id) {
      throw ApiError.badRequest(
        'A category cannot be placed inside itself or its subcategories',
        'CATEGORY_CYCLE',
      );
    }
    cursor = await categoriesRepository.parentIdOf(cursor);
  }
  if (cursor) throw ApiError.badRequest('Category tree is too deep', 'CATEGORY_TOO_DEEP');
}

export const categoriesService = {
  async list(): Promise<{ items: CategoryView[]; tree: CategoryNode[] }> {
    const items = (await categoriesRepository.listAll()).map(toView);
    return { items, tree: buildTree(items) };
  },

  async get(id: string): Promise<CategoryView> {
    return toView(await getOrThrow(id));
  },

  async create(input: CreateCategoryInput, req: Request): Promise<CategoryView> {
    if (input.parentId) await assertValidParent(null, input.parentId);
    const slug = (await resolveSlug(input)) ?? input.name;
    const { slug: _s, ...data } = input;
    const category = await categoriesRepository.create({
      ...defined(data),
      name: input.name,
      slug,
    });
    await audit(
      {
        action: 'catalog.category.create',
        actorId: req.auth?.userId ?? null,
        targetType: 'Category',
        targetId: category.id,
      },
      req,
    );
    return toView(category);
  },

  async update(id: string, input: UpdateCategoryInput, req: Request): Promise<CategoryView> {
    await getOrThrow(id);
    if (input.parentId) await assertValidParent(id, input.parentId);
    const slug = input.slug ? await resolveSlug({ slug: input.slug }, id) : undefined;
    const { slug: _s, ...data } = input;
    const category = await categoriesRepository.update(id, {
      ...defined(data),
      ...(slug ? { slug } : {}),
    });
    await audit(
      {
        action: 'catalog.category.update',
        actorId: req.auth?.userId ?? null,
        targetType: 'Category',
        targetId: id,
        metadata: { fields: Object.keys(input) },
      },
      req,
    );
    return toView(category);
  },

  async remove(id: string, req: Request): Promise<void> {
    const category = await getOrThrow(id);
    if ((await categoriesRepository.countActiveChildren(id)) > 0) {
      throw ApiError.conflict('Move or delete the subcategories first', 'CATEGORY_HAS_CHILDREN');
    }
    if ((await categoriesRepository.countActiveProducts(id)) > 0) {
      throw ApiError.conflict('Move the products in this category first', 'CATEGORY_HAS_PRODUCTS');
    }
    await categoriesRepository.update(id, {
      deletedAt: new Date(),
      isActive: false,
      slug: retiredUnique(category.slug, 140),
    });
    await audit(
      {
        action: 'catalog.category.delete',
        actorId: req.auth?.userId ?? null,
        targetType: 'Category',
        targetId: id,
      },
      req,
    );
  },

  async reorder(input: ReorderCategoriesInput, req: Request): Promise<void> {
    await categoriesRepository.reorder(input.items);
    await audit(
      {
        action: 'catalog.category.reorder',
        actorId: req.auth?.userId ?? null,
        metadata: { count: input.items.length },
      },
      req,
    );
  },

  async setImage(id: string, file: UploadedFile, req: Request): Promise<CategoryView> {
    const category = await getOrThrow(id);
    const stored = await storeImage(file, 'categories');
    const updated = await categoriesRepository.update(id, {
      imageUrl: stored.url,
      imageKey: stored.key,
    });
    await removeStoredFile(category.imageKey);
    await audit(
      {
        action: 'catalog.category.update',
        actorId: req.auth?.userId ?? null,
        targetType: 'Category',
        targetId: id,
        metadata: { image: 'set' },
      },
      req,
    );
    return toView(updated);
  },

  async removeImage(id: string, req: Request): Promise<CategoryView> {
    const category = await getOrThrow(id);
    const updated = await categoriesRepository.update(id, { imageUrl: null, imageKey: null });
    await removeStoredFile(category.imageKey);
    await audit(
      {
        action: 'catalog.category.update',
        actorId: req.auth?.userId ?? null,
        targetType: 'Category',
        targetId: id,
        metadata: { image: 'removed' },
      },
      req,
    );
    return toView(updated);
  },
};
