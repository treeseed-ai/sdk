import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		exclude: ['test/utils/workflow-lifecycle.test.ts'],
		testTimeout: 15_000,
		fileParallelism: false,
	},
});
