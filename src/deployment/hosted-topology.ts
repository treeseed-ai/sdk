import { z } from 'zod';
import { deploymentDigest } from './canonical.ts';

const identifier = z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const timestamp = z.string().datetime();

export const hostedProviderSchema = z.enum(['cloudflare', 'railway']);
export const hostedResourceKindSchema = z.enum([
	'admin-application', 'dns-record', 'tls-policy', 'api-proxy',
	'control-plane-api', 'postgresql', 'operations-runner', 'treedx-service',
]);

const parameterSchema = z.union([
	z.object({ input: identifier }).strict(),
	z.object({ artifact: identifier }).strict(),
	z.object({ resourceOutput: z.object({ resourceId: identifier, output: identifier }).strict() }).strict(),
	z.object({ literal: z.union([z.string().max(4_096), z.number().finite(), z.boolean()]) }).strict(),
]);

const resourceProviderKinds = {
	cloudflare: new Set(['admin-application', 'dns-record', 'tls-policy', 'api-proxy']),
	railway: new Set(['control-plane-api', 'postgresql', 'operations-runner', 'treedx-service']),
} as const;

const sensitiveKey = /(?:credential|password|private.?key|registration.?code|secret|token)/iu;
const personalPath = /(?:^|[\s'"`:=])(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/u;

const hostedResourceDeclarationSchema = z.object({
	id: identifier,
	provider: hostedProviderSchema,
	kind: hostedResourceKindSchema,
	dependsOn: z.array(identifier).default([]),
	parameters: z.record(identifier, parameterSchema).default({}),
	adoption: z.object({ mode: z.literal('adopt-or-create'), externalIdInput: identifier.optional(), replacement: z.literal('forbidden') }).strict(),
}).strict();

export const hostedTopologyDeclarationSchema = z.object({
	schemaVersion: z.literal('treeseed.hosted-topology/v1'),
	id: identifier,
	environment: z.enum(['staging', 'production']),
	mutation: z.literal('approval-required'),
	platform: z.object({ repository: z.literal('treeseed-ai/platform'), commit: gitCommit }).strict(),
	providerConnections: z.record(hostedProviderSchema, z.object({ connectionRef: identifier }).strict()),
	artifacts: z.record(identifier, z.object({ digest, source: z.string().url() }).strict()),
	resources: z.array(hostedResourceDeclarationSchema).min(1),
}).strict().superRefine((declaration, context) => {
	const ids = declaration.resources.map(({ id }) => id);
	if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['resources'], message: 'Hosted topology resource identities must be unique.' });
	for (const [index, resource] of declaration.resources.entries()) {
		if (!resourceProviderKinds[resource.provider].has(resource.kind as never)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['resources', index, 'kind'], message: `${resource.kind} is not owned by ${resource.provider}.` });
		for (const dependency of resource.dependsOn) if (!ids.includes(dependency)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['resources', index, 'dependsOn'], message: `Unknown hosted resource dependency ${dependency}.` });
		for (const key of Object.keys(resource.parameters)) if (sensitiveKey.test(key)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['resources', index, 'parameters', key], message: 'Hosted topology parameters cannot carry credential-like values.' });
		for (const [key, parameter] of Object.entries(resource.parameters)) if ('literal' in parameter && typeof parameter.literal === 'string' && personalPath.test(parameter.literal)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['resources', index, 'parameters', key], message: 'Hosted topology parameters cannot contain personal filesystem paths.' });
	}
});

export const hostedResourceObservationSchema = z.object({
	resourceId: identifier,
	provider: hostedProviderSchema,
	kind: hostedResourceKindSchema,
	providerResourceId: z.string().min(1).max(512).nullable(),
	state: z.enum(['missing', 'healthy', 'degraded']),
	managedBy: z.enum(['treeseed', 'external']).nullable(),
	observedDigest: digest.nullable(),
	observedAt: timestamp,
}).strict();

const hostedTopologyPlanShape = {
	schemaVersion: z.literal('treeseed.hosted-topology-plan/v1'),
	planId: z.string().regex(/^topology-plan-[a-f0-9]{16}$/u),
	planDigest: digest,
	declarationDigest: digest,
	topologyId: identifier,
	environment: z.enum(['staging', 'production']),
	platformCommit: gitCommit,
	actions: z.array(z.object({
		resourceId: identifier,
		provider: hostedProviderSchema,
		kind: hostedResourceKindSchema,
		action: z.enum(['create', 'adopt', 'update', 'noop']),
		desiredResource: hostedResourceDeclarationSchema,
		desiredDigest: digest,
		previousDigest: digest.nullable(),
		providerResourceId: z.string().min(1).max(512).nullable(),
	}).strict()),
	blockers: z.array(z.object({ code: z.enum(['connection-unavailable', 'dependency-cycle', 'observation-unhealthy', 'adoption-drift']), resourceId: identifier.optional(), message: z.string().min(1) }).strict()),
	approvalRequired: z.boolean(),
	executable: z.literal(false),
} as const;

