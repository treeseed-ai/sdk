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
import { HOST_GROUPS, HostingAuditCheck, HostingAuditHostKind, configCheck, firstValue } from './hosting-audit-environment.ts';

export function requiredKeyCheck(
	checks: HostingAuditCheck[],
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
		hostType: HostingAuditHostKind;
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

export function appendManualConfigChecks(
	checks: HostingAuditCheck[],
	values: Record<string, string | undefined>,
	hostKinds: HostingAuditHostKind[],
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

export function appendRegistryConfigChecks({
	checks,
	tenantRoot,
	scope,
	values,
	hostKinds,
}: {
	checks: HostingAuditCheck[];
	tenantRoot: string;
	scope: EnvironmentScope;
	values: Record<string, string | undefined>;
	hostKinds: HostingAuditHostKind[];
}) {
	const registry = collectEnvironmentContext(tenantRoot);
	const selectedGroups = new Set(hostKinds.flatMap((kind) => [...HOST_GROUPS[kind]]));
	const validation = validateEnvironmentValues({
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

export function providerConnectionChecks(report: Awaited<ReturnType<typeof checkProviderConnections>>, hostKinds: HostingAuditHostKind[]) {
	const allowedProviders = new Set<string>();
	if (hostKinds.includes('repository')) allowedProviders.add('github');
	if (hostKinds.includes('web')) allowedProviders.add('cloudflare');
	return report.checks
		.filter((check) => allowedProviders.has(check.provider))
		.map((check): HostingAuditCheck => {
				const hostType: HostingAuditHostKind =
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

export function reconcileSystemsForHostKinds(hostKinds: HostingAuditHostKind[]) {
	const systems = new Set<RunnableBootstrapSystem>();
	if (hostKinds.includes('repository')) systems.add('github');
	if (hostKinds.includes('web')) {
		systems.add('data');
		systems.add('web');
	}
	return [...systems];
}

export function reconcileStatusChecks(status: Awaited<ReturnType<typeof collectReconcileStatus>>, repairedIds = new Set<string>()) {
	const checks: HostingAuditCheck[] = [];
	for (const unit of status.units) {
			const hostType: HostingAuditHostKind =
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
