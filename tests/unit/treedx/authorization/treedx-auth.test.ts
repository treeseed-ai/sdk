import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mintTreeDxHs256Token } from '../../../../src/treedx/accounts/auth.ts';

function decode(segment: string) {
	return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('TreeDX HS256 token primitive', () => {
	it('mints deterministic, scoped, verifiable claims', () => {
		const token = mintTreeDxHs256Token({
			secret: 'secret-a', issuer: 'issuer-a', audience: 'audience-a', actorId: 'actor-a', tenantId: 'tenant-a',
			repoIds: ['repo-a', 'repo-a'], capabilities: ['files:read'], refs: ['refs/heads/main'], paths: ['docs/**'],
			projectId: 'project-a', capacityWorkdayRunId: 'workday-a', ttlSeconds: 300, nowEpochSeconds: 1000, jti: 'token-a',
		});
		const [header, payload, signature] = token.split('.');
		expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' });
		expect(decode(payload)).toMatchObject({ jti: 'token-a', iat: 1000, nbf: 995, exp: 1300, treedx_repo_ids: ['repo-a'], treedx_capabilities: ['files:read'], treeseed_project_id: 'project-a', treeseed_capacity_workday_run_id: 'workday-a' });
		expect(signature).toBe(createHmac('sha256', 'secret-a').update(`${header}.${payload}`).digest('base64url'));
	});

	it('rejects missing identity and unsafe lifetimes', () => {
		const valid = { secret: 's', issuer: 'i', audience: 'a', actorId: 'actor', tenantId: 'tenant' };
		expect(() => mintTreeDxHs256Token({ ...valid, secret: '' })).toThrow(/secret is required/u);
		expect(() => mintTreeDxHs256Token({ ...valid, ttlSeconds: 3601 })).toThrow(/ttlSeconds/u);
	});
});
