import { resolve } from 'node:path';
import { validateRailwayDeployPrerequisites } from "../../operations/services/railway-deploy.ts";
import type { TreeseedReconcileAdapter, TreeseedReconcileUnitType } from ".././contracts.ts";
import { buildRailwayEnv, buildWorkflowMetaAdapter } from './build-workflow-meta-adapter.ts';
import { observeRailwayUnit } from './observe-railway-unit.ts';
import { buildRailwayDiff, destroyRailwayUnit, reconcileRailwayUnit } from './railway-verification-may-settle.ts';
import { verifyRailwayUnit } from './verify-railway-unit.ts';
import { buildAttachmentDiff, observeCustomDomainUnit, observeDnsRecordUnit, resolveDesiredDnsRecords } from './capacity-provider-variables-for-service.ts';
import { reconcileCustomDomainUnit, reconcileDnsRecordUnit, verifyCustomDomainUnit, verifyDnsRecordUnit } from './verify-custom-domain-unit.ts';
import { buildCompositeAdapter, buildManifestAdapter, buildPackageWorkflowAdapter, isTransientRailwayReconcileError } from './to-deploy-target.ts';
import { buildCloudflareAdapter } from './build-cloudflare-diff.ts';
import { buildDockerImageBuildAdapter, buildGitHubWorkflowDispatchAdapter, buildPackageImageAdapter } from './build-git-hub-workflow-dispatch-adapter.ts';
import { buildGitHubBindingAdapter, buildGitHubEnvironmentAdapter } from './build-graph-only-adapter.ts';
import { buildLocalContentMaterializationAdapter, buildLocalProcessAdapter } from './build-local-content-materialization-adapter.ts';
import { buildCapacityProviderAdapter } from './build-capacity-provider-adapter.ts';
import { buildLocalDockerComposeAdapter } from './build-local-docker-compose-adapter.ts';
import { buildLocalTreeDxAdapter } from './verify-local-tree-dx-project-content.ts';
import { buildReleaseGateAdapter } from './build-release-gate-adapter.ts';

export function buildRailwayAdapter(unitType: TreeseedReconcileUnitType): TreeseedReconcileAdapter {
	return {
		providerId: 'railway',
		unitTypes: [unitType],
		supports(candidateUnitType, providerId) {
			return providerId === 'railway' && candidateUnitType === unitType;
		},
		validate(input) {
			const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
			validateRailwayDeployPrerequisites(input.context.tenantRoot, scope, {
				env: buildRailwayEnv(input, scope),
			});
		},
		refresh(input) {
			return observeRailwayUnit(input);
		},
		diff(input) {
			return buildRailwayDiff(input, input.observed);
		},
		apply(input) {
			return reconcileRailwayUnit(input, input.diff);
		},
		destroy(input) {
			return destroyRailwayUnit(input);
		},
		requiredPostconditions() {
			return [
				{ key: 'railway.project', description: 'Railway project exists' },
				{ key: 'railway.service', description: 'Railway service exists' },
				{ key: 'railway.environment', description: 'Railway environment exists' },
			];
		},
		verify(input) {
			return verifyRailwayUnit(input);
		},
	};
}

export function buildCustomDomainAdapter(unitType: 'custom-domain:web' | 'custom-domain:api', providerId: 'cloudflare' | 'railway'): TreeseedReconcileAdapter {
	return {
		providerId,
		unitTypes: [unitType],
		supports(candidateUnitType, candidateProviderId) {
			return candidateUnitType === unitType && candidateProviderId === providerId;
		},
		validate(input) {
			if (providerId === 'railway') {
				const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
				validateRailwayDeployPrerequisites(input.context.tenantRoot, scope, {
					env: buildRailwayEnv(input, scope),
				});
			}
		},
		refresh(input) {
			return observeCustomDomainUnit(input);
		},
		requiredPostconditions() {
			return [
				{ key: 'custom-domain.exists', description: 'Custom domain attachment exists' },
				...(providerId === 'railway'
					? [{ key: 'custom-domain.dns-requirements', description: 'Custom domain exposes DNS requirements' }]
					: []),
			];
		},
		diff(input) {
			return buildAttachmentDiff(input, input.observed);
		},
		async apply(input) {
			let attempt = 0;
			for (;;) {
				try {
					return await reconcileCustomDomainUnit(input, input.diff);
				} catch (error) {
					if (providerId !== 'railway' || attempt >= 2 || !isTransientRailwayReconcileError(error)) throw error;
					attempt += 1;
					process.stderr.write(`[trsd][railway][custom-domain] domain=${String(input.unit.spec.domain ?? '')} retry=${attempt}/2\n`);
					await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
				}
			}
		},
		verify(input) {
			return verifyCustomDomainUnit(input);
		},
	};
}

