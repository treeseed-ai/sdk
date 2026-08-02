import { resolveModelDefinition } from "../../../entrypoints/models/model-registry.ts";
import { normalizeMutationData } from "../../../entrypoints/models/sdk-fields.ts";
import type { SdkMutationRequest,SdkSubscriptionEntity } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase,nowIso } from "../../../persistence/d1-store.ts";
export async function createMethod(this: MemoryAgentDatabase, request: SdkMutationRequest) {
    const definition = resolveModelDefinition(request.model);
    const data = normalizeMutationData(definition, request.data);
    switch (request.model) {
        case 'message':
            return (await this.createMessage({
                type: String(data.type ?? 'message.created'),
                payload: (data.payload as Record<string, unknown> | undefined) ?? data,
                relatedModel: typeof data.related_model === 'string' ? data.related_model : null,
                relatedId: typeof data.related_id === 'string' ? data.related_id : null,
                priority: Number(data.priority ?? 0),
                maxAttempts: Number(data.maxAttempts ?? 3),
                actor: request.actor,
            })) as Record<string, unknown>;
        case 'subscription': {
            const record: SdkSubscriptionEntity = {
                id: this.subscriptions.size + 1,
                email: String(data.email ?? ''),
                name: data.name ? String(data.name) : null,
                status: String(data.status ?? 'active'),
                source: String(data.source ?? 'sdk'),
                consent_at: String(data.consent_at ?? nowIso()),
                created_at: String(data.created_at ?? nowIso()),
                updated_at: String(data.updated_at ?? nowIso()),
                ip_hash: String(data.ip_hash ?? ''),
            };
            this.subscriptions.set(String(record.id), record);
            return record;
        }
        case 'agent_run':
            return this.recordRun({ run: data });
        case 'agent_cursor': {
            const agentSlug = String(data.agent_slug ?? '');
            const cursorKey = String(data.cursor_key ?? '');
            const cursorValue = String(data.cursor_value ?? '');
            this.cursors.set(`${agentSlug}:${cursorKey}`, cursorValue);
            return {
                agentSlug,
                cursorKey,
                cursorValue,
                updatedAt: nowIso(),
            };
        }
        case 'content_lease': {
            const token = await this.tryClaimContentLease({
                model: String(data.model ?? ''),
                itemKey: String(data.item_key ?? ''),
                claimedBy: String(data.claimed_by ?? request.actor),
                leaseSeconds: Number(data.leaseSeconds ?? 300),
            });
            const lease = this.contentLeases.get(`${data.model}:${data.item_key}`);
            return {
                model: String(data.model ?? ''),
                itemKey: String(data.item_key ?? ''),
                claimedBy: String(data.claimed_by ?? request.actor),
                claimedAt: String(lease?.claimedAt ?? nowIso()),
                leaseExpiresAt: String(lease?.leaseExpiresAt ?? nowIso()),
                token: String(token ?? lease?.token ?? ''),
            };
        }
        default:
            throw new Error(`Unsupported D1 create model "${request.model}".`);
    }
}
