import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../hosting/railway/railway-cli.ts';
import { resolveRailwayCredential } from '../../../configuration/service-credentials.ts';
import { listRailwayServices } from './inspect-railway-postgres-service.ts';
import { createRailwayEnvironmentPatchClient, railwayConnectionLabel } from './default-railway-api-url.ts';
import { listRailwayEnvironmentServices } from './list-railway-projects.ts';
import { listRailwayServiceDomains } from './list-railway-service-domains.ts';

export async function ensureRailwayService({
	projectId,
	serviceName,
	serviceId,
	environmentId,
	imageRef,
	sourceRepo,
	sourceBranch,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	serviceName?: string | null;
	serviceId?: string | null;
	environmentId?: string | null;
	imageRef?: string | null;
	sourceRepo?: string | null;
	sourceBranch?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const services = await listRailwayServices({ projectId, env, fetchImpl });
	const desiredServiceName = railwayConnectionLabel(serviceName);
	const desiredServiceId = railwayConnectionLabel(serviceId);
	let existing = services.find((service) =>
		(desiredServiceId && service.id === desiredServiceId)
		|| (desiredServiceName && service.name === desiredServiceName),
	) ?? null;
	if (!existing && environmentId) {
		const environmentServices = await listRailwayEnvironmentServices({ environmentId, env, fetchImpl }).catch(() => []);
		existing = environmentServices.find((service) =>
			(desiredServiceId && service.id === desiredServiceId)
			|| (desiredServiceName && service.name === desiredServiceName),
		) ?? null;
	}
	if (existing) {
		const desiredImageRef = railwayConnectionLabel(imageRef);
		const desiredSourceRepo = railwayConnectionLabel(sourceRepo);
		if (desiredSourceRepo) {
			try {
				await updateRailwayServiceGitSource({
					projectId,
					serviceId: existing.id,
					environmentId,
					sourceRepo: desiredSourceRepo,
					sourceBranch,
					env,
					fetchImpl,
				});
			} catch (error) {
				if (!looksLikeRailwayImageSourceUpdateUnsupported(error)) {
					throw error;
				}
				throw new Error(
					`Railway Git source update for existing service ${existing.name} (${existing.id}) is unsupported; `
					+ 'refusing to delete and recreate an existing service. Repair the service in place or use a provider-supported source update.',
				);
			}
			return { service: existing, created: false };
		}
		if (desiredImageRef) {
			try {
				await updateRailwayServiceImageSource({
					projectId,
					serviceId: existing.id,
					environmentId,
					imageRef: desiredImageRef,
					env,
					fetchImpl,
				});
			} catch (error) {
				if (!looksLikeRailwayImageSourceUpdateUnsupported(error)) {
					throw error;
				}
				throw new Error(
					`Railway image source update for existing service ${existing.name} (${existing.id}) is unsupported; `
					+ 'refusing to delete and recreate an existing service. Repair the service in place or use a provider-supported image source update.',
				);
			}
		}
		return { service: existing, created: false };
	}
	if (!desiredServiceName) {
		throw new Error('Railway service creation requires a service name.');
	}
	const service = await createRailwayImageService({
		projectId,
		environmentId,
		serviceName: desiredServiceName,
		imageRef,
		sourceRepo,
		sourceBranch,
		env,
		fetchImpl,
	});
	return { service, created: true };
}

export async function createRailwayImageService({
	projectId,
	serviceName,
	environmentId,
	imageRef,
	sourceRepo,
	sourceBranch,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	serviceName: string;
	environmentId?: string | null;
	imageRef?: string | null;
	sourceRepo?: string | null;
	sourceBranch?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredSourceRepo = railwayConnectionLabel(sourceRepo);
	const desiredImageRef = railwayConnectionLabel(imageRef);
	const targetEnvironmentId = railwayConnectionLabel(environmentId);
	if (!targetEnvironmentId) throw new Error(`Railway service creation requires an environment id for ${serviceName}.`);
	const client = createRailwayEnvironmentPatchClient({ env, fetchImpl });
	await client.stageEnvironmentChanges({
		environmentId: targetEnvironmentId,
		merge: true,
		patch: {
			services: {
				[serviceName]: {
					isCreated: true,
					source: desiredSourceRepo
						? { repo: desiredSourceRepo, branch: railwayConnectionLabel(sourceBranch) || null, image: null }
						: desiredImageRef ? { image: desiredImageRef, repo: null, branch: null } : null,
				},
			},
		},
	});
	await client.commitStagedPatch({
		environmentId: targetEnvironmentId,
		message: `Treeseed create service ${serviceName}`,
		skipDeploys: true,
	});
	const service = (await listRailwayServices({ projectId, env, fetchImpl })).find((entry) => entry.name === serviceName) ?? null;
	if (!service) {
		throw new Error(`Railway service create did not return a usable service for ${serviceName}.`);
	}
	return service;
}

export function looksLikeRailwayImageSourceUpdateUnsupported(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /Problem processing request|source|image|ServiceUpdateInput/iu.test(message);
}

export async function updateRailwayServiceImageSource({
	projectId,
	serviceId,
	environmentId,
	imageRef,
	env = process.env,
}: {
	projectId?: string | null;
	serviceId: string;
	environmentId?: string | null;
	imageRef: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredImage = railwayConnectionLabel(imageRef);
	if (!serviceId || !desiredImage) {
		throw new Error('Railway service image source update requires a service id and image reference.');
	}
	const targetEnvironmentId = railwayConnectionLabel(environmentId);
	if (!targetEnvironmentId) throw new Error(`Railway service image source update requires an environment id for ${serviceId}.`);
	await connectRailwayServiceSourceWithCli({
		projectId,
		environmentId: targetEnvironmentId,
		serviceId,
		image: desiredImage,
		env,
	});
	return { id: serviceId, name: serviceId };
}

export async function updateRailwayServiceGitSource({
	projectId,
	serviceId,
	environmentId,
	sourceRepo,
	sourceBranch,
	env = process.env,
}: {
	projectId?: string | null;
	serviceId: string;
	environmentId?: string | null;
	sourceRepo: string;
	sourceBranch?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredRepo = railwayConnectionLabel(sourceRepo);
	if (!serviceId || !desiredRepo) {
		throw new Error('Railway service Git source update requires a service id and repository slug.');
	}
	const targetEnvironmentId = railwayConnectionLabel(environmentId);
	if (!targetEnvironmentId) throw new Error(`Railway service Git source update requires an environment id for ${serviceId}.`);
	await connectRailwayServiceSourceWithCli({
		projectId,
		environmentId: targetEnvironmentId,
		serviceId,
		repo: desiredRepo,
		branch: railwayConnectionLabel(sourceBranch) || null,
		env,
	});
	return { id: serviceId, name: serviceId };
}

export async function ensureRailwayGeneratedServiceDomain({
	projectId,
	environmentId,
	serviceId,
	targetPort,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	targetPort?: number | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const domains = await listRailwayServiceDomains({ projectId, environmentId, serviceId, env, fetchImpl });
	const existing = domains.find((domain) => domain.kind === 'service') ?? domains.find((domain) => domain.domain.endsWith('.railway.app')) ?? null;
	if (existing) {
		return { domain: existing, created: false };
	}
	await runRailwayCliJson({
		args: [
			'domain', '--project', projectId, '--environment', environmentId, '--service', serviceId,
			...(Number.isFinite(Number(targetPort)) ? ['--port', String(Number(targetPort))] : []), '--json',
		],
		env,
	});
	const domain = (await listRailwayServiceDomains({ projectId, environmentId, serviceId, env, fetchImpl }))
		.find((entry) => entry.kind === 'service' || entry.domain.endsWith('.railway.app')) ?? null;
	if (!domain) {
		throw new Error('Railway service domain create did not return a usable domain.');
	}
	return { domain, created: true };
}
