export const DEFAULT_CAPACITY_PAGE_LIMIT = 50;
export const MAX_CAPACITY_PAGE_LIMIT = 200;

export interface CapacityPageInfo {
	limit: number;
	hasMore: boolean;
	nextCursor: string | null;
}

export interface CapacityPage<T> {
	items: T[];
	page: CapacityPageInfo;
}

export interface CapacityPageCursor {
	createdAt: string;
	id: string;
}

export function normalizeCapacityPageLimit(value: unknown) {
	if (value === undefined || value === null || value === '') return DEFAULT_CAPACITY_PAGE_LIMIT;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CAPACITY_PAGE_LIMIT) {
		throw new Error(`Capacity page limit must be an integer from 1 through ${MAX_CAPACITY_PAGE_LIMIT}.`);
	}
	return parsed;
}

export function encodeCapacityPageCursor(cursor: CapacityPageCursor) {
	return Buffer.from(JSON.stringify({ v: 1, createdAt: cursor.createdAt, id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeCapacityPageCursor(value: unknown): CapacityPageCursor | null {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string') throw new Error('Capacity page cursor must be a string.');
	try {
		const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
		if (decoded.v !== 1 || typeof decoded.createdAt !== 'string' || !decoded.createdAt || typeof decoded.id !== 'string' || !decoded.id) {
			throw new Error('invalid payload');
		}
		return { createdAt: decoded.createdAt, id: decoded.id };
	} catch {
		throw new Error('Capacity page cursor is invalid.');
	}
}
