import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../hosting/railway/railway-cli.ts';
import { resolveRailwayCredential } from '../../../configuration/service-credentials.ts';
import { railwayGraphqlRequest } from './collect-railway-volumes.ts';
import { normalizeRailwayDomainList } from './normalize-workspace.ts';
import { RailwayTemplateSummary, configuredEnvValue, railwayConnectionLabel } from './default-railway-api-url.ts';
import { inspectRailwayPostgresService, listRailwayServices } from './inspect-railway-postgres-service.ts';

export async function listRailwayServiceDomains({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		domains?: unknown;
	}>({
		query: `
query TreeseedRailwayServiceDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
	domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
		serviceDomains {
			id
			domain
			serviceId
			environmentId
			targetPort
		}
		customDomains {
			id
			domain
			serviceId
			environmentId
			targetPort
		}
	}
}
`.trim(),
		variables: { projectId, environmentId, serviceId },
		env,
		fetchImpl,
	});
	const domains = payload.data?.domains && typeof payload.data.domains === 'object'
		? payload.data.domains as Record<string, unknown>
		: {};
	return [
		...normalizeRailwayDomainList(domains.serviceDomains, 'service'),
		...normalizeRailwayDomainList(domains.customDomains, 'custom'),
	];
}

export async function deployRailwayServiceInstance({
	projectId,
	serviceId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	serviceId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	void fetchImpl;
	const targetProjectId = railwayConnectionLabel(projectId) || configuredEnvValue(env, 'TREESEED_RAILWAY_PROJECT_ID');
	if (!targetProjectId) throw new Error(`Railway CLI redeploy requires a project id for service ${serviceId}.`);
	const result = await runRailwayCliJson<Record<string, unknown>>({
		args: ['service', 'redeploy', '--project', targetProjectId, '--environment', environmentId, '--service', serviceId, '--from-source', '--yes', '--json'],
		env,
	});
	return { deploymentId: railwayConnectionLabel(result.deploymentId ?? result.id) || null };
}

export async function updateRailwayServiceName({
	serviceId,
	name,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	name: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredName = railwayConnectionLabel(name);
	if (!serviceId || !desiredName) {
		throw new Error('Railway service rename requires a service id and name.');
	}
	void env; void fetchImpl;
	throw new Error(`Railway service rename ${serviceId} -> ${desiredName} is not exposed by the official SDK or CLI; direct GraphQL mutation is prohibited.`);
}

export async function ensureRailwayPostgresService({
	projectId,
	environmentId,
	serviceName,
	env = process.env,
	fetchImpl = fetch,
	maxAttempts = 40,
}: {
	projectId: string;
	environmentId: string;
	serviceName: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	maxAttempts?: number;
}) {
	const desiredServiceName = railwayConnectionLabel(serviceName);
	if (!desiredServiceName) {
		throw new Error('Railway Postgres service creation requires a service name.');
	}
	const services = await listRailwayServices({ projectId, env, fetchImpl });
	const existing = services.find((service) => service.name === desiredServiceName || service.id === desiredServiceName) ?? null;
	if (existing) {
		const proof = await inspectRailwayPostgresService({ projectId, environmentId, serviceId: existing.id, env, fetchImpl });
		if (proof.ok) {
			return { service: existing, created: false, proof };
		}
		throw new Error(
			`Railway Postgres service ${existing.name} (${existing.id}) failed proof; `
			+ 'refusing to delete and recreate an existing service. Repair the existing database service in place and rerun reconciliation.',
		);
	}
	const template = await getRailwayTemplateByCode({ code: 'postgres', env, fetchImpl });
	await deployRailwayTemplate({
		templateId: template.id,
		serializedConfig: template.serializedConfig,
		projectId,
		environmentId,
		env,
		fetchImpl,
	});
	const settled = await waitForRailwayPostgresTemplateService({
		projectId,
		environmentId,
		desiredServiceName,
		env,
		fetchImpl,
		maxAttempts,
	});
	return { service: settled.service, created: true, proof: settled.proof };
}

export async function getRailwayTemplateByCode({
	code,
	env = process.env,
	fetchImpl = fetch,
}: {
	code: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}): Promise<RailwayTemplateSummary> {
	const payload = await railwayGraphqlRequest<{
		template?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayTemplate($code: String!) {
	template(code: $code) {
		id
		code
		name
		serializedConfig
	}
}
`.trim(),
		variables: { code },
		env,
		fetchImpl,
		timeoutMs: 15_000,
		retries: 1,
	});
	const template = payload.data?.template;
	const id = railwayConnectionLabel(template?.id);
	if (!id || !template || typeof template !== 'object') {
		throw new Error(`Railway Postgres template "${code}" was not found through the Railway API.`);
	}
	return {
		id,
		code: railwayConnectionLabel(template.code) || null,
		name: railwayConnectionLabel(template.name) || null,
		serializedConfig: normalizeTemplateSerializedConfig(template.serializedConfig),
	};
}

export function normalizeTemplateSerializedConfig(value: unknown): Record<string, unknown> {
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
		} catch {
			return {};
		}
	}
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function deployRailwayTemplate({
	templateId,
	serializedConfig,
	projectId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	templateId: string;
	serializedConfig: Record<string, unknown>;
	projectId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	void serializedConfig; void env; void fetchImpl;
	throw new Error(`Railway template deployment ${templateId} into ${projectId}/${environmentId} is not exposed non-interactively by the official SDK or CLI; direct GraphQL mutation is prohibited.`);
}

export async function waitForRailwayPostgresTemplateService({
	projectId,
	environmentId,
	desiredServiceName,
	env = process.env,
	fetchImpl = fetch,
	maxAttempts = 40,
}: {
	projectId: string;
	environmentId: string;
	desiredServiceName: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	maxAttempts?: number;
}) {
	let lastProof: Awaited<ReturnType<typeof inspectRailwayPostgresService>> | null = null;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const services = await listRailwayServices({ projectId, env, fetchImpl });
		for (const service of services) {
			const proof = await inspectRailwayPostgresService({
				projectId,
				environmentId,
				serviceId: service.id,
				env,
				fetchImpl,
			});
			if (proof.ok) {
				const renamed = service.name === desiredServiceName
					? service
					: await updateRailwayServiceName({ serviceId: service.id, name: desiredServiceName, env, fetchImpl });
				return { service: renamed, proof };
			}
			lastProof = proof;
		}
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	throw new Error(`Railway Postgres template deployment did not produce a managed PostgreSQL service named ${desiredServiceName}. Last proof: ${lastProof?.message ?? 'no candidate service observed'}`);
}
