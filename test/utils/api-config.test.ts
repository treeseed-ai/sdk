import { describe, expect, it } from 'vitest';
import { resolveApiConfig, resolveApiDatabaseUrl, resolveLocalApiDatabaseUrl } from '../../src/api/config.ts';

describe('API config', () => {
	it('accepts canonical web service env names for hosted API credentials', () => {
		const config = resolveApiConfig({
			TREESEED_WEB_SERVICE_ID: 'web-hosted',
			TREESEED_WEB_SERVICE_SECRET: 'hosted-service-secret',
			TREESEED_WEB_ASSERTION_SECRET: 'hosted-assertion-secret',
		});

		expect(config.webServiceId).toBe('web-hosted');
		expect(config.webServiceSecret).toBe('hosted-service-secret');
		expect(config.webAssertionSecret).toBe('hosted-assertion-secret');
	});

	it('keeps API-prefixed web credential env names as the highest priority', () => {
		const config = resolveApiConfig({
			TREESEED_API_WEB_SERVICE_ID: 'api-web',
			TREESEED_WEB_SERVICE_ID: 'web-hosted',
			TREESEED_API_WEB_SERVICE_SECRET: 'api-secret',
			TREESEED_WEB_SERVICE_SECRET: 'hosted-service-secret',
			TREESEED_API_WEB_ASSERTION_SECRET: 'api-assertion',
			TREESEED_WEB_ASSERTION_SECRET: 'hosted-assertion-secret',
		});

		expect(config.webServiceId).toBe('api-web');
		expect(config.webServiceSecret).toBe('api-secret');
		expect(config.webAssertionSecret).toBe('api-assertion');
	});

	it('derives the local API database URL from managed local Postgres settings', () => {
		expect(resolveLocalApiDatabaseUrl({})).toBe('postgres://treeseed:treeseed@127.0.0.1:55432/market_local');
		expect(resolveLocalApiDatabaseUrl({
			TREESEED_MARKET_LOCAL_POSTGRES_PORT: '55444',
			TREESEED_MARKET_LOCAL_POSTGRES_DATABASE: 'custom_local',
		})).toBe('postgres://treeseed:treeseed@127.0.0.1:55444/custom_local');
	});

	it('uses TREESEED_DATABASE_URL as the canonical explicit database override', () => {
		expect(resolveApiDatabaseUrl({
			TREESEED_DATABASE_URL: 'postgres://configured-db',
			TREESEED_API_ENVIRONMENT: 'local',
		})).toBe('postgres://configured-db');
	});

	it('adds a generated local database URL to local API config only', () => {
		const local = resolveApiConfig({
			TREESEED_API_ENVIRONMENT: 'local',
			TREESEED_MARKET_LOCAL_POSTGRES_PORT: '55433',
		});
		expect(local.apiDatabaseUrl).toBe('postgres://treeseed:treeseed@127.0.0.1:55433/market_local');

		const hosted = resolveApiConfig({
			TREESEED_API_BASE_URL: 'https://api.example.com',
			TREESEED_API_ENVIRONMENT: 'prod',
		});
		expect(hosted.apiDatabaseUrl).toBeUndefined();
	});
});
