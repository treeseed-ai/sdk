import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxOrphanRefDiscardRequest,TreeDxOrphanRefDiscardResult,TreeDxPushRequest,TreeDxPushResult,TreeDxRefPromotionRequest,TreeDxRefPromotionResult,TreeDxRefRetirementRequest,TreeDxRefRetirementResult } from "../../../../../../types.ts";
export function pushMethod(this: TreeDxClient, input: TreeDxPushRequest): Promise<TreeDxPushResult> {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/push`, body, { tokenRequired: true }).then((payload) => firstPayload<TreeDxPushResult>(payload, ['push']));
}

export function retireRefMethod(this: TreeDxClient, input: TreeDxRefRetirementRequest): Promise<TreeDxRefRetirementResult> {
	const { repoId, ...body } = input;
	return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/refs/retire`, body, { tokenRequired: true })
		.then((payload) => firstPayload<TreeDxRefRetirementResult>(payload, ['retirement']));
}

export function discardOrphanRefMethod(this: TreeDxClient, input: TreeDxOrphanRefDiscardRequest): Promise<TreeDxOrphanRefDiscardResult> {
	const { repoId, ...body } = input;
	return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/refs/discard-orphan`, body, { tokenRequired: true })
		.then((payload) => firstPayload<TreeDxOrphanRefDiscardResult>(payload, ['discard']));
}

export function promoteRefMethod(this: TreeDxClient, input: TreeDxRefPromotionRequest): Promise<TreeDxRefPromotionResult> {
	const { repoId, ...body } = input;
	return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/refs/promote`, body, { tokenRequired: true })
		.then((payload) => firstPayload<TreeDxRefPromotionResult>(payload, ['promotion']));
}
