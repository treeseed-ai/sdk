import type { ProviderLanePurpose } from '../../agent-capacity/contracts/capacity/communication/communication-records.ts';

export const SEED_BUNDLE_SCHEMA_VERSION = 'treeseed.seed-bundle/v3' as const;
export const HISTORICAL_SEED_BUNDLE_SCHEMA_VERSION = 'treeseed.seed-bundle/v2' as const;

export type SeedEnvironment = 'local' | 'staging' | 'prod' | string;

export interface SeedTeamResource {
	key: string;
	slug: string;
	name: string;
	displayName: string;
	profileSummary?: string;
}

export interface SeedUserMembershipResource {
	key: string;
	team: string;
	principal: { kind: 'user'; email: string };
	roles: string[];
	missingUser: 'defer' | 'reject';
}

export interface SeedServicePrincipalMembershipResource {
	key: string;
	team: string;
	principal: { kind: 'service-principal'; key: string; displayName: string; interactiveLogin: false };
	roles: string[];
}

export type SeedMembershipResource = SeedUserMembershipResource | SeedServicePrincipalMembershipResource;

export interface SeedRepositoryPolicy {
	visibility: 'public' | 'private';
	lifecycle: 'adopt' | 'create-or-adopt';
	deletionPolicy: 'retain';
	defaultBranch: string;
	stagingBranch: string;
	issues: boolean;
	actions: boolean;
	workflows: string[];
}

export interface SeedRepositoryResource {
	key: string;
	project: string;
	role: 'primary' | 'library' | 'fixture' | 'support' | 'template';
	provider: 'github';
	owner: string;
	name: string;
	gitUrl: string;
	defaultBranch: string;
	checkoutPath?: string;
	submodulePath?: string;
	repositoryPolicy: SeedRepositoryPolicy;
	metadata?: Record<string, unknown>;
}

export interface SeedProjectResource {
	key: string;
	team: string;
	slug: string;
	name: string;
	description: string;
	kind: string;
	primaryRepository?: string;
	libraryRepository: string;
	metadata?: Record<string, unknown>;
}

export interface SeedCapacityProviderPrerequisite {
	key: string;
	team: string;
	environments: SeedEnvironment[];
	manifestDigest: `sha256:${string}`;
	manifestRef: string;
	approval: 'trusted-local-owner';
	projects: string[];
	allowedModes: Array<'planning' | 'acting'>;
	requiredLanePurposes: ProviderLanePurpose[];
}

interface SeedBundleBody {
	name: string;
	version: number;
	description: string;
	environments: SeedEnvironment[];
	digest: `sha256:${string}`;
	resources: {
		teams: SeedTeamResource[];
		memberships: SeedMembershipResource[];
		projects: SeedProjectResource[];
		repositories: SeedRepositoryResource[];
	};
	runtime: {
		capacityProviders: SeedCapacityProviderPrerequisite[];
	};
}

export interface SeedBundleV3 extends SeedBundleBody {
	schemaVersion: typeof SEED_BUNDLE_SCHEMA_VERSION;
}

/** Historical receipt shape. It is decodable, but cannot be planned or applied. */
export interface SeedBundleV2 extends Omit<SeedBundleBody, 'resources'> {
	schemaVersion: typeof HISTORICAL_SEED_BUNDLE_SCHEMA_VERSION;
	resources: Omit<SeedBundleBody['resources'], 'projects'> & {
		projects: Array<Omit<SeedProjectResource, 'libraryRepository'> & { libraryRepository?: string }>;
	};
}

export type SeedBundle = SeedBundleV3 | SeedBundleV2;

export interface SeedResourceReceipt {
	resourceKey: string;
	action: 'create' | 'adopt' | 'update' | 'noop' | 'blocked';
	resourceId?: string;
	digest: `sha256:${string}`;
	readBackAt?: string;
	blockers?: string[];
}

export interface SeedReconciliationReceipt {
	schemaVersion: 'treeseed.seed-reconciliation-receipt/v1';
	runId: string;
	seedName: string;
	seedVersion: number;
	seedDigest: `sha256:${string}`;
	mode: 'plan' | 'apply' | 'verify';
	status: 'planned' | 'waiting_provider' | 'verified' | 'blocked' | 'failed';
	resources: SeedResourceReceipt[];
	providerRequestIds: string[];
	createdAt: string;
	completedAt?: string;
}

export interface SeedBundleDiagnostic {
	code: string;
	path: string;
	message: string;
}

function text(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([, entry]) => entry !== undefined)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => [key, canonical(entry)]));
}

export function canonicalSeedBundlePayload(bundle: Omit<SeedBundle, 'digest'> | SeedBundle): string {
	const { digest: _digest, ...payload } = bundle as SeedBundle;
	return JSON.stringify(canonical(payload));
}

