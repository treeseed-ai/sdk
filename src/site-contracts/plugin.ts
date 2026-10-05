import type { DeployConfig, PlatformLayerDefinition, PlatformResourceKind, PlatformSurfaceName, TenantConfig } from './platform.ts';

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
	knowledgePageIds?: string[];
}

export interface SiteRouteContribution {
	pattern: string;
	entrypoint?: string;
	resourcePath?: string;
	capability?: RouteCapability;
}

export interface SiteExtensionContribution {
	routes?: SiteRouteContribution[];
	starlightComponents?: Record<string, string>;
	customCss?: string[];
	remarkPlugins?: unknown[];
	rehypePlugins?: unknown[];
	envSchema?: Record<string, unknown>;
	vitePlugins?: unknown[];
	integrations?: unknown[];
	routeMiddleware?: unknown[];
}

export interface PluginSiteContext {
	projectRoot: string;
	tenantConfig: TenantConfig;
	deployConfig?: DeployConfig;
	pluginConfig: Record<string, unknown>;
}

export interface Plugin {
	id?: string;
	provides?: Record<string, unknown>;
	siteProviders?: Record<string, SiteExtensionContribution | ((context: PluginSiteContext) => SiteExtensionContribution)>;
	siteHooks?: SiteExtensionContribution | ((context: PluginSiteContext) => SiteExtensionContribution);
	siteLayers?: PlatformLayerDefinition[] | ((context: PluginSiteContext) => PlatformLayerDefinition[] | undefined);
	platformLayers?: Array<PlatformLayerDefinition & { surface?: PlatformSurfaceName; kinds?: PlatformResourceKind[] }>;
	[key: string]: unknown;
}

export function defineRoute<T extends SiteRouteContribution>(route: T): T {
	if (!route.pattern.startsWith('/')) throw new Error(`TreeSeed route pattern must start with "/": ${route.pattern}`);
	if (route.capability && !/^[a-z][a-z0-9.-]+$/u.test(route.capability.id)) throw new Error(`Invalid TreeSeed route capability id: ${route.capability.id}`);
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

export function definePlugin<T extends Plugin>(plugin: T): T {
	return plugin;
}
