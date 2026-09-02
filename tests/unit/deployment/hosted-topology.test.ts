import { describe, expect, it } from 'vitest';
import { authorizeHostedTopologyPlan, deploymentDigest, hostedTopologyDeclarationSchema, planHostedTopology, planHostedTopologyRollback, verifyHostedTopologyReadback, type HostedResourceObservation, type HostedTopologyDeclaration } from '../../../src/deployment/index.ts';

const sha = (marker: string) => `sha256:${marker.repeat(64)}`;
const now = '2026-09-02T12:00:00.000Z';

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
		const value = declaration(), connections = ['cloudflare-production', 'railway-production'];
		const observations = value.resources.map((resource) => observation(resource));
		const first = planHostedTopology({ declaration: value, observations, availableConnections: connections });
		const reordered = planHostedTopology({ declaration: { ...value, resources: [...value.resources].reverse() }, observations: [...observations].reverse(), availableConnections: [...connections].reverse() });
		expect(reordered.planDigest).toBe(first.planDigest);
		expect(first.actions.every(({ action }) => action === 'noop')).toBe(true);
		expect(authorizeHostedTopologyPlan(first).approval).toBeNull();
	});

	it('adopts matching external resources without replacement and rejects drift', () => {
		const value = declaration(), external = observation(value.resources[3]!, 'external');
		const accepted = planHostedTopology({ declaration: value, observations: [external], availableConnections: ['cloudflare-production', 'railway-production'] });
		expect(accepted.actions.find(({ resourceId }) => resourceId === 'postgres')?.action).toBe('adopt');
		const drifted = planHostedTopology({ declaration: value, observations: [{ ...external, observedDigest: sha('f') }], availableConnections: ['cloudflare-production', 'railway-production'] });
		expect(drifted.blockers).toMatchObject([{ code: 'adoption-drift', resourceId: 'postgres' }]);
	});

	it('fails closed for missing connections, dependency cycles, and mismatched approval', () => {
		const value = declaration();
		const unavailable = planHostedTopology({ declaration: value, observations: [], availableConnections: [] });
		expect(unavailable.blockers.filter(({ code }) => code === 'connection-unavailable')).toHaveLength(2);
		const cyclic = hostedTopologyDeclarationSchema.parse({ ...value, resources: value.resources.map((resource) => resource.id === 'postgres' ? { ...resource, dependsOn: ['admin'] } : resource) });
		expect(planHostedTopology({ declaration: cyclic, observations: [], availableConnections: ['cloudflare-production', 'railway-production'] }).blockers.some(({ code }) => code === 'dependency-cycle')).toBe(true);
		const plan = planHostedTopology({ declaration: value, observations: [], availableConnections: ['cloudflare-production', 'railway-production'] });
		expect(() => authorizeHostedTopologyPlan(plan)).toThrow(/environment approval/u);
		expect(() => authorizeHostedTopologyPlan(plan, { schemaVersion: 'treeseed.hosted-topology-approval/v1', planDigest: sha('f'), environment: 'production', decision: 'approved', approvedBy: 'release-approver', approvedAt: now })).toThrow(/exact plan/u);
	});

	it('verifies exact read-back, returns noop, and binds rollback lineage', () => {
		const value = declaration(), previous = value.resources.map((resource) => ({ ...observation(resource), state: 'missing' as const, managedBy: null, providerResourceId: null, observedDigest: null }));
		const plan = planHostedTopology({ declaration: value, observations: previous, availableConnections: ['cloudflare-production', 'railway-production'] });
		const authorized = authorizeHostedTopologyPlan(plan, { schemaVersion: 'treeseed.hosted-topology-approval/v1', planDigest: plan.planDigest, environment: 'production', decision: 'approved', approvedBy: 'release-approver', approvedAt: now });
		const resources = value.resources.map((resource) => observation(resource));
		const receipt = verifyHostedTopologyReadback({ plan: authorized, previousResources: previous, resources, completedAt: now });
		expect(receipt.state).toBe('known-good');
		expect(planHostedTopology({ declaration: value, observations: resources, availableConnections: ['cloudflare-production', 'railway-production'] }).actions.every(({ action }) => action === 'noop')).toBe(true);
		expect(planHostedTopologyRollback(receipt).operations.every(({ action }) => action === 'delete-created')).toBe(true);
		expect(() => verifyHostedTopologyReadback({ plan: authorized, previousResources: previous, resources: resources.map((resource, index) => index ? resource : { ...resource, observedDigest: sha('f') }), completedAt: now })).toThrow(/read-back failed/u);
	});

	it('rejects ambiguous, unknown, and identity-confused observations', () => {
		const value = declaration(), target = observation(value.resources[0]!);
		expect(() => planHostedTopology({ declaration: value, observations: [target, target], availableConnections: ['cloudflare-production', 'railway-production'] })).toThrow(/Duplicate/u);
		expect(() => planHostedTopology({ declaration: value, observations: [{ ...target, resourceId: 'unexpected' }], availableConnections: ['cloudflare-production', 'railway-production'] })).toThrow(/Unknown/u);
		expect(() => planHostedTopology({ declaration: value, observations: [{ ...target, provider: 'railway' }], availableConnections: ['cloudflare-production', 'railway-production'] })).toThrow(/identity mismatch/u);
	});

	it('rejects provider-kind confusion, credential-shaped parameters, and personal paths', () => {
		const value = declaration(), target = value.resources[0]!;
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, provider: 'railway' }, ...value.resources.slice(1)] })).toThrow(/not owned/u);
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, parameters: { apiToken: { input: 'credential' } } }, ...value.resources.slice(1)] })).toThrow(/credential-like/u);
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, parameters: { path: { literal: '/home/person/work' } } }, ...value.resources.slice(1)] })).toThrow(/personal filesystem/u);
	});
});
