import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { observeCapacityProviderRuntimeStatus } from '../../src/capacity-provider/runtime-status.ts';

describe('capacity provider runtime status', () => {
	it('requires a fresh published availability session from an approved connection', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-provider-runtime-status-'));
		const path = join(root, 'runtime', 'manager.json');
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({
			schemaVersion: 1,
			role: 'manager',
			ok: true,
			updatedAt: '2026-07-17T12:00:00.000Z',
			result: { connections: [{ ok: true, action: 'availability-session-published' }] },
		}));
		expect(observeCapacityProviderRuntimeStatus(path, 180, new Date('2026-07-17T12:02:00.000Z'))).toMatchObject({
			exists: true,
			valid: true,
			fresh: true,
			connected: true,
			issues: [],
		});
		expect(observeCapacityProviderRuntimeStatus(path, 60, new Date('2026-07-17T12:02:00.000Z'))).toMatchObject({
			fresh: false,
			connected: false,
		});
	});

	it('rejects pending and missing provider manager state', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-provider-runtime-pending-'));
		const path = join(root, 'manager.json');
		writeFileSync(path, JSON.stringify({
			schemaVersion: 1,
			role: 'manager',
			ok: true,
			updatedAt: '2026-07-17T12:00:00.000Z',
			result: { connections: [{ status: 'pending-approval' }] },
		}));
		const pending = observeCapacityProviderRuntimeStatus(path, 180, new Date('2026-07-17T12:00:05.000Z'));
		expect(pending.connected).toBe(false);
		expect(pending.issues).toContain('Manager has not published an availability session for any approved provider connection.');
		expect(observeCapacityProviderRuntimeStatus(join(root, 'missing.json'), 180).exists).toBe(false);
	});

	it('accepts a fresh idle manager when the validated manifest has no connections', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-provider-runtime-idle-'));
		const path = join(root, 'manager.json');
		writeFileSync(path, JSON.stringify({
			schemaVersion: 1,
			role: 'manager',
			ok: true,
			updatedAt: '2026-07-17T12:00:00.000Z',
			result: { connections: [] },
		}));
		expect(observeCapacityProviderRuntimeStatus(path, 180, new Date('2026-07-17T12:00:05.000Z'), false))
			.toMatchObject({ valid: true, fresh: true, connected: false, issues: [] });
	});
});
