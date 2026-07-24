import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from "../../../rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from "../../../tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../../../d1-store.ts";
export async function createUserMethod(this: D1AuthStore, input: {
    email?: string | null;
    username?: string | null;
    displayName?: string | null;
    metadata?: Record<string, unknown>;
}) {
    await this.ensureInitialized();
    const timestamp = isoNow();
    const userId = randomUUID();
    await this.run(`INSERT INTO users (id, email, username, display_name, status, metadata_json, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`, [
        userId,
        input.email?.trim() || null,
        input.username?.trim().toLowerCase() || null,
        input.displayName?.trim() || null,
        JSON.stringify(input.metadata ?? {}),
        timestamp,
        timestamp,
    ]);
    await this.assignRole(userId, 'member');
    await this.writeAuditEvent({
        actorType: 'service',
        actorId: this.config.webServiceId,
        eventType: 'auth.user_created',
        targetType: 'user',
        targetId: userId,
        data: { source: 'admin' },
    });
    return this.principalForUser(userId);
}
