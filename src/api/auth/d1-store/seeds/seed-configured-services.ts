import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from "../../rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from "../../tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../../d1-store.ts";
export async function seedConfiguredServicesMethod(this: D1AuthStore) {
    if (!this.config.webServiceSecret)
        return;
    await this.upsertServiceCredential({
        serviceId: this.config.webServiceId,
        name: 'Trusted web tier',
        secret: this.config.webServiceSecret,
        roles: ['market_admin'],
        permissions: ['services:impersonate:global'],
    });
}
