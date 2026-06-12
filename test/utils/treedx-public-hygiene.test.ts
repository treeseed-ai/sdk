import { describe, expect, it } from 'vitest';
import { TreeDxApiError } from '../../src/treedx/index.ts';
import { assertPublicHygiene } from './treedx-public-hygiene.ts';

describe('TreeDX public hygiene assertions', () => {
	it('accepts representative public payloads and error details', () => {
		const payload = {
			ok: true,
			repo: { repoId: 'repo_1', name: 'docs', defaultRef: 'refs/heads/main' },
			workspace: { workspaceId: 'ws_1', effectiveScope: { paths: ['docs/**'] } },
			error: { code: 'permission_denied', message: 'Permission denied.', details: { capability: 'files:read' } },
		};

		assertPublicHygiene(payload);

		const error = new TreeDxApiError('Workspace policy has been revoked.', {
			status: 409,
			code: 'workspace_revoked',
			details: { workspaceId: 'ws_1' },
			payload,
		});

		assertPublicHygiene({ code: error.code, status: error.status, details: error.details, payload: error.payload });
	});

	it('detects internal paths and secret-like values', () => {
		expect(() => assertPublicHygiene({ localPath: '/tmp/treedx/repo' })).toThrow();
		expect(() => assertPublicHygiene({ token: 'Bearer abc.def.ghi' })).toThrow();
		expect(() => assertPublicHygiene({ url: 'https://example.test/repo.git?token=secret' })).toThrow();
	});
});
