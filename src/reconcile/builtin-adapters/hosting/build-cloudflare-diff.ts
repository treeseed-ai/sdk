import { relative, resolve } from 'node:path';
import { destroyCloudflareResources } from "../../../operations/services/hosting/deployment/deploy.ts";
import { configuredRailwayServices } from "../../../operations/services/hosting/railway/railway-deploy.ts";
import { ensureRailwayEnvironment, ensureRailwayProject, listRailwayEnvironments } from "../../../operations/services/hosting/railway/railway-api.ts";
import type { ObservedUnitState, ReconcileAdapter, ReconcileAdapterInput, ReconcileResult, ReconcileUnitDiff, ReconcileUnitType } from "../../support/contracts/contracts.ts";
import { discoverApplications } from "../../../hosting/apps.ts";
import { verifyCloudflareUnit } from './verify-cloudflare-unit-once.ts';
import { providerCache } from '../reconciliation/build-workflow-meta-adapter.ts';
import { reconcileCloudflareTarget, syncCloudflareSecretsForTarget } from '../reconciliation/reconcile-cloudflare-target.ts';
import { syncPagesEnvironmentVariablesForTarget } from '../support/summarize-verification.ts';
import { isTransientCloudflareReconcileError, sleepMs, toDeployTarget } from './to-deploy-target.ts';
import { observeCloudflareUnit } from './observe-cloudflare-unit.ts';

export function buildCloudflareDiff(input: ReconcileAdapterInput, observed: ObservedUnitState): ReconcileUnitDiff {
	if (!observed.exists) {
		return {
			action: 'create',
			reasons: ['resource missing'],
			before: observed.live,
			after: input.unit.spec,
		};
	}
	if (input.unit.unitType === 'pages-project') {
		const verification = verifyCloudflareUnit(input, []);
		if (verification.supported && !verification.verified) {
			return {
				action: 'update',
				reasons: [...verification.missing, ...verification.drifted],
				before: observed.live,
				after: input.unit.spec,
			};
		}
	}
	const locatorValues = Object.values(observed.locators).filter(Boolean);
	return {
		action: locatorValues.length > 0 ? 'noop' : 'update',
		reasons: locatorValues.length > 0 ? ['resource already present'] : ['resource partially configured'],
		before: observed.live,
		after: input.unit.spec,
	};
}

export function reconcileCloudflareUnit(input: ReconcileAdapterInput, diff: ReconcileUnitDiff): ReconcileResult {
	const cacheKey = `cloudflare:apply:${input.unit.target.kind === 'persistent' ? input.unit.target.scope : input.unit.target.branchName}`;
	const { state } = providerCache(input, cacheKey, () => {
		let attempt = 0;
		for (;;) {
			try {
				const reconciled = reconcileCloudflareTarget(input);
				syncCloudflareSecretsForTarget(input);
				syncPagesEnvironmentVariablesForTarget(input);
				return reconciled;
			} catch (error) {
				if (attempt >= 2 || !isTransientCloudflareReconcileError(error)) {
					throw error;
				}
				attempt += 1;
				sleepMs(500 * attempt);
			}
		}
	});
	const refreshed = observeCloudflareUnit(input);
	return {
		unit: input.unit,
		observed: refreshed,
		diff,
		action: diff.action === 'create' || diff.action === 'update' ? 'update' : diff.action,
		warnings: refreshed.warnings,
		resourceLocators: refreshed.locators,
		state: input.unit.unitType === 'edge-worker'
			? { workerName: state.workerName, lastDeployedUrl: state.lastDeployedUrl ?? null }
			: refreshed.live,
	};
}

