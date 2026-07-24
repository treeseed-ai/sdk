import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	deployTargetLabel,
	loadDeployState,
} from '../../../../src/operations/services/hosting/deployment/deploy.ts';
import { renderDeployWebWorkflow } from '../../../../src/operations/services/repositories/github-automation.ts';
import { incrementVersion } from '../../../../src/operations/services/treedx/workspaces/workspace-save.ts';
import { makeTenantRoot } from '../../../../scripts/testing/cli-test-fixtures.ts';

test('persistent and branch targets produce distinct labels', () => {
	assert.equal(deployTargetLabel(createPersistentDeployTarget('staging')), 'staging');
	assert.equal(deployTargetLabel(createBranchPreviewDeployTarget('feature/one')), 'branch:feature/one');
});

test('branch preview state derives branch-specific worker names', () => {
	const tenantRoot = makeTenantRoot();
	const deployConfig = {
		cloudflare: { accountId: 'fixture-cloudflare-account-id', workerName: 'treeseed-working-site' },
		hosting: { teamId: 'fixture-team', projectId: 'working-site' },
	};
	const state = loadDeployState(tenantRoot, deployConfig, { target: createBranchPreviewDeployTarget('feature/preview') });
	assert.match(state.workerName, /^treeseed-working-site-feature-preview/);
	assert.equal(state.previewEnabled, true);
});

test('deploy workflow exposes final web actions only', () => {
	const webWorkflow = renderDeployWebWorkflow({ workingDirectory: '.' });
	assert.match(webWorkflow, /default: deploy_web/);
	assert.match(webWorkflow, /- publish_content/);
	assert.doesNotMatch(webWorkflow, /RAILWAY_API_TOKEN/);
	assert.doesNotMatch(webWorkflow, /deploy_processing/);
});

test('version bump utility supports major, minor, and patch', () => {
	assert.equal(incrementVersion('1.2.3', 'patch'), '1.2.4');
	assert.equal(incrementVersion('1.2.3', 'minor'), '1.3.0');
	assert.equal(incrementVersion('1.2.3', 'major'), '2.0.0');
});
