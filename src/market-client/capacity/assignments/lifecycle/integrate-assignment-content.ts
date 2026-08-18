import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';
import type { ArtifactMutationReceipt } from '../../../../agent-capacity/artifact-mutation-receipt.ts';

export interface IntegrateAssignmentContentRequest {
	idempotencyKey: string;
	expectedBaseRef: string;
	expectedCommitSha: string;
	reason: string;
	workdayId: string;
	simulateHuman: true;
}

export function integrateAssignmentContentMethod(
	this: MarketClient,
	teamId: string,
	assignmentId: string,
	body: IntegrateAssignmentContentRequest,
) {
	return this.request<{ ok: true; payload: { receipt: ArtifactMutationReceipt; replayed: boolean } }>(
		`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments/${encodeURIComponent(assignmentId)}/content-integration`,
		{ method: 'POST', body, headers: { 'Idempotency-Key': body.idempotencyKey }, requireAuth: true },
	);
}
