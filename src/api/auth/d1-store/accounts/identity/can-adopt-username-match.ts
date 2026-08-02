import type { UserIdentityProfileInput } from "../../../../types.ts";
import { D1AuthStore,UserRow } from "../../../d1-store.ts";
export function canAdoptUsernameMatchMethod(this: D1AuthStore, identity: UserIdentityProfileInput, user: UserRow | null) {
    if (!user?.id || !identity.username)
        return false;
    const profile = identity.profile && typeof identity.profile === 'object' ? identity.profile : {};
    if (identity.provider === 'acceptance' || profile.acceptance === true)
        return true;
    const existingEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    const requestedEmail = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
    return Boolean(requestedEmail && existingEmail && requestedEmail === existingEmail && identity.emailVerified);
}
