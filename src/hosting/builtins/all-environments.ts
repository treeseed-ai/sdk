import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { resolveTreeseedLaunchEnvironment } from '../../operations/services/config-runtime.ts';
import { cloudflareApiRequest, resolveCloudflareZoneIdForHost, resolveConfiguredCloudflareAccountId, runWrangler } from '../../operations/services/deploy.ts';
import type {
	TreeseedApplicationHostingProfile,
	TreeseedHostAdapter,
	TreeseedHostAdapterOperationInput,
	TreeseedHostAdapterOperationResult,
	TreeseedHostCapability,
	TreeseedHostingEnvironment,
	TreeseedHostingStatus,
	TreeseedHostingUnit,
	TreeseedHostingUnitPlan,
	TreeseedHostingVerification,
	TreeseedServicePlacement,
	TreeseedServiceTypeAdapter,
} from '../contracts.ts';
import { serviceType } from './create-cloudflare-host-adapter.ts';
import { sanitizedUnitConfig } from './create-default-service-type-adapters.ts';

export const ALL_ENVIRONMENTS: TreeseedHostingEnvironment[] = ['local', 'staging', 'prod'];

export const PROVIDER_ENVIRONMENTS: TreeseedHostingEnvironment[] = ['staging', 'prod'];

export function capabilities(ids: TreeseedHostCapability[], environments: TreeseedHostingEnvironment[] = ALL_ENVIRONMENTS) {
	return ids.map((id) => ({ id, environments }));
}

export function reconcilerOwnedStatus(input: TreeseedHostAdapterOperationInput): TreeseedHostAdapterOperationResult {
	return {
		status: 'blocked',
		locators: {
			hostId: input.unit.host.id,
			projectGroupId: input.unit.projectGroup?.id ?? null,
		},
		state: {
			unitId: input.unit.id,
			serviceType: input.unit.serviceType.id,
			placement: input.unit.placement,
			planOnly: input.planOnly === true,
		},
		warnings: ['This hosting graph is descriptive only. Live provider state and mutation are owned by the canonical reconciliation adapter.'],
	};
}

export function reconcilerOwnedPlan(input: TreeseedHostAdapterOperationInput & { observed: TreeseedHostAdapterOperationResult }): TreeseedHostingUnitPlan {
	return {
		unitId: input.unit.id,
		action: 'blocked',
		reasons: ['Live provider planning is owned by the canonical reconciliation adapter.'],
		before: input.observed.state,
		after: sanitizedUnitConfig(input.unit),
		warnings: ['Use trsd reconcile plan to inspect authoritative provider state.'],
	};
}

