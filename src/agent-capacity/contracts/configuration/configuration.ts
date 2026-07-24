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
	examplePath: string;
	runtimeOwner: '@treeseed/agent' | '@treeseed/api';
}

export const CAPACITY_CONFIGURATION_DESCRIPTORS: readonly CapacityConfigurationDescriptor[] = [
	{ id: 'provider-manifest', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.capacity-provider/v2', validator: 'validateCapacityProviderManifestV2', examplePath: 'examples/agent-capacity/provider-manifest.yaml', runtimeOwner: '@treeseed/agent' },
	{ id: 'provider-offer', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.provider-supply-offer/v1', validator: 'validateProviderSupplyOffer', examplePath: 'examples/agent-capacity/provider-offer.yaml', runtimeOwner: '@treeseed/agent' },
	{ id: 'capacity-grant', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.capacity-grant/v2', validator: 'validateCapacityGrantV2', examplePath: 'examples/agent-capacity/capacity-grant.yaml', runtimeOwner: '@treeseed/api' },
	{ id: 'allocation-set', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.capacity-allocation-set/v2', validator: 'validateCapacityAllocationSetV2', examplePath: 'examples/agent-capacity/allocation-set.yaml', runtimeOwner: '@treeseed/api' },
	{ id: 'project-agent-class', ownerPackage: '@treeseed/sdk', format: 'yaml', schemaId: 'treeseed.project-agent-class/v1', validator: 'validateProjectAgentClassConfiguration', examplePath: 'examples/agent-capacity/project-agent-class.yaml', runtimeOwner: '@treeseed/api' },
	{ id: 'activity-profile', ownerPackage: '@treeseed/sdk', format: 'mdx-frontmatter', schemaId: 'treeseed.agent-activity-profiles/v1', validator: 'validateAgentActivityProfilesConfiguration', examplePath: 'examples/agent-capacity/activity-profiles.yaml', runtimeOwner: '@treeseed/agent' },
] as const;
