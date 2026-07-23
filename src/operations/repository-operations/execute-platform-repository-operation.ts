import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { serializeFrontmatterDocument, parseFrontmatterDocument } from '../../frontmatter.ts';
import {
	applyProjectLaunchHostBindingConfig,
	auditProjectLaunchHostBindingConfig,
	type ApplyProjectLaunchHostBindingConfigOptions,
} from '../services/template-host-bindings.ts';
import { PlatformRepositoryOperationInput, PlatformRepositoryOperationOptions, PlatformRepositoryOperationResult } from './exec-file-async.ts';
import { assertHostBindingChangedPaths, assertRepositoryWriteMode, changedPaths, changedPathsFromOutput, commitIfRequested, createDecisionFromGovernanceProposal, outputHref, runVerificationCommands } from './create-decision-from-governance-proposal.ts';
import { derivePlatformRepositoryKey, syncRepository } from './platform-repository-verification-error.ts';
import { createDecisionFromProposals, createRelatedContent, initializeLinkedRepository, writeContentRecord } from './initialize-linked-repository.ts';

export async function executePlatformRepositoryOperation(
	operation: 'write_content_record' | 'create_related_content' | 'create_decision_from_proposals' | 'create_decision_from_governance_proposal' | 'apply_host_binding_config' | 'audit_host_binding_config' | string,
	input: PlatformRepositoryOperationInput,
	options: PlatformRepositoryOperationOptions,
): Promise<PlatformRepositoryOperationResult> {
	if (!input.repository?.cloneUrl || !input.repository.name) {
		throw new Error('Repository operation requires a repository descriptor with name and cloneUrl.');
	}
	assertRepositoryWriteMode(input, options);
	const { repoPath, branch: baseBranch } = await syncRepository(input.repository, options.workspaceRoot);
	let output: Record<string, unknown>;
	if (operation === 'write_content_record') {
		const collection = String(input.collection ?? '');
		const record = await writeContentRecord(repoPath, collection, {
			...(input.payload ?? {}),
			projectId: input.projectId,
			teamId: input.teamId,
			createdBy: input.createdBy,
		}, input.normalized);
		output = { record };
	} else if (operation === 'create_related_content') {
		output = await createRelatedContent(repoPath, input);
	} else if (operation === 'create_decision_from_proposals') {
		output = await createDecisionFromProposals(repoPath, input);
	} else if (operation === 'create_decision_from_governance_proposal') {
		output = await createDecisionFromGovernanceProposal(repoPath, input);
	} else if (operation === 'apply_host_binding_config') {
		const hostBindingConfig = applyProjectLaunchHostBindingConfig({
			projectRoot: repoPath,
			hostBindings: input.hostBindings,
			hostBindingPlans: input.hostBindingPlans,
			launchInput: input.launchInput,
			derived: input.derived,
		});
		output = {
			hostBindingConfig,
			changedPaths: hostBindingConfig.targets,
		};
	} else if (operation === 'audit_host_binding_config') {
		const hostBindingAudit = auditProjectLaunchHostBindingConfig({
			projectRoot: repoPath,
			hostBindings: input.hostBindings,
			hostBindingPlans: input.hostBindingPlans,
			launchInput: input.launchInput,
			derived: input.derived,
		});
		output = {
			hostBindingAudit,
			changedPaths: [],
		};
	} else if (operation === 'initialize_linked_repository') {
		output = await initializeLinkedRepository(repoPath, input);
	} else {
		throw new Error(`Unsupported repository operation "${operation}".`);
	}
	const gitChanged = await changedPaths(repoPath);
	const changed = gitChanged.length > 0 ? gitChanged : changedPathsFromOutput(output);
	if (operation === 'apply_host_binding_config' || operation === 'audit_host_binding_config') {
		assertHostBindingChangedPaths(changed);
	}
	const verification = await runVerificationCommands(repoPath, input.repository);
	const commit = await commitIfRequested(repoPath, input.repository, input, changed);
	return {
		ok: true,
		operation,
		repository: {
			key: derivePlatformRepositoryKey(input.repository),
			provider: input.repository.provider ?? 'git',
			owner: input.repository.owner ?? null,
			name: input.repository.name,
			cloneUrl: input.repository.cloneUrl,
		},
		baseBranch,
		repositoryPath: repoPath,
		workspacePath: options.workspaceRoot,
		href: outputHref(output),
		branch: commit.branch ?? baseBranch,
		operationBranch: commit.branch,
		commitSha: commit.commitSha,
		changedPaths: changed,
		verification,
		pullRequest: null,
		workflowRun: null,
		output,
	};
}
