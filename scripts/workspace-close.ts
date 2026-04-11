#!/usr/bin/env node

import { applyTreeseedEnvironmentToProcess } from '../src/operations/services/config-runtime.ts';
import {
	cleanupDestroyedState,
	createBranchPreviewDeployTarget,
	destroyCloudflareResources,
	loadDeployState,
	printDestroySummary,
	validateDestroyPrerequisites,
} from '../src/operations/services/deploy.ts';
import {
	assertFeatureBranch,
	deleteLocalBranch,
	deleteRemoteBranch,
	mergeCurrentBranchIntoStaging,
} from '../src/operations/services/git-workflow.ts';
import { loadCliDeployConfig } from '../src/operations/services/runtime-tools.ts';
import { runWorkspaceSavePreflight } from '../src/operations/services/save-deploy-preflight.ts';

const tenantRoot = process.cwd();
const featureBranch = assertFeatureBranch(tenantRoot);
const previewTarget = createBranchPreviewDeployTarget(featureBranch);
const deployConfig = loadCliDeployConfig(tenantRoot);
const previewState = loadDeployState(tenantRoot, deployConfig, { target: previewTarget });

runWorkspaceSavePreflight({ cwd: tenantRoot });
const repoDir = mergeCurrentBranchIntoStaging(tenantRoot, featureBranch);

if (previewState.readiness?.initialized) {
	applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging', override: true });
	validateDestroyPrerequisites(tenantRoot, { requireRemote: true });
	const result = destroyCloudflareResources(tenantRoot, { target: previewTarget });
	printDestroySummary(result);
}

cleanupDestroyedState(tenantRoot, { target: previewTarget });
deleteRemoteBranch(repoDir, featureBranch);
deleteLocalBranch(repoDir, featureBranch);

console.log('Treeseed close completed successfully.');
console.log(`Merged ${featureBranch} into staging and removed branch artifacts.`);
