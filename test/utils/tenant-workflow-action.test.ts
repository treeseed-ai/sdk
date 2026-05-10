import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../scripts/tenant-workflow-action.ts';

describe('tenant workflow action arguments', () => {
	it('parses final plane-aware workflow actions', () => {
		expect(parseArgs(['--action', 'deploy_web', '--environment', 'staging'])).toMatchObject({
			action: 'deploy_web',
			environment: 'staging',
		});

		expect(parseArgs([
			'--action=deploy_processing',
			'--environment=staging',
			'--project-id',
			'project-1',
			'--preview-id=preview-1',
			'--dry-run',
		])).toMatchObject({
			action: 'deploy_processing',
			environment: 'staging',
			projectId: 'project-1',
			previewId: 'preview-1',
			dryRun: true,
		});

		expect(() => parseArgs(['--action', 'deploy_code'])).toThrow(/Unsupported workflow action/u);
	});
});