export async function digestSeedBundle(bundle: Omit<SeedBundle, 'digest'> | SeedBundle): Promise<`sha256:${string}`> {
	const bytes = new TextEncoder().encode(canonicalSeedBundlePayload(bundle));
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function validateSeedBundle(bundle: SeedBundle): SeedBundleDiagnostic[] {
	const diagnostics: SeedBundleDiagnostic[] = [];
	const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	if (bundle?.schemaVersion === HISTORICAL_SEED_BUNDLE_SCHEMA_VERSION) {
		add('seed_bundle_v2_migration_required', 'schemaVersion', `Historical v2 bundles remain readable but must be migrated to ${SEED_BUNDLE_SCHEMA_VERSION} before planning or apply.`);
	} else if (bundle?.schemaVersion !== SEED_BUNDLE_SCHEMA_VERSION) {
		add('seed_bundle_schema_invalid', 'schemaVersion', `schemaVersion must be ${SEED_BUNDLE_SCHEMA_VERSION}.`);
	}
	if (!text(bundle?.name) || !Number.isInteger(bundle?.version) || bundle.version < 1) add('seed_bundle_identity_invalid', 'name', 'Seed name and positive version are required.');
	if (!/^sha256:[a-f0-9]{64}$/u.test(bundle?.digest ?? '')) add('seed_bundle_digest_invalid', 'digest', 'Seed digest must be an exact SHA-256 digest.');
	const teams = new Set((bundle?.resources?.teams ?? []).map((entry) => entry.key));
	const projects = new Set((bundle?.resources?.projects ?? []).map((entry) => entry.key));
	const repositories = new Set((bundle?.resources?.repositories ?? []).map((entry) => entry.key));
	const allKeys = [...teams, ...projects, ...repositories, ...(bundle?.resources?.memberships ?? []).map((entry) => entry.key)];
	if (new Set(allKeys).size !== allKeys.length) add('seed_bundle_resource_key_duplicate', 'resources', 'Every resource key must be globally unique.');
	for (const [index, membership] of (bundle?.resources?.memberships ?? []).entries()) {
		if (!teams.has(membership.team)) add('seed_bundle_membership_team_unknown', `resources.memberships[${index}].team`, 'Membership references an unknown team.');
		if (membership.principal.kind === 'service-principal' && membership.principal.interactiveLogin !== false) add('seed_bundle_service_principal_interactive_forbidden', `resources.memberships[${index}].principal.interactiveLogin`, 'Service principals cannot log in interactively.');
	}
	for (const [index, project] of (bundle?.resources?.projects ?? []).entries()) {
		if (!teams.has(project.team)) add('seed_bundle_project_team_unknown', `resources.projects[${index}].team`, 'Project references an unknown team.');
		if (!project.primaryRepository && project.kind !== 'content') add('seed_bundle_primary_repository_required', `resources.projects[${index}].primaryRepository`, 'Non-content projects require a primary source repository.');
		if (project.primaryRepository && !repositories.has(project.primaryRepository)) add('seed_bundle_primary_repository_unknown', `resources.projects[${index}].primaryRepository`, 'Project primary repository is missing.');
		if (!project.libraryRepository) add('seed_bundle_library_repository_required', `resources.projects[${index}].libraryRepository`, 'Every project requires one library repository.');
		if (project.libraryRepository && !repositories.has(project.libraryRepository)) add('seed_bundle_library_repository_unknown', `resources.projects[${index}].libraryRepository`, 'Project library repository is missing.');
	}
	for (const [index, repository] of (bundle?.resources?.repositories ?? []).entries()) {
		if ((repository as { role?: string }).role === 'content') add('seed_bundle_content_repository_renamed', `resources.repositories[${index}].role`, 'Repository-backed knowledge uses role library.');
	}
	for (const [index, project] of (bundle?.resources?.projects ?? []).entries()) {
		const library = (bundle?.resources?.repositories ?? []).find((entry) => entry.key === project.libraryRepository);
		if (library && (library.role !== 'library' || library.project !== project.key)) add('seed_bundle_library_repository_mismatch', `resources.projects[${index}].libraryRepository`, 'libraryRepository must reference a library-role repository owned by this project.');
		const projectLibraries = (bundle?.resources?.repositories ?? []).filter((entry) => entry.project === project.key && entry.role === 'library');
		if (projectLibraries.length !== 1) add('seed_bundle_library_repository_count_invalid', `resources.projects[${index}].libraryRepository`, 'Every project must declare exactly one library-role repository.');
	}
	for (const [index, provider] of (bundle?.runtime?.capacityProviders ?? []).entries()) {
		if (!teams.has(provider.team)) add('seed_bundle_provider_team_unknown', `runtime.capacityProviders[${index}].team`, 'Provider references an unknown team.');
		for (const project of provider.projects) if (!projects.has(project)) add('seed_bundle_provider_project_unknown', `runtime.capacityProviders[${index}].projects`, `Provider references unknown project ${project}.`);
		for (const purpose of ['communication', 'platform', 'workday'] as const) if (!provider.requiredLanePurposes.includes(purpose)) add('seed_bundle_provider_lane_required', `runtime.capacityProviders[${index}].requiredLanePurposes`, `Provider prerequisite requires the ${purpose} lane.`);
	}
	return diagnostics;
}
