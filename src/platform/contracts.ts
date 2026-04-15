export type TreeseedFeatureName =
	| 'docs'
	| 'books'
	| 'notes'
	| 'questions'
	| 'objectives'
	| 'agents'
	| 'forms';

export type TreeseedContentCollection =
	| 'pages'
	| 'notes'
	| 'questions'
	| 'objectives'
	| 'people'
	| 'agents'
	| 'books'
	| 'docs';

export interface TreeseedFeatureModules {
	docs?: boolean;
	books?: boolean;
	notes?: boolean;
	questions?: boolean;
	objectives?: boolean;
	agents?: boolean;
	forms?: boolean;
	[key: string]: boolean | undefined;
}

export interface TreeseedContentMap {
	pages: string;
	notes: string;
	questions: string;
	objectives: string;
	people: string;
	agents: string;
	books: string;
	docs: string;
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
}

export interface TreeseedManagedServiceEnvironmentConfig {
	baseUrl?: string;
	domain?: string;
	railwayEnvironment?: string;
}

export interface TreeseedManagedServiceRailwayConfig {
	projectId?: string;
	projectName?: string;
	serviceId?: string;
	serviceName?: string;
	rootDir?: string;
	buildCommand?: string;
	startCommand?: string;
}

export interface TreeseedManagedServiceConfig {
	enabled?: boolean;
	provider?: string;
	rootDir?: string;
	publicBaseUrl?: string;
	railway?: TreeseedManagedServiceRailwayConfig;
	environments?: Partial<Record<'local' | 'staging' | 'prod', TreeseedManagedServiceEnvironmentConfig>>;
}

export interface TreeseedManagedServicesConfig {
	api?: TreeseedManagedServiceConfig;
	agents?: TreeseedManagedServiceConfig;
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
	content?: {
		docs: string;
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
	cloudflare: {
		accountId: string;
		workerName?: string;
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
	overrides?: TreeseedTenantOverrides;
}
