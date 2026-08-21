import { describe, expect, it } from 'vitest';
import { parseDeployConfig } from '../../../src/platform/deploy-config/parse-deploy-config.ts';
import {
	capacityProviderVariablesForService,
} from '../../../src/reconcile/builtin-adapters/capacity/providers/capacity-provider-variables-for-service.ts';
import type { ReconcileAdapterInput } from '../../../src/reconcile/support/contracts/contracts.ts';

const base = `name: Provider Test
slug: provider-test
siteUrl: https://provider.example.com
contactEmail: hello@example.com
cloudflare: { accountId: account-test }
`;

function input(config: ReturnType<typeof parseDeployConfig>): ReconcileAdapterInput {
	return {
		context: {
			tenantRoot: '/tmp/provider-control-plane-test',
			target: { kind: 'persistent', scope: 'staging' },
			deployConfig: config,
			launchEnv: {},
			session: new Map(),
		},
		unit: {
			unitId: 'capacity-provider-manager',
			unitType: 'capacity-provider',
			provider: 'railway',
			identity: { teamId: 'team', projectId: 'project', slug: 'provider-test', environment: 'staging', deploymentKey: 'provider-test-staging', environmentKey: 'staging' },
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'capacity provider manager',
			dependencies: [], spec: {}, secrets: {}, metadata: {},
		},
		persistedState: null,
	};
}

describe('capacity provider control-plane variables', () => {
	it('does not invent a remote endpoint for a managed control plane without an API surface', () => {
		const variables = capacityProviderVariablesForService(input(parseDeployConfig(base)), 'staging', {}, 'capacityProviderManager');
		expect(variables.TREESEED_API_BASE_URL).toBeUndefined();
		expect('TREESEED_MARKET_API_BASE_URL' in variables).toBe(false);
	});

	it('uses the configured external control-plane server', () => {
		const config = parseDeployConfig(`${base}controlPlane:\n  mode: external\n  baseUrl: https://control.example.com/\n`);
		const variables = capacityProviderVariablesForService(input(config), 'staging', {}, 'capacityProviderManager');
		expect(variables.TREESEED_API_BASE_URL).toBe('https://control.example.com');
		expect('TREESEED_MARKET_API_BASE_URL' in variables).toBe(false);
	});

	it('uses the managed API surface as the sole control-plane endpoint', () => {
		const config = parseDeployConfig(`${base}controlPlane:\n  mode: managed\nsurfaces:\n  api:\n    environments:\n      staging: { domain: control.managed.example.com }\nservices:\n  api: { enabled: true, provider: railway }\n  treeseedDatabase: { enabled: true, provider: railway }\n  operationsRunner: { enabled: true, provider: railway }\npublicTreeDxFederation:\n  railway:\n    nodePool: { bootstrapCount: 1, maxNodes: 1 }\n`);
		const variables = capacityProviderVariablesForService(input(config), 'staging', {}, 'capacityProviderManager');
		expect(variables.TREESEED_API_BASE_URL).toBe('https://control.managed.example.com');
		expect('TREESEED_MARKET_API_BASE_URL' in variables).toBe(false);
	});
});
