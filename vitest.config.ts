import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/{unit,integration,contract}/**/*.test.ts'],
	},
});
