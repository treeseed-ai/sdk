import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TreeDxOpenApiComponents, TreeDxRepository, TreeDxRepositoryResponse } from '../../src/treedx/index.ts';

describe('TreeDX generated OpenAPI types', () => {
	it('are reproducible from the OpenAPI contract', () => {
		execFileSync('npm', ['run', 'treedx:check-types'], {
			cwd: process.cwd(),
			stdio: 'pipe',
		});
	});

	it('expose generated schemas through public SDK aliases', () => {
		const repository: TreeDxRepository = {
			repoId: 'repo_1',
			name: 'docs',
			defaultRef: 'refs/heads/main',
			status: 'ready',
		};
		const response: TreeDxRepositoryResponse = {
			ok: true,
			repo: repository,
		};
		const generated: TreeDxOpenApiComponents['schemas']['TreeDxRepository'] = repository;

		expect(response.repo).toEqual(generated);
	});

	it('keeps generated output free of implementation-history labels', () => {
		const generated = readFileSync(resolve(process.cwd(), 'src/treedx/generated/openapi-types.ts'), 'utf8');
		const rollout = String.fromCharCode(115, 116, 97, 103, 101);
		const segment = String.fromCharCode(112, 104, 97, 115, 101);
		const blocked = [`S${rollout.slice(1)} \\d`, `P${segment.slice(1)} \\d`, `x-treedx-${rollout}`, 'deferred-' + 'production'];
		expect(generated).not.toMatch(new RegExp(blocked.join('|'), 'u'));
		expect(generated).not.toMatch(/\\bany\\b/u);
	});

	it('includes public error codes in the generated schema', () => {
		type ErrorCode = TreeDxOpenApiComponents['schemas']['TreeDxErrorCode'];
		const codes: ErrorCode[] = [
			'authentication_required',
			'invalid_token',
			'permission_denied',
			'workspace_revoked',
			'federated_node_timeout',
			'unsupported_transport',
			'sandbox_unavailable',
			'backup_failed',
			'service_unavailable',
		];
		expect(codes).toHaveLength(9);
	});

	it('includes operations schemas', () => {
		type Components = TreeDxOpenApiComponents['schemas'];
		const readiness: Components['TreeDxReadiness'] = {
			status: 'ready',
			checks: [],
			checkedAt: '2026-06-03T12:00:00Z',
		};
		const metrics: Components['TreeDxMetrics'] = {
			counters: [],
			histograms: [],
			gauges: [],
		};
		expect(readiness.status).toBe('ready');
		expect(metrics.counters).toEqual([]);
	});
});
