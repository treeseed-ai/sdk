import { D1AuthStore } from "../../../d1-store.ts";
export function ensureInitializedMethod(this: D1AuthStore) {
    if (!this.initializationPromise) {
        this.initializationPromise = this.ensureAuthSchema()
            .then(() => this.seedCatalog())
            .then(() => this.reconcileBootstrapAdmins())
            .then(() => this.seedConfiguredServices());
    }
    return this.initializationPromise;
}
