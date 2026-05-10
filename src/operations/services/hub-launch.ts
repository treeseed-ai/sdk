import { createGitHubRepository } from './github-automation.ts';
import {
	executeKnowledgeHubProviderLaunch,
	type KnowledgeHubProviderLaunchInput,
	type KnowledgeHubProviderLaunchResult,
} from './hub-provider-launch.ts';

export type KnowledgeHubSourceKind = 'blank_hub' | 'template' | 'knowledge_pack' | 'market_listing';
export type KnowledgeHubRepositoryTopology = 'split_software_content' | 'combined_compatibility';
export type KnowledgeHubRepositoryRole = 'software' | 'content' | 'parent_workspace';
export type KnowledgeHubHostMode = 'treeseed_managed' | 'team_owned' | 'self_hosted' | 'hybrid';
export type KnowledgeHubLaunchPhaseStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

export interface RepositoryHost {
	id?: string;
	teamId?: string | null;
	provider: 'github';
	ownership: 'treeseed_managed' | 'team_owned';
	name: string;
	accountLabel?: string | null;
	organizationOrOwner: string;
	defaultVisibility?: 'private' | 'internal' | 'public';
	softwareRepositoryNameTemplate?: string;
	contentRepositoryNameTemplate?: string;
	branchPolicy?: Record<string, unknown>;
	workflowPolicy?: Record<string, unknown>;
	allowedProjectKinds?: string[];
	status?: 'active' | 'inactive' | 'needs_attention';
}

export interface RepositorySelection {
	owner?: string;
	name?: string;
	url?: string | null;
	defaultBranch?: string | null;
}

export interface HubContentResolutionPolicy {
	productionSource: 'r2_published_artifacts';
	overlaySource?: 'src_content_when_present';
	localSource?: 'local_content_checkout';
	fallback?: 'empty_with_diagnostics' | 'r2_published_artifacts';
}

export interface KnowledgeHubLaunchIntent {
	team: {
		id: string;
		slug?: string | null;
	};
	hub: {
		id?: string;
		name: string;
		slug: string;
		purpose?: string | null;
		visibility?: 'private' | 'team' | 'public';
	};
	source?: {
		kind?: KnowledgeHubSourceKind | 'blank';
		ref?: string | null;
		version?: string | null;
	};
	repository?: {
		hostId?: string | null;
		provider?: 'github';
		owner?: string | null;
		topology?: KnowledgeHubRepositoryTopology;
		softwareRepository?: RepositorySelection | null;
		contentRepository?: RepositorySelection | null;
		visibility?: 'private' | 'internal' | 'public';
	};
	hosting?: {
		mode?: KnowledgeHubHostMode | 'managed';
		webHost?: Record<string, unknown> | null;
		processingHost?: Record<string, unknown> | null;
	};
	contentResolution?: HubContentResolutionPolicy;
	direction?: {
		objective?: string | null;
		question?: string | null;
		proposal?: string | null;
		decisionPolicyPreset?: 'fast_yes_no' | 'lead_approval' | 'team_poll' | 'role_gated';
	};
	capabilities?: Array<Record<string, unknown>>;
	market?: {
		createDraftListing?: boolean;
		publisherTeamId?: string;
		provenancePolicy?: 'private' | 'selected' | 'public';
	};
	execution?: {
		providerLaunchInput?: Partial<KnowledgeHubProviderLaunchInput>;
	};
}

export interface KnowledgeHubRepositoryPlan {
	topology: KnowledgeHubRepositoryTopology;
	provider: 'github';
	hostId?: string | null;
	owner: string;
	visibility: 'private' | 'internal' | 'public';
	repositories: Array<{
		role: KnowledgeHubRepositoryRole;
		owner: string;
		name: string;
		url?: string | null;
		defaultBranch?: string | null;
		create: boolean;
	}>;
}

export interface KnowledgeHubLaunchPlan {
	intent: KnowledgeHubLaunchIntent;
	repository: KnowledgeHubRepositoryPlan;
	contentResolution: HubContentResolutionPolicy;
	phases: KnowledgeHubLaunchPhase[];
}

