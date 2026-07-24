import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from "../../rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from "../../tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../../d1-store.ts";
export async function rotateServiceCredentialMethod(this: D1AuthStore, serviceId: string) {
    await this.ensureInitialized();
    const row = await this.first<{
        name: string;
        roles_json: string;
        permissions_json: string;
    }>(`SELECT name, roles_json, permissions_json FROM service_credentials WHERE service_id = ? AND revoked_at IS NULL`, [serviceId]);
    if (!row) {
        throw new Error(`Unknown active service credential "${serviceId}".`);
    }
    return this.createServiceCredential({
        serviceId,
        name: row.name,
        roles: parseJson<string[]>(row.roles_json, []),
        permissions: parseJson<string[]>(row.permissions_json, []),
    });
}
