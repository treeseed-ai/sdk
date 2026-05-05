import { drizzle } from 'drizzle-orm/d1';
import type { D1DatabaseLike } from '../types/cloudflare.ts';
import { treeseedSchema } from './schema.ts';

export function createTreeseedD1Drizzle(db: D1DatabaseLike) {
	return drizzle(db as never, { schema: treeseedSchema });
}

export type TreeseedD1Drizzle = ReturnType<typeof createTreeseedD1Drizzle>;
