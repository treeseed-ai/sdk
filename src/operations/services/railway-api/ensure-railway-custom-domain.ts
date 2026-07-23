import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../railway-cli.ts';
import { resolveTreeseedRailwayApiToken } from '../../../service-credentials.ts';
import { railwayConnectionLabel } from './default-railway-api-url.ts';
import { listRailwayCustomDomains } from './upsert-railway-variables.ts';

export async function ensureRailwayCustomDomain({
	projectId,
	environmentId,
	serviceId,
	domain,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	domain: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const normalizedDomain = railwayConnectionLabel(domain);
	if (!normalizedDomain) {
		throw new Error('Railway custom domain creation requires a domain.');
	}
	const existing = await listRailwayCustomDomains({ projectId, environmentId, serviceId, env, fetchImpl });
	const matched = existing.find((entry) => entry.domain === normalizedDomain) ?? null;
	if (matched) {
		return { domain: matched, created: false };
	}
	await runRailwayCliJson({
		args: ['domain', normalizedDomain, '--project', projectId, '--environment', environmentId, '--service', serviceId, '--json'],
		env,
	});
	const created = (await listRailwayCustomDomains({ projectId, environmentId, serviceId, env, fetchImpl }))
		.find((entry) => entry.domain === normalizedDomain) ?? null;
	if (!created) {
		throw new Error(`Railway custom domain create did not return a usable domain for ${normalizedDomain}.`);
	}
	return { domain: created, created: true };
}

export async function deleteRailwayCustomDomain({
	projectId,
	environmentId,
	serviceId,
	domainId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	environmentId?: string | null;
	serviceId?: string | null;
	domainId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(domainId)) {
		return { status: 'missing', id: domainId };
	}
	void fetchImpl;
	if (!projectId || !environmentId || !serviceId) throw new Error(`Railway CLI domain deletion requires project, environment, and service ids for ${domainId}.`);
	await runRailwayCliJson({ args: ['domain', 'delete', domainId, '--project', projectId, '--environment', environmentId, '--service', serviceId, '--yes', '--json'], env });
	return { status: 'deleted' };
}

export async function deleteRailwayService({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	environmentId?: string | null;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(serviceId)) {
		return { status: 'missing', id: serviceId };
	}
	void fetchImpl;
	if (!projectId || !environmentId) throw new Error(`Railway CLI service deletion requires project and environment ids for ${serviceId}.`);
	await runRailwayCliJson({ args: ['service', 'delete', '--project', projectId, '--environment', environmentId, '--service', serviceId, '--yes', '--json'], env });
	return { status: 'deleted' };
}

export async function deleteRailwayVolume({
	projectId,
	environmentId,
	volumeId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	environmentId?: string | null;
	volumeId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(volumeId)) {
		return { status: 'missing', id: volumeId };
	}
	void fetchImpl;
	if (!projectId || !environmentId) throw new Error(`Railway CLI volume deletion requires project and environment ids for ${volumeId}.`);
	await runRailwayCliJson({ args: ['volume', '--project', projectId, '--environment', environmentId, 'delete', '--volume', volumeId, '--yes', '--json'], env });
	return { status: 'deleted' };
}

export async function deleteRailwayEnvironment({
	projectId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(environmentId)) {
		return { status: 'missing', id: environmentId };
	}
	void fetchImpl;
	if (!projectId) throw new Error(`Railway CLI environment deletion requires a project id for ${environmentId}.`);
	const tempRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-railway-environment-delete-'));
	try {
		await runRailwayCliJson({ args: ['link', projectId, '--json'], env, cwd: tempRoot });
		await runRailwayCliJson({ args: ['environment', 'delete', environmentId, '--yes', '--json'], env, cwd: tempRoot });
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
	return { status: 'deleted' };
}

export async function deleteRailwayProject({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(projectId)) {
		return { status: 'missing', id: projectId };
	}
	void fetchImpl;
	await runRailwayCliJson({ args: ['project', 'delete', '--project', projectId, '--yes', '--json'], env });
	return { status: 'deleted' };
}
