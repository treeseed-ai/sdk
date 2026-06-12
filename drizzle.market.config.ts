import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/db/market-schema.ts',
	out: './drizzle/market',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.TREESEED_DATABASE_URL ?? '',
	},
});