function verifyPlanBinding(plan: {
	planId: string; planDigest: string; declarationDigest: string; topologyId: string; environment: 'staging' | 'production';
	platformCommit: string; actions: Array<{ resourceId: string; provider: string; kind: string; desiredResource: unknown; desiredDigest: string }>;
	blockers: unknown[];
}, context: z.RefinementCtx) {
	for (const [index, action] of plan.actions.entries()) {
		const desired = hostedResourceDeclarationSchema.parse(action.desiredResource);
		if (desired.id !== action.resourceId || desired.provider !== action.provider || desired.kind !== action.kind)
			context.addIssue({ code: z.ZodIssueCode.custom, path: ['actions', index, 'desiredResource'], message: 'Hosted plan action identity must match its desired resource specification.' });
		if (deploymentDigest(desired) !== action.desiredDigest)
			context.addIssue({ code: z.ZodIssueCode.custom, path: ['actions', index, 'desiredDigest'], message: 'Hosted plan desired digest must bind its complete desired resource specification.' });
	}
	const core = { declarationDigest: plan.declarationDigest, topologyId: plan.topologyId, environment: plan.environment,
		platformCommit: plan.platformCommit, actions: plan.actions, blockers: plan.blockers };
	const expected = deploymentDigest(core);
	if (expected !== plan.planDigest || plan.planId !== `topology-plan-${expected.slice(7, 23)}`)
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['planDigest'], message: 'Hosted topology plan identity must bind the exact canonical plan.' });
}

export const hostedTopologyPlanSchema = z.object(hostedTopologyPlanShape).strict().superRefine(verifyPlanBinding);

export const hostedTopologyApprovalSchema = z.object({
	schemaVersion: z.literal('treeseed.hosted-topology-approval/v1'),
	planDigest: digest,
	environment: z.enum(['staging', 'production']),
	decision: z.literal('approved'),
	approvedBy: z.string().min(1).max(256),
	approvedAt: timestamp,
}).strict();

export const authorizedHostedTopologyPlanSchema = z.object({ ...hostedTopologyPlanShape,
	executable: z.literal(true),
	approval: hostedTopologyApprovalSchema.nullable(),
}).strict().omit({ approvalRequired: true }).superRefine(verifyPlanBinding);

export const hostedTopologyReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.hosted-topology-receipt/v1'),
	receiptId: z.string().regex(/^topology-receipt-[a-f0-9]{16}$/u),
	planDigest: digest,
	declarationDigest: digest,
	topologyId: identifier,
	environment: z.enum(['staging', 'production']),
	platformCommit: gitCommit,
	resources: z.array(hostedResourceObservationSchema),
	previousResources: z.array(hostedResourceObservationSchema),
	state: z.literal('known-good'),
	completedAt: timestamp,
}).strict();

export const hostedTopologyRollbackSchema = z.object({
	schemaVersion: z.literal('treeseed.hosted-topology-rollback/v1'),
	rollbackId: z.string().regex(/^topology-rollback-[a-f0-9]{16}$/u),
	sourceReceiptId: z.string().regex(/^topology-receipt-[a-f0-9]{16}$/u),
	environment: z.enum(['staging', 'production']),
	operations: z.array(z.object({
		resourceId: identifier,
		action: z.enum(['restore', 'delete-created', 'noop']),
		providerResourceId: z.string().min(1).max(512),
		targetDigest: digest.nullable(),
	}).strict()),
	rollbackDigest: digest,
}).strict();

export const hostedTopologyRollbackApprovalSchema = z.object({
	schemaVersion: z.literal('treeseed.hosted-topology-rollback-approval/v1'),
	rollbackDigest: digest,
	environment: z.enum(['staging', 'production']),
	decision: z.literal('approved'),
	approvedBy: z.string().min(1).max(256),
	approvedAt: timestamp,
}).strict();

