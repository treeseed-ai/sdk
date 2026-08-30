import { capabilityDefinitionDigest, capabilityDefinitionSchema, type CapabilityDefinition } from './capability-ontology.ts';

const createdAt = '2026-08-29T00:00:00.000Z';
const services: Record<CapabilityDefinition['family'], string[]> = {
	coordination: ['conversation', 'question-answering', 'planning', 'estimation', 'review', 'reporting', 'human-task-routing', 'decision-support'],
	research: ['web', 'literature', 'market', 'repository', 'dataset-discovery', 'retrieval', 'extraction', 'verification', 'citation', 'synthesis', 'experimentation'],
	data: ['source-connection', 'extraction', 'ingestion', 'synchronization', 'schema-inference', 'schema-mapping', 'normalization', 'transformation', 'enrichment', 'entity-resolution', 'validation', 'quality-analysis', 'lineage', 'statistical-analysis', 'visualization', 'export'],
	engineering: ['architecture', 'repository-analysis', 'code-change', 'refactoring', 'dependency-update', 'build', 'unit-testing', 'integration-testing', 'end-to-end-testing', 'debugging', 'review', 'security-analysis', 'performance-analysis', 'accessibility', 'infrastructure', 'deployment', 'release', 'operations'],
	publishing: ['drafting', 'editing', 'translation', 'structured-content', 'documentation', 'cms', 'repository', 'package-artifact', 'site-build', 'site-deployment', 'syndication', 'release-notes'],
	'external-work': ['ticket-management', 'workflow-execution', 'notification', 'human-service-fulfillment', 'artifact-delivery'],
};

function definition(family: CapabilityDefinition['family'], service: string): CapabilityDefinition {
	const configuration = [
		['instructions.system', 'Provider-neutral system instruction delivery.'],
		['instructions.task', 'Provider-neutral task instruction delivery.'],
		['instructions.templates', 'Immutable instruction template delivery.'],
		['context.queries', 'Resolved context query manifest delivery.'],
		['tools.policy', 'Assignment-scoped tool policy enforcement.'],
	].map(([key, description]) => ({ key: key!, description: description!, schema: {}, requirementSupport: ['required', 'preferred'] as Array<'required' | 'preferred'>, securityCritical: true }));
	const material: Omit<CapabilityDefinition, 'digest'> = {
		schemaVersion: 'treeseed.capability-definition/v1', id: `treeseed.${family}.${service}`, version: '1.0.0', family,
		title: service.split('-').map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`).join(' '),
		description: `Standard TreeSeed ${family} capability for ${service.replaceAll('-', ' ')}.`, status: 'active', features: [], inputs: [], outputs: [],
		configuration, permissionClasses: ['content-policy', 'repository-policy', 'network-policy', 'shell-policy', 'tool-policy'], contextModes: ['inline', 'manifest'], interactionModes: ['asynchronous', 'interactive'], implies: [], conflicts: [],
		qualificationTier: ['security-analysis', 'deployment', 'release', 'operations', 'human-service-fulfillment'].includes(service) ? 'automated-suite' : 'signed-attestation', createdAt,
	};
	return capabilityDefinitionSchema.parse({ ...material, digest: capabilityDefinitionDigest(material) });
}

export const CORE_CAPABILITY_DEFINITIONS = Object.entries(services).flatMap(([family, values]) => values.map((service) => definition(family as CapabilityDefinition['family'], service)));

export const LEGACY_CAPABILITY_ALIASES: Record<string, string> = {
	communication: 'treeseed.coordination.conversation', reporting: 'treeseed.coordination.reporting', 'terminal-reporting': 'treeseed.coordination.reporting',
	'independent-review': 'treeseed.engineering.review', 'governed-revision': 'treeseed.engineering.code-change', repository_work: 'treeseed.engineering.repository-analysis',
	'repository-read': 'treeseed.engineering.repository-analysis', research: 'treeseed.research.synthesis', planning: 'treeseed.coordination.planning',
};

export function resolveLegacyCapability(value: string, activityType?: string): string | null {
	if (value === 'agent-execution') return ({ chat: 'treeseed.coordination.conversation', acting: 'treeseed.engineering.code-change', reviewing: 'treeseed.engineering.review', estimating: 'treeseed.coordination.estimation', reporting: 'treeseed.coordination.reporting', planning: 'treeseed.coordination.planning' } as Record<string, string>)[activityType ?? ''] ?? null;
	if (value === 'repository_work' && activityType === 'acting') return 'treeseed.engineering.code-change';
	if (value.startsWith('engineering:')) return value.endsWith(':review') ? 'treeseed.engineering.review' : 'treeseed.engineering.code-change';
	return LEGACY_CAPABILITY_ALIASES[value] ?? (value.startsWith('treeseed.') || value.startsWith('provider.') ? value : null);
}
