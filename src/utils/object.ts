export type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Drops keys whose value is `undefined`. Bridges Zod's `field?: T | undefined` to Prisma's
 * `field?: T` under `exactOptionalPropertyTypes` (an omitted field means "don't change it").
 */
export function defined<T extends object>(input: T): Defined<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Defined<T>;
}
