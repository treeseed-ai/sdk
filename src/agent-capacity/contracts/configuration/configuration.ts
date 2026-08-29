export const CAPACITY_CONFIGURATION_FAMILIES = [
	'provider-manifest',
	'provider-offer',
	'capacity-grant',
	'allocation-set',
	'project-agent-class',
	'activity-profile',
] as const;

export type CapacityConfigurationFamily = (typeof CAPACITY_CONFIGURATION_FAMILIES)[number];

export interface CapacityConfigurationDescriptor {
	id: CapacityConfigurationFamily;
	ownerPackage: '@treeseed/sdk';
	format: 'yaml' | 'mdx-frontmatter';
	schemaId: string;
	validator: string;
	runtimeOwner: '@treeseed/agent' | '@treeseed/api';
}

export const CAPACITY_CONFIGURATION_DESCRIPTORS: readonly CapacityConfigurationDescriptor[] = [
	{ id: 'provider-manifest', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.capacity-provider/v4', validator: 'validateCapacityProviderManifestV4', runtimeOwner: '@treeseed/agent' },
	{ id: 'provider-offer', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.provider-supply-offer/v1', validator: 'validateProviderSupplyOffer', runtimeOwner: '@treeseed/agent' },
	{ id: 'capacity-grant', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.capacity-grant/v2', validator: 'validateCapacityGrantV2', runtimeOwner: '@treeseed/api' },
	{ id: 'allocation-set', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.capacity-allocation-set/v2', validator: 'validateCapacityAllocationSetV2', runtimeOwner: '@treeseed/api' },
	{ id: 'project-agent-class', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.project-agent-class/v1', validator: 'validateProjectAgentClassConfiguration', runtimeOwner: '@treeseed/api' },
	{ id: 'activity-profile', ownerPackage: '@treeseed/sdk', format: 'mdx-frontmatter', schemaId: 'treeseed.agent-activity-profiles/v1', validator: 'validateAgentActivityProfilesConfiguration', runtimeOwner: '@treeseed/agent' },
] as const;
