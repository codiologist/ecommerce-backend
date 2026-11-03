import type { ProductDetailRow, ProductListRow } from './products.repository.js';

export type VariantView = {
  id: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  lowStockThreshold: number;
  lowStock: boolean;
  weightGrams: number | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  options: {
    attributeId: string;
    attributeName: string;
    attributeType: string;
    valueId: string;
    value: string;
    colorHex: string | null;
  }[];
};

export type ImageView = {
  id: string;
  url: string;
  alt: string | null;
  width: number;
  height: number;
  sortOrder: number;
  variantId: string | null;
};

export type ProductDetailView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  status: string;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string; slug: string } | null;
  specifications: { name: string; value: string }[];
  seoTitle: string | null;
  seoDescription: string | null;
  isFeatured: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants: VariantView[];
  images: ImageView[];
};

export type ProductListItemView = {
  id: string;
  name: string;
  slug: string;
  status: string;
  isFeatured: boolean;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  image: { url: string; alt: string | null } | null;
  variantCount: number;
  priceMin: number | null;
  priceMax: number | null;
  totalStock: number;
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
};

type VariantRow = ProductDetailRow['variants'][number];
type ImageRow = ProductDetailRow['images'][number];

export function toVariantView(v: VariantRow): VariantView {
  return {
    id: v.id,
    sku: v.sku,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    stock: v.stock,
    lowStockThreshold: v.lowStockThreshold,
    lowStock: v.stock <= v.lowStockThreshold,
    weightGrams: v.weightGrams,
    isDefault: v.isDefault,
    isActive: v.isActive,
    sortOrder: v.sortOrder,
    options: v.attributeValues.map((link) => ({
      attributeId: link.attributeValue.attribute.id,
      attributeName: link.attributeValue.attribute.name,
      attributeType: link.attributeValue.attribute.type,
      valueId: link.attributeValue.id,
      value: link.attributeValue.value,
      colorHex: link.attributeValue.colorHex,
    })),
  };
}

export const toImageView = (i: ImageRow): ImageView => ({
  id: i.id,
  url: i.url,
  alt: i.alt,
  width: i.width,
  height: i.height,
  sortOrder: i.sortOrder,
  variantId: i.variantId,
});

function specs(value: unknown): { name: string; value: string }[] {
  return Array.isArray(value)
    ? value.filter(
        (s): s is { name: string; value: string } =>
          typeof s === 'object' && s !== null && typeof (s as { name?: unknown }).name === 'string',
      )
    : [];
}

export function toProductDetailView(p: ProductDetailRow): ProductDetailView {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    shortDescription: p.shortDescription,
    status: p.status,
    category: p.category,
    brand: p.brand,
    specifications: specs(p.specifications),
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    isFeatured: p.isFeatured,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    variants: p.variants.map(toVariantView),
    images: p.images.map(toImageView),
  };
}

export function toProductListItemView(p: ProductListRow): ProductListItemView {
  const prices = p.variants.filter((v) => v.isActive).map((v) => v.price);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    isFeatured: p.isFeatured,
    category: p.category,
    brand: p.brand,
    image: p.images[0] ?? null,
    variantCount: p.variants.length,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    totalStock: p.variants.reduce((sum, v) => sum + v.stock, 0),
    lowStock: p.variants.some((v) => v.stock <= v.lowStockThreshold),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