export type HostedTopologyDeclaration = z.infer<typeof hostedTopologyDeclarationSchema>;
export type HostedResourceObservation = z.infer<typeof hostedResourceObservationSchema>;
export type HostedTopologyPlan = z.infer<typeof hostedTopologyPlanSchema>;
export type HostedTopologyApproval = z.infer<typeof hostedTopologyApprovalSchema>;
export type AuthorizedHostedTopologyPlan = z.infer<typeof authorizedHostedTopologyPlanSchema>;
export type HostedTopologyReceipt = z.infer<typeof hostedTopologyReceiptSchema>;

function observationMap(items: HostedResourceObservation[], declaration: HostedTopologyDeclaration) {
	const resources = new Map(declaration.resources.map((resource) => [resource.id, resource]));
	const observations = new Map<string, HostedResourceObservation>();
	for (const input of items) {
		const item = hostedResourceObservationSchema.parse(input), resource = resources.get(item.resourceId);
		if (observations.has(item.resourceId)) throw new Error(`Duplicate hosted resource observation ${item.resourceId}.`);
		if (!resource) throw new Error(`Unknown hosted resource observation ${item.resourceId}.`);
		if (item.provider !== resource.provider || item.kind !== resource.kind) throw new Error(`Hosted resource observation identity mismatch for ${item.resourceId}.`);
		observations.set(item.resourceId, item);
	}
	return observations;
}

function cycleMembers(declaration: HostedTopologyDeclaration) {
	const dependencies = new Map(declaration.resources.map(({ id, dependsOn }) => [id, dependsOn]));
	const visiting = new Set<string>(), visited = new Set<string>(), cycles = new Set<string>();
	const visit = (id: string) => {
		if (visiting.has(id)) { cycles.add(id); return; }
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of dependencies.get(id) ?? []) { visit(dependency); if (cycles.has(dependency)) cycles.add(id); }
		visiting.delete(id); visited.add(id);
	};
	for (const id of dependencies.keys()) visit(id);
	return [...cycles].sort();
}

export function planHostedTopology(input: {
	declaration: HostedTopologyDeclaration;
	observations: HostedResourceObservation[];
	availableConnections: string[];
}): HostedTopologyPlan {
	const declaration = hostedTopologyDeclarationSchema.parse(input.declaration);
	const normalizedDeclaration = {
		...declaration,
		resources: [...declaration.resources]
			.map((resource) => ({ ...resource, dependsOn: [...resource.dependsOn].sort() }))
			.sort((left, right) => left.id.localeCompare(right.id)),
	};
	const observations = observationMap(input.observations, normalizedDeclaration);
	const blockers: HostedTopologyPlan['blockers'] = [];
	for (const [provider, binding] of Object.entries(normalizedDeclaration.providerConnections)) if (!input.availableConnections.includes(binding.connectionRef)) blockers.push({ code: 'connection-unavailable', message: `${provider} connection ${binding.connectionRef} is unavailable.` });
	for (const resourceId of cycleMembers(normalizedDeclaration)) blockers.push({ code: 'dependency-cycle', resourceId, message: `Hosted resource ${resourceId} participates in a dependency cycle.` });
	const actions = normalizedDeclaration.resources.map((resource) => {
		const desiredDigest = deploymentDigest(resource);
		const observation = observations.get(resource.id);
		let action: 'create' | 'adopt' | 'update' | 'noop' = 'create';
		if (observation?.state === 'degraded') blockers.push({ code: 'observation-unhealthy', resourceId: resource.id, message: `Hosted resource ${resource.id} is degraded and cannot be reconciled automatically.` });
		if (observation?.state === 'healthy') {
			if (observation.observedDigest === desiredDigest) action = observation.managedBy === 'external' ? 'adopt' : 'noop';
			else if (observation.managedBy === 'external') blockers.push({ code: 'adoption-drift', resourceId: resource.id, message: `External resource ${resource.id} differs from the declaration and cannot be replaced.` });
			else action = 'update';
		}
		return { resourceId: resource.id, provider: resource.provider, kind: resource.kind, action, desiredResource: resource,
			desiredDigest, previousDigest: observation?.observedDigest ?? null, providerResourceId: observation?.providerResourceId ?? null };
	});
	const declarationDigest = deploymentDigest(normalizedDeclaration);
	const core = { declarationDigest, topologyId: declaration.id, environment: declaration.environment, platformCommit: declaration.platform.commit, actions, blockers };
	const planDigest = deploymentDigest(core);
	return hostedTopologyPlanSchema.parse({ schemaVersion: 'treeseed.hosted-topology-plan/v1', planId: `topology-plan-${planDigest.slice(7, 23)}`, planDigest, ...core, approvalRequired: actions.some(({ action }) => action !== 'noop'), executable: false });
}

