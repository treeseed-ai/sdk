
import { WorkflowRecommendation, WorkflowState } from './branch-role.ts';

export function recommendNextSteps(state: WorkflowState): WorkflowRecommendation[] {
	const recommendations: WorkflowRecommendation[] = [];
	if (!state.workspaceRoot) {
		return [{ operation: 'status', reason: 'Run this from inside a Treeseed workspace so the project root can be resolved.' }];
	}
	if (!state.deployConfigPresent) {
		return [{ operation: 'init', reason: 'Create a new Treeseed tenant before configuring or releasing anything.', input: { directory: '<directory>' } }];
	}
	if (!state.files.machineConfig) {
		recommendations.push({ operation: 'status', reason: 'Validate tooling, auth, and repository readiness first.' });
		recommendations.push({ operation: 'config', reason: 'Bootstrap the local machine config and injected runtime environment.' });
		return recommendations;
	}
	if (!state.secrets.wrappedKeyPresent || state.secrets.migrationRequired) {
		recommendations.push({
			operation: state.secrets.migrationRequired ? 'secrets:migrate-key' : 'secrets:unlock',
			reason: state.secrets.migrationRequired
				? 'Wrap the local machine key before running secret-backed commands.'
				: 'Create and unlock the local wrapped machine key before running secret-backed commands.',
		});
		return recommendations;
	}
	if (state.workflowControl.interruptedRuns.length > 0) {
		recommendations.push({
			operation: 'resume',
			reason: 'Resume the most recent interrupted workflow run before making new branch changes.',
			input: { runId: state.workflowControl.interruptedRuns[0].runId },
		});
		recommendations.push({ operation: 'recover', reason: 'Inspect active workflow locks and interrupted runs.' });
		return recommendations.slice(0, 3);
	}
	if (state.workflowControl.lock.active && state.workflowControl.lock.runId) {
		recommendations.push({ operation: 'recover', reason: 'Inspect the active workflow lock before starting another mutating command.' });
		return recommendations.slice(0, 3);
	}
	if (state.branchRole === 'feature') {
		if (state.packageSync.mode === 'recursive-workspace' && state.packageSync.blockers.length > 0 && state.branchName) {
			recommendations.push({
				operation: 'switch',
				reason: 'Realign the checked-out package repos to the current task branch before continuing.',
				input: { branch: state.branchName },
			});
		}
		recommendations.push({ operation: 'stage', reason: 'Merge this task branch into staging and clean up branch artifacts.', input: { message: 'describe the resolution' } });
		recommendations.push({ operation: 'save', reason: 'Persist, verify, and push the current task branch before or independently of staging it.', input: { message: 'describe your change' } });
		if (state.preview.enabled && state.branchName) {
			recommendations.push({ operation: 'save', reason: 'Save refreshes the branch preview deployment when one is enabled.', input: { message: 'describe your change', preview: true } });
		} else {
			recommendations.push({ operation: 'dev', reason: 'Use the local environment for iterative work on this feature branch.' });
		}
		recommendations.push({ operation: 'close', reason: 'Archive this task without merging if it should be abandoned.', input: { message: 'reason' } });
		return recommendations.slice(0, 3);
	}
	if (state.branchRole === 'staging') {
		if (state.packageSync.mode === 'recursive-workspace' && state.packageSync.warnings.length > 0 && state.branchName) {
			recommendations.push({
				operation: 'release',
				reason: 'Reattach repairable package repos automatically before continuing the release.',
				input: { bump: 'patch' },
			});
		}
		if (state.packageSync.mode === 'recursive-workspace' && state.packageSync.blockers.length > 0 && state.branchName) {
			recommendations.push({
				operation: 'switch',
				reason: 'Realign the checked-out package repos to staging before releasing.',
				input: { branch: state.branchName },
			});
		}
		if (!state.persistentEnvironments.staging.initialized) {
			recommendations.push({ operation: 'config', reason: 'Initialize the staging environment before releasing.', input: { environment: ['staging'] } });
		} else if ((state.releaseHistory.unreleasedStagingCommits ?? 0) > 0) {
			recommendations.push({ operation: 'release', reason: 'Promote unreleased staging commits into production.', input: { bump: 'patch' } });
			if (state.managedServices.api.enabled) {
				recommendations.push({ operation: 'auth:login', reason: 'Keep the local runtime authenticated to the remote API used by managed services.' });
			}
		} else {
			recommendations.push({ operation: 'status', reason: 'Inspect staging and production state; no unreleased staging commits are pending.' });
			if (state.managedServices.api.enabled) {
				recommendations.push({ operation: 'auth:login', reason: 'Keep the local runtime authenticated to the remote API used by managed services.' });
			}
		}
		return recommendations.slice(0, 3);
	}
	if (state.branchRole === 'main') {
		if (state.dirtyWorktree) {
			recommendations.push({ operation: 'save', reason: 'Only explicit hotfix saves are allowed on main.', input: { message: 'describe the hotfix', hotfix: true } });
		} else if (!state.persistentEnvironments.prod.initialized) {
			recommendations.push({ operation: 'config', reason: 'Initialize production before a release requires it.', input: { environment: ['prod'] } });
		} else {
			recommendations.push({ operation: 'status', reason: 'Inspect production state and release readiness.' });
			recommendations.push({ operation: 'rollback', reason: 'Roll back production to the previous recorded deployment if needed.', input: { environment: 'prod' } });
		}
		return recommendations.slice(0, 3);
	}
	recommendations.push({ operation: 'dev', reason: 'Start the local Treeseed development environment.' });
	recommendations.push({ operation: 'switch', reason: 'Create a task branch from the latest staging commit.', input: { branch: 'feature/my-change' } });
	return recommendations.slice(0, 3);
}