export interface KnowledgeHubLaunchPhase {
	phase: string;
	status: KnowledgeHubLaunchPhaseStatus;
	title: string;
	summary?: string | null;
	startedAt?: string | null;
	finishedAt?: string | null;
	data?: Record<string, unknown>;
	error?: { code?: string | null; message: string } | null;
}

export interface KnowledgeHubLaunchResult {
	intent: KnowledgeHubLaunchIntent;
	plan: KnowledgeHubLaunchPlan;
	repositories: KnowledgeHubRepositoryPlan['repositories'];
	workingRoot: KnowledgeHubProviderLaunchResult['workingRoot'];
	repository: KnowledgeHubProviderLaunchResult['repository'];
	contentRepository?: KnowledgeHubProviderLaunchResult['contentRepository'];
	contentRepositoryWorkingRoot?: KnowledgeHubProviderLaunchResult['contentRepositoryWorkingRoot'];
	workflows: KnowledgeHubProviderLaunchResult['workflows'];
	cloudflare: KnowledgeHubProviderLaunchResult['cloudflare'];
	railway: KnowledgeHubProviderLaunchResult['railway'];
	projectApiBaseUrl?: string | null;
	projectSiteUrl?: string | null;
	projectMetadata: KnowledgeHubProviderLaunchResult['projectMetadata'];
	defaultWorkstream: KnowledgeHubProviderLaunchResult['defaultWorkstream'];
	phases: KnowledgeHubLaunchPhase[];
	templatePackage: KnowledgeHubProviderLaunchResult['templatePackage'];
	knowledgePackPackage: KnowledgeHubProviderLaunchResult['knowledgePackPackage'];
	metadata: Record<string, unknown>;
}

export interface KnowledgeHubLaunchExecutionOptions {
	onPhase?: (phase: KnowledgeHubLaunchPhase) => void | Promise<void>;
}

function slugify(value: string | null | undefined, fallback = 'hub') {
	const slug = String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	return slug || fallback;
}

function renderRepositoryName(template: string | null | undefined, hubSlug: string, fallbackSuffix: string) {
	const base = template && template.trim() ? template.trim() : `{hub}-${fallbackSuffix}`;
	return slugify(base.replace(/\{hub\}/gu, hubSlug), `${hubSlug}-${fallbackSuffix}`);
}

export function normalizeKnowledgeHubSourceKind(kind: unknown): KnowledgeHubSourceKind {
	if (kind === 'blank' || kind === 'blank_hub' || kind === undefined || kind === null) return 'blank_hub';
	if (kind === 'template' || kind === 'knowledge_pack' || kind === 'market_listing') return kind;
	throw new Error(`Unsupported Knowledge Hub source kind "${String(kind)}".`);
}

export function normalizeKnowledgeHubLaunchIntent(input: KnowledgeHubLaunchIntent): KnowledgeHubLaunchIntent {
	if (!input?.team?.id) throw new Error('Knowledge Hub launch intent requires team.id.');
	if (!input?.hub?.name) throw new Error('Knowledge Hub launch intent requires hub.name.');
	const slug = slugify(input.hub.slug || input.hub.name, 'hub');
	return {
		...input,
		hub: {
			...input.hub,
			slug,
			visibility: input.hub.visibility ?? 'team',
		},
		source: {
			...input.source,
			kind: normalizeKnowledgeHubSourceKind(input.source?.kind),
			ref: input.source?.ref ?? null,
			version: input.source?.version ?? null,
		},
		repository: {
			provider: 'github',
			topology: input.repository?.topology ?? 'split_software_content',
			visibility: input.repository?.visibility ?? 'private',
			hostId: input.repository?.hostId ?? null,
			owner: input.repository?.owner ?? null,
			softwareRepository: input.repository?.softwareRepository ?? null,
			contentRepository: input.repository?.contentRepository ?? null,
		},
		hosting: {
			mode: input.hosting?.mode === 'managed' ? 'treeseed_managed' : input.hosting?.mode ?? 'treeseed_managed',
			webHost: input.hosting?.webHost ?? null,
			processingHost: input.hosting?.processingHost ?? null,
		},
		contentResolution: input.contentResolution ?? defaultHubContentResolutionPolicy(),
		direction: input.direction ?? {},
		capabilities: input.capabilities ?? [],
		market: input.market ?? {},
	};
}

