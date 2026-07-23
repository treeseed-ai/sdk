import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	discoverTreeseedPackageAdapters,
	type TreeseedPackageAdapter,
} from '../../operations/services/package-adapters.ts';
import { redactCapacityProviderEnv, validateAndDigestCapacityProviderManifest } from '../../capacity-provider.ts';
import { workspaceRoot } from '../../operations/services/workspace-tools.ts';
import {
	checkedOutTemplateRepositories,
	type TreeseedTemplateRepositoryManifest,
} from '../../operations/services/managed-repositories.ts';
import { deriveTreeseedDesiredUnits } from '../../reconcile/desired-state.ts';
import type { TreeseedDesiredUnit, TreeseedReconcileSelector, TreeseedReconcileTarget } from '../../reconcile/contracts.ts';
import {
	buildProjectLocalContentResources,
	type TreeseedLocalContentMode,
} from '../local-content-materialization.ts';
import { localTreeDxSeedDigest } from '../local-treedx-seed.ts';
import { TreeseedDesiredEnvironment, TreeseedDesiredResource, TreeseedPackageUnit, TreeseedTemplateUnit, hashJson, packageUnitRequiredSecretsForGitHubEnvironment } from './treeseed-desired-environment.ts';
import { internalPackageDependencies, releasePhaseForEnvironment } from './safe-tree-dx-repository-name.ts';

export function releaseGateResources(packages: TreeseedPackageUnit[], templates: TreeseedTemplateUnit[], environment: TreeseedDesiredEnvironment): TreeseedDesiredResource[] {
	const phase = releasePhaseForEnvironment(environment);
	const hostedEnvironment = environment === 'prod' ? 'prod' : 'staging';
	const packageGates = packages.flatMap((pkg) => {
		const fingerprint = hashJson({ packageId: pkg.id, version: pkg.version, capability: pkg.releaseCapability, environment, phase });
		const verifyDependencies = [
			`package-manifest:${pkg.id}`,
			...internalPackageDependencies(packages, pkg).map((dependencyId) => `release-gate:verify:${dependencyId}`),
		];
		const verifyGate: TreeseedDesiredResource = {
			id: `release-gate:verify:${pkg.id}`,
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: pkg.id,
			serviceId: null,
			logicalName: `${pkg.id} verify gate`,
			dependencies: verifyDependencies,
			spec: {
				gateKind: 'release-gate:verify',
				phase,
				packageId: pkg.id,
				environment: hostedEnvironment,
				fingerprint,
				capability: pkg.releaseCapability,
				command: 'verify.release',
			},
			source: { type: 'package-adapter', id: pkg.id },
		};
		const publishGateKind = pkg.releaseCapability === 'npm'
			? 'release-gate:npm-publish'
			: pkg.releaseCapability === 'image'
				? 'release-gate:image-publish'
				: null;
		const imageCredentialDependencies = publishGateKind === 'release-gate:image-publish' && pkg.githubEnvironments.includes(hostedEnvironment)
			? [
				...packageUnitRequiredSecretsForGitHubEnvironment(pkg, hostedEnvironment).map((secretName) => `github-secret-binding:${pkg.id}:${hostedEnvironment}:${secretName}`),
				...pkg.requiredVariables.map((variableName) => `github-variable-binding:${pkg.id}:${hostedEnvironment}:${variableName}`),
			]
			: [];
		const publishDependencies = publishGateKind === 'release-gate:image-publish'
			? [verifyGate.id, ...imageCredentialDependencies]
			: [verifyGate.id];
		return [
			verifyGate,
			...(publishGateKind ? [{
				id: `${publishGateKind}:${pkg.id}`,
				kind: 'release-gate' as const,
				provider: 'treeseed',
				environment,
				packageId: pkg.id,
				serviceId: null,
				logicalName: `${pkg.id} publish gate`,
				dependencies: publishDependencies,
				spec: {
					gateKind: publishGateKind,
					phase,
					packageId: pkg.id,
					environment: hostedEnvironment,
					repository: pkg.repository,
					fingerprint: hashJson({ publishGateKind, packageId: pkg.id, version: pkg.version, environment, phase }),
					capability: pkg.releaseCapability,
				},
				source: { type: 'package-adapter' as const, id: pkg.id },
			}] : []),
		];
	});
	const templateGates = templates.flatMap((template) => {
		const verifyGate: TreeseedDesiredResource = {
			id: `release-gate:template-verify:${template.id}`,
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: template.id,
			serviceId: null,
			logicalName: `${template.name} template verify gate`,
			dependencies: [`template-manifest:${template.id}`],
			spec: {
				gateKind: 'release-gate:template-verify',
				phase,
				templateId: template.id,
				environment: hostedEnvironment,
				fingerprint: hashJson({ templateId: template.id, version: template.version, repository: template.repository, environment, phase }),
				releaseTag: template.releaseTag,
				recordPath: template.recordPath,
			},
			source: { type: 'package-adapter' as const, id: `template:${template.id}` },
		};
		return [
			verifyGate,
			{
				id: `release-gate:template-release-record:${template.id}`,
				kind: 'release-gate' as const,
				provider: 'treeseed',
				environment,
				packageId: template.id,
				serviceId: null,
				logicalName: `${template.name} template release record`,
				dependencies: [verifyGate.id],
				spec: {
					gateKind: 'release-gate:template-release-record',
					phase,
					templateId: template.id,
					environment: hostedEnvironment,
					fingerprint: hashJson({ gate: 'template-release-record', templateId: template.id, version: template.version, releaseTag: template.releaseTag, environment, phase }),
					releaseTag: template.releaseTag,
					recordPath: template.recordPath,
				},
				source: { type: 'package-adapter' as const, id: `template:${template.id}` },
			},
		];
	});
	const releaseDependencies = [...packageGates.map((gate) => gate.id), ...templateGates.map((gate) => gate.id)];
	return [
		...packageGates,
		...templateGates,
		{
			id: `release-gate:hosted-reconcile:${hostedEnvironment}:all`,
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: null,
			serviceId: 'hosted-reconcile',
			logicalName: `${hostedEnvironment} hosted reconciliation gate`,
			dependencies: releaseDependencies,
			spec: {
				gateKind: 'release-gate:hosted-reconcile',
				phase,
				environment: hostedEnvironment,
				appId: 'all',
				fingerprint: hashJson({ gate: 'hosted-reconcile', environment: hostedEnvironment, packages, templates }),
				hostedSelector: {
					environment: hostedEnvironment,
					provider: ['cloudflare', 'cloudflare-dns', 'railway'],
				},
			},
			source: { type: 'package-adapter', id: 'release' },
		},
		{
			id: `release-gate:live-verify:${hostedEnvironment}:all`,
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: null,
			serviceId: 'live-verify',
			logicalName: `${hostedEnvironment} live verification gate`,
			dependencies: [`release-gate:hosted-reconcile:${hostedEnvironment}:all`],
			spec: {
				gateKind: 'release-gate:live-verify',
				phase,
				environment: hostedEnvironment,
				appId: 'all',
				fingerprint: hashJson({ gate: 'live-verify', environment: hostedEnvironment, packages, templates }),
				hostedSelector: {
					environment: hostedEnvironment,
					provider: ['cloudflare', 'cloudflare-dns', 'railway'],
				},
			},
			source: { type: 'package-adapter', id: 'release' },
		},
		{
			id: environment === 'prod' ? 'release-gate:production-record:prod' : 'release-gate:candidate-record:staging',
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: null,
			serviceId: environment === 'prod' ? 'production-record' : 'candidate-record',
			logicalName: environment === 'prod' ? 'production release record' : 'staging candidate record',
			dependencies: [`release-gate:live-verify:${hostedEnvironment}:all`],
			spec: {
				gateKind: environment === 'prod' ? 'release-gate:production-record' : 'release-gate:candidate-record',
				phase,
				environment,
				fingerprint: hashJson({ gate: environment === 'prod' ? 'production-record' : 'candidate-record', packages, templates }),
				recordPath: environment === 'prod'
					? '.treeseed/workflow/releases/latest-production.json'
					: '.treeseed/workflow/release-candidates/latest-staging.json',
			},
			source: { type: 'package-adapter', id: 'release' },
		},
	];
}

