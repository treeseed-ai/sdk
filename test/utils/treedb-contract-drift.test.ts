import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import * as treedb from '../../src/treedb/index.ts';

const workspaceOpenApiPath = resolve(process.cwd(), '../../docs/api/openapi.yaml');
const packageOpenApiPath = resolve(process.cwd(), 'docs/api/openapi.yaml');
const openApiPath = existsSync(workspaceOpenApiPath) ? workspaceOpenApiPath : packageOpenApiPath;
const openApi = parse(readFileSync(openApiPath, 'utf8')) as {
	paths?: Record<string, Record<string, unknown>>;
};

const requiredPaths = [
	'/api/v1/auth/whoami',
	'/api/v1/policy/effective-scope',
	'/api/v1/repos/{repo_id}',
	'/api/v1/repos/{repo_id}/files/read',
	'/api/v1/repos/{repo_id}/files/search',
	'/api/v1/repos/{repo_id}/query',
	'/api/v1/repos/{repo_id}/workspaces',
	'/api/v1/workspaces/{workspace_id}/files',
	'/api/v1/workspaces/{workspace_id}/commit',
	'/api/v1/workspaces/{workspace_id}/exec',
	'/api/v1/repos/{repo_id}/graph/refresh',
	'/api/v1/repos/{repo_id}/graph/refresh-jobs/{job_id}',
	'/api/v1/repos/{repo_id}/graph/query',
	'/api/v1/repos/{repo_id}/context/build',
	'/api/v1/repos/{repo_id}/snapshots/build',
	'/api/v1/repos/{repo_id}/artifacts/export',
	'/api/v1/search',
	'/api/v1/query',
	'/api/v1/context/build',
	'/api/v1/graph/query',
	'/api/v1/repos/{repo_id}/search/index/refresh',
	'/api/v1/repos/{repo_id}/search/index/status',
	'/api/v1/repos/{repo_id}/search/index/compact',
];

describe('TreeDB SDK contract drift checks', () => {
	it('keeps SDK-critical OpenAPI routes present', () => {
		for (const path of requiredPaths) {
			expect(openApi.paths, path).toHaveProperty(path);
		}
	});

	it('keeps TreeDB subpaths and SDK runtime exports present', () => {
		for (const subpath of ['./treedb', './treedb/client', './treedb/types', './treedb/adapters']) {
			expect(packageJson.exports, subpath).toHaveProperty(subpath);
		}
		for (const name of [
			'TreeDbClient',
			'TreeDbRegistryClient',
			'TreeDbFederatedClient',
			'TreeDbApiError',
			'TreeDbRepositoryAdapter',
			'TreeDbQueryAdapter',
			'TreeDbGraphAdapter',
			'TreeDbWorkspaceAdapter',
			'TreeDbRepositoryPort',
			'TreeDbRepositoryQueryPort',
			'TreeDbGraphPort',
			'TreeDbRegistryPort',
			'TreeDbFederatedPort',
			'TreeDbExecPort',
			'TreeDbArtifactPort',
		]) {
			expect(treedb, name).toHaveProperty(name);
		}
	});
});
