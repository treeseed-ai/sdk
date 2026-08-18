import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/{unit,integration,contract}/**/*.test.ts'],
		exclude: ['tests/integration/workflow/lifecycle/**/*.test.ts'],
		testTimeout: 15_000,
		fileParallelism: false,
	},
});
