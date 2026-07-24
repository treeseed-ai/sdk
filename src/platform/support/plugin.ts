import type {
	DeployConfig,
	PlatformLayerDefinition,
	PlatformResourceKind,
	PlatformSurfaceName,
	TenantConfig,
} from './contracts.ts';
import type { EnvironmentRegistryOverlay } from '../configuration/environment.ts';
import type { SdkGraphRankingProvider } from '../../entrypoints/models/sdk-types.ts';
import type { ReconcileAdapter } from '../../reconcile/support/contracts/contracts.ts';
import type {
	ApplicationHostingProfile,
	HostAdapter,
	ServiceTypeAdapter,
} from '../../hosting/contracts.ts';

export type SiteLayerDefinition = PlatformLayerDefinition & {
	kinds?: Array<'pages' | 'styles' | 'components'>;
};

export type SiteRouteContribution = {
	pattern: string;
	entrypoint?: string;
	resourcePath?: string;
	capability?: RouteCapability;
};

export type RouteOwner = 'market' | 'admin' | 'core';
export type RouteResponseKind = 'page' | 'message' | 'redirect' | 'data' | 'proxy' | 'action' | 'feed';
export type RouteArchetype = 'action' | 'auth-form' | 'collection' | 'dashboard' | 'detail' | 'feed' | 'message' | 'profile' | 'reader' | 'redirect' | 'settings' | 'wizard';
export type RouteNavigationPosture = 'primary' | 'secondary' | 'contextual' | 'hidden';
export type RouteStatus = 'active' | 'planned' | 'deprecated';

export interface RouteCapability {
	id: string;
	owner: RouteOwner;
	responseKind: RouteResponseKind;
	archetype: RouteArchetype;
	shell: string;
	template: string;
	surface: 'auth' | 'public' | 'personal' | 'team' | 'content' | 'system';
	resourceType: string;
	accessPolicy: string[];
	viewModelDependencies: string[];
	navigation: RouteNavigationPosture;
	states: Array<'loading' | 'empty' | 'forbidden' | 'unavailable' | 'validation' | 'conflict' | 'retry' | 'success' | 'not-found'>;
	selector: string;
	status: RouteStatus;
	guarantees: string[];
	description: string;
}

export function defineRoute<T extends SiteRouteContribution>(route: T): T {
	if (!route.pattern.startsWith('/')) throw new Error(`TreeSeed route pattern must start with "/": ${route.pattern}`);
	if (route.capability && !/^[a-z][a-z0-9.-]+$/u.test(route.capability.id)) {
		throw new Error(`Invalid TreeSeed route capability id: ${route.capability.id}`);
	}
	return route;
}

export function validateRouteCapabilities(routes: readonly SiteRouteContribution[]) {
	const patterns = new Set<string>();
	const ids = new Set<string>();
	for (const route of routes) {
		defineRoute(route);
		if (patterns.has(route.pattern)) throw new Error(`Duplicate TreeSeed route pattern: ${route.pattern}`);
		patterns.add(route.pattern);
		if (!route.capability) throw new Error(`TreeSeed route ${route.pattern} is missing capability metadata.`);
		if (ids.has(route.capability.id)) throw new Error(`Duplicate TreeSeed route capability id: ${route.capability.id}`);
		ids.add(route.capability.id);
	}
	return routes;
}

export type PlatformRouteContribution = {
	pattern: string;
	entrypoint?: string;
	resourcePath?: string;
	methods?: string[];
};

export type SiteExtensionContribution = {
	routes?: SiteRouteContribution[];
	starlightComponents?: Record<string, string>;
	customCss?: string[];
	remarkPlugins?: unknown[];
	rehypePlugins?: unknown[];
	envSchema?: Record<string, unknown>;
	vitePlugins?: unknown[];
	integrations?: unknown[];
	routeMiddleware?: unknown[];
};

