import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { resolveLaunchEnvironment } from '../../operations/services/configuration/config-runtime.ts';
import { cloudflareApiRequest, resolveCloudflareZoneIdForHost, resolveConfiguredCloudflareAccountId, runWrangler } from '../../operations/services/hosting/deployment/deploy.ts';
import type {
	ApplicationHostingProfile,
	HostAdapter,
	HostAdapterOperationInput,
	HostAdapterOperationResult,
	HostCapability,
	HostingEnvironment,
	HostingStatus,
	HostingUnit,
	HostingUnitPlan,
	HostingVerification,
	ServicePlacement,
	ServiceTypeAdapter,
} from '../contracts.ts';
import { ALL_ENVIRONMENTS, PROVIDER_ENVIRONMENTS, cloudflarePagesBranchName, cloudflarePagesBuildCommand, cloudflarePagesBuildOutputDir, cloudflarePagesDeploymentUrl, cloudflarePagesDomain, cloudflarePagesProjectName, createReconcilerOwnedHostAdapter, reconcilerOwnedStatus } from './all-environments.ts';
import { cloudflarePagesDnsTarget, cloudflarePagesDomainName, observeCloudflarePagesDeployment, observeCloudflarePagesDns, observeCloudflarePagesDomain, observeCloudflarePagesProject, probeCloudflarePagesPublicUrl } from './probe-cloudflare-pages-public-url.ts';

export function createCloudflareHostAdapter(): HostAdapter {
	const base = createReconcilerOwnedHostAdapter('cloudflare', 'Cloudflare', [
		'web-site',
		'object-store',
		'database',
		'dns',
		'domain',
		'secret',
		'variable',
		'deployment',
		'health',
	], PROVIDER_ENVIRONMENTS);
	const isPagesSite = (input: HostAdapterOperationInput) => input.unit.serviceType.id === 'web-site';
	return {
		...base,
		refresh(input) {
			if (!isPagesSite(input)) return base.refresh(input);
			const projectName = cloudflarePagesProjectName(input);
			const project = projectName ? observeCloudflarePagesProject(input, projectName) : null;
			const domain = cloudflarePagesDomain(input);
			const branchName = cloudflarePagesBranchName(input);
			const observedDomain = projectName ? observeCloudflarePagesDomain(input, projectName, domain) : null;
			const observedDns = projectName ? observeCloudflarePagesDns(input, projectName, branchName, domain) : null;
			const observedDeployment = projectName ? observeCloudflarePagesDeployment(input, projectName, branchName) : null;
			const domainReady = !domain || Boolean(observedDomain && observedDns);
			const deploymentReady = Boolean(observedDeployment);
			return {
				status: projectName && project?.name === projectName && domainReady && deploymentReady ? 'ready' : (projectName ? 'pending' : 'blocked'),
				locators: {
					hostId: input.unit.host.id,
					projectGroupId: input.unit.projectGroup?.id ?? null,
					projectName,
					domain,
					pagesDevUrl: projectName ? cloudflarePagesDeploymentUrl(projectName, branchName, input.environment) : null,
				},
				state: {
					unitId: input.unit.id,
					serviceType: input.unit.serviceType.id,
					placement: input.unit.placement,
					projectName,
					branchName,
					observedProjectName: project?.name ?? null,
					observedDomain: cloudflarePagesDomainName(observedDomain),
					observedDnsRecord: observedDns ? {
						name: observedDns.name ?? null,
						type: observedDns.type ?? null,
						content: observedDns.content ?? null,
						proxied: observedDns.proxied ?? null,
					} : null,
					observedDeployment: observedDeployment ? {
						id: observedDeployment.Id ?? observedDeployment.id ?? null,
						branch: observedDeployment.Branch ?? observedDeployment.branch ?? null,
						deployment: observedDeployment.Deployment ?? observedDeployment.url ?? null,
					} : null,
					buildOutputDir: cloudflarePagesBuildOutputDir(input),
					buildCommand: cloudflarePagesBuildCommand(input),
				},
				warnings: projectName ? [] : ['Cloudflare Pages projectName is missing.'],
			};
			},
			apply(input) {
				if (!isPagesSite(input)) return base.apply(input);
				return {
					...reconcilerOwnedStatus(input),
					status: 'blocked',
					warnings: [
						'Cloudflare Pages mutation is reconciler-owned. Use trsd hosting apply or trsd reconcile apply so the Cloudflare reconcile adapter performs apply, refresh, verify, and persist.',
					],
				};
			},
		verify(input) {
			if (!isPagesSite(input)) return base.verify(input);
			if (input.planOnly) return base.verify(input);
			const projectName = cloudflarePagesProjectName(input);
			const branchName = projectName ? cloudflarePagesBranchName(input) : null;
			const domain = cloudflarePagesDomain(input);
			const observed = input.observed;
			const observedState = observed.state && typeof observed.state === 'object' ? observed.state as Record<string, any> : {};
			const observedProjectName = observedState.observedProjectName ?? observedState.projectName ?? null;
			const observedDomain = observedState.observedDomain ?? null;
			const observedDnsRecord = observedState.observedDnsRecord ?? null;
			const observedDeployment = observedState.observedDeployment ?? null;
			const publicUrl = domain ? `https://${domain}` : (projectName && branchName ? cloudflarePagesDeploymentUrl(projectName, branchName, input.environment) : null);
			const publicProbe = input.environment === 'prod' ? probeCloudflarePagesPublicUrl(publicUrl) : null;
			const checks = [
				{
					key: 'pages-project.exists',
					label: 'Cloudflare Pages project exists',
					ok: Boolean(projectName && observedProjectName === projectName),
					expected: projectName,
					observed: observedProjectName,
					issues: projectName && observedProjectName === projectName ? [] : [`Cloudflare Pages project ${projectName ?? '(unset)'} was not observed.`],
				},
				{
					key: 'pages-deployment.exists',
					label: 'Cloudflare Pages branch deployment exists',
					ok: Boolean(observedDeployment),
					expected: branchName,
					observed: observedDeployment,
					issues: observedDeployment ? [] : [`Cloudflare Pages project ${projectName ?? '(unset)'} has no deployment for branch ${branchName ?? '(unset)'}.`],
				},
				{
					key: 'pages-domain.exists',
					label: 'Cloudflare Pages custom domain is attached',
					ok: !domain || observedDomain === domain,
					expected: domain,
					observed: observedDomain,
					issues: !domain || observedDomain === domain ? [] : [`Cloudflare Pages custom domain ${domain} is not attached to project ${projectName ?? '(unset)'}.`],
				},
				{
					key: 'pages-dns.exists',
					label: 'Cloudflare DNS record points to the Pages branch',
					ok: !domain || Boolean(observedDnsRecord),
					expected: domain && projectName && branchName ? {
						name: domain,
						type: 'CNAME',
						content: cloudflarePagesDnsTarget(projectName, branchName, input.environment),
						proxied: true,
					} : null,
					observed: observedDnsRecord,
					issues: !domain || observedDnsRecord ? [] : [`Cloudflare DNS record ${domain} -> ${projectName && branchName ? cloudflarePagesDnsTarget(projectName, branchName, input.environment) : '(unset)'} is missing.`],
				},
			];
			if (input.environment === 'prod') {
				checks.push({
					key: 'pages-public-url.ok',
					label: 'Cloudflare Pages public URL responds successfully',
					ok: publicProbe?.ok === true,
					expected: { url: publicUrl, ok: true },
					observed: publicProbe,
					issues: publicProbe?.ok === true
						? []
						: [`Cloudflare Pages public URL ${publicUrl ?? '(unset)'} did not return a successful status.`],
				});
			}
			return {
				unitId: input.unit.id,
				status: checks.every((check) => check.ok) ? 'ready' : 'pending',
				verified: checks.every((check) => check.ok),
				checks,
				warnings: [],
			};
		},
		status(input) {
			return isPagesSite(input) ? this.refresh(input) : base.status(input);
		},
	};
}

