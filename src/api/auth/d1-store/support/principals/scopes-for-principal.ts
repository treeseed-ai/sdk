import { D1AuthStore } from "../../../d1-store.ts";
export function scopesForPrincipalMethod(this: D1AuthStore, permissions: string[]) {
    const scopes = new Set<string>(['auth:me']);
    if (permissions.includes('*:*:*') || permissions.includes('sdk:execute:global'))
        scopes.add('sdk');
    if (permissions.includes('*:*:*') || permissions.includes('agent:execute:global'))
        scopes.add('agent');
    if (permissions.includes('*:*:*') || permissions.includes('operations:execute:global'))
        scopes.add('operations');
    return [...scopes];
}
