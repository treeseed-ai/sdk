export const SERVICE_PROVIDER_IDS = ['github', 'cloudflare', 'railway', 'openbao'] as const;

export const SERVICE_CAPABILITY_TYPES = [
	'repository-hosting',
	'workflow-execution',
	'workflow-configuration',
	'secret-enclave',
	'frontend-hosting',
	'backend-hosting',
	'dns-management',
	'object-storage',
	'database-hosting',
	'capacity-runtime-hosting',
	'private-knowledge-index-hosting',
	'artifact-hosting',
] as const;

export const SERVICE_CONNECTION_STATUSES = [
	'draft',
	'active',
	'degraded',
	'validation-failed',
	'reentry-required',
	'reauthorization-required',
	'disconnected',
] as const;

export const SERVICE_CAPABILITY_STATUSES = ['configured', 'disabled', 'blocked', 'planned'] as const;

export type ServiceProviderId = (typeof SERVICE_PROVIDER_IDS)[number];
export type ServiceCapabilityType = (typeof SERVICE_CAPABILITY_TYPES)[number];
export type ServiceConnectionStatus = (typeof SERVICE_CONNECTION_STATUSES)[number];
export type ServiceCapabilityStatus = (typeof SERVICE_CAPABILITY_STATUSES)[number];

export type ServiceFieldDefinition = {
	key: string;
	label: string;
	description: string;
	required: boolean;
	sensitive: boolean;
	input: 'text' | 'password' | 'url';
	placeholder?: string;
};

export type CredentialProfileDefinition = {
	id: string;
	label: string;
	description: string;
	capabilities: ServiceCapabilityType[];
	fields: ServiceFieldDefinition[];
	permissions: string[];
	sharing: 'capability-scoped' | 'provider-shared';
	unattendedCompatible: boolean;
	authoritySchemes?: CredentialAuthorityScheme[];
	knowledgePageIds: string[];
};

export const CREDENTIAL_AUTHORITY_SCHEMES = [
	'app-installation',
	'api-token',
	'oauth-token',
	'environment-reference',
	'client-encrypted',
	'external-vault',
	'workload-identity',
] as const;

export type CredentialAuthorityScheme = (typeof CREDENTIAL_AUTHORITY_SCHEMES)[number];

export type ServiceCapabilityDefinition = {
	type: ServiceCapabilityType;
	label: string;
	description: string;
	credentialProfileIds: string[];
	status: 'available' | 'planned';
	knowledgePageIds?: string[];
};

export type ServiceProviderDefinition = {
	id: ServiceProviderId;
	label: string;
	logoKey: string;
	documentationUrl: string;
	description: string;
	connectionFields: ServiceFieldDefinition[];
	capabilities: ServiceCapabilityDefinition[];
	credentialProfiles: CredentialProfileDefinition[];
	knowledgePageIds: string[];
};

export type TeamServiceConnection = {
	id: string;
	teamId: string;
	providerId: ServiceProviderId | string;
	displayName: string;
	status: ServiceConnectionStatus | string;
	nonSecretConfig: Record<string, unknown>;
	version: number;
	createdByUserId?: string | null;
	updatedByUserId?: string | null;
	createdAt: string;
	updatedAt: string;
	lastValidatedAt?: string | null;
};