export function createDefaultHostAdapters(): Record<string, HostAdapter> {
	return {
		railway: createReconcilerOwnedHostAdapter('railway', 'Railway', [
			'project',
			'environment',
			'container',
			'volume',
			'database',
			'domain',
			'secret',
			'variable',
			'deployment',
			'scheduled-job',
			'health',
			'logs',
		], PROVIDER_ENVIRONMENTS),
		cloudflare: createCloudflareHostAdapter(),
		github: createReconcilerOwnedHostAdapter('github', 'GitHub', [
			'source-repository',
			'workflow',
			'secret',
			'variable',
			'health',
		], PROVIDER_ENVIRONMENTS),
		smtp: createReconcilerOwnedHostAdapter('smtp', 'SMTP', [
			'email-relay',
			'secret',
			'health',
		], ALL_ENVIRONMENTS),
		'local-process': createReconcilerOwnedHostAdapter('local-process', 'Local process', [
			'process',
			'web-site',
			'container',
			'variable',
			'deployment',
			'health',
			'logs',
			'port',
			'hot-reload',
		], ['local']),
		'local-docker': createReconcilerOwnedHostAdapter('local-docker', 'Local Docker', [
			'container',
			'volume',
			'database',
			'object-store',
			'secret',
			'variable',
			'deployment',
			'health',
			'logs',
		], ['local']),
	};
}

export function serviceType(
	id: string,
	label: string,
	placement: ServicePlacement,
	requiredCapabilities: HostCapability[],
	defaultHostByEnvironment: Partial<Record<HostingEnvironment, string>>,
	composes: string[] = [],
): ServiceTypeAdapter {
	return {
		id,
		label,
		placement,
		requiredCapabilities,
		defaultHostByEnvironment,
		composes,
		describe(unit) {
			return `${label} on ${unit.host.label}`;
		},
	};
}
