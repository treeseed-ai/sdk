import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloudflareApiRequest, runWrangler } from '../operations/services/deploy.ts';
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
	return {
		unitId: input.unit.id,
		status: missing.length === 0 ? input.observed.status : 'blocked',
		verified: missing.length === 0,
		checks: [
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
		],
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

function cloudflarePagesDomain(input: TreeseedHostAdapterOperationInput) {
	const config = unitConfig(input);
	return typeof config.domain === 'string' && config.domain.trim()
		? config.domain.trim()
		: null;
}

function runCloudflarePagesBuild(input: TreeseedHostAdapterOperationInput) {
	const command = cloudflarePagesBuildCommand(input);
	if (!command || input.dryRun) {
		return;
	}
	const result = spawnSync('bash', ['-lc', command], {
		cwd: input.graph.tenantRoot,
		stdio: 'inherit',
		env: process.env,
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(`Cloudflare Pages build command failed: ${command}`);
	}
}

function ensureCloudflarePagesProject(input: TreeseedHostAdapterOperationInput, projectName: string) {
	if (input.dryRun) return;
	const productionBranch = cloudflarePagesBranchName({ ...input, environment: 'prod' });
	const result = runWrangler([
		'pages',
		'project',
		'create',
		projectName,
		'--production-branch',
		productionBranch,
	], {
		cwd: input.graph.tenantRoot,
		capture: true,
		allowFailure: true,
	});
	if (result.status !== 0) {
		const output = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n');
		if (!/already exists|code:\s*8000002/iu.test(output)) {
			throw new Error(output || `Failed to create Cloudflare Pages project ${projectName}.`);
		}
	}
}

function ensureCloudflarePagesDomain(input: TreeseedHostAdapterOperationInput, projectName: string, domain: string | null) {
	const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	if (!domain || !accountId || input.dryRun) return;
	const domainPath = `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`;
	const existing = cloudflareApiRequest(domainPath, { allowFailure: true });
	if (existing?.result?.name === domain || existing?.result?.domain === domain) {
		return;
	}
	const created = cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
		{
			method: 'POST',
			body: { name: domain },
			allowFailure: true,
		},
	);
	const errors = Array.isArray(created?.errors) ? created.errors.map((entry: any) => String(entry?.message ?? entry)).join('; ') : '';
	if (errors && !/already exists|already been taken|conflict/iu.test(errors)) {
		throw new Error(`Failed to attach Cloudflare Pages custom domain ${domain}: ${errors}`);
	}
}

function observeCloudflarePagesProject(projectName: string) {
	const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	const token = String(process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
	if (!accountId || !token) return null;
	return cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
		{ allowFailure: true },
	)?.result ?? null;
}

function observeCloudflarePagesDomain(projectName: string, domain: string | null) {
	const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	const token = String(process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
	if (!domain || !accountId || !token) return null;
	return cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`,
		{ allowFailure: true },
	)?.result ?? null;
}

function verifyCloudflarePagesPostconditions(projectName: string, domain: string | null) {
	const project = observeCloudflarePagesProject(projectName);
	if (project?.name !== projectName) {
		throw new Error(`Cloudflare Pages project ${projectName} was not observed after deploy.`);
	}
	if (domain) {
		const observedDomain = observeCloudflarePagesDomain(projectName, domain);
		const observedName = observedDomain?.name ?? observedDomain?.domain ?? null;
		if (observedName !== domain) {
			throw new Error(`Cloudflare Pages custom domain ${domain} was not observed on project ${projectName} after deploy.`);
		}
	}
}

function deployCloudflarePages(input: TreeseedHostAdapterOperationInput & { plan: TreeseedHostingUnitPlan }): TreeseedHostAdapterOperationResult {
	const projectName = cloudflarePagesProjectName(input);
	if (!projectName) {
		return {
			...syntheticStatus(input),
			status: 'blocked',
			warnings: ['Cloudflare Pages projectName is required for web-site deployment.'],
		};
	}
	const branchName = cloudflarePagesBranchName(input);
	const buildOutputDir = cloudflarePagesBuildOutputDir(input);
	const outputPath = resolve(input.graph.tenantRoot, buildOutputDir);
	if (!input.dryRun) {
		runCloudflarePagesBuild(input);
		if (!existsSync(outputPath)) {
			throw new Error(`Cloudflare Pages build output does not exist: ${outputPath}`);
		}
		ensureCloudflarePagesProject(input, projectName);
		ensureCloudflarePagesDomain(input, projectName, cloudflarePagesDomain(input));
		runWrangler([
			'pages',
			'deploy',
			outputPath,
			'--project-name',
			projectName,
			'--branch',
			branchName,
		], {
			cwd: input.graph.tenantRoot,
			capture: true,
		});
		verifyCloudflarePagesPostconditions(projectName, cloudflarePagesDomain(input));
	}
	return {
		status: input.dryRun ? 'pending' : 'ready',
		locators: {
			hostId: input.unit.host.id,
			projectGroupId: input.unit.projectGroup?.id ?? null,
			projectName,
			branchName,
			domain: cloudflarePagesDomain(input),
			pagesDevUrl: `https://${branchName}.${projectName}.pages.dev`,
		},
		state: {
			unitId: input.unit.id,
			serviceType: input.unit.serviceType.id,
			placement: input.unit.placement,
			projectName,
			branchName,
			buildOutputDir,
			buildCommand: cloudflarePagesBuildCommand(input),
			dryRun: input.dryRun === true,
			applied: input.dryRun !== true,
		},
		warnings: [],
	};
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
			const project = projectName ? observeCloudflarePagesProject(projectName) : null;
			const domain = cloudflarePagesDomain(input);
			const observedDomain = projectName ? observeCloudflarePagesDomain(projectName, domain) : null;
			return {
				status: projectName && project?.name === projectName ? 'ready' : (projectName ? 'pending' : 'blocked'),
				locators: {
					hostId: input.unit.host.id,
					projectGroupId: input.unit.projectGroup?.id ?? null,
					projectName,
					domain,
				},
				state: {
					unitId: input.unit.id,
					serviceType: input.unit.serviceType.id,
					placement: input.unit.placement,
					projectName,
					observedProjectName: project?.name ?? null,
					observedDomain: observedDomain?.name ?? observedDomain?.domain ?? null,
					buildOutputDir: cloudflarePagesBuildOutputDir(input),
					buildCommand: cloudflarePagesBuildCommand(input),
				},
				warnings: projectName ? [] : ['Cloudflare Pages projectName is missing.'],
			};
		},
		apply(input) {
			if (!isPagesSite(input)) return base.apply(input);
			return deployCloudflarePages(input);
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
