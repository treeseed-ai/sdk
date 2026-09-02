import { describe, expect, it } from 'vitest';
import { authorizeHostedTopologyPlan, authorizeHostedTopologyRollback, authorizeHostedTopologyRollbackExecution, deploymentDigest, hostedTopologyDeclarationSchema, hostedTopologyPlanSchema, planHostedTopology, planHostedTopologyRollback, planHostedTopologyRollbackExecution, verifyHostedTopologyReadback, type HostedResourceObservation, type HostedTopologyDeclaration } from '../../../src/deployment/index.ts';

const sha = (marker: string) => `sha256:${marker.repeat(64)}`;
const now = '2026-09-02T12:00:00.000Z';
const connections = () => ({
	cloudflare: { connectionRef: 'cloudflare-production', nonSecretConfig: { accountId: 'cf-account', zoneId: 'cf-zone' } },
	railway: { connectionRef: 'railway-production', nonSecretConfig: { workspaceId: 'rw-workspace', region: 'us-east' } },
});

function declaration(): HostedTopologyDeclaration {
	return hostedTopologyDeclarationSchema.parse({
		schemaVersion: 'treeseed.hosted-topology/v1', id: 'production', environment: 'production', mutation: 'approval-required',
		platform: { repository: 'treeseed-ai/platform', commit: 'a'.repeat(40) },
		providerConnections: { cloudflare: { connectionRef: 'cloudflare-production' }, railway: { connectionRef: 'railway-production' } },
		artifacts: { admin: { digest: sha('a'), source: 'https://example.test/admin.tar.gz' }, api: { digest: sha('b'), source: 'https://example.test/api.tar.gz' } },
		resources: [
			{ id: 'admin', provider: 'cloudflare', kind: 'admin-application', dependsOn: ['api-proxy'], parameters: { artifact: { artifact: 'admin' } }, adoption: { mode: 'adopt-or-create', externalIdInput: 'admin-resource-id', replacement: 'forbidden' } },
			{ id: 'api-proxy', provider: 'cloudflare', kind: 'api-proxy', dependsOn: ['api'], parameters: { upstream: { resourceOutput: { resourceId: 'api', output: 'public-url' } } }, adoption: { mode: 'adopt-or-create', replacement: 'forbidden' } },
			{ id: 'api', provider: 'railway', kind: 'control-plane-api', dependsOn: ['postgres'], parameters: { artifact: { artifact: 'api' } }, adoption: { mode: 'adopt-or-create', replacement: 'forbidden' } },
			{ id: 'postgres', provider: 'railway', kind: 'postgresql', dependsOn: [], parameters: { region: { input: 'railway-region' } }, adoption: { mode: 'adopt-or-create', externalIdInput: 'postgres-resource-id', replacement: 'forbidden' } },
		],
	});
}

function observation(resource: HostedTopologyDeclaration['resources'][number], managedBy: 'treeseed' | 'external' = 'treeseed'): HostedResourceObservation {
	return { resourceId: resource.id, provider: resource.provider, kind: resource.kind, providerResourceId: `${resource.provider}-${resource.id}`, state: 'healthy', managedBy, observedDigest: deploymentDigest(resource), observedAt: now };
}

