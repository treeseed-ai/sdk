import { describe,expect,it } from 'vitest';
import { apiLicensePolicyPaths } from '../../../src/seeds/licensing/portfolio-license.js';

describe('portfolio license policy', () => {
	it('reconciles the complete API dual-license and one-time committer contract', () => {
		expect(apiLicensePolicyPaths).toEqual([
			'COMMERCIAL.md',
			'CONTRIBUTING.md',
			'.github/PULL_REQUEST_TEMPLATE.md',
			'.github/approved-committers.json',
			'.github/COMMITTER_APPROVAL.md',
			'.github/ISSUE_TEMPLATE/agpl-committer-approval.yml',
			'.github/workflows/agpl-committer-authorization.yml',
			'docs/licensing-provenance.md',
		]);
	});
});
