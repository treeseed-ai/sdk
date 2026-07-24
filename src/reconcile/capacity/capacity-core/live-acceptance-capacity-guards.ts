import { createHash } from 'node:crypto';
import { MarketClient } from '../../../entrypoints/clients/market-client.ts';
import { CapacityProviderApiError, ProviderProtocolClient } from '../../../capacity/providers/capacity-provider.ts';

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

export async function capacityAcceptancePolicyFingerprint(input: {
	adminClient: MarketClient;
	teamId: string;
	grantId: string;
	allocationId: string;
}) {
	const [grant, allocation] = await Promise.all([
		input.adminClient.capacityGrant(input.teamId, input.grantId),
		input.adminClient.capacityAllocationSet(input.teamId, input.allocationId),
	]);
	return createHash('sha256').update(stableJson({ grant: grant.payload, allocation: allocation.payload })).digest('hex');
}

export async function assertCapacityAcceptancePolicyUnchanged(input: {
	adminClient: MarketClient;
	teamId: string;
	grantId: string;
	allocationId: string;
	expectedFingerprint: string;
}) {
	const observed = await capacityAcceptancePolicyFingerprint(input);
	if (observed !== input.expectedFingerprint) {
		throw new Error('Capacity acceptance execution mutated human-owned grant or allocation policy.');
	}
}

export async function assertRevokedCapacityProviderAccess(input: {
	providerClient: ProviderProtocolClient;
	assignmentId: string;
}) {
	try {
		await input.providerClient.assignment(input.assignmentId);
	} catch (error) {
		if (error instanceof CapacityProviderApiError && (error.status === 401 || error.status === 403)) return;
		throw new Error(`Capacity acceptance revoked-access probe failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
	}
	throw new Error('Capacity acceptance revoked membership retained provider assignment access.');
}
