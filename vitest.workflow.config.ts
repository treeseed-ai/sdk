import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/integration/workflow/lifecycle/**/*.test.ts'],
		testTimeout: 360_000,
		fileParallelism: false,
	},
});