export function defaultHubContentResolutionPolicy(): HubContentResolutionPolicy {
	return {
		productionSource: 'r2_published_artifacts',
		overlaySource: 'src_content_when_present',
		localSource: 'local_content_checkout',
		fallback: 'empty_with_diagnostics',
	};
}

export function planKnowledgeHubRepositories(
	intent: KnowledgeHubLaunchIntent,
	host?: RepositoryHost | null,
): KnowledgeHubRepositoryPlan {
	const normalized = normalizeKnowledgeHubLaunchIntent(intent);
	const hubSlug = normalized.hub.slug;
	const owner = normalized.repository?.owner
		?? host?.organizationOrOwner
		?? process.env.TREESEED_HOSTED_HUBS_GITHUB_OWNER
		?? 'treeseed-sites';
	const topology = normalized.repository?.topology ?? 'split_software_content';
	const visibility = normalized.repository?.visibility ?? host?.defaultVisibility ?? 'private';
	if (topology === 'combined_compatibility') {
		const name = normalized.repository?.softwareRepository?.name ?? hubSlug;
		return {
			topology,
			provider: 'github',
			hostId: normalized.repository?.hostId ?? host?.id ?? null,
			owner,
			visibility,
			repositories: [{
				role: 'software',
				owner,
				name,
				url: normalized.repository?.softwareRepository?.url ?? null,
				defaultBranch: normalized.repository?.softwareRepository?.defaultBranch ?? 'main',
				create: !normalized.repository?.softwareRepository?.url,
			}],
		};
	}
	const softwareName = normalized.repository?.softwareRepository?.name
		?? renderRepositoryName(host?.softwareRepositoryNameTemplate, hubSlug, 'site');
	const contentName = normalized.repository?.contentRepository?.name
		?? renderRepositoryName(host?.contentRepositoryNameTemplate, hubSlug, 'content');
	return {
		topology,
		provider: 'github',
		hostId: normalized.repository?.hostId ?? host?.id ?? null,
		owner,
		visibility,
		repositories: [
			{
				role: 'software',
				owner,
				name: softwareName,
				url: normalized.repository?.softwareRepository?.url ?? null,
				defaultBranch: normalized.repository?.softwareRepository?.defaultBranch ?? 'main',
				create: !normalized.repository?.softwareRepository?.url,
			},
			{
				role: 'content',
				owner,
				name: contentName,
				url: normalized.repository?.contentRepository?.url ?? null,
				defaultBranch: normalized.repository?.contentRepository?.defaultBranch ?? 'main',
				create: !normalized.repository?.contentRepository?.url,
			},
		],
	};
}

export function planKnowledgeHubLaunch(input: KnowledgeHubLaunchIntent, host?: RepositoryHost | null): KnowledgeHubLaunchPlan {
	const intent = normalizeKnowledgeHubLaunchIntent(input);
	return {
		intent,
		repository: planKnowledgeHubRepositories(intent, host),
		contentResolution: intent.contentResolution ?? defaultHubContentResolutionPolicy(),
		phases: [
			{ phase: 'launch_queued', status: 'queued', title: 'Launch queued' },
			{ phase: 'preflight_running', status: 'queued', title: 'Validating launch plan' },
			{ phase: 'repository_create', status: 'queued', title: 'Creating software repository' },
			{ phase: 'content_repository_create', status: 'queued', title: 'Creating content repository' },
			{ phase: 'starting_shape_apply', status: 'queued', title: 'Applying starting shape' },
			{ phase: 'config_sync', status: 'queued', title: 'Configuring runtime' },
			{ phase: 'cloudflare_reconcile', status: 'queued', title: 'Reconciling Cloudflare resources' },
			{ phase: 'backend_processing_connect', status: 'queued', title: 'Connecting backend processing' },
			{ phase: 'verification', status: 'queued', title: 'Verifying launch' },
			{ phase: 'packaging', status: 'queued', title: 'Packaging launch outputs' },
		],
	};
}