export type PlatformExtensionContribution = {
	routes?: PlatformRouteContribution[];
	middleware?: unknown[];
	handlers?: Record<string, unknown>;
	config?: Record<string, unknown>;
	envSchema?: Record<string, unknown>;
	vitePlugins?: unknown[];
	integrations?: unknown[];
	customCss?: string[];
	remarkPlugins?: unknown[];
	rehypePlugins?: unknown[];
	routeMiddleware?: unknown[];
	starlightComponents?: Record<string, string>;
};

export type PluginSiteContext = {
	projectRoot: string;
	tenantConfig: TenantConfig;
	siteConfig?: unknown;
	deployConfig?: DeployConfig;
	pluginConfig: Record<string, unknown>;
};

export type PluginPlatformContext = PluginSiteContext & {
	surface: PlatformSurfaceName;
};

export type PlatformLayerContribution = PlatformLayerDefinition & {
	surface?: PlatformSurfaceName;
	kinds?: PlatformResourceKind[];
};

export type PluginEnvironmentContext = {
	projectRoot: string;
	tenantConfig?: TenantConfig;
	deployConfig?: DeployConfig;
	pluginConfig: Record<string, unknown>;
};

export type ContentProviderContext = PluginEnvironmentContext & {
	tenantConfig: TenantConfig;
};

export type GraphRankingProviderContribution =
	| SdkGraphRankingProvider
	| ((context: PluginEnvironmentContext) => SdkGraphRankingProvider | undefined);

export type HostingContribution = {
	hostAdapters?: Record<string, HostAdapter>;
	serviceTypeAdapters?: Record<string, ServiceTypeAdapter>;
	profiles?: ApplicationHostingProfile[];
	uiPlacements?: Record<string, unknown>;
	environmentDefaults?: Record<string, unknown>;
};

export interface Plugin {
	id?: string;
	provides?: Record<string, any> & {
		operations?: string[];
		dns?: string[];
		reconcile?: {
			providers?: string[];
		};
	};
	operationProviders?: Record<string, unknown>;
	siteProviders?: Record<
		string,
		SiteExtensionContribution | ((context: PluginSiteContext) => SiteExtensionContribution)
	>;
	contentProviders?: {
		runtime?: Record<string, unknown>;
		publish?: Record<string, unknown>;
		docs?: Record<string, unknown>;
	};
	siteHooks?: SiteExtensionContribution | ((context: PluginSiteContext) => SiteExtensionContribution);
	siteLayers?: SiteLayerDefinition[] | ((context: PluginSiteContext) => SiteLayerDefinition[] | undefined);
	platformProviders?: Record<
		PlatformSurfaceName,
		Record<string, PlatformExtensionContribution | ((context: PluginPlatformContext) => PlatformExtensionContribution)>
	>;
	platformHooks?:
		| Partial<Record<PlatformSurfaceName, PlatformExtensionContribution>>
		| ((context: PluginPlatformContext) => PlatformExtensionContribution | undefined);
	platformLayers?:
		| PlatformLayerContribution[]
		| ((context: PluginPlatformContext) => PlatformLayerContribution[] | undefined);
	environmentRegistry?:
		| EnvironmentRegistryOverlay
		| ((context: PluginEnvironmentContext) => EnvironmentRegistryOverlay | undefined);
	reconcileAdapters?:
		| Record<string, ReconcileAdapter | ((context: PluginEnvironmentContext) => ReconcileAdapter | undefined)>
		| ((context: PluginEnvironmentContext) => Record<string, ReconcileAdapter | ((context: PluginEnvironmentContext) => ReconcileAdapter | undefined)> | undefined);
	hosting?:
		| HostingContribution
		| ((context: PluginEnvironmentContext) => HostingContribution | undefined);
	graphRankingProviders?: Record<string, GraphRankingProviderContribution>;
	[key: string]: unknown;
}

export function definePlugin<T extends Plugin>(plugin: T): T {
	return plugin;
}
