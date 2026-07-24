import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from "../../../rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from "../../../tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../../../d1-store.ts";
export async function createPersonalAccessTokenMethod(this: D1AuthStore, userId: string, input: {
    name: string;
    scopes?: string[];
    expiresAt?: string | null;
}) {
    await this.ensureInitialized();
    const nowIso = isoNow();
    const token = nextOpaqueToken('pat');
    const id = randomUUID();
    const tokenHash = stableHash(token, this.config.authSecret);
    const prefix = token.slice(0, 12);
    await this.run(`INSERT INTO api_tokens (id, user_id, kind, name, token_prefix, token_hash, scopes_json, expires_at, last_used_at, revoked_at, metadata_json, created_at, updated_at)
			 VALUES (?, ?, 'personal_access_token', ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`, [
        id,
        userId,
        input.name,
        prefix,
        tokenHash,
        JSON.stringify(input.scopes?.length ? input.scopes : ['auth:me']),
        input.expiresAt ?? null,
        JSON.stringify({}),
        nowIso,
        nowIso,
    ]);
    await this.writeAuditEvent({
        actorType: 'user',
        actorId: userId,
        eventType: 'auth.pat_created',
        targetType: 'api_token',
        targetId: id,
        data: { name: input.name },
    });
    return { id, token, prefix, name: input.name, expiresAt: input.expiresAt ?? null } satisfies PersonalAccessTokenResult;
}