export function validateRepositoryHost(host: RepositoryHost) {
	const issues: string[] = [];
	if (host.provider !== 'github') issues.push('Repository Host provider must be github.');
	if (!host.organizationOrOwner?.trim()) issues.push('Repository Host requires organizationOrOwner.');
	if (!['treeseed_managed', 'team_owned'].includes(host.ownership)) issues.push('Repository Host ownership must be treeseed_managed or team_owned.');
	if (!host.name?.trim()) issues.push('Repository Host requires name.');
	return {
		ok: issues.length === 0,
		issues,
		host: {
			...host,
			defaultVisibility: host.defaultVisibility ?? 'private',
			softwareRepositoryNameTemplate: host.softwareRepositoryNameTemplate ?? '{hub}-site',
			contentRepositoryNameTemplate: host.contentRepositoryNameTemplate ?? '{hub}-content',
			branchPolicy: host.branchPolicy ?? {},
			workflowPolicy: host.workflowPolicy ?? {},
			allowedProjectKinds: host.allowedProjectKinds ?? ['knowledge_hub'],
			status: host.status ?? 'active',
		},
	};
}

export async function createKnowledgeHubRepositories(input: {
	plan: KnowledgeHubRepositoryPlan;
	dryRun?: boolean;
	description?: string | null;
	homepageUrl?: string | null;
}) {
	const githubToken = process.env.TREESEED_HOSTED_HUBS_GITHUB_TOKEN || '';
	const githubEnv = githubToken ? { ...process.env, GH_TOKEN: githubToken, GITHUB_TOKEN: githubToken } : process.env;
	const created = [];
	for (const repository of input.plan.repositories) {
		if (!repository.create || input.dryRun !== false) {
			created.push({ ...repository, status: repository.create ? 'planned' : 'connected' });
			continue;
		}
		const result = await createGitHubRepository({
			owner: repository.owner,
			name: repository.name,
			description: input.description ?? `TreeSeed Knowledge Hub ${repository.role} repository`,
			visibility: input.plan.visibility,
			homepageUrl: input.homepageUrl ?? undefined,
			topics: ['treeseed', 'knowledge-hub', repository.role],
		}, { env: githubEnv });
		created.push({
			...repository,
			owner: result.owner,
			name: result.name,
			url: result.url,
			status: 'created',
		});
	}
	return { repositories: created };
}

function providerLaunchInputFromIntent(plan: KnowledgeHubLaunchPlan): KnowledgeHubProviderLaunchInput {
	const intent = plan.intent;
	const sourceKind = normalizeKnowledgeHubSourceKind(intent.source?.kind);
	const software = plan.repository.repositories.find((repository) => repository.role === 'software');
	const content = plan.repository.repositories.find((repository) => repository.role === 'content');
	const providerInput = intent.execution?.providerLaunchInput ?? {};
	return {
		...providerInput,
		projectId: providerInput.projectId ?? intent.hub.id ?? intent.hub.slug,
		teamId: intent.team.id,
		teamSlug: intent.team.slug ?? null,
		projectSlug: intent.hub.slug,
		projectName: intent.hub.name,
		summary: intent.hub.purpose ?? null,
		sourceKind: sourceKind === 'blank_hub' ? 'blank' : sourceKind === 'market_listing' ? 'template' : sourceKind,
		sourceRef: intent.source?.ref ?? null,
		hostingMode: intent.hosting?.mode === 'treeseed_managed' ? 'managed' : intent.hosting?.mode ?? 'managed',
		publicSite: intent.hub.visibility === 'public',
		repoOwner: providerInput.repoOwner ?? software?.owner ?? plan.repository.owner,
		repoName: providerInput.repoName ?? software?.name ?? intent.hub.slug,
		repoVisibility: plan.repository.visibility,
		existingRepository: software?.url
			? {
				owner: software.owner,
				name: software.name,
				url: software.url,
				defaultBranch: software.defaultBranch ?? 'main',
				visibility: plan.repository.visibility,
			}
			: null,
		contentRepository: content
			? {
				owner: content.owner,
				name: content.name,
				url: content.url ?? null,
				visibility: plan.repository.visibility,
				defaultBranch: content.defaultBranch ?? 'main',
			}
			: null,
	};
}