export function buildDnsRecordAdapter(): TreeseedReconcileAdapter {
	return {
		providerId: 'cloudflare-dns',
		unitTypes: ['dns-record'],
		supports(candidateUnitType, providerId) {
			return candidateUnitType === 'dns-record' && providerId === 'cloudflare-dns';
		},
		refresh(input) {
			return observeDnsRecordUnit(input);
		},
		requiredPostconditions(input) {
			const desired = resolveDesiredDnsRecords(input);
			return desired.map((record, index) => ({
				key: `dns-record:${index + 1}`,
				description: `DNS record ${record.type} ${record.name} matches the desired value`,
			}));
		},
		diff(input) {
			return buildAttachmentDiff(input, input.observed);
		},
		apply(input) {
			return reconcileDnsRecordUnit(input, input.diff);
		},
		verify(input) {
			return verifyDnsRecordUnit(input);
		},
	};
}

export function createCloudflareReconcileAdapters() {
	return [
		buildCloudflareAdapter('queue'),
		buildCloudflareAdapter('database'),
		buildCloudflareAdapter('content-store'),
		buildCloudflareAdapter('kv-form-guard'),
		buildCloudflareAdapter('turnstile-widget'),
		buildCloudflareAdapter('pages-project'),
		buildCloudflareAdapter('edge-worker'),
		buildCustomDomainAdapter('custom-domain:web', 'cloudflare'),
		buildDnsRecordAdapter(),
		buildCompositeAdapter('web-ui'),
	];
}

export function createRailwayReconcileAdapters() {
	return [
		buildRailwayAdapter('railway-service:api'),
		buildRailwayAdapter('railway-service:operations-runner'),
		buildRailwayAdapter('railway-service:workday-manager'),
		buildRailwayAdapter('railway-service:worker-runner'),
		buildCustomDomainAdapter('custom-domain:api', 'railway'),
		buildCompositeAdapter('api-runtime'),
		buildCompositeAdapter('operations-runner-runtime'),
		buildCompositeAdapter('workday-manager-runtime'),
		buildCompositeAdapter('worker-runner-runtime'),
	];
}

export function createPackageReconcileAdapters() {
	return [
		buildManifestAdapter(),
		buildPackageWorkflowAdapter(),
		buildPackageImageAdapter(),
	];
}

export function createGitHubReconcileAdapters() {
	return [
		buildGitHubEnvironmentAdapter(),
		buildGitHubBindingAdapter('github-secret-binding'),
		buildGitHubBindingAdapter('github-variable-binding'),
		buildGitHubWorkflowDispatchAdapter(),
	];
}

export function createDockerReconcileAdapters() {
	return [
		buildDockerImageBuildAdapter(),
	];
}

export function createLocalProcessReconcileAdapters() {
	return [
		buildLocalContentMaterializationAdapter(),
		buildLocalProcessAdapter(),
	];
}

export function createCapacityProviderReconcileAdapters() {
	return [
		buildCapacityProviderAdapter('local'),
		buildCapacityProviderAdapter('railway'),
		buildLocalDockerComposeAdapter(),
		buildLocalTreeDxAdapter(),
	];
}

export function createReleaseGateReconcileAdapters() {
	return [
		buildWorkflowMetaAdapter(),
		buildReleaseGateAdapter(),
	];
}
