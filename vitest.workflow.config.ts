import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/integration/workflow/workflow-lifecycle.*.test.ts'],
		fileParallelism: false,
	},
});
