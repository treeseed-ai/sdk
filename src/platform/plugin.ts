import type {
	TreeseedDeployConfig,
	TreeseedPlatformLayerDefinition,
	TreeseedPlatformResourceKind,
	TreeseedPlatformSurfaceName,
	TreeseedTenantConfig,
} from './contracts.ts';
import type { TreeseedEnvironmentRegistryOverlay } from './environment.ts';
import type { SdkGraphRankingProvider } from '../sdk-types.ts';
import type { TreeseedReconcileAdapter } from '../reconcile/contracts.ts';
import type {
	TreeseedApplicationHostingProfile,
	TreeseedHostAdapter,
	TreeseedServiceTypeAdapter,
} from '../hosting/contracts.ts';

export type TreeseedSiteLayerDefinition = TreeseedPlatformLayerDefinition & {
	kinds?: Array<'pages' | 'styles' | 'components'>;
};

export type TreeseedSiteRouteContribution = {
	pattern: string;
	entrypoint?: string;
	resourcePath?: string;
	capability?: TreeseedRouteCapability;
};

export type TreeseedRouteOwner = 'market' | 'admin' | 'core';
export type TreeseedRouteResponseKind = 'page' | 'message' | 'redirect' | 'data' | 'proxy' | 'action' | 'feed';
export type TreeseedRouteArchetype = 'action' | 'auth-form' | 'collection' | 'dashboard' | 'detail' | 'feed' | 'message' | 'profile' | 'reader' | 'redirect' | 'settings' | 'wizard';
export type TreeseedRouteNavigationPosture = 'primary' | 'secondary' | 'contextual' | 'hidden';
export type TreeseedRouteStatus = 'active' | 'planned' | 'deprecated';

export interface TreeseedRouteCapability {
	id: string;
	owner: TreeseedRouteOwner;
	responseKind: TreeseedRouteResponseKind;
	archetype: TreeseedRouteArchetype;
	shell: string;
	template: string;
	surface: 'auth' | 'public' | 'personal' | 'team' | 'content' | 'system';
	resourceType: string;
	accessPolicy: string[];
	viewModelDependencies: string[];
	navigation: TreeseedRouteNavigationPosture;
	states: Array<'loading' | 'empty' | 'forbidden' | 'unavailable' | 'validation' | 'conflict' | 'retry' | 'success' | 'not-found'>;
	selector: string;
	status: TreeseedRouteStatus;
	guarantees: string[];
	description: string;
}

export function defineTreeseedRoute<T extends TreeseedSiteRouteContribution>(route: T): T {
	if (!route.pattern.startsWith('/')) throw new Error(`TreeSeed route pattern must start with "/": ${route.pattern}`);
	if (route.capability && !/^[a-z][a-z0-9.-]+$/u.test(route.capability.id)) {
		throw new Error(`Invalid TreeSeed route capability id: ${route.capability.id}`);
	}
	return route;
}

export function validateTreeseedRouteCapabilities(routes: readonly TreeseedSiteRouteContribution[]) {
	const patterns = new Set<string>();
	const ids = new Set<string>();
	for (const route of routes) {
		defineTreeseedRoute(route);
		if (patterns.has(route.pattern)) throw new Error(`Duplicate TreeSeed route pattern: ${route.pattern}`);
		patterns.add(route.pattern);
		if (!route.capability) throw new Error(`TreeSeed route ${route.pattern} is missing capability metadata.`);
		if (ids.has(route.capability.id)) throw new Error(`Duplicate TreeSeed route capability id: ${route.capability.id}`);
		ids.add(route.capability.id);
	}
	return routes;
}

export type TreeseedPlatformRouteContribution = {
	pattern: string;
	entrypoint?: string;
	resourcePath?: string;
	methods?: string[];
};

export type TreeseedSiteExtensionContribution = {
	routes?: TreeseedSiteRouteContribution[];
	starlightComponents?: Record<string, string>;
	customCss?: string[];
	remarkPlugins?: unknown[];
	rehypePlugins?: unknown[];
	envSchema?: Record<string, unknown>;
	vitePlugins?: unknown[];
	integrations?: unknown[];
	routeMiddleware?: unknown[];
};

