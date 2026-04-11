import type { TreeseedDeployConfig, TreeseedTenantConfig } from '../contracts.ts';
import type { TreeseedEnvironmentRegistryOverlay } from '../environment.ts';
import type { SdkGraphRankingProvider } from '../../sdk-types.ts';

export type TreeseedSiteLayerDefinition = {
	root: string;
	kinds?: Array<'pages' | 'styles' | 'components'>;
};

export type TreeseedSiteRouteContribution = {
	pattern: string;
	entrypoint?: string;
	resourcePath?: string;
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

export type TreeseedPluginSiteContext = {
	projectRoot: string;
	tenantConfig: TreeseedTenantConfig;
	siteConfig?: unknown;
	deployConfig?: TreeseedDeployConfig;
	pluginConfig: Record<string, unknown>;
};

export type TreeseedPluginEnvironmentContext = {
	projectRoot: string;
	tenantConfig?: TreeseedTenantConfig;
	deployConfig?: TreeseedDeployConfig;
	pluginConfig: Record<string, unknown>;
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
	siteHooks?: TreeseedSiteExtensionContribution | ((context: TreeseedPluginSiteContext) => TreeseedSiteExtensionContribution);
	siteLayers?: TreeseedSiteLayerDefinition[] | ((context: TreeseedPluginSiteContext) => TreeseedSiteLayerDefinition[] | undefined);
	environmentRegistry?:
		| TreeseedEnvironmentRegistryOverlay
		| ((context: TreeseedPluginEnvironmentContext) => TreeseedEnvironmentRegistryOverlay | undefined);
	graphRankingProviders?: Record<string, TreeseedGraphRankingProviderContribution>;
	[key: string]: unknown;
}

export function defineTreeseedPlugin<T extends TreeseedPlugin>(plugin: T): T {
	return plugin;
}
