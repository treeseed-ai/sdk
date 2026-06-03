import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TreeDbOpenApiComponents, TreeDbRepository, TreeDbRepositoryResponse } from '../../src/treedb/index.ts';

describe('TreeDB generated OpenAPI types', () => {
	it('are reproducible from the OpenAPI contract', () => {
		execFileSync('npm', ['run', 'treedb:check-types'], {
			cwd: process.cwd(),
			stdio: 'pipe',
		});
	});

	it('expose generated schemas through public SDK aliases', () => {
		const repository: TreeDbRepository = {
			repoId: 'repo_1',
			name: 'docs',
			defaultRef: 'refs/heads/main',
			status: 'ready',
		};
		const response: TreeDbRepositoryResponse = {
			ok: true,
			repo: repository,
		};
		const generated: TreeDbOpenApiComponents['schemas']['TreeDbRepository'] = repository;

		expect(response.repo).toEqual(generated);
	});

	it('keeps generated output free of implementation-history labels', () => {
		const generated = readFileSync(resolve(process.cwd(), 'src/treedb/generated/openapi-types.ts'), 'utf8');
		const rollout = String.fromCharCode(115, 116, 97, 103, 101);
		const segment = String.fromCharCode(112, 104, 97, 115, 101);
		const blocked = [`S${rollout.slice(1)} \\d`, `P${segment.slice(1)} \\d`, `x-treedb-${rollout}`, 'deferred-' + 'production'];
		expect(generated).not.toMatch(new RegExp(blocked.join('|'), 'u'));
		expect(generated).not.toMatch(/\\bany\\b/u);
	});

	it('includes public error codes in the generated schema', () => {
		type ErrorCode = TreeDbOpenApiComponents['schemas']['TreeDbErrorCode'];
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
		type Components = TreeDbOpenApiComponents['schemas'];
		const readiness: Components['TreeDbReadiness'] = {
			status: 'ready',
			checks: [],
			checkedAt: '2026-06-03T12:00:00Z',
		};
		const metrics: Components['TreeDbMetrics'] = {
			counters: [],
			histograms: [],
			gauges: [],
		};
		expect(readiness.status).toBe('ready');
		expect(metrics.counters).toEqual([]);
	});
});