export function authorizeHostedTopologyPlan(planInput: HostedTopologyPlan, approvalInput?: HostedTopologyApproval): AuthorizedHostedTopologyPlan {
	const plan = hostedTopologyPlanSchema.parse(planInput);
	if (plan.blockers.length) throw new Error('Hosted topology plan has unresolved blockers.');
	const approval = approvalInput ? hostedTopologyApprovalSchema.parse(approvalInput) : null;
	if (plan.approvalRequired && !approval) throw new Error('Hosted topology mutation requires environment approval.');
	if (approval && (approval.planDigest !== plan.planDigest || approval.environment !== plan.environment)) throw new Error('Hosted topology approval does not bind the exact plan and environment.');
	const { approvalRequired: _approvalRequired, ...approvedPlan } = plan;
	return authorizedHostedTopologyPlanSchema.parse({ ...approvedPlan, executable: true, approval });
}

export function verifyHostedTopologyReadback(input: {
	plan: AuthorizedHostedTopologyPlan;
	previousResources: HostedResourceObservation[];
	resources: HostedResourceObservation[];
	completedAt: string;
}): HostedTopologyReceipt {
	const plan = authorizedHostedTopologyPlanSchema.parse(input.plan);
	const expectedIds = new Set(plan.actions.map(({ resourceId }) => resourceId));
	const resources = input.resources.map((item) => hostedResourceObservationSchema.parse(item)).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
	if (resources.length !== expectedIds.size || new Set(resources.map(({ resourceId }) => resourceId)).size !== resources.length || resources.some(({ resourceId }) => !expectedIds.has(resourceId))) throw new Error('Authoritative read-back must contain each planned hosted resource exactly once.');
	const observed = new Map(resources.map((item) => [item.resourceId, item]));
	for (const action of plan.actions) {
		const item = observed.get(action.resourceId);
		if (!item || item.provider !== action.provider || item.kind !== action.kind || item.state !== 'healthy' || !item.providerResourceId || item.observedDigest !== action.desiredDigest) throw new Error(`Authoritative read-back failed for hosted resource ${action.resourceId}.`);
	}
	const completedAt = timestamp.parse(input.completedAt);
	const receiptDigest = deploymentDigest({ planDigest: plan.planDigest, resources, completedAt });
	return hostedTopologyReceiptSchema.parse({ schemaVersion: 'treeseed.hosted-topology-receipt/v1', receiptId: `topology-receipt-${receiptDigest.slice(7, 23)}`, planDigest: plan.planDigest, declarationDigest: plan.declarationDigest, topologyId: plan.topologyId, environment: plan.environment, platformCommit: plan.platformCommit, resources, previousResources: input.previousResources.map((item) => hostedResourceObservationSchema.parse(item)).sort((left, right) => left.resourceId.localeCompare(right.resourceId)), state: 'known-good', completedAt });
}

export function planHostedTopologyRollback(receiptInput: HostedTopologyReceipt) {
	const receipt = hostedTopologyReceiptSchema.parse(receiptInput);
	const previous = new Map(receipt.previousResources.map((item) => [item.resourceId, item]));
	const operations = receipt.resources.map((resource) => {
		const prior = previous.get(resource.resourceId);
		return { resourceId: resource.resourceId, action: !prior || prior.state === 'missing' ? 'delete-created' as const : prior.observedDigest === resource.observedDigest ? 'noop' as const : 'restore' as const, providerResourceId: resource.providerResourceId!, targetDigest: prior?.observedDigest ?? null };
	}).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
	const rollbackDigest = deploymentDigest({ sourceReceiptId: receipt.receiptId, operations });
	return hostedTopologyRollbackSchema.parse({ schemaVersion: 'treeseed.hosted-topology-rollback/v1', rollbackId: `topology-rollback-${rollbackDigest.slice(7, 23)}`, sourceReceiptId: receipt.receiptId, environment: receipt.environment, operations, rollbackDigest });
}

export function authorizeHostedTopologyRollback(rollbackInput: z.input<typeof hostedTopologyRollbackSchema>, approvalInput: z.input<typeof hostedTopologyRollbackApprovalSchema>) {
	const rollback = hostedTopologyRollbackSchema.parse(rollbackInput), approval = hostedTopologyRollbackApprovalSchema.parse(approvalInput);
	if (approval.rollbackDigest !== rollback.rollbackDigest || approval.environment !== rollback.environment) throw new Error('Hosted topology rollback approval does not bind the exact rollback and environment.');
	return { rollback, approval };
}
