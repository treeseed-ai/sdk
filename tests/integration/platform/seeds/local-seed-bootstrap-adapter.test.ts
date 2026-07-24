import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createLocalSeedBootstrapAdapter } from '../../../../src/reconcile/seeds/local-seed-bootstrap-adapter.ts';
import type { DesiredUnit, ReconcileAdapterInput } from '../../../../src/reconcile/support/contracts/contracts.ts';

function adapterInput(root: string, modulePath: string): ReconcileAdapterInput {
	const unit: DesiredUnit = {
		unitId: 'local:local-seed-bootstrap:treeseed',
		unitType: 'local-seed-bootstrap',
		provider: 'local',
		identity: {
			teamId: 'treeseed',
			projectId: 'treeseed-market',
			slug: 'treeseed',
			environment: 'local',
			deploymentKey: 'local',
			environmentKey: 'local',
		},
		target: { kind: 'persistent', scope: 'local' },
		logicalName: 'local Treeseed seed bootstrap',
		dependencies: [],
		spec: {
			seedName: 'treeseed',
			environments: 'local',
			manifestPath: join(root, 'seeds/treeseed.yaml'),
			manifestDigest: 'sha256:test',
			applyModulePath: modulePath,
		},
		secrets: {},
		metadata: {},
	};
	return {
		context: {
			tenantRoot: root,
			target: unit.target,
			deployConfig: {} as never,
			launchEnv: {},
			session: new Map(),
		},
		unit,
		persistedState: null,
	};
}

describe('local seed bootstrap reconciliation adapter', () => {
	it('plans, applies, and verifies the API-owned seed service to convergence', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-local-seed-adapter-'));
		try {
			const modulePath = join(root, 'seed-service.mjs');
			writeFileSync(modulePath, `
let converged = false;
export async function planLocalSeedFromCli() {
  return { plan: { summary: converged
    ? { create: 0, update: 0, unchanged: 2, skip: 0, error: 0 }
    : { create: 1, update: 1, unchanged: 0, skip: 0, error: 0 } } };
}
export async function applyLocalSeedFromCli() {
  converged = true;
  return { result: { actionCount: 2 } };
}
`, 'utf8');
			const adapter = createLocalSeedBootstrapAdapter();
			const input = adapterInput(root, modulePath);
			const observed = await adapter.refresh(input);
			const diff = await adapter.diff({ ...input, observed });
			expect(diff).toMatchObject({ action: 'update', reasons: ['2 local seed mutations remain'] });
			const applied = await adapter.apply({ ...input, observed, diff });
			expect(applied.state).toMatchObject({ pendingMutations: 0, applied: { actionCount: 2 } });
			const converged = await adapter.refresh(input);
			const verification = await adapter.verify!({ ...input, observed: converged });
			expect(converged).toMatchObject({ status: 'ready', live: { pendingMutations: 0 } });
			expect(verification).toMatchObject({ ready: true, verified: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('blocks when the configured API-owned seed module is unavailable', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-local-seed-missing-'));
		try {
			const adapter = createLocalSeedBootstrapAdapter();
			const input = adapterInput(root, join(root, 'missing.mjs'));
			const observed = await adapter.refresh(input);
			const diff = await adapter.diff({ ...input, observed });
			expect(observed.status).toBe('error');
			expect(diff.action).toBe('blocked');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
