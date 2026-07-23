import net from 'node:net';
import tls from 'node:tls';
import {
	getTreeseedEnvironmentSuggestedValues,
	type TreeseedEnvironmentScope,
	validateTreeseedEnvironmentValues,
} from '../../../platform/environment.ts';
import {
	collectTreeseedConfigSeedValues,
	collectTreeseedEnvironmentContext,
	checkTreeseedProviderConnections,
} from '../config-runtime.ts';
import {
	buildProvisioningSummary,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
} from '../deploy.ts';
import {
	currentManagedBranch,
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from '../git-workflow.ts';
import { loadTreeseedPlatformConfig } from '../../../platform/config.ts';
import {
	collectTreeseedReconcileStatus,
	reconcileTreeseedTarget,
	type TreeseedRunnableBootstrapSystem,
} from '../../../reconcile/index.ts';
import type { TreeseedReconcileTarget } from '../../../reconcile/contracts.ts';
import { providerConnectionChecks } from './required-key-check.ts';

export type TreeseedHostingAuditEnvironment = 'current' | 'local' | 'staging' | 'prod';

export type TreeseedHostingAuditResolvedEnvironment = 'local' | 'staging' | 'prod' | 'preview';

export type TreeseedHostingAuditHostKind = 'repository' | 'web' | 'email';

export type TreeseedHostingAuditCheckStatus = 'passed' | 'warning' | 'failed' | 'skipped' | 'repaired';

export type TreeseedHostingAuditSeverity = 'info' | 'warning' | 'critical';

export type TreeseedHostingAuditCheck = {
	id: string;
	hostType: TreeseedHostingAuditHostKind | 'platform';
	provider: string;
	category: 'config' | 'identity' | 'resource' | 'connectivity' | 'repair' | 'security';
	status: TreeseedHostingAuditCheckStatus;
	severity: TreeseedHostingAuditSeverity;
	summary: string;
	detail?: string;
	resourceRef?: string;
	repairAvailable?: boolean;
	repaired?: boolean;
	remediation?: string;
};

export type TreeseedHostingAuditReport = {
	ok: boolean;
	environment: TreeseedHostingAuditResolvedEnvironment;
	requestedEnvironment: TreeseedHostingAuditEnvironment;
	repairMode: boolean;
	repaired: boolean;
	target: {
		kind: TreeseedReconcileTarget['kind'];
		scope?: string;
		branchName?: string;
		label: string;
	};
	hostKinds: TreeseedHostingAuditHostKind[];
	checkedAt: string;
	checks: TreeseedHostingAuditCheck[];
	missingConfig: Array<{
		key: string;
		hostType: TreeseedHostingAuditHostKind | 'platform';
		severity: TreeseedHostingAuditSeverity;
		summary: string;
	}>;
	resources: Record<string, unknown>;
	warnings: string[];
	blockers: string[];
	nextActions: string[];
};

export type TreeseedHostingAuditOptions = {
	tenantRoot: string;
	environment?: TreeseedHostingAuditEnvironment;
	repair?: boolean;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	valuesOverlay?: Record<string, string | undefined>;
	hostKinds?: TreeseedHostingAuditHostKind[];
	providerConnectionChecks?: boolean;
	resourceChecks?: boolean;
	write?: (line: string) => void;
};

export const HOST_KINDS: TreeseedHostingAuditHostKind[] = ['repository', 'web', 'email'];

export const HOST_GROUPS: Record<TreeseedHostingAuditHostKind, Set<string>> = {
	repository: new Set(['auth', 'github']),
	web: new Set(['cloudflare', 'hosting']),
	email: new Set(['smtp']),
};

export function hasValue(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0;
}

export function firstValue(values: Record<string, string | undefined>, keys: string[]) {
	for (const key of keys) {
		const value = values[key];
		if (hasValue(value)) {
			return value;
		}
	}
	return undefined;
}

export function nonEmptyEnvironmentValues(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	return Object.fromEntries(
		Object.entries(env)
			.filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
			.map(([key, value]) => [key, String(value)]),
	);
}

export function normalizeHostKinds(hostKinds?: TreeseedHostingAuditHostKind[]) {
	const selected = Array.isArray(hostKinds) && hostKinds.length > 0 ? hostKinds : HOST_KINDS;
	const normalized = selected
		.map((kind) => String(kind).trim())
		.filter((kind): kind is TreeseedHostingAuditHostKind => HOST_KINDS.includes(kind as TreeseedHostingAuditHostKind));
	return normalized.length > 0 ? [...new Set(normalized)] : HOST_KINDS;
}

export function targetLabel(target: TreeseedReconcileTarget) {
	return target.kind === 'branch' ? `preview:${target.branchName}` : target.scope;
}

export function serializeTarget(target: TreeseedReconcileTarget) {
	return {
		kind: target.kind,
		...(target.kind === 'branch' ? { branchName: target.branchName } : { scope: target.scope }),
		label: targetLabel(target),
	};
}

export function resolveTreeseedHostingAuditTarget({
	tenantRoot,
	environment = 'current',
}: {
	tenantRoot: string;
	environment?: TreeseedHostingAuditEnvironment;
}): {
	environment: TreeseedHostingAuditResolvedEnvironment;
	scope: TreeseedEnvironmentScope;
	target: TreeseedReconcileTarget;
	branchName: string | null;
} {
	if (environment === 'local') {
		return {
			environment: 'local',
			scope: 'local',
			target: createPersistentDeployTarget('staging'),
			branchName: null,
		};
	}
	if (environment === 'staging') {
		return {
			environment: 'staging',
			scope: 'staging',
			target: createPersistentDeployTarget('staging'),
			branchName: null,
		};
	}
	if (environment === 'prod') {
		return {
			environment: 'prod',
			scope: 'prod',
			target: createPersistentDeployTarget('prod'),
			branchName: null,
		};
	}

	const branchName = currentManagedBranch(tenantRoot);
	if (branchName === PRODUCTION_BRANCH) {
		return {
			environment: 'prod',
			scope: 'prod',
			target: createPersistentDeployTarget('prod'),
			branchName,
		};
	}
	if (branchName === STAGING_BRANCH) {
		return {
			environment: 'staging',
			scope: 'staging',
			target: createPersistentDeployTarget('staging'),
			branchName,
		};
	}
	if (branchName) {
		try {
			const deployConfig = loadTreeseedPlatformConfig({ tenantRoot, environment: 'staging', env: process.env }).deployConfig;
			const previewTarget = createBranchPreviewDeployTarget(branchName);
			const previewState = loadDeployState(tenantRoot, deployConfig, { target: previewTarget });
			if (
				previewState?.previewEnabled === true
				|| previewState?.readiness?.initialized === true
				|| hasValue(previewState?.lastDeployedUrl)
				|| hasValue(previewState?.workerName)
			) {
				return {
					environment: 'preview',
					scope: 'staging',
					target: previewTarget,
					branchName,
				};
			}
		} catch {
			// Fall through to staging readiness when preview state is not available yet.
		}
	}
	return {
		environment: 'staging',
		scope: 'staging',
		target: createPersistentDeployTarget('staging'),
		branchName,
	};
}

export function normalizeAuditValues(values: Record<string, string | undefined>) {
	const normalized = { ...values };
	const githubToken = normalized.TREESEED_HOSTED_HUBS_GITHUB_TOKEN;
	if (githubToken) {
		normalized.GH_TOKEN = githubToken;
		normalized.GITHUB_TOKEN = githubToken;
	}
	const cloudflareToken = normalized.CLOUDFLARE_API_TOKEN;
	if (cloudflareToken) {
		normalized.CLOUDFLARE_API_TOKEN = cloudflareToken;
	}
	const cloudflareAccount = normalized.CLOUDFLARE_ACCOUNT_ID;
	if (cloudflareAccount) {
		normalized.CLOUDFLARE_ACCOUNT_ID = cloudflareAccount;
	}
	const railwayToken = normalized.RAILWAY_API_TOKEN;
	if (railwayToken) {
		normalized.RAILWAY_API_TOKEN = railwayToken;
	}
	const railwayWorkspace = normalized.TREESEED_RAILWAY_WORKSPACE;
	if (railwayWorkspace) {
		normalized.TREESEED_RAILWAY_WORKSPACE = railwayWorkspace;
	}
	return normalized;
}

export function configCheck({
	id,
	hostType,
	provider,
	status,
	severity,
	summary,
	detail,
	remediation,
}: {
	id: string;
	hostType: TreeseedHostingAuditCheck['hostType'];
	provider: string;
	status: TreeseedHostingAuditCheckStatus;
	severity: TreeseedHostingAuditSeverity;
	summary: string;
	detail?: string;
	remediation?: string;
}): TreeseedHostingAuditCheck {
	return {
		id,
		hostType,
		provider,
		category: 'config',
		status,
		severity,
		summary,
		...(detail ? { detail } : {}),
		...(remediation ? { remediation } : {}),
	};
}
