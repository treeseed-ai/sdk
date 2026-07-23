import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../../scripts/tenant-workflow-action.ts';

describe('tenant workflow action arguments', () => {
	it('parses final plane-aware workflow actions', () => {
		expect(parseArgs(['--action', 'deploy_web', '--environment', 'staging'])).toMatchObject({
			action: 'deploy_web',
			environment: 'staging',
		});

		expect(() => parseArgs(['--action', 'deploy_processing'])).toThrow(/Unsupported workflow action/u);
		expect(() => parseArgs(['--action', 'deploy_code'])).toThrow(/Unsupported workflow action/u);
	});
});
