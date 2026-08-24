import type { ComponentRelease, HostConfiguration } from './schemas.ts';

export interface TopologyBlocker {
	code: 'missing-connection' | 'invalid-locality' | 'missing-local-component' | 'missing-local-endpoint';
	componentId: string;
	dependencyId: string;
	message: string;
}

export function collectTopologyBlockers(host: HostConfiguration, releases: ComponentRelease[]): TopologyBlocker[] {
	const selected = new Map(releases.map((release) => [release.componentId, release]));
	const blockers: TopologyBlocker[] = [];
	for (const release of releases) {
		const selection = host.components[release.componentId];
		if (!selection?.enabled) continue;
		for (const dependency of release.runtime.dependencies) {
			const connection = selection.connections[dependency.id];
			if (!connection) {
				if (!dependency.optional) blockers.push({ code: 'missing-connection', componentId: release.componentId, dependencyId: dependency.id, message: `${release.componentId} requires an explicit ${dependency.id} connection.` });
				continue;
			}
			if (dependency.locality !== 'either' && connection.kind !== dependency.locality) {
				blockers.push({ code: 'invalid-locality', componentId: release.componentId, dependencyId: dependency.id, message: `${release.componentId}.${dependency.id} requires a ${dependency.locality} connection.` });
				continue;
			}
			if (connection.kind !== 'local') continue;
			const target = selected.get(connection.componentId);
			if (!target || !host.components[connection.componentId]?.enabled) {
				blockers.push({ code: 'missing-local-component', componentId: release.componentId, dependencyId: dependency.id, message: `${release.componentId}.${dependency.id} references disabled or unselected component ${connection.componentId}.` });
				continue;
			}
			const service = target.runtime.services.find((candidate) => candidate.id === connection.serviceId);
			if (!service?.endpoints.some((endpoint) => endpoint.id === connection.endpointId)) blockers.push({ code: 'missing-local-endpoint', componentId: release.componentId, dependencyId: dependency.id, message: `${release.componentId}.${dependency.id} references unknown endpoint ${connection.componentId}.${connection.serviceId}.${connection.endpointId}.` });
		}
	}
	return blockers.sort((left, right) => `${left.componentId}.${left.dependencyId}`.localeCompare(`${right.componentId}.${right.dependencyId}`));
}

export function hostNeedsEdge(host: HostConfiguration, releases: ComponentRelease[]) {
	return releases.some((release) => host.components[release.componentId]?.enabled && release.runtime.services.some((service) => service.endpoints.some((endpoint) => endpoint.visibility === 'host')));
}
