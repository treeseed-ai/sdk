import { mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { WorkflowSdk } from '../../../../src/operations/workflow.ts';
import { writeGovernedExecutionAuthority } from '../../../../src/operations/agents/execution-authority-receipt.ts';
import { stageCandidateAttestationBlockers } from '../../../../src/workflow/operations.ts';
import { repositoryIdentityKey } from '../../../../src/repositories/repository-identity.ts';
import { createWorkflowRepo,git,workflowFor } from './workflow-lifecycle.support.ts';

describe('treeseed workflow lifecycle: governance receipts', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-workflow-home-')));
		vi.stubEnv('TREESEED_STAGE_WAIT_MODE', 'skip');
		vi.stubEnv('TREESEED_COMMIT_MESSAGE_PROVIDER', 'fallback');
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
		vi.stubEnv('TREESEED_GIT_DEPENDENCY_SMOKE', 'skip');
		vi.stubEnv('TREESEED_COMMAND_READINESS_MODE', 'skip');
		vi.stubEnv('TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE', 'skip');
		vi.stubEnv('GIT_ALLOW_PROTOCOL', 'file:ssh:https:http:git');
	});
	afterEach(() => vi.unstubAllEnvs());

	it('revalidates governed changes and hashes the evidence into the stage candidate', async () => {
		const { work } = createWorkflowRepo();
		const remote = git(work, ['remote', 'get-url', 'origin']);
		const commit = git(work, ['rev-parse', 'HEAD']);
		const authority = writeGovernedExecutionAuthority(work, {
			teamId: 'team-a', projectId: 'project-a', proposalId: 'proposal-a', proposalVersion: 1, proposalContentHash: 'hash-a', decisionId: 'decision-a',
			decisionDependencies: [{ projectId: 'project-b', decisionId: 'decision-b' }], assignmentId: 'assignment-a', graphId: 'graph-a', graphNodeId: 'node-a',
			deliverableManifestId: 'deliverable-a', deliverableContractId: 'contract-a', repository: { canonicalKey: repositoryIdentityKey(remote)!, remoteUrl: remote },
			sourceBranch: 'feature/demo-task', baseCommit: commit, checkpointCommit: commit, integratedCommit: commit, changedPaths: ['feature.txt'],
		}).receipt;
		await workflowFor(work).save({ message: 'chore: governed candidate', federated: true, verify: false, refreshPreview: false });
		const unavailable = await workflowFor(work).stage({ message: 'stage governed candidate', verifyMode: 'none', async: true, plan: true });
		expect(unavailable.payload.blockers).toContain('The integration receipt contains governed execution, but no control-plane authority validator is configured.');

		const observed: string[] = [];
		const validated = await new WorkflowSdk({ cwd: work, write: () => {}, validateExecutionAuthorities: async (authorities) => {
			observed.push(...authorities.map((entry) => entry.authorityId));
			return authorities.map((entry) => ({ authorityId: entry.authorityId, valid: true, code: null, message: null }));
		} }).stage({ message: 'stage governed candidate', verifyMode: 'none', async: true, cleanupMode: 'manual' });
		expect(observed.length).toBeGreaterThanOrEqual(2);
		expect(observed.every((authorityId) => authorityId === authority.authorityId)).toBe(true);
		expect(validated.payload.manifest.governanceAuthority).toMatchObject({ status: 'passed', authorityIds: [authority.authorityId], blockers: [] });
		const candidatePath = resolve(work, '.treeseed', 'workflow', 'stage-candidates', 'latest.json');
		const alteredCandidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
		alteredCandidate.governanceAuthority.checkedAt = '2000-01-01T00:00:00.000Z';
		writeFileSync(candidatePath, `${JSON.stringify(alteredCandidate, null, 2)}\n`, 'utf8');
		expect(stageCandidateAttestationBlockers(work)).toContain('The staging candidate governance evidence or verification identity has been altered. Run `trsd stage` again.');
	}, 360000);

	it('rejects missing authority and post-authority path changes', async () => {
		const missing = createWorkflowRepo().work;
		writeFileSync(resolve(missing, 'feature.txt'), 'governed without authority\n', 'utf8');
		git(missing, ['add', 'feature.txt']);
		git(missing, ['commit', '-m', 'feat: unbound checkpoint', '-m', 'Treeseed-Assignment: missing-authority']);
		await expect(workflowFor(missing).save({ message: 'save unbound checkpoint', federated: true, verify: false, refreshPreview: false })).rejects.toThrow(/has no matching governed execution authority/u);

		const altered = createWorkflowRepo().work;
		const base = git(altered, ['rev-parse', 'HEAD']);
		writeFileSync(resolve(altered, 'feature.txt'), 'authorized version\n', 'utf8');
		git(altered, ['add', 'feature.txt']);
		git(altered, ['commit', '-m', 'feat: authorized checkpoint', '-m', 'Treeseed-Assignment: assignment-altered']);
		const checkpoint = git(altered, ['rev-parse', 'HEAD']);
		const remote = git(altered, ['remote', 'get-url', 'origin']);
		writeGovernedExecutionAuthority(altered, {
			teamId: 'team-a', projectId: 'project-a', proposalId: 'proposal-a', proposalVersion: 1, proposalContentHash: 'hash-a', decisionId: 'decision-a', decisionDependencies: [],
			assignmentId: 'assignment-altered', graphId: 'graph-a', graphNodeId: 'node-a', deliverableManifestId: 'deliverable-a', deliverableContractId: 'contract-a',
			repository: { canonicalKey: repositoryIdentityKey(remote)!, remoteUrl: remote }, sourceBranch: 'feature/demo-task', baseCommit: base,
			checkpointCommit: checkpoint, integratedCommit: checkpoint, changedPaths: ['feature.txt'],
		});
		writeFileSync(resolve(altered, 'feature.txt'), 'unauthorized later version\n', 'utf8');
		git(altered, ['add', 'feature.txt']);
		git(altered, ['commit', '-m', 'fix: alter governed path']);
		await expect(workflowFor(altered).save({ message: 'save altered checkpoint', federated: true, verify: false, refreshPreview: false })).rejects.toThrow(/changed after authority commit/u);
	}, 360000);

	it('rejects source changes in a verified workset without project-scoped authority', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true, materialization: 'workset' });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "ungoverned-workset";\n', 'utf8');

		await expect(workflowFor(work).save({ message: 'save ungoverned workset', federated: true, verify: false, refreshPreview: false }))
			.rejects.toThrow(/has source changes but no authority rooted at its exact inventory commit/u);
	}, 360000);
});
