import { describe, expect, it } from 'vitest';
import { resolveApiConfig } from '../../src/api/config.ts';

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
});
