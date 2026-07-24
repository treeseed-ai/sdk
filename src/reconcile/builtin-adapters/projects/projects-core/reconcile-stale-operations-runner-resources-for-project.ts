import { findStaleOperationsRunnerResources } from "../../../../operations/services/hosting/railway/railway-deploy.ts";
import { listRailwayServices, listRailwayVolumes } from "../../../../operations/services/hosting/railway/railway-api.ts";
import type { ReconcileAdapterInput } from "../../../support/contracts/contracts.ts";
import { activeRailwayVolumeInstances, recordRailwayProviderDrift, traceRailwayReconcile } from '../../hosting/resolve-railway-topology-for-scope.ts';

export async function reconcileStaleOperationsRunnerResourcesForProject(
	input: ReconcileAdapterInput,
	{
		scope,
		env,
		project,
		environment,
		desiredServiceNames,
		desiredVolumeNames,
	}: {
		scope: string;
		env: NodeJS.ProcessEnv | Record<string, string | undefined>;
		project: { id: string; name: string };
		environment: { id: string; name: string };
		desiredServiceNames: Set<string>;
		desiredVolumeNames: Set<string>;
	},
) {
	if (desiredServiceNames.size === 0 || desiredVolumeNames.size === 0) {
		traceRailwayReconcile(env, 'sync:runner:delete-skip', `${project.name}: no desired runner names; refusing to prune operations runner resources`);
		return;
	}
	const services = await listRailwayServices({ projectId: project.id, env });
	const desiredServiceIds = new Set(services
		.filter((service) => desiredServiceNames.has(service.name))
		.map((service) => service.id));
	const staleServices = findStaleOperationsRunnerResources(services, desiredServiceNames);
	traceRailwayReconcile(
		env,
		'sync:runner:observed-services',
		`${project.name}: desired=${[...desiredServiceNames].join(',') || '(none)'} stale=${staleServices.map((service) => service.name).join(',') || '(none)'}`,
	);
	for (const service of staleServices) {
		traceRailwayReconcile(env, 'sync:runner:block-stale-service', `${service.name}:${service.id}`);
		recordRailwayProviderDrift(input, scope, {
			kind: 'railway.stale-operations-runner-service',
			action: 'manual-repair-required',
			status: 'blocked',
			projectId: project.id,
			environmentId: environment.id,
			serviceId: service.id,
			serviceName: service.name,
			reason: 'Railway reports an undeclared operations runner service. Reconciliation refuses to delete existing services; adopt, rename, retain, or remove it through an explicit destroy workflow.',
		});
	}
	const volumes = await listRailwayVolumes({ projectId: project.id, env }).catch(() => []);
	const staleVolumes = findStaleOperationsRunnerResources(volumes, desiredVolumeNames)
		.filter((volume) => {
			const activeInstances = activeRailwayVolumeInstances(volume);
			return volume.instances.length === 0 || activeInstances.length > 0;
		})
		.filter((volume) => activeRailwayVolumeInstances(volume).every((instance) => !desiredServiceIds.has(instance.serviceId ?? '')));
	traceRailwayReconcile(
		env,
		'sync:runner:observed-volumes',
		`${project.name}: desired=${[...desiredVolumeNames].join(',') || '(none)'} stale=${staleVolumes.map((volume) => volume.name ?? volume.id).join(',') || '(none)'}`,
	);
	for (const volume of staleVolumes) {
		traceRailwayReconcile(env, 'sync:runner:block-stale-volume', `${volume.name ?? volume.id}:${volume.id}`);
		recordRailwayProviderDrift(input, scope, {
			kind: 'railway.stale-operations-runner-volume',
			action: 'manual-repair-required',
			status: 'blocked',
			projectId: project.id,
			environmentId: environment.id,
			volumeId: volume.id,
			volumeName: volume.name ?? null,
			reason: 'Railway reports an undeclared operations runner volume. Reconciliation refuses destructive cleanup during repair; adopt, retain, or remove it through an explicit destroy workflow.',
		});
	}
}
