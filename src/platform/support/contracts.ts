export type FeatureName =
	| 'docs'
	| 'books'
	| 'notes'
	| 'questions'
	| 'objectives'
	| 'proposals'
	| 'decisions'
	| 'agents'
	| 'forms';

export type ContentCollection =
	| 'pages'
	| 'notes'
	| 'questions'
	| 'objectives'
	| 'proposals'
	| 'decisions'
	| 'people'
	| 'agents'
	| 'books'
	| 'docs'
	| 'templates'
	| 'knowledge_packs'
	| 'workdays';

export interface FeatureModules {
	docs?: boolean;
	books?: boolean;
	notes?: boolean;
	questions?: boolean;
	objectives?: boolean;
	proposals?: boolean;
	decisions?: boolean;
	agents?: boolean;
	forms?: boolean;
	[key: string]: boolean | undefined;
}

export interface ContentMap {
	pages: string;
	notes: string;
	questions: string;
	objectives: string;
	proposals: string;
	decisions: string;
	people: string;
	agents: string;
	books: string;
	docs: string;
	templates?: string;
	knowledge_packs?: string;
	workdays?: string;
	[key: string]: string | undefined;
}

export interface TenantSiteModelConfig {
	/**
	 * Controls whether this content model should be rendered by the site runtime.
	 * Content remains managed in Git and available through SDK/content pipelines.
	 */
	rendered?: boolean;
}

export interface TenantSiteConfig {
	models?: Partial<Record<ContentCollection, TenantSiteModelConfig>>;
}

