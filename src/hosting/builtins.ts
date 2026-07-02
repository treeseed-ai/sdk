import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveTreeseedLaunchEnvironment } from '../operations/services/config-runtime.ts';
import { cloudflareApiRequest, resolveCloudflareZoneIdForHost, resolveConfiguredCloudflareAccountId, runWrangler } from '../operations/services/deploy.ts';
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
} from './contracts.ts';

const ALL_ENVIRONMENTS: TreeseedHostingEnvironment[] = ['local', 'staging', 'prod'];
const PROVIDER_ENVIRONMENTS: TreeseedHostingEnvironment[] = ['staging', 'prod'];

function capabilities(ids: TreeseedHostCapability[], environments: TreeseedHostingEnvironment[] = ALL_ENVIRONMENTS) {
	return ids.map((id) => ({ id, environments }));
}

function syntheticStatus(input: TreeseedHostAdapterOperationInput): TreeseedHostAdapterOperationResult {
	return {
		status: 'pending',
		locators: {
			hostId: input.unit.host.id,
			projectGroupId: input.unit.projectGroup?.id ?? null,
		},
		state: {
			unitId: input.unit.id,
			serviceType: input.unit.serviceType.id,
			placement: input.unit.placement,
			dryRun: input.dryRun === true,
		},
		warnings: [],
	};
}

function defaultPlan(input: TreeseedHostAdapterOperationInput & { observed: TreeseedHostAdapterOperationResult }): TreeseedHostingUnitPlan {
	return {
		unitId: input.unit.id,
		action: input.observed.status === 'ready' ? 'noop' : 'create',
		reasons: input.observed.status === 'ready' ? ['unit already ready'] : ['unit is not yet recorded as ready by the hosting graph'],
		before: input.observed.state,
		after: sanitizedUnitConfig(input.unit),
		warnings: [],
	};
}

