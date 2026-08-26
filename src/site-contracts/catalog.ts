export const REMOTE_CONTRACT_HEADER = 'x-treeseed-contract-version';
export const REMOTE_CONTRACT_VERSION = 1;

export const COMMERCE_OFFER_MODES = [
	'free', 'private', 'contact', 'one_time', 'one_time_current_version', 'subscription',
	'subscription_updates', 'professional_hosting', 'scoped_contract', 'external',
] as const;
export type CommerceOfferMode = typeof COMMERCE_OFFER_MODES[number];
export type CatalogItemOfferMode = CommerceOfferMode;

export interface CatalogItem {
	id?: string;
	slug: string;
	name?: string;
	title?: string;
	description?: string;
	visibility?: string;
	offerMode?: CommerceOfferMode;
	priceModel?: CommerceOfferMode;
	[key: string]: any;
}