export function phaseFromProviderLaunch(entry: KnowledgeHubProviderLaunchResult['phases'][number]): KnowledgeHubLaunchPhase {
	const completed = entry.status === 'completed';
	const canonicalPhase = ({
		repo_provision: 'repository_create',
		content_repository: 'content_repository_create',
		content_bootstrap: 'starting_shape_apply',
		workflow_bootstrap: 'config_sync',
		hosting_registration: 'cloudflare_reconcile',
		runtime_connection: 'backend_processing_connect',
	} as Record<string, string>)[entry.phase] ?? entry.phase;
	return {
		phase: canonicalPhase,
		status: entry.status,
		title: canonicalPhase.replace(/_/gu, ' '),
		summary: entry.detail,
		startedAt: completed ? null : entry.timestamp,
		finishedAt: completed ? entry.timestamp : null,
		data: { providerPhase: entry.phase },
		error: entry.status === 'failed' ? { message: entry.detail } : null,
	};
}

export async function executeKnowledgeHubLaunch(
	input: KnowledgeHubLaunchIntent,
	options: KnowledgeHubLaunchExecutionOptions = {},
): Promise<KnowledgeHubLaunchResult> {
	const plan = planKnowledgeHubLaunch(input);
	const phases: KnowledgeHubLaunchPhase[] = [];
	const providerLaunch = await executeKnowledgeHubProviderLaunch(providerLaunchInputFromIntent(plan), {
		onPhase: async (providerPhase) => {
			const phase = phaseFromProviderLaunch(providerPhase);
			phases.push(phase);
			await options?.onPhase?.(phase);
		},
	});
	if (phases.length === 0) {
		phases.push(...providerLaunch.phases.map(phaseFromProviderLaunch));
	}
	return {
		intent: plan.intent,
		plan,
		repositories: plan.repository.repositories.map((repository) => {
			if (repository.role === 'content' && providerLaunch.contentRepository) {
				return {
					...repository,
					owner: providerLaunch.contentRepository.owner,
					name: providerLaunch.contentRepository.name,
					url: providerLaunch.contentRepository.url,
					defaultBranch: providerLaunch.contentRepository.defaultBranch,
					create: false,
				};
			}
			if (repository.role !== 'software') return repository;
			return {
				...repository,
				owner: providerLaunch.repository.owner,
				name: providerLaunch.repository.name,
				url: providerLaunch.repository.url,
				defaultBranch: providerLaunch.repository.defaultBranch,
				create: false,
			};
		}),
		workingRoot: providerLaunch.workingRoot,
		repository: providerLaunch.repository,
		contentRepository: providerLaunch.contentRepository,
		contentRepositoryWorkingRoot: providerLaunch.contentRepositoryWorkingRoot,
		workflows: providerLaunch.workflows,
		cloudflare: providerLaunch.cloudflare,
		railway: providerLaunch.railway,
		projectApiBaseUrl: providerLaunch.projectApiBaseUrl,
		projectSiteUrl: providerLaunch.projectSiteUrl,
		projectMetadata: providerLaunch.projectMetadata,
		defaultWorkstream: providerLaunch.defaultWorkstream,
		phases,
		templatePackage: providerLaunch.templatePackage,
		knowledgePackPackage: providerLaunch.knowledgePackPackage,
		metadata: {
			repositoryTopology: plan.repository.topology,
			contentResolution: plan.contentResolution,
		},
	};
}
