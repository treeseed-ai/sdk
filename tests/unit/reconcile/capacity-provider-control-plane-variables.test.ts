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
	it('uses the singleton for both transports in pass-through mode', () => {
		const variables = capacityProviderVariablesForService(input(parseDeployConfig(base)), 'staging', {}, 'capacityProviderManager');
		expect(variables).toMatchObject({
			TREESEED_MARKET_API_BASE_URL: 'https://api.treeseed.dev',
			TREESEED_API_BASE_URL: 'https://api.treeseed.dev',
		});
	});

	it('keeps Market central while an external control plane remains sovereign', () => {
		const config = parseDeployConfig(`${base}controlPlane:\n  mode: external\n  baseUrl: https://control.example.com/\n`);
		const variables = capacityProviderVariablesForService(input(config), 'staging', {}, 'capacityProviderManager');
		expect(variables).toMatchObject({
			TREESEED_MARKET_API_BASE_URL: 'https://api.treeseed.dev',
			TREESEED_API_BASE_URL: 'https://control.example.com',
		});
	});

	it('uses the managed API surface without changing the singleton Market', () => {
		const config = parseDeployConfig(`${base}controlPlane:\n  mode: managed\nsurfaces:\n  api:\n    environments:\n      staging: { domain: control.managed.example.com }\nservices:\n  api: { enabled: true, provider: railway }\n  treeseedDatabase: { enabled: true, provider: railway }\n  operationsRunner: { enabled: true, provider: railway }\npublicTreeDxFederation:\n  railway:\n    nodePool: { bootstrapCount: 1, maxNodes: 1 }\n`);
		const variables = capacityProviderVariablesForService(input(config), 'staging', {}, 'capacityProviderManager');
		expect(variables).toMatchObject({
			TREESEED_MARKET_API_BASE_URL: 'https://api.treeseed.dev',
			TREESEED_API_BASE_URL: 'https://control.managed.example.com',
		});
	});
});
