import net from 'node:net';
import tls from 'node:tls';
import {
	getTreeseedEnvironmentSuggestedValues,
	type TreeseedEnvironmentScope,
	validateTreeseedEnvironmentValues,
} from '../../platform/environment.ts';
import {
	collectTreeseedConfigSeedValues,
	collectTreeseedEnvironmentContext,
	checkTreeseedProviderConnections,
} from './config-runtime.ts';
import {
	buildProvisioningSummary,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
} from './deploy.ts';
import {
	currentManagedBranch,
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from './git-workflow.ts';
import { loadTreeseedPlatformConfig } from '../../platform/config.ts';
import {
	collectTreeseedReconcileStatus,
	reconcileTreeseedTarget,
	type TreeseedRunnableBootstrapSystem,
} from '../../reconcile/index.ts';
import type { TreeseedReconcileTarget } from '../../reconcile/contracts.ts';

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

const HOST_KINDS: TreeseedHostingAuditHostKind[] = ['repository', 'web', 'email'];
const HOST_GROUPS: Record<TreeseedHostingAuditHostKind, Set<string>> = {
	repository: new Set(['auth', 'github']),
	web: new Set(['cloudflare', 'hosting']),
	email: new Set(['smtp']),
};

function hasValue(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0;
}

function firstValue(values: Record<string, string | undefined>, keys: string[]) {
	for (const key of keys) {
		const value = values[key];
		if (hasValue(value)) {
			return value;
		}
	}
	return undefined;
}

function nonEmptyEnvironmentValues(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	return Object.fromEntries(
		Object.entries(env)
			.filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
			.map(([key, value]) => [key, String(value)]),
	);
}

function normalizeHostKinds(hostKinds?: TreeseedHostingAuditHostKind[]) {
	const selected = Array.isArray(hostKinds) && hostKinds.length > 0 ? hostKinds : HOST_KINDS;
	const normalized = selected
		.map((kind) => String(kind).trim())
		.filter((kind): kind is TreeseedHostingAuditHostKind => HOST_KINDS.includes(kind as TreeseedHostingAuditHostKind));
	return normalized.length > 0 ? [...new Set(normalized)] : HOST_KINDS;
}

function targetLabel(target: TreeseedReconcileTarget) {
	return target.kind === 'branch' ? `preview:${target.branchName}` : target.scope;
}

function serializeTarget(target: TreeseedReconcileTarget) {
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

function normalizeAuditValues(values: Record<string, string | undefined>) {
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

function configCheck({
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

function requiredKeyCheck(
	checks: TreeseedHostingAuditCheck[],
	values: Record<string, string | undefined>,
	{
		id,
		hostType,
		provider,
		keys,
		label,
		remediation,
	}: {
		id: string;
		hostType: TreeseedHostingAuditHostKind;
		provider: string;
		keys: string[];
		label: string;
		remediation: string;
	},
) {
	const configured = firstValue(values, keys);
	checks.push(configCheck({
		id,
		hostType,
		provider,
		status: configured ? 'passed' : 'failed',
		severity: configured ? 'info' : 'critical',
		summary: configured ? `${label} is configured.` : `${label} is missing.`,
		detail: configured ? undefined : `Expected one of: ${keys.join(', ')}.`,
		remediation,
	}));
}

function appendManualConfigChecks(
	checks: TreeseedHostingAuditCheck[],
	values: Record<string, string | undefined>,
	hostKinds: TreeseedHostingAuditHostKind[],
) {
	if (hostKinds.includes('repository')) {
		requiredKeyCheck(checks, values, {
			id: 'repository.github.owner',
			hostType: 'repository',
			provider: 'github',
			keys: ['TREESEED_HOSTED_HUBS_GITHUB_OWNER'],
			label: 'Repository owner or organization',
			remediation: 'Set TREESEED_HOSTED_HUBS_GITHUB_OWNER for TreeSeed-managed hosted repositories.',
		});
		requiredKeyCheck(checks, values, {
			id: 'repository.github.token',
			hostType: 'repository',
			provider: 'github',
			keys: ['TREESEED_HOSTED_HUBS_GITHUB_TOKEN'],
			label: 'Repository provider token',
			remediation: 'Set TREESEED_HOSTED_HUBS_GITHUB_TOKEN for TreeSeed-managed hosted repositories, or provide a team-owned Repository Host session.',
		});
	}
	if (hostKinds.includes('web')) {
		requiredKeyCheck(checks, values, {
			id: 'web.cloudflare.token',
			hostType: 'web',
			provider: 'cloudflare',
			keys: ['TREESEED_CLOUDFLARE_API_TOKEN'],
			label: 'Web provider token',
			remediation: 'Set TREESEED_CLOUDFLARE_API_TOKEN for TreeSeed-managed Web hosting.',
		});
		requiredKeyCheck(checks, values, {
			id: 'web.cloudflare.account',
			hostType: 'web',
			provider: 'cloudflare',
			keys: ['TREESEED_CLOUDFLARE_ACCOUNT_ID'],
			label: 'Web provider account',
			remediation: 'Set TREESEED_CLOUDFLARE_ACCOUNT_ID for TreeSeed-managed Web hosting.',
		});
	}
	if (hostKinds.includes('email')) {
		requiredKeyCheck(checks, values, {
			id: 'email.smtp.host',
			hostType: 'email',
			provider: 'smtp',
			keys: ['TREESEED_SMTP_HOST'],
			label: 'Email provider host',
			remediation: 'Set TREESEED_SMTP_HOST or configure a team-owned Email Host session.',
		});
		requiredKeyCheck(checks, values, {
			id: 'email.smtp.port',
			hostType: 'email',
			provider: 'smtp',
			keys: ['TREESEED_SMTP_PORT'],
			label: 'Email provider port',
			remediation: 'Set TREESEED_SMTP_PORT or configure a team-owned Email Host session.',
		});
		requiredKeyCheck(checks, values, {
			id: 'email.smtp.from',
			hostType: 'email',
			provider: 'smtp',
			keys: ['TREESEED_SMTP_FROM'],
			label: 'Email sender address',
			remediation: 'Set TREESEED_SMTP_FROM to a verified sender address.',
		});
	}
}

function appendRegistryConfigChecks({
	checks,
	tenantRoot,
	scope,
	values,
	hostKinds,
}: {
	checks: TreeseedHostingAuditCheck[];
	tenantRoot: string;
	scope: TreeseedEnvironmentScope;
	values: Record<string, string | undefined>;
	hostKinds: TreeseedHostingAuditHostKind[];
}) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const selectedGroups = new Set(hostKinds.flatMap((kind) => [...HOST_GROUPS[kind]]));
	const validation = validateTreeseedEnvironmentValues({
		values,
		scope,
		purpose: 'config',
		deployConfig: registry.context.deployConfig,
		tenantConfig: registry.context.tenantConfig,
		plugins: registry.context.plugins,
	});
	const selectedProblems = [...validation.missing, ...validation.invalid]
		.filter((problem) => selectedGroups.has(problem.entry.group));
	for (const problem of selectedProblems) {
		const hostType = hostKinds.find((kind) => HOST_GROUPS[kind].has(problem.entry.group)) ?? 'platform';
		checks.push(configCheck({
			id: `config.${problem.id}`,
			hostType,
			provider: problem.entry.group,
			status: 'failed',
			severity: problem.entry.requirement === 'optional' ? 'warning' : 'critical',
			summary: `${problem.label} is ${problem.reason}.`,
			detail: problem.message,
			remediation: problem.entry.howToGet,
		}));
	}
	if (selectedProblems.length === 0) {
		checks.push(configCheck({
			id: 'config.registry',
			hostType: 'platform',
			provider: 'treeseed',
			status: 'passed',
			severity: 'info',
			summary: 'Registered hosting environment values are complete.',
		}));
	}
}

function providerConnectionChecks(report: Awaited<ReturnType<typeof checkTreeseedProviderConnections>>, hostKinds: TreeseedHostingAuditHostKind[]) {
	const allowedProviders = new Set<string>();
	if (hostKinds.includes('repository')) allowedProviders.add('github');
	if (hostKinds.includes('web')) allowedProviders.add('cloudflare');
	return report.checks
		.filter((check) => allowedProviders.has(check.provider))
		.map((check): TreeseedHostingAuditCheck => {
				const hostType: TreeseedHostingAuditHostKind =
					check.provider === 'github' ? 'repository' : 'web';
			return {
				id: `identity.${check.provider}`,
				hostType,
				provider: check.provider,
				category: 'identity',
				status: check.ready ? 'passed' : check.skipped ? 'skipped' : 'failed',
				severity: check.ready || check.skipped ? 'info' : 'critical',
				summary: check.ready ? `${check.provider} identity check passed.` : check.skipped ? `${check.provider} identity check skipped.` : `${check.provider} identity check failed.`,
				detail: check.detail,
				repairAvailable: false,
				remediation: check.ready ? undefined : `Confirm ${check.provider} credentials and provider CLI access for this environment.`,
			};
		});
}

function reconcileSystemsForHostKinds(hostKinds: TreeseedHostingAuditHostKind[]) {
	const systems = new Set<TreeseedRunnableBootstrapSystem>();
	if (hostKinds.includes('repository')) systems.add('github');
	if (hostKinds.includes('web')) {
		systems.add('data');
		systems.add('web');
	}
	return [...systems];
}

function reconcileStatusChecks(status: Awaited<ReturnType<typeof collectTreeseedReconcileStatus>>, repairedIds = new Set<string>()) {
	const checks: TreeseedHostingAuditCheck[] = [];
	for (const unit of status.units) {
			const hostType: TreeseedHostingAuditHostKind =
				unit.provider === 'github'
					? 'repository'
					: 'web';
		const verified = unit.verification?.verified === true;
		const id = `resource.${unit.provider}.${unit.unitType}.${unit.unitId}`;
		const repaired = repairedIds.has(id);
		checks.push({
			id,
			hostType,
			provider: unit.provider,
			category: 'resource',
			status: repaired ? 'repaired' : verified ? 'passed' : 'failed',
			severity: verified || repaired ? 'info' : 'critical',
			summary: `${unit.provider}:${unit.unitType} ${verified || repaired ? 'is ready' : 'is not ready'}.`,
			detail: [
				unit.exists === false ? 'Resource is missing.' : null,
				unit.verification?.missing?.length ? `missing: ${unit.verification.missing.join(', ')}` : null,
				unit.verification?.drifted?.length ? `drifted: ${unit.verification.drifted.join(', ')}` : null,
				unit.warnings?.length ? `warnings: ${unit.warnings.join('; ')}` : null,
			].filter(Boolean).join(' ') || undefined,
			resourceRef: unit.locators?.length ? unit.locators.join(', ') : unit.unitId,
			repairAvailable: true,
			repaired,
			remediation: verified || repaired ? undefined : 'Run trsd audit hosting --repair to reconcile platform resources.',
		});
	}
	return checks;
}

async function checkSmtpReachability(values: Record<string, string | undefined>): Promise<TreeseedHostingAuditCheck> {
	const host = values.TREESEED_SMTP_HOST;
	const port = Number(values.TREESEED_SMTP_PORT ?? 0);
	const secure = /^(true|1|tls|ssl|465)$/iu.test(String(values.TREESEED_SMTP_SECURE ?? ''));
	if (!host || !Number.isFinite(port) || port <= 0) {
		return {
			id: 'connectivity.smtp',
			hostType: 'email',
			provider: 'smtp',
			category: 'connectivity',
			status: 'skipped',
			severity: 'warning',
			summary: 'Email connectivity check skipped.',
			detail: 'SMTP host and port are required before TreeSeed can test connectivity.',
			remediation: 'Configure SMTP host and port, then rerun the hosting audit.',
		};
	}
	return new Promise((resolve) => {
		const socket = secure
			? tls.connect({ host, port, servername: host, timeout: 5000 })
			: net.connect({ host, port, timeout: 5000 });
		let settled = false;
		const finish = (check: TreeseedHostingAuditCheck) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(check);
		};
		socket.once('connect', () => finish({
			id: 'connectivity.smtp',
			hostType: 'email',
			provider: 'smtp',
			category: 'connectivity',
			status: 'passed',
			severity: 'info',
			summary: 'Email provider accepts a TCP connection.',
			resourceRef: `${host}:${port}`,
		}));
		socket.once('secureConnect', () => finish({
			id: 'connectivity.smtp',
			hostType: 'email',
			provider: 'smtp',
			category: 'connectivity',
			status: 'passed',
			severity: 'info',
			summary: 'Email provider accepts a TLS connection.',
			resourceRef: `${host}:${port}`,
		}));
		socket.once('timeout', () => finish({
			id: 'connectivity.smtp',
			hostType: 'email',
			provider: 'smtp',
			category: 'connectivity',
			status: 'failed',
			severity: 'critical',
			summary: 'Email provider connection timed out.',
			resourceRef: `${host}:${port}`,
			remediation: 'Confirm SMTP host, port, firewall, and TLS mode.',
		}));
		socket.once('error', (error) => finish({
			id: 'connectivity.smtp',
			hostType: 'email',
			provider: 'smtp',
			category: 'connectivity',
			status: 'failed',
			severity: 'critical',
			summary: 'Email provider connection failed.',
			detail: error instanceof Error ? error.message : String(error),
			resourceRef: `${host}:${port}`,
			remediation: 'Confirm SMTP host, port, firewall, and TLS mode.',
		}));
	});
}

function summarizeReport(checks: TreeseedHostingAuditCheck[]) {
	const blockers = checks
		.filter((check) => check.status === 'failed' && check.severity === 'critical')
		.map((check) => check.detail ? `${check.summary} ${check.detail}` : check.summary);
	const warnings = checks
		.filter((check) => check.status === 'warning' || (check.status === 'failed' && check.severity === 'warning'))
		.map((check) => check.detail ? `${check.summary} ${check.detail}` : check.summary);
	const missingConfig = checks
		.filter((check) => check.category === 'config' && check.status === 'failed')
		.flatMap((check) => {
			const detail = check.detail ?? '';
			const match = detail.match(/Expected one of: ([^.]+)\./u);
			const keys = match?.[1]?.split(',').map((key) => key.trim()).filter(Boolean) ?? [];
			return keys.length > 0
				? keys.map((key) => ({
					key,
					hostType: check.hostType,
					severity: check.severity,
					summary: check.summary,
				}))
				: [{
					key: check.id.replace(/^config\./u, ''),
					hostType: check.hostType,
					severity: check.severity,
					summary: check.summary,
				}];
		});
	const nextActions = blockers.length > 0
		? [...new Set(checks
			.filter((check) => check.status === 'failed')
			.map((check) => check.remediation)
			.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
		: ['Hosting setup is ready for host saving and project launch.'];
	return { blockers, warnings, missingConfig, nextActions };
}

export async function runTreeseedHostingAudit({
	tenantRoot,
	environment = 'current',
	repair = false,
	env = process.env,
	valuesOverlay = {},
	hostKinds: requestedHostKinds,
	providerConnectionChecks: shouldCheckProviderConnections = true,
	resourceChecks: shouldCheckResources = true,
	write,
}: TreeseedHostingAuditOptions): Promise<TreeseedHostingAuditReport> {
	const resolved = resolveTreeseedHostingAuditTarget({ tenantRoot, environment });
	const hostKinds = normalizeHostKinds(requestedHostKinds);
	const deployConfig = loadTreeseedPlatformConfig({ tenantRoot, environment: resolved.scope, env }).deployConfig;
	const seedValues = collectTreeseedConfigSeedValues(tenantRoot, resolved.scope, env, valuesOverlay);
	const suggestedValues = getTreeseedEnvironmentSuggestedValues({
		scope: resolved.scope,
		purpose: 'config',
		deployConfig,
		values: {
			...seedValues,
			...nonEmptyEnvironmentValues(env),
			...nonEmptyEnvironmentValues(valuesOverlay),
		},
	});
	const values = normalizeAuditValues({
		...suggestedValues,
		...seedValues,
		...nonEmptyEnvironmentValues(env),
		...nonEmptyEnvironmentValues(valuesOverlay),
	});
	const checks: TreeseedHostingAuditCheck[] = [];

	appendManualConfigChecks(checks, values, hostKinds);
	appendRegistryConfigChecks({ checks, tenantRoot, scope: resolved.scope, values, hostKinds });

	if (shouldCheckProviderConnections) {
		const connectionReport = await checkTreeseedProviderConnections({
			tenantRoot,
			scope: resolved.scope,
			env: {
				...values,
				TREESEED_GITHUB_IDENTITY_MODE: 'account',
			},
			valuesOverlay: {
				...values,
				TREESEED_GITHUB_IDENTITY_MODE: 'account',
			},
		});
		checks.push(...providerConnectionChecks(connectionReport, hostKinds));
	}

	if (hostKinds.includes('email')) {
		checks.push(await checkSmtpReachability(values));
	}

	const systems = reconcileSystemsForHostKinds(hostKinds);
	let resources: Record<string, unknown> = {};
	let repaired = false;
	if (!shouldCheckResources) {
		checks.push({
			id: 'resources.skipped',
			hostType: 'platform',
			provider: 'treeseed',
			category: 'resource',
			status: 'skipped',
			severity: 'info',
			summary: 'Hosted provider resource checks are skipped for this audit.',
		});
	} else if (resolved.environment !== 'local' && systems.length > 0) {
		try {
			const state = loadDeployState(tenantRoot, deployConfig, { target: resolved.target });
			resources = buildProvisioningSummary(deployConfig, state, resolved.target) as Record<string, unknown>;
		} catch (error) {
			checks.push({
				id: 'resources.summary',
				hostType: 'platform',
				provider: 'treeseed',
				category: 'resource',
				status: 'warning',
				severity: 'warning',
				summary: 'Unable to load provisioning summary.',
				detail: error instanceof Error ? error.message : String(error),
			});
		}
		try {
			const beforeStatus = await collectTreeseedReconcileStatus({
				tenantRoot,
				target: resolved.target,
				env: values,
				systems,
			});
			let repairedIds = new Set<string>();
			if (repair && beforeStatus.ready !== true) {
				write?.('[audit][hosting] Repair mode enabled; reconciling platform provider resources.');
				const repairResult = await reconcileTreeseedTarget({
					tenantRoot,
					target: resolved.target,
					env: values,
					systems,
					write,
				});
				repaired = repairResult.results.some((result) => result.action !== 'none');
				const afterStatus = await collectTreeseedReconcileStatus({
					tenantRoot,
					target: resolved.target,
					env: values,
					systems,
				});
				repairedIds = new Set(afterStatus.units
					.filter((unit) => unit.verification?.verified === true)
					.map((unit) => `resource.${unit.provider}.${unit.unitType}.${unit.unitId}`));
				checks.push(...reconcileStatusChecks(afterStatus, repairedIds));
			} else {
				checks.push(...reconcileStatusChecks(beforeStatus));
			}
		} catch (error) {
			checks.push({
				id: 'resources.reconcile-status',
				hostType: 'platform',
				provider: 'treeseed',
				category: 'resource',
				status: 'failed',
				severity: 'critical',
				summary: repair ? 'Hosting resource repair failed.' : 'Hosting resource readiness check failed.',
				detail: error instanceof Error ? error.message : String(error),
				repairAvailable: !repair,
				remediation: repair ? 'Inspect provider credentials and rerun the audit.' : 'Run trsd audit hosting --repair after fixing provider credentials.',
			});
		}
	} else if (resolved.environment === 'local') {
		checks.push({
			id: 'resources.local',
			hostType: 'platform',
			provider: 'treeseed',
			category: 'resource',
			status: 'skipped',
			severity: 'info',
			summary: 'Hosted provider resource checks are skipped for local audits.',
		});
	}

	const summary = summarizeReport(checks);
	return {
		ok: summary.blockers.length === 0,
		environment: resolved.environment,
		requestedEnvironment: environment,
		repairMode: repair,
		repaired,
		target: serializeTarget(resolved.target),
		hostKinds,
		checkedAt: new Date().toISOString(),
		checks,
		missingConfig: summary.missingConfig,
		resources,
		warnings: summary.warnings,
		blockers: summary.blockers,
		nextActions: summary.nextActions,
	};
}

export function formatTreeseedHostingAuditReport(report: TreeseedHostingAuditReport) {
	const lines = [
		`Treeseed hosting audit (${report.environment}, ${report.repairMode ? 'repair' : 'read-only'})`,
		`Status: ${report.ok ? 'ready' : 'blocked'}`,
		`Target: ${report.target.label}`,
		'',
		'Checks:',
		...report.checks.map((check) => {
			const status = check.status.toUpperCase();
			const resource = check.resourceRef ? ` [${check.resourceRef}]` : '';
			const detail = check.detail ? ` ${check.detail}` : '';
			return `  - ${status} ${check.hostType}/${check.provider}/${check.category}: ${check.summary}${resource}${detail}`;
		}),
	];
	if (report.blockers.length > 0) {
		lines.push('', 'Blockers:', ...report.blockers.map((blocker) => `  - ${blocker}`));
	}
	if (report.warnings.length > 0) {
		lines.push('', 'Warnings:', ...report.warnings.map((warning) => `  - ${warning}`));
	}
	lines.push('', 'Next actions:', ...report.nextActions.map((action) => `  - ${action}`));
	return lines.join('\n');
}
