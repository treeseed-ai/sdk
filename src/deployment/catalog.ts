import { componentReleaseSchema, hostConfigurationSchema, releaseCatalogSchema, type ComponentRelease, type HostConfiguration, type ReleaseCatalog } from './schemas.ts';

export interface MixedTrackResolution {
	components: ComponentRelease[];
	warnings: string[];
}

export function resolveMixedTrackCatalog(input: { host: HostConfiguration; stable: ReleaseCatalog; development?: ReleaseCatalog }): MixedTrackResolution {
	const host = hostConfigurationSchema.parse(input.host);
	const stable = releaseCatalogSchema.parse(input.stable);
	const development = input.development ? releaseCatalogSchema.parse(input.development) : undefined;
	if (stable.track !== 'stable' || stable.stableBase !== null) throw new Error('The base catalog must be stable and self-contained.');
	if (development && (development.track !== 'development' || development.stableBase?.catalogDigest !== stable.catalogDigest)) throw new Error('Development catalog is not bound to the selected stable catalog.');
	const stableComponents = new Map(stable.components.map((component) => [component.componentId, component]));
	const developmentComponents = new Map(development?.components.map((component) => [component.componentId, component]) ?? []);
	const components: ComponentRelease[] = [];
	const warnings: string[] = [];
	for (const [componentId, selection] of Object.entries(host.components).sort(([left], [right]) => left.localeCompare(right))) {
		if (!selection.enabled) continue;
		const selected = selection.track === 'development' ? developmentComponents.get(componentId) : stableComponents.get(componentId);
		if (!selected) throw new Error(`No ${selection.track} release is available for enabled component ${componentId}.`);
		componentReleaseSchema.parse(selected);
		if (selected.track === 'development' && selected.stableBase?.compatibilityId !== stable.compatibilityId) throw new Error(`Development component ${componentId} is incompatible with stable base ${stable.compatibilityId}.`);
		components.push(selected);
		if (selection.track === 'development') warnings.push(`${componentId} follows the continuous development track.`);
	}
	return { components, warnings };
}

export function collectHostAliases(components: readonly ComponentRelease[], overrides: Record<string, string> = {}) {
	const endpoints = new Map<string, ComponentRelease['runtime']['services'][number]['endpoints'][number]>();
	for (const component of components) for (const service of component.runtime.services) for (const endpoint of service.endpoints) {
		if (endpoint.visibility === 'host') endpoints.set(`${component.componentId}.${service.id}.${endpoint.id}`, endpoint);
	}
	for (const [key, alias] of Object.entries(overrides)) {
		const endpoint = endpoints.get(key);
		if (!endpoint) throw new Error(`Alias override ${key} does not identify an accepted host endpoint.`);
		if (!endpoint.aliasOverride) throw new Error(`Host endpoint ${key} does not permit alias overrides.`);
		if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.localhost$/u.test(alias)) throw new Error(`Alias override ${key} must use the .localhost namespace.`);
	}
	const aliases = new Map<string, { componentId: string; serviceId: string; endpointId: string; port: number }>();
	for (const component of components) for (const service of component.runtime.services) for (const endpoint of service.endpoints) {
		if (endpoint.visibility !== 'host') continue;
		const key = `${component.componentId}.${service.id}.${endpoint.id}`;
		const alias = overrides[key] ?? endpoint.defaultAlias;
		if (!alias?.endsWith('.localhost')) throw new Error(`Host endpoint ${key} requires a .localhost alias.`);
		if (aliases.has(alias)) throw new Error(`Duplicate host alias ${alias}.`);
		aliases.set(alias, { componentId: component.componentId, serviceId: service.id, endpointId: endpoint.id, port: endpoint.port });
	}
	return aliases;
}
