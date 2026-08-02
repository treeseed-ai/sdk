import { D1AuthStore } from "../../d1-store.ts";
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
