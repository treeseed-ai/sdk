import type {
	TreeseedDeployConfig,
	TreeseedPlatformLayerDefinition,
	TreeseedPlatformResourceKind,
	TreeseedPlatformSurfaceName,
	TreeseedTenantConfig,
} from './contracts.ts';
import type { TreeseedEnvironmentRegistryOverlay } from './environment.ts';
import type { SdkGraphRankingProvider } from '../sdk-types.ts';

export type TreeseedSiteLayerDefinition = TreeseedPlatformLayerDefinition & {
	kinds?: Array<'pages' | 'styles' | 'components'>;
};

export type TreeseedSiteRouteContribution = {
	pattern: string;
	entrypoint?: string;
	resourcePath?: string;
};

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

export interface TreeseedPlugin {
	id?: string;
	provides?: Record<string, any> & {
		operations?: string[];
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
	graphRankingProviders?: Record<string, TreeseedGraphRankingProviderContribution>;
	[key: string]: unknown;
}

export function defineTreeseedPlugin<T extends TreeseedPlugin>(plugin: T): T {
	return plugin;
}
