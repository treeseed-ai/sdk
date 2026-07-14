import { describe, expect, it } from 'vitest';
import {
	assertApiRailwaySourcePolicy,
	assertNoRailwaySourceIdentityCollisions,
	railwayEnvironmentQualifiedServiceName,
} from '../../src/operations/services/railway-source-policy.ts';

describe('Railway source identity isolation', () => {
	it('derives stable environment-qualified names for scalar and indexed services', () => {
		expect(railwayEnvironmentQualifiedServiceName('treeseed-api', 'staging')).toBe('treeseed-api-staging');
		expect(railwayEnvironmentQualifiedServiceName('treeseed-api-production', 'staging')).toBe('treeseed-api-staging');
		expect(railwayEnvironmentQualifiedServiceName('treeseed-api-operations-runner-01', 'prod')).toBe('treeseed-api-operations-runner-production-01');
		expect(railwayEnvironmentQualifiedServiceName('public-treedx-node-staging-02', 'prod')).toBe('public-treedx-node-production-02');
		expect(railwayEnvironmentQualifiedServiceName('treeseed-api-postgres', 'local')).toBe('treeseed-api-postgres');
	});

	it('rejects unsuffixed and cross-environment API identities', () => {
		const staging = {
			key: 'api',
			serviceName: 'treeseed-api',
			sourceMode: 'git',
			sourceRepo: 'treeseed-ai/api',
			sourceBranch: 'staging',
			sourceRootDirectory: '.',
			dockerfilePath: '/Dockerfile.api',
		};
		expect(() => assertApiRailwaySourcePolicy('staging', staging)).toThrow(/serviceName must be treeseed-api-staging/u);
		expect(() => assertApiRailwaySourcePolicy('prod', {
			...staging,
			serviceName: 'treeseed-api-staging',
			sourceMode: 'image',
			sourceRepo: null,
			sourceBranch: null,
			sourceRootDirectory: null,
			dockerfilePath: null,
			imageRef: 'treeseed/api:1.2.3',
		})).toThrow(/serviceName must be treeseed-api-production/u);
	});

	it('rejects one project-wide identity with differing environment sources', () => {
		expect(() => assertNoRailwaySourceIdentityCollisions([
			{ environment: 'staging', serviceName: 'treeseed-api', sourceMode: 'git', sourceRepo: 'treeseed-ai/api', sourceBranch: 'staging' },
			{ environment: 'prod', serviceName: 'treeseed-api', sourceMode: 'image', imageRef: 'treeseed/api:1.2.3' },
		])).toThrow(/shared by staging and prod with different source\/build configurations/u);
	});

	it('accepts separate identities and identical shared infrastructure sources', () => {
		expect(() => assertNoRailwaySourceIdentityCollisions([
			{ environment: 'staging', serviceName: 'treeseed-api-staging', sourceMode: 'git' },
			{ environment: 'prod', serviceName: 'treeseed-api-production', sourceMode: 'image' },
			{ environment: 'staging', serviceName: 'treeseed-api-postgres', sourceMode: 'image', imageRef: 'postgres:16' },
			{ environment: 'prod', serviceName: 'treeseed-api-postgres', sourceMode: 'image', imageRef: 'postgres:16' },
		])).not.toThrow();
	});
});
