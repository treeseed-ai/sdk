import { describe,expect,it } from 'vitest';
import { apiLicensePolicyPaths } from '../../../src/seeds/licensing/portfolio-license.js';

describe('portfolio license policy', () => {
	it('reconciles the complete API dual-license and contributor-grant contract', () => {
		expect(apiLicensePolicyPaths).toEqual([
			'COMMERCIAL.md',
			'CONTRIBUTING.md',
			'.github/PULL_REQUEST_TEMPLATE.md',
			'.github/workflows/contributor-license.yml',
			'docs/licensing-provenance.md',
		]);
	});
});