describe('reviewed hosted topology contracts', () => {
	it('produces deterministic plans independent of declaration and observation order', () => {
		const value = declaration(), selected = connections();
		const observations = value.resources.map((resource) => observation(resource));
		const first = planHostedTopology({ declaration: value, observations, connections: selected });
		const reordered = planHostedTopology({ declaration: { ...value, resources: [...value.resources].reverse() }, observations: [...observations].reverse(), connections: selected });
		expect(reordered.planDigest).toBe(first.planDigest);
		expect(first.actions.every(({ action }) => action === 'noop')).toBe(true);
		expect(authorizeHostedTopologyPlan(first).approval).toBeNull();
	});

	it('binds each executable action to the complete reviewed resource specification', () => {
		const value = declaration();
		const plan = planHostedTopology({ declaration: value, observations: [], connections: connections() });
		expect(plan.artifacts).toEqual(value.artifacts);
		expect(plan.providerConnections).toEqual(connections());
		expect(plan.actions.map(({ desiredResource }) => desiredResource)).toEqual([...value.resources]
			.map((resource) => ({ ...resource, dependsOn: [...resource.dependsOn].sort() })).sort((left, right) => left.id.localeCompare(right.id)));
		const action = plan.actions[0]!;
		expect(() => hostedTopologyPlanSchema.parse({ ...plan, actions: [{ ...action, desiredResource: { ...action.desiredResource, parameters: { changed: { literal: true } } } }, ...plan.actions.slice(1)] })).toThrow(/desired digest/u);
		expect(() => hostedTopologyPlanSchema.parse({ ...plan, actions: [{ ...action, resourceId: 'tampered' }, ...plan.actions.slice(1)] })).toThrow(/identity/u);
		expect(() => hostedTopologyPlanSchema.parse({ ...plan, planDigest: sha('f') })).toThrow(/exact canonical plan/u);
		expect(() => hostedTopologyPlanSchema.parse({ ...plan, providerConnections: { ...plan.providerConnections,
			cloudflare: { ...plan.providerConnections.cloudflare!, nonSecretConfig: { apiToken: 'forbidden' } } } })).toThrow(/credential-like/u);
	});

	it('adopts matching external resources without replacement and rejects drift', () => {
		const value = declaration(), external = observation(value.resources[3]!, 'external');
		const accepted = planHostedTopology({ declaration: value, observations: [external], connections: connections() });
		expect(accepted.actions.find(({ resourceId }) => resourceId === 'postgres')?.action).toBe('adopt');
		const drifted = planHostedTopology({ declaration: value, observations: [{ ...external, observedDigest: sha('f') }], connections: connections() });
		expect(drifted.blockers).toMatchObject([{ code: 'adoption-drift', resourceId: 'postgres' }]);
	});

	it('fails closed for missing connections, dependency cycles, and mismatched approval', () => {
		const value = declaration();
		const unavailable = planHostedTopology({ declaration: value, observations: [], connections: {} });
		expect(unavailable.blockers.filter(({ code }) => code === 'connection-unavailable')).toHaveLength(2);
		const cyclic = hostedTopologyDeclarationSchema.parse({ ...value, resources: value.resources.map((resource) => resource.id === 'postgres' ? { ...resource, dependsOn: ['admin'] } : resource) });
		expect(planHostedTopology({ declaration: cyclic, observations: [], connections: connections() }).blockers.some(({ code }) => code === 'dependency-cycle')).toBe(true);
		const plan = planHostedTopology({ declaration: value, observations: [], connections: connections() });
		expect(() => authorizeHostedTopologyPlan(plan)).toThrow(/environment approval/u);
		expect(() => authorizeHostedTopologyPlan(plan, { schemaVersion: 'treeseed.hosted-topology-approval/v1', planDigest: sha('f'), environment: 'production', decision: 'approved', approvedBy: 'release-approver', approvedAt: now })).toThrow(/exact plan/u);
	});

	it('verifies exact read-back, returns noop, and binds rollback lineage', () => {
		const value = declaration(), previous = value.resources.map((resource) => ({ ...observation(resource), state: 'missing' as const, managedBy: null, providerResourceId: null, observedDigest: null }));
		const plan = planHostedTopology({ declaration: value, observations: previous, connections: connections() });
		const authorized = authorizeHostedTopologyPlan(plan, { schemaVersion: 'treeseed.hosted-topology-approval/v1', planDigest: plan.planDigest, environment: 'production', decision: 'approved', approvedBy: 'release-approver', approvedAt: now });
		const resources = value.resources.map((resource) => observation(resource));
		const receipt = verifyHostedTopologyReadback({ plan: authorized, previousResources: previous, resources, completedAt: now });
		expect(receipt.state).toBe('known-good');
		expect(planHostedTopology({ declaration: value, observations: resources, connections: connections() }).actions.every(({ action }) => action === 'noop')).toBe(true);
		const rollback = planHostedTopologyRollback(receipt);
		expect(rollback.operations.every(({ action }) => action === 'delete-created')).toBe(true);
		expect(authorizeHostedTopologyRollback(rollback, { schemaVersion: 'treeseed.hosted-topology-rollback-approval/v1', rollbackDigest: rollback.rollbackDigest, environment: 'production', decision: 'approved', approvedBy: 'release-approver', approvedAt: now }).rollback.rollbackId).toBe(rollback.rollbackId);
		expect(() => authorizeHostedTopologyRollback(rollback, { schemaVersion: 'treeseed.hosted-topology-rollback-approval/v1', rollbackDigest: sha('f'), environment: 'production', decision: 'approved', approvedBy: 'release-approver', approvedAt: now })).toThrow(/exact rollback/u);
		expect(() => verifyHostedTopologyReadback({ plan: authorized, previousResources: previous, resources: resources.map((resource, index) => index ? resource : { ...resource, observedDigest: sha('f') }), completedAt: now })).toThrow(/read-back failed/u);
	});

	it('rejects ambiguous, unknown, and identity-confused observations', () => {
		const value = declaration(), target = observation(value.resources[0]!);
		expect(() => planHostedTopology({ declaration: value, observations: [target, target], connections: connections() })).toThrow(/Duplicate/u);
		expect(() => planHostedTopology({ declaration: value, observations: [{ ...target, resourceId: 'unexpected' }], connections: connections() })).toThrow(/Unknown/u);
		expect(() => planHostedTopology({ declaration: value, observations: [{ ...target, provider: 'railway' }], connections: connections() })).toThrow(/identity mismatch/u);
	});

	it('binds rollback approval to the complete source and target plans', () => {
		const value = declaration(), current = value.resources.map((resource) => observation(resource));
		const sourcePlan = authorizeHostedTopologyPlan(planHostedTopology({ declaration: value, observations: [], connections: connections() }), { schemaVersion: 'treeseed.hosted-topology-approval/v1', planDigest: planHostedTopology({ declaration: value, observations: [], connections: connections() }).planDigest, environment: 'production', decision: 'approved', approvedBy: 'release-approver', approvedAt: now });
		const previous = current.map((resource, index) => index ? resource : { ...resource, state: 'missing' as const, managedBy: null, providerResourceId: null, observedDigest: null });
		const receipt = verifyHostedTopologyReadback({ plan: sourcePlan, previousResources: previous, resources: current, completedAt: now });
		const rollback = planHostedTopologyRollback(receipt), targetDeclaration = hostedTopologyDeclarationSchema.parse({ ...value, resources: value.resources.slice(1) });
		const targetPlan = planHostedTopology({ declaration: targetDeclaration, observations: previous.slice(1), connections: connections() });
		const execution = planHostedTopologyRollbackExecution({ rollback, sourceReceipt: receipt, sourcePlan, targetPlan });
		const approval = { schemaVersion: 'treeseed.hosted-topology-rollback-execution-approval/v1' as const, executionDigest: execution.executionDigest, environment: 'production' as const, decision: 'approved' as const, approvedBy: 'release-approver', approvedAt: now };
		expect(authorizeHostedTopologyRollbackExecution(execution, approval).execution.targetPlanDigest).toBe(targetPlan.planDigest);
		const changedConnections = connections(); changedConnections.cloudflare.nonSecretConfig.zoneId = 'different-zone';
		const substitutedTarget = planHostedTopology({ declaration: targetDeclaration, observations: previous.slice(1), connections: changedConnections });
		const substitutedExecution = planHostedTopologyRollbackExecution({ rollback, sourceReceipt: receipt, sourcePlan, targetPlan: substitutedTarget });
		expect(() => authorizeHostedTopologyRollbackExecution(substitutedExecution, approval)).toThrow(/exact source, target/u);
	});

	it('rejects provider-kind confusion, credential-shaped parameters, and personal paths', () => {
		const value = declaration(), target = value.resources[0]!;
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, provider: 'railway' }, ...value.resources.slice(1)] })).toThrow(/not owned/u);
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, parameters: { apiToken: { input: 'credential' } } }, ...value.resources.slice(1)] })).toThrow(/credential-like/u);
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, parameters: { path: { literal: '/home/person/work' } } }, ...value.resources.slice(1)] })).toThrow(/personal filesystem/u);
	});
});
