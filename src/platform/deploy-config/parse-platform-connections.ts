import type {
	ControlPlaneConfig,
	ManagedServicesConfig,
	MarketProfileConfig,
	PlatformAuthorityConfig,
	PublicTreeDxFederationConfig,
} from '../support/contracts.ts';
import { optionalEnum, optionalRecord, optionalString } from './deploy-config-field-aliases.ts';

export const TREESEED_MARKET_API_BASE_URL = 'https://api.treeseed.dev' as const;

export function parsePlatformAuthority(value: unknown): PlatformAuthorityConfig {
	const record = optionalRecord(value, 'authority') ?? {};
	return {
		kind: optionalEnum(record.kind, 'authority.kind', ['customer-platform', 'market-singleton'] as const)
			?? 'customer-platform',
	};
}

export function parseMarketProfile(value: unknown): MarketProfileConfig {
	const record = optionalRecord(value, 'market') ?? {};
	const profile = optionalString(record.profile) ?? 'treeseed';
	if (profile !== 'treeseed') {
		throw new Error('Invalid deploy config: persistent deployments must use the immutable treeseed Market profile.');
	}
	const configuredBaseUrl = optionalString(record.baseUrl);
	if (configuredBaseUrl && configuredBaseUrl !== TREESEED_MARKET_API_BASE_URL) {
		throw new Error(`Invalid deploy config: the treeseed Market profile URL is ${TREESEED_MARKET_API_BASE_URL} and cannot be overridden.`);
	}
	return {
		profile: 'treeseed',
		kind: 'singleton_external',
		baseUrl: TREESEED_MARKET_API_BASE_URL,
		provisioningAuthority: 'forbidden',
	};
}

export function parseControlPlane(value: unknown, market: MarketProfileConfig): ControlPlaneConfig {
	const record = optionalRecord(value, 'controlPlane') ?? {};
	const mode = optionalEnum(record.mode, 'controlPlane.mode', ['market-passthrough', 'external', 'managed'] as const)
		?? 'market-passthrough';
	const baseUrl = optionalString(record.baseUrl);
	if (mode === 'external' && !baseUrl) {
		throw new Error('Invalid deploy config: controlPlane.baseUrl is required when controlPlane.mode is external.');
	}
	if (mode !== 'external' && baseUrl) {
		throw new Error(`Invalid deploy config: controlPlane.baseUrl is only valid for external mode, not ${mode}.`);
	}
	return {
		mode,
		baseUrl: mode === 'external' ? baseUrl : mode === 'market-passthrough' ? market.baseUrl : undefined,
	};
}

export function assertPlatformServiceAuthority(
	authority: PlatformAuthorityConfig,
	services: Record<string, unknown> | undefined,
) {
	if (authority.kind === 'market-singleton') return;
	const forbidden = Object.keys(services ?? {}).find((key) => /^market-?api$/iu.test(key));
	if (forbidden) {
		throw new Error(`Invalid deploy config: customer Platform authority cannot provision singleton Market service ${forbidden}.`);
	}
}

export function assertControlPlaneTopology(input: {
	controlPlane: ControlPlaneConfig;
	services: ManagedServicesConfig | undefined;
	publicTreeDxFederation: PublicTreeDxFederationConfig | undefined;
	explicit: boolean;
}) {
	if (!input.explicit) return;
	const enabled = (key: string) => input.services?.[key]?.enabled !== false && Boolean(input.services?.[key]);
	const owned = ['api', 'treeseedDatabase', 'operationsRunner'].filter(enabled);
	if (input.controlPlane.mode !== 'managed') {
		if (owned.length || input.publicTreeDxFederation) {
			throw new Error(`Invalid deploy config: controlPlane.mode ${input.controlPlane.mode} cannot provision customer control-plane resources (${[...owned, ...(input.publicTreeDxFederation ? ['publicTreeDxFederation'] : [])].join(', ')}).`);
		}
		return;
	}
	const missing = ['api', 'treeseedDatabase', 'operationsRunner'].filter((key) => !enabled(key));
	if (!input.publicTreeDxFederation) missing.push('publicTreeDxFederation');
	if (missing.length) {
		throw new Error(`Invalid deploy config: controlPlane.mode managed requires ${missing.join(', ')}.`);
	}
}
