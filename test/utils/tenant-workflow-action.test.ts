import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../scripts/tenant-workflow-action.ts';

describe('tenant workflow action arguments', () => {
	it('parses skip-provision without changing the deploy-code default', () => {
		expect(parseArgs(['--action', 'deploy_code', '--environment', 'staging'])).toMatchObject({
			action: 'deploy_code',
			environment: 'staging',
			skipProvision: false,
		});

		expect(parseArgs([
			'--action=deploy_code',
			'--environment=staging',
			'--project-id',
			'project-1',
			'--preview-id=preview-1',
			'--dry-run',
			'--skip-provision',
		])).toMatchObject({
			action: 'deploy_code',
			environment: 'staging',
			projectId: 'project-1',
			previewId: 'preview-1',
			dryRun: true,
			skipProvision: true,
		});
	});
});
