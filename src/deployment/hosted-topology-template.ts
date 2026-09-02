import { z } from 'zod';
import { hostedArtifactSchema, hostedProviderSchema, hostedResourceDeclarationSchema, hostedTopologyDeclarationSchema } from './hosted-topology.ts';

const identifier = z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u);
const custodyIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);

export const hostedTopologyTemplateSchema = z.object({
	schemaVersion: z.literal('treeseed.hosted-topology-template/v1'),
	id: identifier,
	deploymentId: custodyIdentifier,
	stackId: custodyIdentifier,
	environment: z.enum(['staging', 'production']),
	mutation: z.literal('approval-required'),
	stateBackend: z.object({ connectionRef: identifier }).strict(),
	providerConnections: z.record(hostedProviderSchema, z.object({ connectionRef: identifier }).strict()),
	artifactBindings: z.record(identifier, z.object({ input: identifier, kind: z.enum(['archive', 'file', 'oci-image']) }).strict()),
	resources: z.array(hostedResourceDeclarationSchema),
}).strict().superRefine((template, context) => {
	const referenced = new Set(template.resources.flatMap(({ parameters }) => Object.values(parameters).flatMap((parameter) => 'artifact' in parameter ? [parameter.artifact] : [])));
	for (const artifact of referenced) if (!template.artifactBindings[artifact]) context.addIssue({ code: z.ZodIssueCode.custom, path: ['artifactBindings'], message: `Hosted topology template has no binding for ${artifact}.` });
	for (const artifact of Object.keys(template.artifactBindings)) if (!referenced.has(artifact)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['artifactBindings', artifact], message: `Hosted topology artifact binding ${artifact} is unused.` });
});

export type HostedTopologyTemplate = z.infer<typeof hostedTopologyTemplateSchema>;

export function compileHostedTopologyTemplate(input: {
	template: HostedTopologyTemplate;
	teamId: string;
	platformCommit: string;
	artifacts: Record<string, z.input<typeof hostedArtifactSchema>>;
}) {
	const template = hostedTopologyTemplateSchema.parse(input.template), teamId = custodyIdentifier.parse(input.teamId), platformCommit = gitCommit.parse(input.platformCommit);
	const expectedInputs = Object.values(template.artifactBindings).map(({ input: name }) => name).sort(), receivedInputs = Object.keys(input.artifacts).sort();
	if (new Set(expectedInputs).size !== expectedInputs.length) throw new Error('Hosted topology template artifact input names must be unique.');
	if (expectedInputs.join('\n') !== receivedInputs.join('\n')) throw new Error('Hosted topology artifact inputs must match the exact template bindings.');
	const artifacts = Object.fromEntries(Object.entries(template.artifactBindings).sort(([left], [right]) => left.localeCompare(right)).map(([id, binding]) => {
		const artifact = hostedArtifactSchema.parse(input.artifacts[binding.input]);
		if (artifact.kind !== binding.kind) throw new Error(`Hosted topology artifact ${binding.input} must be ${binding.kind}.`);
		return [id, artifact];
	}));
	return hostedTopologyDeclarationSchema.parse({
		schemaVersion: 'treeseed.hosted-topology/v1', id: template.id, teamId, deploymentId: template.deploymentId, stackId: template.stackId,
		environment: template.environment, mutation: template.mutation, platform: { repository: 'treeseed-ai/platform', commit: platformCommit },
		stateBackend: template.stateBackend, providerConnections: template.providerConnections, artifacts, resources: template.resources,
	});
}
