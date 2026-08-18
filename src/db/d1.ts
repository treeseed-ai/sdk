import { drizzle } from 'drizzle-orm/d1';
import type { D1DatabaseLike } from '../types/cloudflare.ts';
import { Schema } from './schema.ts';

export function createD1Drizzle(db: D1DatabaseLike) {
	return drizzle(db as never, { schema: Schema });
}

export type D1Drizzle = ReturnType<typeof createD1Drizzle>;