export function slugBranchName(branchName: string) {
	return branchName
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 48) || 'preview';
}

export function branchPreviewResources(target: TreeseedReconcileTarget, environment: TreeseedDesiredEnvironment): TreeseedDesiredResource[] {
	if (target.kind !== 'branch') return [];
	const branchSlug = slugBranchName(target.branchName);
	const previewId = `branch-preview:${branchSlug}:web`;
	return [
		{
			id: previewId,
			kind: 'branch-preview',
			provider: 'treeseed',
			environment,
			packageId: '@treeseed/market',
			serviceId: 'market-web',
			logicalName: `Branch preview for ${target.branchName}`,
			dependencies: [],
			spec: {
				branch: target.branchName,
				branchSlug,
				environment: 'staging',
				appId: 'web',
				host: 'cloudflare',
				ttlHours: 72,
				resources: {
					environment: 'staging',
					appId: ['web'],
					provider: ['cloudflare', 'cloudflare-dns'],
				},
			},
			source: { type: 'package-adapter', id: 'branch-preview' },
		},
		{
			id: `branch-preview-cleanup:${branchSlug}:web`,
			kind: 'branch-preview-cleanup',
			provider: 'treeseed',
			environment,
			packageId: '@treeseed/market',
			serviceId: 'market-web',
			logicalName: `Branch preview cleanup for ${target.branchName}`,
			dependencies: [previewId],
			spec: {
				branch: target.branchName,
				branchSlug,
				environment: 'staging',
				reason: 'manual',
				selector: {
					environment: 'staging',
					unitId: [previewId],
				},
			},
			source: { type: 'package-adapter', id: 'branch-preview-cleanup' },
		},
	];
}

export function resourceMatchesSelector(resource: TreeseedDesiredResource, selector?: TreeseedReconcileSelector) {
	if (!selector) return true;
	const has = (values: string[] | undefined, candidates: Array<string | null>) => {
		const normalized = new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
		return normalized.size === 0 || candidates.some((candidate) => candidate != null && normalized.has(candidate));
	};
	return has(selector.host ?? selector.provider, [resource.provider])
		&& has(selector.packageId, [resource.packageId])
		&& has(selector.serviceId, [resource.serviceId, resource.logicalName])
		&& has(selector.resourceKind, [resource.kind])
		&& has(selector.unitId, [resource.id, resource.source.type === 'reconcile-unit' ? resource.source.id : null])
		&& has(selector.serviceType, [typeof resource.spec.unitType === 'string' ? resource.spec.unitType : null]);
}
