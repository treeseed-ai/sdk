import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localProviderResources } from '../../../src/platform/desired-state/local-provider-resources.ts';

describe('local provider desired resources', () => {
	it('binds compose replacement to the built provider source closure', () => {
		const root = resolve(process.cwd(), '../..');
		const resources = localProviderResources({
			tenantRoot: root,
			environment: 'local',
			sourceClosureDigest: 'closure-a',
			treeDxEnvironment: {},
			hostCodexAuthFile: '',
			r2Bucket: 'content',
			seedBootstrapAvailable: false,
			seedNames: ['agents'],
		});
		const compose = resources.find((resource) => resource.kind === 'local-docker-compose');
		expect(compose?.spec.sourceClosureDigest).toBe('closure-a');
		expect((compose?.spec.env as Record<string,string>).TREESEED_PROVIDER_SOURCE_CLOSURE_DIGEST).toBe('closure-a');
		expect(compose?.dependencies).toContain('docker-image-build:treeseed/agent-runtime');
		const provider = resources.find((resource) => resource.kind === 'capacity-provider');
		expect(provider?.spec.seedName).toBe('agents');
	});
});
