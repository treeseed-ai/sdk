import { describe, expect, it } from 'vitest';
import { parseDeployConfig } from '../../../../src/platform/deploy-config/parse-deploy-config.ts';

const base = `name: Control Plane Test
slug: control-plane-test
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare: { accountId: account-test }
`;

describe('control-plane deployment configuration', () => {
	it('defaults to a managed customer control plane without a Market profile', () => {
		const config = parseDeployConfig(base);
		expect(config.authority).toEqual({ kind: 'customer-platform' });
		expect(config.controlPlane).toEqual({ mode: 'managed', baseUrl: undefined });
		expect('market' in config).toBe(false);
	});

	it('accepts an explicit external control-plane server', () => {
		const config = parseDeployConfig(`${base}controlPlane:\n  mode: external\n  baseUrl: https://control.example.com/\n`);
		expect(config.controlPlane).toEqual({ mode: 'external', baseUrl: 'https://control.example.com/' });
	});

	it('rejects an external control plane without a server URL', () => {
		expect(() => parseDeployConfig(`${base}controlPlane:\n  mode: external\n`)).toThrow(/baseUrl/u);
	});

	it('rejects removed Market services and pass-through modes', () => {
		expect(() => parseDeployConfig(`${base}services:\n  marketApi: { enabled: true, provider: railway }\n`)).toThrow(/Market service/u);
		expect(() => parseDeployConfig(`${base}controlPlane:\n  mode: market-passthrough\n`)).toThrow();
	});
});