function defaultVerify(input: TreeseedHostAdapterOperationInput & { observed: TreeseedHostAdapterOperationResult }): TreeseedHostingVerification {
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
	if (input.unit.host.id === 'railway' && input.environment === 'prod' && unitConfig(input).sourceMode === 'image') {
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

function createSyntheticHostAdapter(
	id: string,
	label: string,
	capabilityIds: TreeseedHostCapability[],
	environments: TreeseedHostingEnvironment[] = ALL_ENVIRONMENTS,
): TreeseedHostAdapter {
	return {
		id,
		label,
		capabilities: capabilities(capabilityIds, environments),
		refresh: syntheticStatus,
		diff: defaultPlan,
		apply(input) {
			return {
				...syntheticStatus(input),
				status: input.dryRun ? 'pending' : 'ready',
				state: {
					...syntheticStatus(input).state,
					applied: input.dryRun !== true,
				},
			};
		},
		verify: defaultVerify,
		status: syntheticStatus,
	};
}

function unitConfig(input: TreeseedHostAdapterOperationInput): Record<string, any> {
	return input.unit.config && typeof input.unit.config === 'object'
		? input.unit.config as Record<string, any>
		: {};
}

function cloudflarePagesConfig(input: TreeseedHostAdapterOperationInput): Record<string, any> {
	return unitConfig(input).cloudflare?.pages && typeof unitConfig(input).cloudflare.pages === 'object'
		? unitConfig(input).cloudflare.pages as Record<string, any>
		: {};
}

function cloudflarePagesProjectName(input: TreeseedHostAdapterOperationInput) {
	const pages = cloudflarePagesConfig(input);
	return typeof pages.projectName === 'string' && pages.projectName.trim()
		? pages.projectName.trim()
		: null;
}

function cloudflarePagesBranchName(input: TreeseedHostAdapterOperationInput) {
	const pages = cloudflarePagesConfig(input);
	const key = input.environment === 'prod' ? 'productionBranch' : 'stagingBranch';
	const fallback = input.environment === 'prod' ? 'main' : 'staging';
	return typeof pages[key] === 'string' && pages[key].trim() ? pages[key].trim() : fallback;
}

function cloudflarePagesBuildOutputDir(input: TreeseedHostAdapterOperationInput) {
	const pages = cloudflarePagesConfig(input);
	return typeof pages.buildOutputDir === 'string' && pages.buildOutputDir.trim()
		? pages.buildOutputDir.trim()
		: 'dist';
}

function cloudflarePagesBuildCommand(input: TreeseedHostAdapterOperationInput) {
	const pages = cloudflarePagesConfig(input);
	return typeof pages.buildCommand === 'string' && pages.buildCommand.trim()
		? pages.buildCommand.trim()
		: null;
}

function cloudflarePagesConfigRoot(input: TreeseedHostAdapterOperationInput): string {
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

function cloudflarePagesEnv(input: TreeseedHostAdapterOperationInput): Record<string, string> {
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

function cloudflarePagesDomain(input: TreeseedHostAdapterOperationInput) {
	const config = unitConfig(input);
	return typeof config.domain === 'string' && config.domain.trim()
		? config.domain.trim()
		: null;
}

function cloudflarePagesDeploymentUrl(projectName: string, branchName: string, environment: TreeseedHostingEnvironment) {
	return environment === 'prod'
		? `https://${projectName}.pages.dev`
		: `https://${branchName}.${projectName}.pages.dev`;
}

function cloudflarePagesDnsTarget(projectName: string, branchName: string, environment: TreeseedHostingEnvironment) {
	return environment === 'prod'
		? `${projectName}.pages.dev`
		: `${branchName}.${projectName}.pages.dev`;
}

function cloudflarePagesDomainName(domain: any) {
	return typeof domain?.name === 'string' ? domain.name
		: typeof domain?.domain === 'string' ? domain.domain
			: typeof domain?.hostname === 'string' ? domain.hostname
				: '';
}

function listCloudflarePagesDomains(input: TreeseedHostAdapterOperationInput, projectName: string) {
	const env = cloudflarePagesEnv(input);
	const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	const token = String(env.CLOUDFLARE_API_TOKEN ?? '').trim();
	if (!projectName || !accountId || !token) return [];
	const domains: any[] = [];
	let page = 1;
	let totalPages = 1;
	while (page <= totalPages && page <= 50) {
		const payload = cloudflareApiRequest(
			`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains?per_page=25&page=${page}`,
			{ env, allowFailure: true },
		);
		if (payload?.success === false) break;
		if (Array.isArray(payload?.result)) domains.push(...payload.result);
		const reportedTotal = Number(payload?.result_info?.total_pages);
		totalPages = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : page;
		page += 1;
	}
	return domains;
}

function findCloudflarePagesDomain(input: TreeseedHostAdapterOperationInput, projectName: string, domain: string | null) {
	if (!domain) return null;
	const env = cloudflarePagesEnv(input);
	const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	const token = String(env.CLOUDFLARE_API_TOKEN ?? '').trim();
	if (accountId && token) {
		const direct = cloudflareApiRequest(
			`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`,
			{ env, allowFailure: true },
		)?.result ?? null;
		if (cloudflarePagesDomainName(direct) === domain) return direct;
	}
	return listCloudflarePagesDomains(input, projectName)
		.find((entry) => cloudflarePagesDomainName(entry) === domain) ?? null;
}

function cloudflareDnsRecordName(record: any) {
	return typeof record?.name === 'string' ? record.name : '';
}

function listCloudflareDnsRecords(input: TreeseedHostAdapterOperationInput, recordName: string | null) {
	const env = cloudflarePagesEnv(input);
	const zoneId = recordName ? resolveCloudflareZoneIdForHost(input.graph.deployConfig, recordName, env) : null;
	if (!zoneId || !recordName) return { zoneId, records: [] as any[] };
	const payload = cloudflareApiRequest(
		`/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(recordName)}&per_page=100`,
		{ env, allowFailure: true },
	);
	return {
		zoneId,
		records: Array.isArray(payload?.result) ? payload.result : [],
	};
}

function observeCloudflarePagesProject(input: TreeseedHostAdapterOperationInput, projectName: string) {
	const env = cloudflarePagesEnv(input);
	const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	const token = String(env.CLOUDFLARE_API_TOKEN ?? '').trim();
	if (!accountId || !token) return null;
	return cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
		{ env, allowFailure: true },
	)?.result ?? null;
}

function observeCloudflarePagesDomain(input: TreeseedHostAdapterOperationInput, projectName: string, domain: string | null) {
	return findCloudflarePagesDomain(input, projectName, domain);
}

function observeCloudflarePagesDeployment(input: TreeseedHostAdapterOperationInput, projectName: string, branchName: string) {
	const result = runWrangler(['pages', 'deployment', 'list', '--project-name', projectName, '--json'], {
		cwd: input.graph.tenantRoot,
		capture: true,
		allowFailure: true,
		env: cloudflarePagesEnv(input),
	});
	if (result.status !== 0) return null;
	try {
		const deployments = JSON.parse(result.stdout || '[]');
		return (Array.isArray(deployments) ? deployments : [])
			.find((entry) => entry?.Branch === branchName || entry?.branch === branchName) ?? null;
	} catch {
		return null;
	}
}

function observeCloudflarePagesDns(input: TreeseedHostAdapterOperationInput, projectName: string, branchName: string, domain: string | null) {
	if (!domain) return null;
	const expectedContent = cloudflarePagesDnsTarget(projectName, branchName, input.environment);
	const { zoneId, records } = listCloudflareDnsRecords(input, domain);
	const record = records.find((entry) =>
		cloudflareDnsRecordName(entry) === domain
		&& String(entry?.type ?? '').toUpperCase() === 'CNAME'
		&& entry?.content === expectedContent
	) ?? null;
	return record ? { ...record, zoneId } : null;
}

function createCloudflareHostAdapter(): TreeseedHostAdapter {
	const base = createSyntheticHostAdapter('cloudflare', 'Cloudflare', [
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
	const isPagesSite = (input: TreeseedHostAdapterOperationInput) => input.unit.serviceType.id === 'web-site';
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
					...syntheticStatus(input),
					status: 'blocked',
					warnings: [
						'Cloudflare Pages mutation is reconciler-owned. Use trsd hosting apply or trsd reconcile apply so the Cloudflare reconcile adapter performs apply, refresh, verify, and persist.',
					],
				};
			},
		verify(input) {
			if (!isPagesSite(input)) return base.verify(input);
			if (input.dryRun) return base.verify(input);
			const projectName = cloudflarePagesProjectName(input);
			const branchName = projectName ? cloudflarePagesBranchName(input) : null;
			const domain = cloudflarePagesDomain(input);
			const observed = input.observed;
			const observedState = observed.state && typeof observed.state === 'object' ? observed.state as Record<string, any> : {};
			const observedProjectName = observedState.observedProjectName ?? observedState.projectName ?? null;
			const observedDomain = observedState.observedDomain ?? null;
			const observedDnsRecord = observedState.observedDnsRecord ?? null;
			const observedDeployment = observedState.observedDeployment ?? null;
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

export function createDefaultHostAdapters(): Record<string, TreeseedHostAdapter> {
	return {
		railway: createSyntheticHostAdapter('railway', 'Railway', [
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
		github: createSyntheticHostAdapter('github', 'GitHub', [
			'source-repository',
			'workflow',
			'secret',
			'variable',
			'health',
		], PROVIDER_ENVIRONMENTS),
		smtp: createSyntheticHostAdapter('smtp', 'SMTP', [
			'email-relay',
			'secret',
			'health',
		], ALL_ENVIRONMENTS),
		'local-process': createSyntheticHostAdapter('local-process', 'Local process', [
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
		'local-docker': createSyntheticHostAdapter('local-docker', 'Local Docker', [
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

function serviceType(
	id: string,
	label: string,
	placement: TreeseedServicePlacement,
	requiredCapabilities: TreeseedHostCapability[],
	defaultHostByEnvironment: Partial<Record<TreeseedHostingEnvironment, string>>,
	composes: string[] = [],
): TreeseedServiceTypeAdapter {
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

export function createDefaultServiceTypeAdapters(): Record<string, TreeseedServiceTypeAdapter> {
	return {
		'web-site': serviceType('web-site', 'Web site', 'web', ['web-site', 'deployment', 'health'], {
			local: 'local-process',
			staging: 'cloudflare',
			prod: 'cloudflare',
		}),
		'container-api': serviceType('container-api', 'Container API', 'api', ['container', 'variable', 'deployment', 'health'], {
			local: 'local-process',
			staging: 'railway',
			prod: 'railway',
		}),
		'stateful-container': serviceType('stateful-container', 'Stateful container', 'operations', ['container', 'volume', 'variable', 'deployment', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}),
		'runner-pool': serviceType('runner-pool', 'Runner pool', 'runner-capacity', ['container', 'volume', 'variable', 'deployment', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}),
		'scheduled-job': serviceType('scheduled-job', 'Scheduled job', 'operations', ['scheduled-job', 'variable', 'deployment', 'health'], {
			local: 'local-process',
			staging: 'railway',
			prod: 'railway',
		}),
		'relational-database': serviceType('relational-database', 'Relational database', 'database', ['database', 'secret', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}),
		'object-store': serviceType('object-store', 'Object store', 'content-storage', ['object-store', 'health'], {
			local: 'local-docker',
			staging: 'cloudflare',
			prod: 'cloudflare',
		}),
		'source-repository': serviceType('source-repository', 'Source repository', 'repository', ['source-repository', 'health'], {
			local: 'local-process',
			staging: 'github',
			prod: 'github',
		}),
		'email-relay': serviceType('email-relay', 'Email relay', 'email', ['email-relay', 'secret', 'health'], {
			local: 'smtp',
			staging: 'smtp',
			prod: 'smtp',
		}),
		'knowledge-library': serviceType('knowledge-library', 'Knowledge library', 'knowledge-library', [], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['treedx-federation']),
		'treedx-node': serviceType('treedx-node', 'TreeDX node', 'knowledge-library', ['container', 'volume', 'variable', 'deployment', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['stateful-container']),
		'treedx-federation': serviceType('treedx-federation', 'TreeDX federation', 'knowledge-library', [], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['treedx-node']),
		'treeseed-control-plane': serviceType('treeseed-control-plane', 'Treeseed control plane', 'operations', [], {
			local: 'local-process',
			staging: 'railway',
			prod: 'railway',
		}, ['container-api', 'runner-pool', 'relational-database']),
		'capacity-provider': serviceType('capacity-provider', 'Capacity provider', 'runner-capacity', [], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['runner-pool']),
	};
}

export function createDefaultHostingProfiles(): TreeseedApplicationHostingProfile[] {
	return [
		{
			id: 'treeseed-managed-public-team',
			label: 'TreeSeed managed public team',
			description: 'Public teams use the shared public TreeDX federation and managed web/content defaults.',
			services: [],
			metadata: { publicRead: true, managed: true },
		},
		{
			id: 'treeseed-managed-private-team',
			label: 'TreeSeed managed private team',
			description: 'Private teams receive dedicated managed infrastructure for privacy-bearing data.',
			services: [],
			metadata: { publicRead: false, managed: true },
		},
		{
			id: 'customer-self-hosted',
			label: 'Customer self-hosted',
			description: 'Customer-owned hosts satisfy the same service capabilities.',
			services: [],
			metadata: { managed: false },
		},
		{
			id: 'local-development',
			label: 'Local development',
			description: 'Hot-reload local processes for code services and local Docker for stateful services.',
			services: [],
			metadata: { local: true, hotReload: true },
		},
		{
			id: 'production-like-local',
			label: 'Production-like local',
			description: 'Local containers model provider-backed runtime behavior without mutating hosted resources.',
			services: [],
			metadata: { local: true, productionLike: true },
		},
	];
}

export function sanitizedUnitConfig(unit: TreeseedHostingUnit) {
	return {
		id: unit.id,
		label: unit.label,
		serviceType: unit.serviceType.id,
		placement: unit.placement,
		hostId: unit.host.id,
		environment: unit.environment,
		projectGroupId: unit.projectGroup?.id ?? null,
		requiredCapabilities: unit.requiredCapabilities,
		secretRefs: unit.secretRefs,
		variableRefs: unit.variableRefs,
		application: unit.application
			? {
				id: unit.application.id,
				relativeRoot: unit.application.relativeRoot,
				roles: unit.application.roles,
			}
			: null,
		config: redactSensitiveConfig(unit.config),
		metadata: redactSensitiveConfig(unit.metadata),
	};
}

export function redactSensitiveConfig(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry) => redactSensitiveConfig(entry));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
		if (/(secret|token|password|privateKey|apiKey|credential)/iu.test(key)) {
			return [key, '[redacted]'];
		}
		return [key, redactSensitiveConfig(entry)];
	}));
}

export function summarizePlacementStatus(statuses: TreeseedHostingStatus[]): TreeseedHostingStatus {
	if (statuses.includes('blocked')) return 'blocked';
	if (statuses.includes('degraded')) return 'degraded';
	if (statuses.includes('pending')) return 'pending';
	if (statuses.includes('ready')) return 'ready';
	return 'unknown';
}
