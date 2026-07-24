import net from 'node:net';
import tls from 'node:tls';
import {
	getEnvironmentSuggestedValues,
	type EnvironmentScope,
	validateEnvironmentValues,
} from '../../../platform/configuration/environment.ts';
import {
	collectConfigSeedValues,
	collectEnvironmentContext,
	checkProviderConnections,
} from '../configuration/config-runtime.ts';
import {
	buildProvisioningSummary,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
} from '../hosting/deployment/deploy.ts';
import {
	currentManagedBranch,
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from '../operations/git-workflow.ts';
import { loadPlatformConfig } from '../../../platform/configuration/config.ts';
import {
	collectReconcileStatus,
	reconcileTarget,
	type RunnableBootstrapSystem,
} from '../../../reconcile/index.ts';
import type { ReconcileTarget } from '../../../reconcile/support/contracts/contracts.ts';
import { providerConnectionChecks } from './required-key-check.ts';

export type HostingAuditEnvironment = 'current' | 'local' | 'staging' | 'prod';

export type HostingAuditResolvedEnvironment = 'local' | 'staging' | 'prod' | 'preview';

export type HostingAuditHostKind = 'repository' | 'web' | 'email';

export type HostingAuditCheckStatus = 'passed' | 'warning' | 'failed' | 'skipped' | 'repaired';

export type HostingAuditSeverity = 'info' | 'warning' | 'critical';

export type HostingAuditCheck = {
	id: string;
	hostType: HostingAuditHostKind | 'platform';
	provider: string;
	category: 'config' | 'identity' | 'resource' | 'connectivity' | 'repair' | 'security';
	status: HostingAuditCheckStatus;
	severity: HostingAuditSeverity;
	summary: string;
	detail?: string;
	resourceRef?: string;
	repairAvailable?: boolean;
	repaired?: boolean;
	remediation?: string;
};

export type HostingAuditReport = {
	ok: boolean;
	environment: HostingAuditResolvedEnvironment;
	requestedEnvironment: HostingAuditEnvironment;
	repairMode: boolean;
	repaired: boolean;
	target: {
		kind: ReconcileTarget['kind'];
		scope?: string;
		branchName?: string;
		label: string;
	};
	hostKinds: HostingAuditHostKind[];
	checkedAt: string;
	checks: HostingAuditCheck[];
	missingConfig: Array<{
		key: string;
		hostType: HostingAuditHostKind | 'platform';
		severity: HostingAuditSeverity;
		summary: string;
	}>;
	resources: Record<string, unknown>;
	warnings: string[];
	blockers: string[];
	nextActions: string[];
};

export type HostingAuditOptions = {
	tenantRoot: string;
	environment?: HostingAuditEnvironment;
	repair?: boolean;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	valuesOverlay?: Record<string, string | undefined>;
	hostKinds?: HostingAuditHostKind[];
	providerConnectionChecks?: boolean;
	resourceChecks?: boolean;
	write?: (line: string) => void;
};

export const HOST_KINDS: HostingAuditHostKind[] = ['repository', 'web', 'email'];

export const HOST_GROUPS: Record<HostingAuditHostKind, Set<string>> = {
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

export function normalizeHostKinds(hostKinds?: HostingAuditHostKind[]) {
	const selected = Array.isArray(hostKinds) && hostKinds.length > 0 ? hostKinds : HOST_KINDS;
	const normalized = selected
		.map((kind) => String(kind).trim())
		.filter((kind): kind is HostingAuditHostKind => HOST_KINDS.includes(kind as HostingAuditHostKind));
	return normalized.length > 0 ? [...new Set(normalized)] : HOST_KINDS;
}

export function targetLabel(target: ReconcileTarget) {
	return target.kind === 'branch' ? `preview:${target.branchName}` : target.scope;
}

export function serializeTarget(target: ReconcileTarget) {
	return {
		kind: target.kind,
		...(target.kind === 'branch' ? { branchName: target.branchName } : { scope: target.scope }),
		label: targetLabel(target),
	};
}

export function resolveHostingAuditTarget({
	tenantRoot,
	environment = 'current',
}: {
	tenantRoot: string;
	environment?: HostingAuditEnvironment;
}): {
	environment: HostingAuditResolvedEnvironment;
	scope: EnvironmentScope;
	target: ReconcileTarget;
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
			const deployConfig = loadPlatformConfig({ tenantRoot, environment: 'staging', env: process.env }).deployConfig;
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
	hostType: HostingAuditCheck['hostType'];
	provider: string;
	status: HostingAuditCheckStatus;
	severity: HostingAuditSeverity;
	summary: string;
	detail?: string;
	remediation?: string;
}): HostingAuditCheck {
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
