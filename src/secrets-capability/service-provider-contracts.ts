export const SERVICE_PROVIDER_IDS = ['github', 'cloudflare', 'railway'] as const;

export const SERVICE_CAPABILITY_TYPES = [
	'repository-hosting',
	'workflow-execution',
	'workflow-configuration',
	'secret-enclave',
	'frontend-hosting',
	'backend-hosting',
	'dns-management',
	'object-storage',
	'state-encryption',
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
	'openbao',
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
				description: 'Installation authority for governed repository creation and guarded Git reads and writes.',
				capabilities: ['repository-hosting'],
				fields: [],
				permissions: ['Metadata: read', 'Contents: read and write', 'Checks: read', 'Administration: read and write'], sharing: 'capability-scoped', unattendedCompatible: true,
				authoritySchemes: ['app-installation'],
				knowledgePageIds: ['provider.github', 'services.credentials', 'vault.rotation'],
			},
			{
				id: 'github-repository-token', label: 'Repository token authority',
				description: 'Fine-grained token authority restricted to selected repositories and Contents access.',
				capabilities: ['repository-hosting'], fields: [field('accessToken', 'Fine-grained token', 'Stored in core OpenBao; used only by authorized operations.', true, true)],
				permissions: ['Metadata: read', 'Contents: read and write'], sharing: 'capability-scoped', unattendedCompatible: true,
				authoritySchemes: ['openbao'],
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
				fields: [field('accessToken', 'Fine-grained token', 'Stored in core OpenBao; used only by authorized operations.', true, true)],
				permissions: ['Metadata: read', 'Contents: read', 'Actions: read and write', 'Secrets: read and write', 'Variables: read and write'],
				sharing: 'capability-scoped', unattendedCompatible: true,
				authoritySchemes: ['openbao'],
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
		connectionFields: [
			field('deploymentEnvironment', 'Deployment environment', 'The exact TreeSeed deployment environment. Use staging or production; one connection must never span both.'),
			field('accountId', 'Account ID', 'The non-secret Cloudflare account identifier.'),
			field('zoneId', 'Zone ID', 'Optional non-secret zone identifier used by reviewed DNS and TLS topology resources.', false),
			field('stateBucket', 'OpenTofu state bucket', 'Optional R2 bucket name used only by a state-backend connection.', false),
			field('stateEndpoint', 'OpenTofu state endpoint', 'Optional HTTPS S3-compatible R2 endpoint used only by a state-backend connection.', false),
			field('stateRegion', 'OpenTofu state region', 'Optional S3-compatible region; omit to use auto.', false),
			field('stateEncryptionKeyRef', 'State encryption key reference', 'Optional non-secret team-vault key name used to encrypt this backend state.', false),
		],
		capabilities: [
			{ type: 'frontend-hosting', label: 'Frontend hosting', description: 'Pages and Workers application hosting.', credentialProfileIds: ['cloudflare-runtime'], status: 'available' },
			{ type: 'dns-management', label: 'DNS management', description: 'Scoped DNS record management.', credentialProfileIds: ['cloudflare-dns'], status: 'available' },
			{ type: 'object-storage', label: 'Object storage', description: 'R2-backed immutable publication, private artifact storage, and scoped S3 state access.', credentialProfileIds: ['cloudflare-storage', 's3-state-session'], status: 'available' },
			{ type: 'state-encryption', label: 'State encryption', description: 'Independent encryption authority for OpenTofu state and plan files.', credentialProfileIds: ['opentofu-state-encryption'], status: 'available' },
		],
		credentialProfiles: [
			{ id: 'cloudflare-runtime', label: 'Pages and Workers token', description: 'A token limited to application deployment resources.', capabilities: ['frontend-hosting'], fields: [field('apiToken', 'API token', 'Stored in core OpenBao and used only by authorized operations.', true, true)], permissions: ['Account: Workers Scripts Edit', 'Account: Pages Edit'], sharing: 'capability-scoped', unattendedCompatible: true, authoritySchemes: ['openbao'], knowledgePageIds: ['provider.cloudflare', 'services.credentials', 'vault.rotation'] },
			{ id: 'cloudflare-dns', label: 'DNS token', description: 'A token restricted to selected zones.', capabilities: ['dns-management'], fields: [field('apiToken', 'DNS API token', 'Encrypted separately from deployment authority.', true, true)], permissions: ['Zone: DNS Edit for only the managed zones'], sharing: 'capability-scoped', unattendedCompatible: true, authoritySchemes: ['openbao'], knowledgePageIds: ['provider.cloudflare', 'services.credentials', 'vault.rotation'] },
			{ id: 'cloudflare-storage', label: 'Storage management authority', description: 'Vault-custodied token used only to reconcile authorized R2 resources.', capabilities: ['object-storage'], fields: [field('apiToken', 'Storage API token', 'Encrypted separately and used only to reconcile authorized R2 resources.', true, true)], permissions: ['Account: Workers R2 Storage Edit'], sharing: 'capability-scoped', unattendedCompatible: true, authoritySchemes: ['openbao'], knowledgePageIds: ['provider.cloudflare', 'services.credentials', 'vault.rotation'] },
			{ id: 's3-state-session', label: 'OpenTofu state session', description: 'S3-compatible credentials limited to the selected team state prefix.', capabilities: ['object-storage'], fields: [field('accessKeyId', 'R2 access key ID', 'Vault-custodied S3-compatible access key identifier for encrypted OpenTofu state.', true, true), field('secretAccessKey', 'R2 secret access key', 'Vault-custodied S3-compatible secret key for encrypted OpenTofu state.', true, true), field('sessionToken', 'R2 session token', 'Optional short-lived S3-compatible session token.', false, true)], permissions: ['Object read and write for only the managed team state prefix'], sharing: 'capability-scoped', unattendedCompatible: true, authoritySchemes: ['openbao'], knowledgePageIds: ['provider.cloudflare', 'services.credentials', 'vault.rotation'] },
			{ id: 'opentofu-state-encryption', label: 'OpenTofu state encryption', description: 'Independent encryption material that is never stored with the R2 state object.', capabilities: ['state-encryption'], fields: [field('stateEncryptionKey', 'OpenTofu state encryption key', 'A 32-byte hexadecimal key stored separately in core OpenBao.', true, true)], permissions: ['Encrypt and decrypt only the selected team OpenTofu state'], sharing: 'capability-scoped', unattendedCompatible: true, authoritySchemes: ['openbao'], knowledgePageIds: ['provider.cloudflare', 'services.credentials', 'vault.rotation'] },
		],
	},
	{
		id: 'railway',
		label: 'Railway',
		logoKey: 'railway',
		documentationUrl: 'https://docs.railway.com/guides/public-api',
		description: 'Connect a Railway workspace for future backend and private infrastructure.',
		knowledgePageIds: ['provider.railway'],
		connectionFields: [
			field('deploymentEnvironment', 'Deployment environment', 'The exact TreeSeed deployment environment. Use staging or production; one connection must never span both.'),
			field('workspaceId', 'Workspace ID', 'The non-secret Railway workspace identifier.'),
			field('projectId', 'Project ID', 'Optional non-secret project identifier used to adopt a reviewed hosted topology.', false),
			field('environmentId', 'Environment ID', 'Optional non-secret environment identifier used to target reviewed hosted deployments.', false),
		],
		capabilities: [
			{ type: 'backend-hosting', label: 'Backend hosting', description: 'API and backend service hosting.', credentialProfileIds: ['railway-workspace'], status: 'available' },
			{ type: 'database-hosting', label: 'Database hosting', description: 'Managed database placement.', credentialProfileIds: ['railway-workspace'], status: 'available' },
			{ type: 'capacity-runtime-hosting', label: 'Capacity runtime hosting', description: 'Future capacity provider placement.', credentialProfileIds: ['railway-workspace'], status: 'planned' },
			{ type: 'private-knowledge-index-hosting', label: 'Private knowledge hosting', description: 'Private TreeDX knowledge-plane placement.', credentialProfileIds: ['railway-workspace'], status: 'available' },
		],
		credentialProfiles: [{
			id: 'railway-workspace',
			label: 'Railway workspace token',
			description: 'Railway currently exposes broad workspace authority. Sharing it increases the blast radius across enabled capabilities.',
			capabilities: ['backend-hosting', 'database-hosting', 'capacity-runtime-hosting', 'private-knowledge-index-hosting'],
			fields: [field('apiToken', 'Workspace token', 'Stored in core OpenBao and used only by authorized operations.', true, true)],
			permissions: ['Workspace access required by the selected operations'],
			sharing: 'provider-shared',
			unattendedCompatible: true,
			authoritySchemes: ['openbao'],
			knowledgePageIds: ['provider.railway', 'services.credentials', 'vault.rotation'],
		}],
	},
] as const;

export function getServiceProviderDefinition(providerId: string): ServiceProviderDefinition | undefined {
	return SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === providerId);
}

export function serviceProviderSupportsCapability(providerId: string, capability: string): boolean {
	return Boolean(getServiceProviderDefinition(providerId)?.capabilities.some((item) => item.type === capability));
}
