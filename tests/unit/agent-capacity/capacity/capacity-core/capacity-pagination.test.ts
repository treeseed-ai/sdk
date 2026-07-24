import { describe, expect, it } from 'vitest';
import {
	decodeCapacityPageCursor,
	encodeCapacityPageCursor,
	normalizeCapacityPageLimit,
} from '../../../../../src/capacity/capacity-core/capacity-pagination.ts';

describe('capacity pagination contracts', () => {
	it('normalizes bounded limits and rejects unbounded or malformed values', () => {
		expect(normalizeCapacityPageLimit(undefined)).toBe(50);
		expect(normalizeCapacityPageLimit('200')).toBe(200);
		for (const invalid of [0, -1, 201, 1.5, 'many']) {
			expect(() => normalizeCapacityPageLimit(invalid)).toThrow(/1 through 200/u);
		}
	});

	it('round-trips opaque stable-position cursors and rejects malformed input', () => {
		const cursor = { createdAt: '2026-07-17T00:00:00.000Z', id: 'grant_123' };
		expect(decodeCapacityPageCursor(encodeCapacityPageCursor(cursor))).toEqual(cursor);
		expect(() => decodeCapacityPageCursor('not-a-cursor')).toThrow(/invalid/u);
	});
});
