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
import { HostingAuditCheck, HostingAuditOptions, HostingAuditReport, nonEmptyEnvironmentValues, normalizeAuditValues, normalizeHostKinds, resolveHostingAuditTarget, serializeTarget } from './hosting-audit-environment.ts';
import { appendManualConfigChecks, appendRegistryConfigChecks, providerConnectionChecks, reconcileStatusChecks, reconcileSystemsForHostKinds } from './required-key-check.ts';

export async function checkSmtpReachability(values: Record<string, string | undefined>): Promise<HostingAuditCheck> {
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
		const finish = (check: HostingAuditCheck) => {
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

export function summarizeReport(checks: HostingAuditCheck[]) {
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

export async function runHostingAudit({
	tenantRoot,
	environment = 'current',
	repair = false,
	env = process.env,
	valuesOverlay = {},
	hostKinds: requestedHostKinds,
	providerConnectionChecks: shouldCheckProviderConnections = true,
	resourceChecks: shouldCheckResources = true,
	write,
}: HostingAuditOptions): Promise<HostingAuditReport> {
	const resolved = resolveHostingAuditTarget({ tenantRoot, environment });
	const hostKinds = normalizeHostKinds(requestedHostKinds);
	const deployConfig = loadPlatformConfig({ tenantRoot, environment: resolved.scope, env }).deployConfig;
	const seedValues = collectConfigSeedValues(tenantRoot, resolved.scope, env, valuesOverlay);
	const suggestedValues = getEnvironmentSuggestedValues({
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
	const checks: HostingAuditCheck[] = [];

	appendManualConfigChecks(checks, values, hostKinds);
	appendRegistryConfigChecks({ checks, tenantRoot, scope: resolved.scope, values, hostKinds });

	if (shouldCheckProviderConnections) {
		const connectionReport = await checkProviderConnections({
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
			const beforeStatus = await collectReconcileStatus({
				tenantRoot,
				target: resolved.target,
				env: values,
				systems,
			});
			let repairedIds = new Set<string>();
			if (repair && beforeStatus.ready !== true) {
				write?.('[audit][hosting] Repair mode enabled; reconciling platform provider resources.');
				const repairResult = await reconcileTarget({
					tenantRoot,
					target: resolved.target,
					env: values,
					systems,
					write,
				});
				repaired = repairResult.results.some((result) => result.action !== 'none');
				const afterStatus = await collectReconcileStatus({
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
