import { createHmac, randomUUID } from 'node:crypto';

export interface TreeDxHs256TokenInput {
	secret: string;
	issuer: string;
	audience: string;
	actorId: string;
	tenantId: string;
	repoIds?: string[];
	capabilities?: string[];
	refs?: string[];
	paths?: string[];
	projectId?: string;
	capacityWorkdayRunId?: string;
	ttlSeconds?: number;
	nowEpochSeconds?: number;
	jti?: string;
}

function required(value: string, owner: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${owner} is required to mint a TreeDX token.`);
	return normalized;
}

function normalizedStrings(values: string[] | undefined, fallback: string[]): string[] {
	const normalized = values?.map((value) => String(value).trim()).filter(Boolean) ?? [];
	return normalized.length > 0 ? [...new Set(normalized)] : fallback;
}

function base64urlJson(value: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function mintTreeDxHs256Token(input: TreeDxHs256TokenInput): string {
	const secret = required(input.secret, 'secret');
	const issuer = required(input.issuer, 'issuer');
	const audience = required(input.audience, 'audience');
	const actorId = required(input.actorId, 'actorId');
	const tenantId = required(input.tenantId, 'tenantId');
	const ttlSeconds = input.ttlSeconds ?? 300;
	if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) {
		throw new Error('ttlSeconds must be an integer between 30 and 3600.');
	}
	const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
	if (!Number.isInteger(now) || now < 0) throw new Error('nowEpochSeconds must be a nonnegative integer.');
	const payload = {
		iss: issuer,
		aud: audience,
		sub: actorId,
		jti: input.jti?.trim() || randomUUID(),
		iat: now,
		nbf: now - 5,
		exp: now + ttlSeconds,
		treedx_actor_id: actorId,
		treedx_tenant_id: tenantId,
		treedx_repo_ids: normalizedStrings(input.repoIds, ['*']),
		treedx_capabilities: normalizedStrings(input.capabilities, []),
		treedx_refs: normalizedStrings(input.refs, ['*']),
		treedx_paths: normalizedStrings(input.paths, ['**']),
		...(input.projectId?.trim() ? { treeseed_project_id: input.projectId.trim() } : {}),
		...(input.capacityWorkdayRunId?.trim() ? { treeseed_capacity_workday_run_id: input.capacityWorkdayRunId.trim() } : {}),
	};
	const signingInput = `${base64urlJson({ alg: 'HS256', typ: 'JWT' })}.${base64urlJson(payload)}`;
	return `${signingInput}.${createHmac('sha256', secret).update(signingInput).digest('base64url')}`;
}
