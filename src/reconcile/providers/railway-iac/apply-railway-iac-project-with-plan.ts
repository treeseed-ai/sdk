import { rmSync } from 'node:fs';
import {
runRailwayIac,
type RailwayIacApplyResponse,
type RailwayIacPlanResponse
} from 'railway/iac';
import { railwayIacApplyFailure,RailwayIacProjectInput,RailwayIacRenderResult } from './railway-iac-service.ts';
import { renderRailwayIacProject } from './resolve-railway-iac-volume-bindings.ts';
import { runRailwayIacWithRateLimitRetry } from './run-railway-iac-with-rate-limit-retry.ts';
import { commitAndVerifyRailwayStagedPatch,planRailwayIacProject,railwayIacClient,railwayPatchForPlan,railwayStagedPatchMatchesPlan,readRailwayStagedPatch } from './validate-railway-iac-change-set.ts';

export async function applyRailwayIacProjectWithPlan(
	input: RailwayIacProjectInput,
	rendered = renderRailwayIacProject(input),
	planned?: RailwayIacPlanResponse,
): Promise<RailwayIacApplyResponse> {
	const client = railwayIacClient(input);
	const pendingBeforeApply = await readRailwayStagedPatch(input);
	if (pendingBeforeApply) {
		const effectivePlan = planned ?? await planRailwayIacProject(input, rendered);
		const expectedPatch = railwayPatchForPlan(effectivePlan);
		if (!effectivePlan.ok || !expectedPatch) {
			throw new Error(`Railway environment ${input.environmentName} has pending staged patch ${pendingBeforeApply.id}, but TreeSeed could not compile a validated replacement patch.`);
		}
		let patchToCommit = pendingBeforeApply;
		if (!railwayStagedPatchMatchesPlan(pendingBeforeApply, effectivePlan)) {
			const staged = await runRailwayIacWithRateLimitRetry(() => client.stageEnvironmentChanges({
				environmentId: input.environmentId,
				patch: expectedPatch,
				merge: false,
			}));
			const replaced = await readRailwayStagedPatch(input);
			if (!replaced || replaced.id !== staged.id || !railwayStagedPatchMatchesPlan(replaced, effectivePlan)) {
				throw new Error(`Railway environment ${input.environmentName} did not retain the exact TreeSeed replacement for stale patch ${pendingBeforeApply.id}.`);
			}
			patchToCommit = replaced;
		}
		await commitAndVerifyRailwayStagedPatch(client, input, patchToCommit);
		return {
			...effectivePlan,
			command: 'apply',
			applyResult: {
				id: patchToCommit.id,
				status: 'APPLIED',
				changes: [],
				diagnostics: [],
			},
			stagedPatchId: patchToCommit.id,
		} as RailwayIacApplyResponse;
	}
	if (planned?.ok && (planned.changeSet?.changes ?? []).length === 0) {
		return {
			...planned,
			command: 'apply',
			applyResult: {
				status: 'APPLIED',
				changes: [],
				diagnostics: [],
			},
		} as RailwayIacApplyResponse;
	}

	const response = await runRailwayIacWithRateLimitRetry(() => runRailwayIac({
		command: 'apply',
		cwd: rendered.tempDir,
		file: rendered.filePath,
		backboard: {
			endpoint: input.railwayApiUrl?.trim() || undefined,
			token: input.railwayApiToken,
			authType: 'bearer',
			projectId: input.projectId,
			environmentId: input.environmentId,
			decryptVariables: false,
			merge: true,
		},
		}) as Promise<RailwayIacApplyResponse>, {
			onRetry: (attempt, delayMs, error) => process.stderr.write(`[trsd][railway][iac:retry] command=apply attempt=${attempt} waitMs=${delayMs} reason=${error instanceof Error ? error.message : String(error)}\n`),
			onWait: (attempt, remainingMs) => process.stderr.write(`[trsd][railway][iac:retry] command=apply attempt=${attempt} cooldownRemainingMs=${remainingMs}\n`),
		});
	if (railwayIacApplyFailure(response)) return response;
	const pendingAfterApply = await readRailwayStagedPatch(input);
	if (pendingAfterApply) {
		if (response.stagedPatchId && response.stagedPatchId !== pendingAfterApply.id) {
			throw new Error(`Railway apply returned staged patch ${response.stagedPatchId}, but live Railway reports ${pendingAfterApply.id}.`);
		}
		await commitAndVerifyRailwayStagedPatch(client, input, pendingAfterApply);
	}
	return response;
}

export function cleanupRailwayIacRender(rendered: Pick<RailwayIacRenderResult, 'tempDir'>) {
	rmSync(rendered.tempDir, { recursive: true, force: true });
}
