import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export async function startDeviceFlowMethod(this: D1AuthStore, request: DeviceCodeStartRequest): Promise<DeviceCodeStartResponse> {
    await this.ensureInitialized();
    const current = now();
    const expiresAt = addSeconds(current, this.config.deviceCodeTtlSeconds);
    const deviceCode = nextOpaqueToken('device');
    const userCode = `${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await this.run(`INSERT INTO device_codes (id, device_code, user_code, requested_scopes_json, expires_at, interval_seconds, status, user_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`, [
        randomUUID(),
        deviceCode,
        userCode,
        JSON.stringify(request.scopes?.length ? request.scopes : ['auth:me']),
        expiresAt.toISOString(),
        this.config.deviceCodePollIntervalSeconds,
        current.toISOString(),
        current.toISOString(),
    ]);
    return {
        ok: true,
        deviceCode,
        userCode,
        verificationUri: approvalUrl(this.config.baseUrl),
        verificationUriComplete: approvalUrl(this.config.baseUrl, userCode),
        intervalSeconds: this.config.deviceCodePollIntervalSeconds,
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds: this.config.deviceCodeTtlSeconds,
    };
}