export function defaultVerify(input: TreeseedHostAdapterOperationInput & { observed: TreeseedHostAdapterOperationResult }): TreeseedHostingVerification {
	const hostCapabilities = new Set(input.unit.host.capabilities
		.filter((capability) => capability.environments.includes(input.environment))
		.map((capability) => capability.id));
	const missing = input.unit.requiredCapabilities.filter((capability) => !hostCapabilities.has(capability));
	const checks: TreeseedHostingVerification['checks'] = [
		{
			key: 'host-capabilities',
			label: 'Host supports required capabilities',
			ok: missing.length === 0,
			expected: input.unit.requiredCapabilities,
			observed: [...hostCapabilities],
			issues: missing.map((capability) => `Missing host capability: ${capability}`),
		},
		{
			key: 'secrets-redacted',
			label: 'Secrets are represented by references only',
			ok: !JSON.stringify(input.unit.config).match(/(token|secret|password|key)\s*[:=]\s*[^",}]+/iu),
			expected: 'secretRefs',
			observed: input.unit.secretRefs,
			issues: [],
		},
	];
	if (
		input.unit.host.id === 'railway'
		&& input.environment === 'prod'
		&& unitConfig(input).sourceMode === 'image'
		&& input.unit.serviceType.id !== 'relational-database'
		&& unitConfig(input).resourceType !== 'postgres'
	) {
		const imageRef = unitConfig(input).imageRef;
		const hasImageRef = typeof imageRef === 'string' && imageRef.trim().length > 0;
		checks.push({
			key: 'railway-image-ref',
			label: 'Production Railway service uses an immutable image reference',
			ok: hasImageRef,
			expected: unitConfig(input).imageRefEnv ? `${unitConfig(input).imageRefEnv}=<image>:<tag>` : '<image>:<tag>',
			observed: imageRef ?? null,
			issues: hasImageRef ? [] : [`Production Railway service ${unitConfig(input).serviceName ?? input.unit.id} is image-backed but no image reference was resolved.`],
		});
	}
	const verified = checks.every((check) => check.ok);
	return {
		unitId: input.unit.id,
		status: verified ? input.observed.status : 'blocked',
		verified,
		checks,
		warnings: [],
	};
}

export function createReconcilerOwnedHostAdapter(
	id: string,
	label: string,
	capabilityIds: TreeseedHostCapability[],
	environments: TreeseedHostingEnvironment[] = ALL_ENVIRONMENTS,
): TreeseedHostAdapter {
	return {
		id,
		label,
		capabilities: capabilities(capabilityIds, environments),
		refresh: reconcilerOwnedStatus,
		diff: reconcilerOwnedPlan,
		apply(input) {
			return {
				...reconcilerOwnedStatus(input),
				warnings: ['Provider mutation was not attempted. Use trsd reconcile apply.'],
			};
		},
		verify(input) {
			return {
				unitId: input.unit.id,
				status: 'blocked',
				verified: false,
				checks: [{
					key: 'canonical-reconciliation-required',
					label: 'Canonical reconciliation evidence is required',
					ok: false,
					expected: 'authoritative live provider observation',
					observed: input.observed.status,
					issues: ['The descriptive hosting graph cannot verify live provider state.'],
				}],
				warnings: ['Use trsd reconcile apply or trsd reconcile test-live for provider verification.'],
			};
		},
		status: reconcilerOwnedStatus,
	};
}

export function unitConfig(input: TreeseedHostAdapterOperationInput): Record<string, any> {
	return input.unit.config && typeof input.unit.config === 'object'
		? input.unit.config as Record<string, any>
		: {};
}

export function cloudflarePagesConfig(input: TreeseedHostAdapterOperationInput): Record<string, any> {
	return unitConfig(input).cloudflare?.pages && typeof unitConfig(input).cloudflare.pages === 'object'
		? unitConfig(input).cloudflare.pages as Record<string, any>
		: {};
}

export function cloudflarePagesProjectName(input: TreeseedHostAdapterOperationInput) {
	const pages = cloudflarePagesConfig(input);
	return typeof pages.projectName === 'string' && pages.projectName.trim()
		? pages.projectName.trim()
		: null;
}

export function cloudflarePagesBranchName(input: TreeseedHostAdapterOperationInput) {
	const pages = cloudflarePagesConfig(input);
	const key = input.environment === 'prod' ? 'productionBranch' : 'stagingBranch';
	const fallback = input.environment === 'prod' ? 'main' : 'staging';
	return typeof pages[key] === 'string' && pages[key].trim() ? pages[key].trim() : fallback;
}

export function cloudflarePagesBuildOutputDir(input: TreeseedHostAdapterOperationInput) {
	const pages = cloudflarePagesConfig(input);
	return typeof pages.buildOutputDir === 'string' && pages.buildOutputDir.trim()
		? pages.buildOutputDir.trim()
		: 'dist';
}

export function cloudflarePagesBuildCommand(input: TreeseedHostAdapterOperationInput) {
	const pages = cloudflarePagesConfig(input);
	return typeof pages.buildCommand === 'string' && pages.buildCommand.trim()
		? pages.buildCommand.trim()
		: null;
}

export function cloudflarePagesConfigRoot(input: TreeseedHostAdapterOperationInput): string {
	let current = resolve(input.graph.tenantRoot);
	while (true) {
		if (existsSync(resolve(current, '.treeseed', 'config', 'machine.yaml'))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return resolve(input.graph.tenantRoot);
		}
		current = parent;
	}
}

export function cloudflarePagesEnv(input: TreeseedHostAdapterOperationInput): Record<string, string> {
	const configRoot = cloudflarePagesConfigRoot(input);
	const resolvedValues = input.environment === 'local'
		? {}
		: resolveTreeseedLaunchEnvironment({
			tenantRoot: configRoot,
			scope: input.environment,
		});
	const accountId = [
		process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID,
		resolvedValues.CLOUDFLARE_ACCOUNT_ID,
		resolveConfiguredCloudflareAccountId(input.graph.deployConfig),
	].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
	const token = [
		process.env.TREESEED_CLOUDFLARE_API_TOKEN,
		resolvedValues.CLOUDFLARE_API_TOKEN,
	].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
	return {
		...resolvedValues,
		CLOUDFLARE_ACCOUNT_ID: accountId,
		CLOUDFLARE_API_TOKEN: token,
	};
}

export function cloudflarePagesDomain(input: TreeseedHostAdapterOperationInput) {
	const config = unitConfig(input);
	return typeof config.domain === 'string' && config.domain.trim()
		? config.domain.trim()
		: null;
}

export function cloudflarePagesDeploymentUrl(projectName: string, branchName: string, environment: TreeseedHostingEnvironment) {
	return environment === 'prod'
		? `https://${projectName}.pages.dev`
		: `https://${branchName}.${projectName}.pages.dev`;
}
