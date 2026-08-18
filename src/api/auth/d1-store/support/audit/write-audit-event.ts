import { randomUUID } from 'node:crypto';
import { D1AuthStore,isoNow } from "../../../d1-store.ts";
export async function writeAuditEventMethod(this: D1AuthStore, input: {
    actorType: string;
    actorId: string | null;
    eventType: string;
    targetType: string | null;
    targetId: string | null;
    data?: Record<string, unknown>;
}) {
    await this.run(`INSERT INTO audit_events (id, actor_type, actor_id, event_type, target_type, target_id, data_json, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        randomUUID(),
        input.actorType,
        input.actorId,
        input.eventType,
        input.targetType,
        input.targetId,
        JSON.stringify(input.data ?? {}),
        isoNow(),
    ]);
}