export interface BookDefinition {
	order: number;
	slug: string;
	title: string;
	description: string;
	summary: string;
	sectionLabel: string;
	basePath: string;
	landingPath: string;
	outlinePath?: string;
	downloadFileName: string;
	downloadHref: string;
	downloadTitle: string;
	exportRoots?: string[];
	sidebarItems: Array<{
		label: string;
		link?: string;
		autogenerate?: { directory: string };
		items?: BookDefinition['sidebarItems'];
	}>;
	tags?: string[];
	id?: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export type ColorSchemeId = 'fern' | 'lichen' | 'cedar' | 'tidepool' | (string & {});

export interface SemanticColorTokens {
	canvas: string;
	canvasSubtle: string;
	surface: string;
	surfaceMuted: string;
	surfaceRaised: string;
	surfaceOverlay: string;
	text: string;
	textMuted: string;
	textSubtle: string;
	textInverse: string;
	link: string;
	linkHover: string;
	border: string;
	borderMuted: string;
	borderStrong: string;
	focus: string;
	accent: string;
	accentHover: string;
	accentStrong: string;
	accentSoft: string;
	accentText: string;
	info: string;
	infoSoft: string;
	infoText: string;
	infoBorder: string;
	success: string;
	successSoft: string;
	successText: string;
	successBorder: string;
	warning: string;
	warningSoft: string;
	warningText: string;
	warningBorder: string;
	danger: string;
	dangerSoft: string;
	dangerText: string;
	dangerBorder: string;
	shadow: string;
	grid: string;
}

export interface SchemeTokens {
	light: SemanticColorTokens;
	dark: SemanticColorTokens;
}

export interface ThemeConfig {
	defaultScheme?: ColorSchemeId;
	defaultMode?: ThemeMode;
	schemes?: Record<ColorSchemeId, Partial<{
		light: Partial<SemanticColorTokens>;
		dark: Partial<SemanticColorTokens>;
	}>>;
}

export interface PluginReference {
	package: string;
	enabled?: boolean;
	config?: Record<string, unknown>;
}

export type PlatformSurfaceName = 'web' | 'api' | (string & {});

export type PlatformResourceKind =
	| 'pages'
	| 'styles'
	| 'components'
	| 'routes'
	| 'middleware'
	| 'handlers'
	| 'config';

export interface PlatformLayerDefinition {
	root: string;
	kinds?: PlatformResourceKind[];
}

export interface TenantSurfaceOverride {
	layers?: PlatformLayerDefinition[];
}

export interface TenantOverrides {
	pagesRoot?: string;
	stylesRoot?: string;
	componentsRoot?: string;
	surfaces?: Partial<Record<PlatformSurfaceName, TenantSurfaceOverride>>;
}

export interface PlatformSurfaceConfig {
	enabled?: boolean;
	provider?: string;
	rootDir?: string;
	publicBaseUrl?: string;
	localBaseUrl?: string;
	local?: LocalRuntimeConfig;
	environments?: Partial<Record<'local' | 'staging' | 'prod', ManagedServiceEnvironmentConfig>>;
	cache?: WebSurfaceCacheConfig;
}

export interface WebCachePolicyConfig {
	browserTtlSeconds?: number;
	edgeTtlSeconds?: number;
	staleWhileRevalidateSeconds?: number;
	staleIfErrorSeconds?: number;
}

export interface WebSourcePageCacheConfig extends WebCachePolicyConfig {
	paths?: string[];
}

export interface WebSurfaceCacheConfig {
	sourcePages?: WebSourcePageCacheConfig;
	contentPages?: WebCachePolicyConfig;
	r2PublishedObjects?: WebCachePolicyConfig;
}

export type ContentServingMode = 'local_collections' | 'published_runtime';

export interface CloudflareR2Config {
	binding?: string;
	bucketName?: string;
	publicBaseUrl?: string;
	manifestKeyTemplate?: string;
	previewRootTemplate?: string;
	previewTtlHours?: number;
}

export interface CloudflarePagesConfig {
	projectName?: string;
	previewProjectName?: string;
	productionBranch?: string;
	stagingBranch?: string;
	buildCommand?: string;
	buildOutputDir?: string;
}

export type HostingKind = 'treeseed_control_plane' | 'hosted_project' | 'self_hosted_project';
export type HostingRegistration = 'optional' | 'none';
export type HubMode = 'treeseed_hosted' | 'customer_hosted';
export type RuntimeMode = 'none' | 'byo_attached' | 'treeseed_managed';
export type RuntimeRegistration = 'optional' | 'required' | 'none';
export type ProcessingMode = 'market-assigned' | 'team-owned' | 'project-owned' | 'local' | 'none';

export interface HostingConfig {
	kind: HostingKind;
	registration?: HostingRegistration;
	marketBaseUrl?: string;
	teamId?: string;
	projectId?: string;
}

export interface HubConfig {
	mode: HubMode;
}

export interface RuntimeConfig {
	mode: RuntimeMode;
	registration?: RuntimeRegistration;
	marketBaseUrl?: string;
	teamId?: string;
	projectId?: string;
}

export interface ProcessingConfig {
	mode: ProcessingMode;
	providerRef?: string;
	requiredCapabilities?: string[];
}

export interface ManagedServiceEnvironmentConfig {
	baseUrl?: string;
	domain?: string;
	railwayEnvironment?: string;
	railwayProjectName?: string;
	serviceName?: string;
	railwayServiceName?: string;
}

export type LocalRuntimeMode = 'auto' | 'provider' | 'local';

export interface LocalRuntimeConfig {
	runtime?: LocalRuntimeMode;
}

export interface ManagedServiceCloudflareConfig {
	workerName?: string;
}

export interface ManagedServiceRailwayConfig {
	projectId?: string;
	projectName?: string;
	serviceId?: string;
	serviceName?: string;
	rootDir?: string;
	imageRef?: string;
	sourceMode?: 'git' | 'image';
	sourceRepo?: string;
	sourceBranch?: string;
	sourceRootDirectory?: string;
	buildCommand?: string;
	startCommand?: string;
	healthcheckPath?: string;
	healthcheckTimeoutSeconds?: number;
	healthcheckIntervalSeconds?: number;
	restartPolicy?: string;
	runtimeMode?: string;
	resourceType?: string;
	environmentVariable?: string;
	serviceTargets?: string[];
	volumeMountPath?: string;
	runnerPool?: {
		bootstrapCount?: number;
		maxRunners?: number;
		volumeMountPath?: string;
	};
	schedule?: string | string[];
}

export interface ManagedServiceConfig {
	enabled?: boolean;
	provider?: string;
	rootDir?: string;
	publicBaseUrl?: string;
	cloudflare?: ManagedServiceCloudflareConfig;
	railway?: ManagedServiceRailwayConfig;
	local?: LocalRuntimeConfig;
	environments?: Partial<Record<'local' | 'staging' | 'prod', ManagedServiceEnvironmentConfig>>;
}

export interface ManagedServicesConfig {
	api?: ManagedServiceConfig;
	[key: string]: ManagedServiceConfig | undefined;
}

export interface PublicTreeDxFederationConfig {
	railway?: {
		nodePool?: {
			bootstrapCount?: number;
			maxNodes?: number;
		};
	};
}

export interface PlatformSurfacesConfig {
	web?: PlatformSurfaceConfig;
	api?: PlatformSurfaceConfig;
	[key: string]: PlatformSurfaceConfig | undefined;
}

export interface ProviderSelections {
	forms: string;
	operations: string;
	agents: {
		execution: string;
		mutation: string;
		repository: string;
		verification: string;
		notification: string;
		research: string;
	};
	deploy: string;
	dns?: string;
	content?: {
		runtime: string;
		publish: string;
		docs?: string;
		serving?: ContentServingMode;
	};
	site?: string;
}

export interface ExportConfig {
	ignore?: string[];
	bundledPaths?: string[];
}

export interface ApiConnectionConfig {
	proxyPrefix?: string;
	localBaseUrl?: string;
	environments?: Partial<Record<'local' | 'staging' | 'prod', {
		baseUrl?: string;
		domain?: string;
	}>>;
}

export interface DeployConfig {
	name: string;
	slug: string;
	siteUrl: string;
	contactEmail: string;
	projectRoot?: string;
	hosting?: HostingConfig;
	hub: HubConfig;
	runtime: RuntimeConfig;
	cloudflare: {
		accountId: string;
		zoneId?: string;
		workerName?: string;
		queueName?: string;
		dlqName?: string;
		d1Binding?: string;
		queueBinding?: string;
		pages?: CloudflarePagesConfig;
		r2?: CloudflareR2Config;
	};
	plugins: PluginReference[];
	providers: ProviderSelections;
	surfaces?: PlatformSurfacesConfig;
	services?: ManagedServicesConfig;
	publicTreeDxFederation?: PublicTreeDxFederationConfig;
	connections?: {
		api?: ApiConnectionConfig;
		[key: string]: unknown;
	};
	processing?: ProcessingConfig;
	smtp?: {
		enabled?: boolean;
	};
	turnstile?: {
		enabled?: boolean;
	};
	export?: ExportConfig;
}

export interface TenantConfig {
	id: string;
	siteConfigPath: string;
	content: ContentMap;
	features: FeatureModules;
	site?: TenantSiteConfig;
	overrides?: TenantOverrides;
}
