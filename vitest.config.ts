import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		fileParallelism: true,
		maxWorkers: 2,
		include: ['tests/{unit,integration,contract}/**/*.test.ts'],
		exclude: ['tests/integration/workflow/lifecycle/**/*.test.ts'],
	},
});