export function buildCloudflareAdapter(unitType: ReconcileUnitType): ReconcileAdapter {
	return {
		providerId: 'cloudflare',
		unitTypes: [unitType],
		supports(candidateUnitType, providerId) {
			return providerId === 'cloudflare' && candidateUnitType === unitType;
		},
		refresh(input) {
			return observeCloudflareUnit(input);
		},
		requiredPostconditions(input) {
			switch (input.unit.unitType) {
				case 'queue':
					return [
						{ key: 'queue.exists', description: 'Queue exists by name and id' },
						{ key: 'queue.dlq', description: 'Dead-letter queue exists by name and id when configured' },
						{ key: 'queue.binding', description: 'Queue binding matches desired config' },
					];
				case 'database':
					return [
						{ key: 'database.exists', description: 'D1 database exists by name and id' },
						{ key: 'database.binding', description: 'D1 binding matches desired config' },
					];
				case 'kv-form-guard':
					return [
						{ key: 'kv.exists', description: 'KV namespace exists by title and id' },
						{ key: 'kv.binding', description: 'KV binding matches desired config' },
					];
				case 'turnstile-widget':
					return [
						{ key: 'turnstile.exists', description: 'Turnstile widget exists by name and sitekey' },
						{ key: 'turnstile.mode', description: 'Turnstile widget mode is managed' },
						{ key: 'turnstile.domains', description: 'Turnstile widget domains match desired config' },
					];
				case 'content-store':
					return [
						{ key: 'r2.exists', description: 'R2 bucket exists by name' },
						{ key: 'r2.binding', description: 'R2 binding matches desired config' },
					];
				case 'pages-project':
					return [
						{ key: 'pages.exists', description: 'Pages project exists' },
						{ key: 'pages.production-branch', description: 'Pages production branch matches desired config' },
					];
				case 'edge-worker':
					return [
						{ key: 'edge-worker.generated', description: 'Generated web runtime metadata exists' },
					];
				default:
					return [];
			}
		},
		diff(input) {
			return buildCloudflareDiff(input, input.observed);
		},
		apply(input) {
			return reconcileCloudflareUnit(input, input.diff);
		},
		verify(input) {
			return verifyCloudflareUnit(input, input.postconditions);
		},
		destroy(input) {
			const cacheKey = `cloudflare:destroy:${input.unit.target.kind === 'persistent' ? input.unit.target.scope : input.unit.target.branchName}`;
			providerCache(input, cacheKey, () => destroyCloudflareResources(input.context.tenantRoot, { target: toDeployTarget(input.context.target) }));
			return {
				unit: input.unit,
				observed: input.observed,
				diff: {
					action: 'delete',
					reasons: ['target destroyed'],
					before: input.observed.live,
					after: {},
				},
				action: 'delete',
				warnings: [],
				resourceLocators: {},
				state: {},
				verification: null,
			};
		},
	};
}

export function relativeRailwayRootDir(tenantRoot: string, serviceRoot: string) {
	const resolved = relative(tenantRoot, serviceRoot).replace(/\\/gu, '/');
	return !resolved || resolved === '' ? '.' : resolved;
}

export function railwayServiceRootDirectory(
	tenantRoot: string,
	service: ReturnType<typeof configuredRailwayServices>[number],
) {
	const sourceRootDirectory = String(service.sourceRootDirectory ?? '').trim();
	if (sourceRootDirectory) {
		return sourceRootDirectory;
	}
	return relativeRailwayRootDir(service.application?.root ?? tenantRoot, service.rootDir);
}

export function configuredMarketDatabaseService(tenantRoot: string, deployConfig: ReconcileAdapterInput['context']['deployConfig']) {
	if (deployConfig.services?.treeseedDatabase) {
		return DatabaseDescriptor(deployConfig.services.treeseedDatabase, deployConfig.slug);
	}
	for (const application of discoverApplications(tenantRoot)) {
		const service = application.config.services?.treeseedDatabase;
		if (service) {
			return DatabaseDescriptor(service, application.config.slug);
		}
	}
	return null;
}

export function DatabaseDescriptor(service: Record<string, any>, slug?: string | null) {
	return {
		service,
		serviceName: typeof service.railway?.serviceName === 'string' && service.railway.serviceName.trim()
			? service.railway.serviceName.trim()
			: `${slug ?? 'treeseed-api'}-postgres`,
	};
}

export async function ensureRailwayEnvironmentForService({
	service,
	project,
	environmentName,
	env,
}: {
	service: ReturnType<typeof configuredRailwayServices>[number];
	project: Awaited<ReturnType<typeof ensureRailwayProject>>['project'];
	environmentName: string;
	env: Record<string, string>;
}) {
	try {
		return (await ensureRailwayEnvironment({
			projectId: project.id,
			environmentName,
			env,
		})).environment;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (!/Problem processing request/iu.test(message)) {
			throw error;
		}
	}

	for (let attempt = 0; attempt < 12; attempt += 1) {
		const environments = await listRailwayEnvironments({ projectId: project.id, env });
		const existing = environments.find((environment) => environment.name === environmentName || environment.id === environmentName) ?? null;
		if (existing) {
			return existing;
		}
		await new Promise((resolve) => setTimeout(resolve, 2500));
	}
	throw new Error(`Railway API environment provisioning failed for ${project.name ?? service.projectName ?? project.id}/${environmentName}.`);
}
