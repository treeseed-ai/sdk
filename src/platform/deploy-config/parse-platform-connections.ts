import type {
	ControlPlaneConfig,
	ManagedServicesConfig,
	PlatformAuthorityConfig,
	PublicTreeDxFederationConfig,
} from '../support/contracts.ts';
import { optionalEnum, optionalRecord, optionalString } from './deploy-config-field-aliases.ts';

export function parsePlatformAuthority(value: unknown): PlatformAuthorityConfig {
	const record = optionalRecord(value, 'authority') ?? {};
	return {
		kind: optionalEnum(record.kind, 'authority.kind', ['customer-platform'] as const)
			?? 'customer-platform',
	};
}

export function parseControlPlane(value: unknown): ControlPlaneConfig {
	const record = optionalRecord(value, 'controlPlane') ?? {};
	const mode = optionalEnum(record.mode, 'controlPlane.mode', ['external', 'managed'] as const) ?? 'managed';
	const baseUrl = optionalString(record.baseUrl);
	if (mode === 'external' && !baseUrl) {
		throw new Error('Invalid deploy config: controlPlane.baseUrl is required when controlPlane.mode is external.');
	}
	if (mode !== 'external' && baseUrl) {
		throw new Error(`Invalid deploy config: controlPlane.baseUrl is only valid for external mode, not ${mode}.`);
	}
	return {
		mode,
		baseUrl: mode === 'external' ? baseUrl : undefined,
	};
}

export function assertPlatformServiceAuthority(
	authority: PlatformAuthorityConfig,
	services: Record<string, unknown> | undefined,
) {
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
