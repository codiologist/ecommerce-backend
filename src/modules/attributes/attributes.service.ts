import { audit } from '../../lib/audit.js';
import { ApiError } from '../../utils/ApiError.js';
import { defined } from '../../utils/object.js';
import { uniqueSlug } from '../../utils/slug.js';

import { attributesRepository } from './attributes.repository.js';

import type {
  CreateAttributeInput,
  CreateAttributeValueInput,
  UpdateAttributeInput,
  UpdateAttributeValueInput,
} from './attributes.schema.js';
import type { Attribute, AttributeValue } from '@prisma/client';
import type { Request } from 'express';

type ValueRow = AttributeValue & { _count?: { variants: number } };

export type AttributeValueView = {
  id: string;
  attributeId: string;
  value: string;
  slug: string;
  colorHex: string | null;
  sortOrder: number;
  variantCount: number;
};
export type AttributeView = {
  id: string;
  name: string;
  slug: string;
  type: Attribute['type'];
  sortOrder: number;
  values: AttributeValueView[];
};

const valueView = (v: ValueRow): AttributeValueView => ({
  id: v.id,
  attributeId: v.attributeId,
  value: v.value,
  slug: v.slug,
  colorHex: v.colorHex,
  sortOrder: v.sortOrder,
  variantCount: v._count?.variants ?? 0,
});

const toView = (a: Attribute & { values: ValueRow[] }): AttributeView => ({
  id: a.id,
  name: a.name,
  slug: a.slug,
  type: a.type,
  sortOrder: a.sortOrder,
  values: a.values.map(valueView),
});

const actor = (req: Request) => req.auth?.userId ?? null;

async function getOrThrow(id: string) {
  const attribute = await attributesRepository.findById(id);
  if (!attribute) throw ApiError.notFound('Attribute not found', 'ATTRIBUTE_NOT_FOUND');
  return attribute;
}

async function getValueOrThrow(id: string) {
  const value = await attributesRepository.findValue(id);
  if (!value) throw ApiError.notFound('Attribute value not found', 'ATTRIBUTE_VALUE_NOT_FOUND');
  return value;
}

export const attributesService = {
  async list(): Promise<AttributeView[]> {
    return (await attributesRepository.list()).map(toView);
  },

  async create(input: CreateAttributeInput, req: Request): Promise<AttributeView> {
    let slug = input.slug;
    if (slug && (await attributesRepository.slugExists(slug))) {
      throw ApiError.conflict('This slug is already used by another attribute', 'SLUG_TAKEN');
    }
    slug ??= await uniqueSlug(input.name, (s) => attributesRepository.slugExists(s));
    const attribute = await attributesRepository.create({
      name: input.name,
      slug,
      type: input.type,
      ...defined({ sortOrder: input.sortOrder }),
    });
    await audit(
      {
        action: 'catalog.attribute.create',
        actorId: actor(req),
        targetType: 'Attribute',
        targetId: attribute.id,
      },
      req,
    );
    return toView(attribute);
  },

  async update(id: string, input: UpdateAttributeInput, req: Request): Promise<AttributeView> {
    await getOrThrow(id);
    if (input.slug && (await attributesRepository.slugExists(input.slug, id))) {
      throw ApiError.conflict('This slug is already used by another attribute', 'SLUG_TAKEN');
    }
    const attribute = await attributesRepository.update(id, defined(input));
    await audit(
      {
        action: 'catalog.attribute.update',
        actorId: actor(req),
        targetType: 'Attribute',
        targetId: id,
      },
      req,
    );
    return toView(attribute);
  },

  async remove(id: string, req: Request): Promise<void> {
    await getOrThrow(id);
    if ((await attributesRepository.usageCount(id)) > 0) {
      throw ApiError.conflict('This attribute is used by product variants', 'ATTRIBUTE_IN_USE');
    }
    await attributesRepository.delete(id);
    await audit(
      {
        action: 'catalog.attribute.delete',
        actorId: actor(req),
        targetType: 'Attribute',
        targetId: id,
      },
      req,
    );
  },

  async createValue(
    attributeId: string,
    input: CreateAttributeValueInput,
    req: Request,
  ): Promise<AttributeValueView> {
    const attribute = await getOrThrow(attributeId);
    if (attribute.type === 'COLOR' && !input.colorHex) {
      throw ApiError.validation([
        { path: 'body.colorHex', message: 'Colour attributes need a hex colour' },
      ]);
    }
    let slug = input.slug;
    if (slug && (await attributesRepository.valueSlugExists(attributeId, slug))) {
      throw ApiError.conflict('This value already exists for the attribute', 'SLUG_TAKEN');
    }
    slug ??= await uniqueSlug(input.value, (s) =>
      attributesRepository.valueSlugExists(attributeId, s),
    );
    const value = await attributesRepository.createValue({
      attributeId,
      value: input.value,
      slug,
      colorHex: attribute.type === 'COLOR' ? (input.colorHex ?? null) : null,
      ...defined({ sortOrder: input.sortOrder }),
    });
    await audit(
      {
        action: 'catalog.attribute_value.create',
        actorId: actor(req),
        targetType: 'AttributeValue',
        targetId: value.id,
      },
      req,
    );
    return valueView(value);
  },

  async updateValue(
    valueId: string,
    input: UpdateAttributeValueInput,
    req: Request,
  ): Promise<AttributeValueView> {
    const existing = await getValueOrThrow(valueId);
    if (
      input.slug &&
      (await attributesRepository.valueSlugExists(existing.attributeId, input.slug, valueId))
    ) {
      throw ApiError.conflict('This value already exists for the attribute', 'SLUG_TAKEN');
    }
    if (existing.attribute.type === 'COLOR' && input.colorHex === null) {
      throw ApiError.validation([
        { path: 'body.colorHex', message: 'Colour attributes need a hex colour' },
      ]);
    }
    const data = defined({
      ...input,
      colorHex: existing.attribute.type === 'COLOR' ? input.colorHex : undefined,
    });
    const value = await attributesRepository.updateValue(valueId, data);
    await audit(
      {
        action: 'catalog.attribute_value.update',
        actorId: actor(req),
        targetType: 'AttributeValue',
        targetId: valueId,
      },
      req,
    );
    return valueView(value);
  },

  async removeValue(valueId: string, req: Request): Promise<void> {
    await getValueOrThrow(valueId);
    if ((await attributesRepository.valueUsageCount(valueId)) > 0) {
      throw ApiError.conflict('This value is used by product variants', 'ATTRIBUTE_VALUE_IN_USE');
    }
    await attributesRepository.deleteValue(valueId);
    await audit(
      {
        action: 'catalog.attribute_value.delete',
        actorId: actor(req),
        targetType: 'AttributeValue',
        targetId: valueId,
      },
      req,
    );
  },
};
