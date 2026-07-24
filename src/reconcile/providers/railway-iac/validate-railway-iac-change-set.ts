import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	changeSetToEnvironmentPatch,
	IacClient,
	runRailwayIac,
	type RailwayChangeSet,
	type RailwayIacApplyResponse,
	type RailwayIacPlanResponse,
	type ResourceNode,
} from 'railway/iac';
import { railwayGraphqlRequest } from '../../../operations/services/hosting/railway/railway-api.ts';
import { assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService } from '../../../operations/services/hosting/railway/railway-source-policy.ts';
import { RailwayIacValidationResult, RailwayIacProjectInput } from './railway-iac-service.ts';
import { changeName, isRailwayGitSourceChange, isRailwayImageSourceChange, isRailwaySourceChange, renderRailwayIacProject } from './resolve-railway-iac-volume-bindings.ts';
import { id, runRailwayIacWithRateLimitRetry } from './run-railway-iac-with-rate-limit-retry.ts';
import { applyRailwayIacProjectWithPlan } from './apply-railway-iac-project-with-plan.ts';

export function validateRailwayIacChangeSet(changeSet: RailwayChangeSet | undefined, desiredNames: {
	services: string[];
	volumes: string[];
	database: string | null;
	scope: string;
	serviceSourceModes?: Record<string, string | null | undefined>;
	serviceSourceRefs?: Record<string, string | null | undefined>;
	allowedResourceDeletions?: string[];
	protectedResourceNames?: string[];
}): RailwayIacValidationResult {
	const blockedReasons: string[] = [];
	const destructiveChanges: string[] = [];
	const desired = new Set([...desiredNames.services, ...desiredNames.volumes, ...(desiredNames.database ? [desiredNames.database] : [])]);
	const allowedResourceDeletions = new Set(desiredNames.allowedResourceDeletions ?? []);
	const protectedResourceNames = new Set(desiredNames.protectedResourceNames ?? []);
	const created = new Set((changeSet?.changes ?? [])
		.filter((change) => change.kind === 'resource.create')
		.map((change) => changeName(change)));
	for (const change of changeSet?.changes ?? []) {
		const name = changeName(change);
		const serviceName = name.replace(/^(service|database|volume)\./u, '');
		const sourceMode = desiredNames.serviceSourceModes?.[name]
			?? desiredNames.serviceSourceModes?.[serviceName]
			?? null;
		const sourceRef = desiredNames.serviceSourceRefs?.[name]
			?? desiredNames.serviceSourceRefs?.[serviceName]
			?? null;
		const sourceChanged = change.kind === 'resource.update' && isRailwaySourceChange(change);
		const imageSourceChange = sourceChanged && isRailwayImageSourceChange(change);
		const gitSourceChange = sourceChanged && isRailwayGitSourceChange(change);
		const desiredGitSource = sourceMode === 'git' && typeof sourceRef === 'string' && sourceRef.startsWith('github:');
		const desiredImageSource = sourceMode === 'image' && typeof sourceRef === 'string' && sourceRef.startsWith('image:');
		const apiPolicyService = isApiRailwaySourcePolicyService({ serviceName });
		if (protectedResourceNames.has(name) && (change.kind === 'resource.update' || change.kind === 'resource.delete')) {
			blockedReasons.push(`Railway IaC plan would ${change.kind === 'resource.delete' ? 'delete' : 'update'} sibling-environment resource ${name}.`);
		}
		if (change.kind === 'resource.delete') {
			destructiveChanges.push(change.summary);
			if (!allowedResourceDeletions.has(name) && !allowedResourceDeletions.has(serviceName)) {
				blockedReasons.push(`Railway IaC plan would delete resource ${name || change.summary}; hosting reconciliation only deletes explicitly recognized obsolete aliases. Use the explicit destroy workflow for other deletions.`);
			}
			if (desired.has(name) && !created.has(name)) {
				blockedReasons.push(`Railway IaC plan would delete desired resource ${name}.`);
			}
		}
		if (desiredNames.scope === 'staging' && sourceChanged && apiPolicyService && sourceMode === 'git' && !gitSourceChange && !desiredGitSource) {
			blockedReasons.push(`Railway IaC plan would change staging API resource ${name} source without confirming a GitHub source.`);
		}
		if (desiredNames.scope === 'staging' && sourceChanged && imageSourceChange && !(apiPolicyService && sourceMode === 'git' && (gitSourceChange || desiredGitSource))) {
			blockedReasons.push(`Railway IaC plan would switch staging resource ${name} to an image source.`);
		}
		if (desiredNames.scope === 'staging' && sourceChanged && (!sourceMode || sourceMode === 'image')) {
			blockedReasons.push(`Railway IaC plan would apply an image-backed desired source to staging resource ${name}.`);
		}
		if (desiredNames.scope === 'prod' && sourceChanged && apiPolicyService && sourceMode === 'image' && !imageSourceChange && !desiredImageSource) {
			blockedReasons.push(`Railway IaC plan would change production API resource ${name} source without confirming an image source.`);
		}
		if (desiredNames.scope === 'prod' && sourceChanged && gitSourceChange) {
			blockedReasons.push(`Railway IaC plan would switch production resource ${name} to a Git source.`);
		}
		if (desiredNames.scope === 'prod' && sourceChanged && (!sourceMode || sourceMode === 'git')) {
			blockedReasons.push(`Railway IaC plan would apply a Git-backed desired source to production resource ${name}.`);
		}
	}
	return {
		ok: blockedReasons.length === 0,
		destructiveChanges,
		blockedReasons,
		allowedDrift: [],
	};
}

