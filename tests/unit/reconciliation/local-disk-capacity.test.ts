import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { observeLocalDiskCapacity } from '../../../src/reconcile/providers/local-disk-capacity.ts';

describe('local reconciliation disk capacity', () => {
	it('reserves at least ten percent of the filesystem beyond operation headroom', () => {
		const root = mkdtempSync(join(tmpdir(), 'disk-capacity-'));
		const observation = observeLocalDiskCapacity({ path: root, operationHeadroomBytes: 1024 });

		expect(observation.totalBytes).toBeGreaterThan(0);
		expect(observation.reserveBytes).toBeGreaterThanOrEqual(Math.ceil(observation.totalBytes * 0.1));
		expect(observation.requiredAvailableBytes).toBe(observation.reserveBytes + 1024);
		expect(observation.ok).toBe(observation.availableBytes >= observation.requiredAvailableBytes);
	});

	it('fails closed when configured build headroom exceeds available space', () => {
		const root = mkdtempSync(join(tmpdir(), 'disk-capacity-blocked-'));
		const observation = observeLocalDiskCapacity({ path: root, operationHeadroomBytes: Number.MAX_SAFE_INTEGER });

		expect(observation.ok).toBe(false);
		expect(observation.deficitBytes).toBeGreaterThan(0);
		expect(observation.reason).toContain('disk-capacity-insufficient');
	});
});
