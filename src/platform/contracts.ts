export type TreeseedFeatureName =
	| 'docs'
	| 'books'
	| 'notes'
	| 'questions'
	| 'objectives'
	| 'proposals'
	| 'decisions'
	| 'agents'
	| 'forms';

export type TreeseedContentCollection =
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

export interface TreeseedFeatureModules {
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

export interface TreeseedContentMap {
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

export interface TreeseedTenantSiteModelConfig {
	/**
	 * Controls whether this content model should be rendered by the site runtime.
	 * Content remains managed in Git and available through SDK/content pipelines.
	 */
	rendered?: boolean;
}

export interface TreeseedTenantSiteConfig {
	models?: Partial<Record<TreeseedContentCollection, TreeseedTenantSiteModelConfig>>;
}

export interface TreeseedBookDefinition {
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
		items?: TreeseedBookDefinition['sidebarItems'];
	}>;
	tags?: string[];
	id?: string;
}

export interface TreeseedThemeConfig {
	surfaces?: {
		background?: string;
		backgroundElevated?: string;
		backgroundSoft?: string;
		panel?: string;
		panelStrong?: string;
	};
	text?: {
		body?: string;
		muted?: string;
		soft?: string;
	};
	border?: {
		base?: string;
		strong?: string;
		grid?: string;
	};
	accent?: {
		base?: string;
		strong?: string;
		soft?: string;
	};
	info?: {
		base?: string;
		strong?: string;
		soft?: string;
	};
	warm?: {
		base?: string;
		strong?: string;
	};
}

export interface TreeseedPluginReference {
	package: string;
	enabled?: boolean;
	config?: Record<string, unknown>;
}

export type TreeseedPlatformSurfaceName = 'web' | 'api' | (string & {});

export type TreeseedPlatformResourceKind =
	| 'pages'
	| 'styles'
	| 'components'
	| 'routes'
	| 'middleware'
	| 'handlers'
	| 'config';

export interface TreeseedPlatformLayerDefinition {
	root: string;
	kinds?: TreeseedPlatformResourceKind[];
}

export interface TreeseedTenantSurfaceOverride {
	layers?: TreeseedPlatformLayerDefinition[];
}

export interface TreeseedTenantOverrides {
	pagesRoot?: string;
	stylesRoot?: string;
	componentsRoot?: string;
	surfaces?: Partial<Record<TreeseedPlatformSurfaceName, TreeseedTenantSurfaceOverride>>;
}

export interface TreeseedPlatformSurfaceConfig {
	enabled?: boolean;
	provider?: string;
	rootDir?: string;
	publicBaseUrl?: string;
	localBaseUrl?: string;
	environments?: Partial<Record<'local' | 'staging' | 'prod', TreeseedManagedServiceEnvironmentConfig>>;
	cache?: TreeseedWebSurfaceCacheConfig;
}

export interface TreeseedWebCachePolicyConfig {
	browserTtlSeconds?: number;
	edgeTtlSeconds?: number;
	staleWhileRevalidateSeconds?: number;
	staleIfErrorSeconds?: number;
}

export interface TreeseedWebSourcePageCacheConfig extends TreeseedWebCachePolicyConfig {
	paths?: string[];
}

export interface TreeseedWebSurfaceCacheConfig {
	sourcePages?: TreeseedWebSourcePageCacheConfig;
	contentPages?: TreeseedWebCachePolicyConfig;
	r2PublishedObjects?: TreeseedWebCachePolicyConfig;
}

export type TreeseedContentServingMode = 'local_collections' | 'published_runtime';

export interface TreeseedCloudflareR2Config {
	binding?: string;
	bucketName?: string;
	publicBaseUrl?: string;
	manifestKeyTemplate?: string;
	previewRootTemplate?: string;
	previewTtlHours?: number;
}

export interface TreeseedCloudflarePagesConfig {
	projectName?: string;
	previewProjectName?: string;
	productionBranch?: string;
	stagingBranch?: string;
	buildOutputDir?: string;
}

export type TreeseedHostingKind = 'market_control_plane' | 'hosted_project' | 'self_hosted_project';
export type TreeseedHostingRegistration = 'optional' | 'none';
export type TreeseedHubMode = 'treeseed_hosted' | 'customer_hosted';
export type TreeseedRuntimeMode = 'none' | 'byo_attached' | 'treeseed_managed';
export type TreeseedRuntimeRegistration = 'optional' | 'required' | 'none';

export interface TreeseedHostingConfig {
	kind: TreeseedHostingKind;
	registration?: TreeseedHostingRegistration;
	marketBaseUrl?: string;
	teamId?: string;
	projectId?: string;
}

export interface TreeseedHubConfig {
	mode: TreeseedHubMode;
}

export interface TreeseedRuntimeConfig {
	mode: TreeseedRuntimeMode;
	registration?: TreeseedRuntimeRegistration;
	marketBaseUrl?: string;
	teamId?: string;
	projectId?: string;
}

export interface TreeseedManagedServiceEnvironmentConfig {
	baseUrl?: string;
	domain?: string;
	railwayEnvironment?: string;
}

export interface TreeseedManagedServiceCloudflareConfig {
	workerName?: string;
}

export interface TreeseedManagedServiceRailwayConfig {
	projectId?: string;
	projectName?: string;
	serviceId?: string;
	serviceName?: string;
	rootDir?: string;
	buildCommand?: string;
	startCommand?: string;
	healthcheckPath?: string;
	healthcheckTimeoutSeconds?: number;
	healthcheckIntervalSeconds?: number;
	restartPolicy?: string;
	runtimeMode?: string;
	schedule?: string | string[];
}

export interface TreeseedManagedServiceConfig {
	enabled?: boolean;
	provider?: string;
	rootDir?: string;
	publicBaseUrl?: string;
	cloudflare?: TreeseedManagedServiceCloudflareConfig;
	railway?: TreeseedManagedServiceRailwayConfig;
	environments?: Partial<Record<'local' | 'staging' | 'prod', TreeseedManagedServiceEnvironmentConfig>>;
}

export interface TreeseedManagedServicesConfig {
	api?: TreeseedManagedServiceConfig;
	[key: string]: TreeseedManagedServiceConfig | undefined;
}

export interface TreeseedPlatformSurfacesConfig {
	web?: TreeseedPlatformSurfaceConfig;
	api?: TreeseedPlatformSurfaceConfig;
	[key: string]: TreeseedPlatformSurfaceConfig | undefined;
}

export interface TreeseedProviderSelections {
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
		serving?: TreeseedContentServingMode;
	};
	site?: string;
}