export async function planRailwayIacProject(input: RailwayIacProjectInput, rendered = renderRailwayIacProject(input)): Promise<RailwayIacPlanResponse> {
	return runRailwayIacWithRateLimitRetry(() => runRailwayIac({
		command: 'plan',
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
		}) as Promise<RailwayIacPlanResponse>, {
			onRetry: (attempt, delayMs, error) => process.stderr.write(`[trsd][railway][iac:retry] command=plan attempt=${attempt} waitMs=${delayMs} reason=${error instanceof Error ? error.message : String(error)}\n`),
			onWait: (attempt, remainingMs) => process.stderr.write(`[trsd][railway][iac:retry] command=plan attempt=${attempt} cooldownRemainingMs=${remainingMs}\n`),
		});
}

export async function applyRailwayIacProject(input: RailwayIacProjectInput, rendered = renderRailwayIacProject(input)): Promise<RailwayIacApplyResponse> {
	return applyRailwayIacProjectWithPlan(input, rendered);
}

export type RailwayStagedPatch = {
	id: string;
	status: string;
	patch: Record<string, unknown>;
} | null;

export function canonicalRailwayPatch(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalRailwayPatch);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([, entry]) => entry !== undefined)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => [key, canonicalRailwayPatch(entry)]));
}

export function railwayStagedPatchMatchesPlan(
	patch: NonNullable<RailwayStagedPatch>,
	plan: RailwayIacPlanResponse,
) {
	const expected = railwayPatchForPlan(plan);
	if (!expected) return false;
	return JSON.stringify(canonicalRailwayPatch(patch.patch)) === JSON.stringify(canonicalRailwayPatch(expected));
}

export function railwayPatchForPlan(plan: RailwayIacPlanResponse) {
	if (!plan.currentGraph || !plan.currentConfig || !plan.changeSet) return null;
	return changeSetToEnvironmentPatch({
		currentGraph: plan.currentGraph,
		currentConfig: plan.currentConfig,
		changeSet: plan.changeSet,
	});
}

export function railwayIacClient(input: RailwayIacProjectInput) {
	return new IacClient({
		token: input.railwayApiToken,
		authType: 'bearer',
		...(input.railwayApiUrl?.trim() ? { graphqlEndpoint: input.railwayApiUrl.trim() } : {}),
	});
}

export async function readRailwayStagedPatch(input: RailwayIacProjectInput) {
	return runRailwayIacWithRateLimitRetry(async () => {
		const response = await railwayGraphqlRequest<{
			environmentStagedChanges: RailwayStagedPatch;
		}>({
			query: `query TreeseedRailwayStagedPatch($environmentId: String!) {
				environmentStagedChanges(environmentId: $environmentId) {
					id
					status
					patch(decryptVariables: true)
				}
			}`,
			variables: { environmentId: input.environmentId },
			apiToken: input.railwayApiToken,
			apiUrl: input.railwayApiUrl?.trim() || undefined,
			retries: 0,
		});
		const staged = response.data.environmentStagedChanges;
		const id = String(staged?.id ?? '').trim();
		return !id || id === '<empty>' ? null : staged;
	});
}

export async function commitAndVerifyRailwayStagedPatch(
	client: IacClient,
	input: RailwayIacProjectInput,
	patch: NonNullable<RailwayStagedPatch>,
	{
		attempts = 450,
		intervalMs = 2_000,
		sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
		skipDeploys = false,
	}: {
		attempts?: number;
		intervalMs?: number;
		sleep?: (milliseconds: number) => Promise<unknown>;
		skipDeploys?: boolean;
	} = {},
) {
	const commitResult = await runRailwayIacWithRateLimitRetry(() => client.commitStagedPatch({
		environmentId: input.environmentId,
		message: 'Apply TreeSeed reconciled Railway configuration',
		skipDeploys,
	}));
	if (typeof commitResult !== 'string' || !commitResult.trim()) {
		throw new Error(`Railway did not return a commit identifier for staged patch ${patch.id}.`);
	}
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const observed = await readRailwayStagedPatch(input);
		if (!observed) return;
		if (observed.id !== patch.id) {
			throw new Error(`Railway staged patch changed from ${patch.id} to ${observed.id} while TreeSeed was committing it.`);
		}
		if (attempt === 1 || attempt % Math.max(1, Math.round(15_000 / intervalMs)) === 0) {
			process.stderr.write(`[trsd][railway][iac:commit-settle] patch=${patch.id} status=${observed.status || 'unknown'} elapsedMs=${attempt * intervalMs}\n`);
		}
		if (attempt < attempts) await sleep(intervalMs);
	}
	throw new Error(`Railway staged patch ${patch.id} remained pending after it was committed.`);
}