export type TreeseedPlatformExtensionContribution = {
	routes?: TreeseedPlatformRouteContribution[];
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

export type TreeseedPluginSiteContext = {
	projectRoot: string;
	tenantConfig: TreeseedTenantConfig;
	siteConfig?: unknown;
	deployConfig?: TreeseedDeployConfig;
	pluginConfig: Record<string, unknown>;
};

export type TreeseedPluginPlatformContext = TreeseedPluginSiteContext & {
	surface: TreeseedPlatformSurfaceName;
};

export type TreeseedPlatformLayerContribution = TreeseedPlatformLayerDefinition & {
	surface?: TreeseedPlatformSurfaceName;
	kinds?: TreeseedPlatformResourceKind[];
};

export type TreeseedPluginEnvironmentContext = {
	projectRoot: string;
	tenantConfig?: TreeseedTenantConfig;
	deployConfig?: TreeseedDeployConfig;
	pluginConfig: Record<string, unknown>;
};

export type TreeseedContentProviderContext = TreeseedPluginEnvironmentContext & {
	tenantConfig: TreeseedTenantConfig;
};

export type TreeseedGraphRankingProviderContribution =
	| SdkGraphRankingProvider
	| ((context: TreeseedPluginEnvironmentContext) => SdkGraphRankingProvider | undefined);

export type TreeseedHostingContribution = {
	hostAdapters?: Record<string, TreeseedHostAdapter>;
	serviceTypeAdapters?: Record<string, TreeseedServiceTypeAdapter>;
	profiles?: TreeseedApplicationHostingProfile[];
	uiPlacements?: Record<string, unknown>;
	environmentDefaults?: Record<string, unknown>;
};

export interface TreeseedPlugin {
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
		TreeseedSiteExtensionContribution | ((context: TreeseedPluginSiteContext) => TreeseedSiteExtensionContribution)
	>;
	contentProviders?: {
		runtime?: Record<string, unknown>;
		publish?: Record<string, unknown>;
		docs?: Record<string, unknown>;
	};
	siteHooks?: TreeseedSiteExtensionContribution | ((context: TreeseedPluginSiteContext) => TreeseedSiteExtensionContribution);
	siteLayers?: TreeseedSiteLayerDefinition[] | ((context: TreeseedPluginSiteContext) => TreeseedSiteLayerDefinition[] | undefined);
	platformProviders?: Record<
		TreeseedPlatformSurfaceName,
		Record<string, TreeseedPlatformExtensionContribution | ((context: TreeseedPluginPlatformContext) => TreeseedPlatformExtensionContribution)>
	>;
	platformHooks?:
		| Partial<Record<TreeseedPlatformSurfaceName, TreeseedPlatformExtensionContribution>>
		| ((context: TreeseedPluginPlatformContext) => TreeseedPlatformExtensionContribution | undefined);
	platformLayers?:
		| TreeseedPlatformLayerContribution[]
		| ((context: TreeseedPluginPlatformContext) => TreeseedPlatformLayerContribution[] | undefined);
	environmentRegistry?:
		| TreeseedEnvironmentRegistryOverlay
		| ((context: TreeseedPluginEnvironmentContext) => TreeseedEnvironmentRegistryOverlay | undefined);
	reconcileAdapters?:
		| Record<string, TreeseedReconcileAdapter | ((context: TreeseedPluginEnvironmentContext) => TreeseedReconcileAdapter | undefined)>
		| ((context: TreeseedPluginEnvironmentContext) => Record<string, TreeseedReconcileAdapter | ((context: TreeseedPluginEnvironmentContext) => TreeseedReconcileAdapter | undefined)> | undefined);
	hosting?:
		| TreeseedHostingContribution
		| ((context: TreeseedPluginEnvironmentContext) => TreeseedHostingContribution | undefined);
	graphRankingProviders?: Record<string, TreeseedGraphRankingProviderContribution>;
	[key: string]: unknown;
}

export function defineTreeseedPlugin<T extends TreeseedPlugin>(plugin: T): T {
	return plugin;
}