export type TeamServiceCapabilityBinding = {
	id: string;
	connectionId: string;
	teamId: string;
	capabilityType: ServiceCapabilityType | string;
	status: ServiceCapabilityStatus | string;
	credentialProfileId?: string | null;
	configuration: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type TeamServiceCredentialProfile = {
	id: string;
	connectionId: string;
	teamId: string;
	definitionId: string;
	custodyMode: string;
	status: 'configured' | 'reentry-required' | 'revoked';
	envelopeVersion?: string | null;
	fingerprint?: string | null;
	lastRotatedAt?: string | null;
	lastValidatedAt?: string | null;
	createdAt: string;
	updatedAt: string;
};

const field = (
	key: string,
	label: string,
	description: string,
	required = true,
	sensitive = false,
): ServiceFieldDefinition => ({
	key,
	label,
	description,
	required,
	sensitive,
	input: sensitive ? 'password' : 'text',
});

export const SERVICE_PROVIDER_CATALOG: readonly ServiceProviderDefinition[] = [
	{
		id: 'github',
		label: 'GitHub',
		logoKey: 'github',
		documentationUrl: 'https://docs.github.com/apps/creating-github-apps',
		description: 'Connect an organization through a GitHub App installation.',
		knowledgePageIds: ['provider.github'],
		connectionFields: [
			field('organization', 'Organization', 'The organization or account that owns repositories.'),
		],
		capabilities: [
			{ type: 'repository-hosting', label: 'Repository hosting', description: 'Own source and knowledge repositories.', credentialProfileIds: ['github-repository-app', 'github-repository-token'], status: 'available' },
			{ type: 'workflow-execution', label: 'Workflow execution', description: 'Run allowlisted GitHub Actions workflows.', credentialProfileIds: ['github-workflow-app', 'github-workflow-token'], status: 'available' },
			{ type: 'workflow-configuration', label: 'Workflow configuration', description: 'Manage the scoped variables required by allowlisted workflows.', credentialProfileIds: ['github-workflow-app', 'github-workflow-token'], status: 'available' },
			{ type: 'secret-enclave', label: 'Actions secret enclave', description: 'Write GitHub-encrypted values to Actions without making them readable by TreeSeed.', credentialProfileIds: ['github-workflow-app', 'github-workflow-token'], status: 'available' },
		],
		credentialProfiles: [
			{
				id: 'github-repository-app', label: 'Repository Connector App',
				description: 'Installation authority narrowed to one repository for guarded Git reads and writes.',
				capabilities: ['repository-hosting'],
				fields: [],
				permissions: ['Metadata: read', 'Contents: read and write'], sharing: 'capability-scoped', unattendedCompatible: true,
				authoritySchemes: ['app-installation'],
				knowledgePageIds: ['provider.github', 'services.credentials', 'vault.rotation'],
			},
			{
				id: 'github-repository-token', label: 'Repository token authority',
				description: 'Fine-grained token authority restricted to selected repositories and Contents access.',
				capabilities: ['repository-hosting'], fields: [field('accessToken', 'Fine-grained token', 'Encrypted before leaving this browser.', true, true)],
				permissions: ['Metadata: read', 'Contents: read and write'], sharing: 'capability-scoped', unattendedCompatible: false,
				authoritySchemes: ['api-token', 'environment-reference', 'client-encrypted', 'external-vault'],
				knowledgePageIds: ['provider.github', 'services.credentials', 'vault.rotation'],
			},
			{
				id: 'github-workflow-app', label: 'Workflow Connector App',
				description: 'Installation authority for dispatch, run observation, and separately enabled secret and variable configuration.',
				capabilities: ['workflow-execution', 'workflow-configuration', 'secret-enclave'],
				fields: [],
				permissions: ['Metadata: read', 'Contents: read', 'Actions: read and write', 'Secrets: read and write', 'Variables: read and write'],
				sharing: 'capability-scoped', unattendedCompatible: true,
				authoritySchemes: ['app-installation'],
				knowledgePageIds: ['provider.github', 'services.credentials', 'vault.rotation'],
			},
			{
				id: 'github-workflow-token', label: 'Workflow token authority',
				description: 'Fine-grained token authority for Actions and explicitly enabled secret or variable scopes.',
				capabilities: ['workflow-execution', 'workflow-configuration', 'secret-enclave'],
				fields: [field('accessToken', 'Fine-grained token', 'Encrypted before leaving this browser.', true, true)],
				permissions: ['Metadata: read', 'Contents: read', 'Actions: read and write', 'Secrets: read and write', 'Variables: read and write'],
				sharing: 'capability-scoped', unattendedCompatible: false,
				authoritySchemes: ['api-token', 'environment-reference', 'client-encrypted', 'external-vault'],
				knowledgePageIds: ['provider.github', 'services.credentials', 'vault.rotation'],
			},
		],
	},
	{
		id: 'cloudflare',
		label: 'Cloudflare',
		logoKey: 'cloudflare',
		documentationUrl: 'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/',
		description: 'Connect a Cloudflare account with separately scoped capability tokens.',
		knowledgePageIds: ['provider.cloudflare'],
		connectionFields: [field('accountId', 'Account ID', 'The non-secret Cloudflare account identifier.')],
		capabilities: [
			{ type: 'frontend-hosting', label: 'Frontend hosting', description: 'Future Pages and Workers application hosting.', credentialProfileIds: ['cloudflare-runtime'], status: 'available' },
			{ type: 'dns-management', label: 'DNS management', description: 'Future scoped DNS record management.', credentialProfileIds: ['cloudflare-dns'], status: 'planned' },
			{ type: 'object-storage', label: 'Object storage', description: 'R2-backed immutable publication and private artifact storage.', credentialProfileIds: ['cloudflare-storage'], status: 'available' },
		],
		credentialProfiles: [
			{ id: 'cloudflare-runtime', label: 'Pages and Workers token', description: 'A token limited to application deployment resources.', capabilities: ['frontend-hosting'], fields: [field('apiToken', 'API token', 'Encrypted in this browser and used only for authorized frontend operations.', true, true)], permissions: ['Account: Workers Scripts Edit', 'Account: Pages Edit'], sharing: 'capability-scoped', unattendedCompatible: false, knowledgePageIds: ['provider.cloudflare', 'services.credentials', 'vault.rotation'] },
			{ id: 'cloudflare-dns', label: 'DNS token', description: 'A token restricted to selected zones.', capabilities: ['dns-management'], fields: [field('apiToken', 'DNS API token', 'Encrypted separately from deployment authority.', true, true)], permissions: ['Zone: DNS Edit for only the managed zones'], sharing: 'capability-scoped', unattendedCompatible: false, knowledgePageIds: ['provider.cloudflare', 'services.credentials', 'vault.rotation'] },
			{ id: 'cloudflare-storage', label: 'Storage token', description: 'A token limited to R2 resources.', capabilities: ['object-storage'], fields: [field('apiToken', 'Storage API token', 'Encrypted separately from runtime and DNS authority.', true, true)], permissions: ['Account: Workers R2 Storage Edit'], sharing: 'capability-scoped', unattendedCompatible: false, knowledgePageIds: ['provider.cloudflare', 'services.credentials', 'vault.rotation'] },
		],
	},
	{
		id: 'railway',
		label: 'Railway',
		logoKey: 'railway',
		documentationUrl: 'https://docs.railway.com/guides/public-api',
		description: 'Connect a Railway workspace for future backend and private infrastructure.',
		knowledgePageIds: ['provider.railway'],
		connectionFields: [field('workspaceId', 'Workspace ID', 'The non-secret Railway workspace identifier.')],
		capabilities: [
			{ type: 'backend-hosting', label: 'Backend hosting', description: 'Future API and backend service hosting.', credentialProfileIds: ['railway-workspace'], status: 'available' },
			{ type: 'database-hosting', label: 'Database hosting', description: 'Future managed database placement.', credentialProfileIds: ['railway-workspace'], status: 'planned' },
			{ type: 'capacity-runtime-hosting', label: 'Capacity runtime hosting', description: 'Future capacity provider placement.', credentialProfileIds: ['railway-workspace'], status: 'planned' },
			{ type: 'private-knowledge-index-hosting', label: 'Private knowledge hosting', description: 'Future private TreeDX knowledge-plane placement.', credentialProfileIds: ['railway-workspace'], status: 'planned' },
		],
		credentialProfiles: [{
			id: 'railway-workspace',
			label: 'Railway workspace token',
			description: 'Railway currently exposes broad workspace authority. Sharing it increases the blast radius across enabled capabilities.',
			capabilities: ['backend-hosting', 'database-hosting', 'capacity-runtime-hosting', 'private-knowledge-index-hosting'],
			fields: [field('apiToken', 'Workspace token', 'Encrypted in this browser. TreeSeed will request explicit authorization before interactive use.', true, true)],
			permissions: ['Workspace access required by the selected operations'],
			sharing: 'provider-shared',
			unattendedCompatible: false,
			knowledgePageIds: ['provider.railway', 'services.credentials', 'vault.rotation'],
		}],
	},
	{
		id: 'openbao',
		label: 'OpenBao / HashiCorp Vault',
		logoKey: 'vault',
		documentationUrl: 'https://openbao.org/docs/auth/jwt/',
		description: 'Reference an external vault through workload identity; no long-lived vault token is stored.',
		knowledgePageIds: ['provider.openbao', 'services.external-vault'],
		connectionFields: [field('address', 'Vault address', 'The HTTPS endpoint for the vault.'), field('mount', 'Secrets mount', 'The mount containing TreeSeed-managed references.'), field('role', 'Workload identity role', 'The OIDC/JWT role used by the operations runner.')],
		capabilities: [{ type: 'secret-enclave', label: 'External secret vault', description: 'Resolve approved secret references through workload identity.', credentialProfileIds: [], status: 'available' }],
		credentialProfiles: [],
	},
] as const;

export function getServiceProviderDefinition(providerId: string): ServiceProviderDefinition | undefined {
	return SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === providerId);
}

export function serviceProviderSupportsCapability(providerId: string, capability: string): boolean {
	return Boolean(getServiceProviderDefinition(providerId)?.capabilities.some((item) => item.type === capability));
}
