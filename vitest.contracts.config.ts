import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		fileParallelism: true,
		maxWorkers: 2,
		testTimeout: 15_000,
		include: [
			'tests/contract/operator-contracts/**/*.test.ts',
			'tests/contract/standards/**/*.test.ts',
			'tests/contract/agent-capacity/capacity-configuration.test.ts',
			'tests/unit/deployment/**/*.test.ts',
			'tests/unit/development/**/*.test.ts',
			'tests/unit/operator-contracts/**/*.test.ts',
			'tests/unit/control-plane-client.test.ts',
			'tests/unit/treedx-proxy.test.ts',
			'tests/unit/treeai-proxy.test.ts',
			'tests/unit/security/**/*.test.ts',
			'tests/unit/secrets-capability/provider-operation-contracts.test.ts',
			'tests/unit/agent-capacity/capacity/assignments/assignment-record-validation.test.ts',
			'tests/unit/agent-capacity/capacity/providers/capacity-provider.test.ts',
		],
	},
});