export interface TreeseedExportConfig {
	ignore?: string[];
	bundledPaths?: string[];
}

export interface TreeseedDeployConfig {
	name: string;
	slug: string;
	siteUrl: string;
	contactEmail: string;
	hosting?: TreeseedHostingConfig;
	hub: TreeseedHubConfig;
	runtime: TreeseedRuntimeConfig;
	cloudflare: {
		accountId: string;
		zoneId?: string;
		workerName?: string;
		queueName?: string;
		dlqName?: string;
		d1Binding?: string;
		queueBinding?: string;
		pages?: TreeseedCloudflarePagesConfig;
		r2?: TreeseedCloudflareR2Config;
	};
	plugins: TreeseedPluginReference[];
	providers: TreeseedProviderSelections;
	surfaces?: TreeseedPlatformSurfacesConfig;
	services?: TreeseedManagedServicesConfig;
	smtp?: {
		enabled?: boolean;
	};
	turnstile?: {
		enabled?: boolean;
	};
	export?: TreeseedExportConfig;
}

export interface TreeseedTenantConfig {
	id: string;
	siteConfigPath: string;
	content: TreeseedContentMap;
	features: TreeseedFeatureModules;
	site?: TreeseedTenantSiteConfig;
	overrides?: TreeseedTenantOverrides;
}
