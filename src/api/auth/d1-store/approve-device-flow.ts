import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export async function approveDeviceFlowMethod(this: D1AuthStore, request: DeviceCodeApproveRequest): Promise<{
    ok: true;
}> {
    await this.ensureInitialized();
    const row = await this.first<DeviceCodeRow>(`SELECT * FROM device_codes WHERE user_code = ?`, [request.userCode]);
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
        throw new Error('Device code approval failed because the user code is unknown or expired.');
    }
    let userId = request.principalId;
    if (!(await this.loadUser(userId))) {
        const createdAt = isoNow();
        await this.run(`INSERT INTO users (id, email, display_name, status, metadata_json, created_at, updated_at)
				 VALUES (?, NULL, ?, 'active', ?, ?, ?)`, [userId, request.displayName ?? null, JSON.stringify(request.metadata ?? {}), createdAt, createdAt]);
        await this.assignRole(userId, 'member');
    }
    await this.run(`UPDATE device_codes SET status = 'approved', user_id = ?, updated_at = ? WHERE id = ?`, [userId, isoNow(), row.id]);
    await this.writeAuditEvent({
        actorType: 'user',
        actorId: userId,
        eventType: 'auth.device_approved',
        targetType: 'device_code',
        targetId: row.id,
    });
    return { ok: true };
}
