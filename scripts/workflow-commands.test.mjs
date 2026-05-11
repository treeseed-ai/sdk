import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	deployTargetLabel,
	loadDeployState,
} from '../dist/scripts/deploy-lib.js';
import { renderDeployProcessingWorkflow, renderDeployWebWorkflow } from '../dist/operations/services/github-automation.js';
import { incrementVersion } from '../dist/scripts/workspace-save-lib.js';
import { makeTenantRoot } from './cli-test-fixtures.mjs';

test('persistent and branch targets produce distinct labels', () => {
	assert.equal(deployTargetLabel(createPersistentDeployTarget('staging')), 'staging');
	assert.equal(deployTargetLabel(createBranchPreviewDeployTarget('feature/one')), 'branch:feature/one');
});

test('branch preview state derives branch-specific worker names', () => {
	const tenantRoot = makeTenantRoot();
	const deployConfig = {
		cloudflare: { accountId: 'fixture-cloudflare-account-id', workerName: 'treeseed-working-site' },
	};
	const state = loadDeployState(tenantRoot, deployConfig, { target: createBranchPreviewDeployTarget('feature/preview') });
	assert.match(state.workerName, /^treeseed-working-site-feature-preview/);
	assert.equal(state.previewEnabled, true);
});

test('deploy workflows expose final web and processing actions', () => {
	const webWorkflow = renderDeployWebWorkflow({ workingDirectory: '.' });
	const processingWorkflow = renderDeployProcessingWorkflow({ workingDirectory: '.' });
	assert.match(webWorkflow, /default: deploy_web/);
	assert.match(webWorkflow, /- publish_content/);
	assert.doesNotMatch(webWorkflow, /RAILWAY_API_TOKEN/);
	assert.match(processingWorkflow, /default: deploy_processing/);
	assert.match(processingWorkflow, /RAILWAY_API_TOKEN/);
	assert.match(processingWorkflow, /TREESEED_CAPACITY_PROVIDER_ID/);
});

test('version bump utility supports major, minor, and patch', () => {
	assert.equal(incrementVersion('1.2.3', 'patch'), '1.2.4');
	assert.equal(incrementVersion('1.2.3', 'minor'), '1.3.0');
	assert.equal(incrementVersion('1.2.3', 'major'), '2.0.0');
});
