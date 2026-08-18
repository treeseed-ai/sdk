import { D1AuthStore } from "../../../d1-store.ts";
export async function loadIdentityByProviderMethod(this: D1AuthStore, provider: string, providerSubject: string) {
    return this.first<{
        id: string;
        user_id: string;
        email: string | null;
        profile_json: string | null;
    }>(`SELECT * FROM user_identities WHERE provider = ? AND provider_subject = ?`, [provider, providerSubject]);
}
