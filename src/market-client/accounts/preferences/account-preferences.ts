import type { AccountPreferences, AccountPreferencesUpdate } from '../../../accounts/account-contracts.ts';
import type { MarketClient } from '../../../entrypoints/clients/market-client.ts';

export function accountPreferencesMethod(this: MarketClient) {
	return this.request<{ ok: true; payload: AccountPreferences }>('/v1/auth/web/preferences', { requireAuth: true });
}

export function updateAccountPreferencesMethod(this: MarketClient, body: AccountPreferencesUpdate) {
	return this.request<{ ok: true; payload: AccountPreferences }>('/v1/auth/web/preferences', {
		method: 'PATCH',
		body,
		requireAuth: true,
	});
}
