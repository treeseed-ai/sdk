import { describe, expect, it } from 'vitest';
import { authorizeHostedTopologyPlan, authorizeHostedTopologyRollback, authorizeHostedTopologyRollbackExecution, bindHostedStateBackend, deploymentDigest, hostedTopologyDeclarationSchema, hostedTopologyPlanSchema, hostedTopologyStateKey, planHostedTopology, planHostedTopologyRollback, planHostedTopologyRollbackExecution, verifyHostedTopologyReadback, type HostedResourceObservation, type HostedTopologyDeclaration } from '../../../src/deployment/index.ts';

const sha = (marker: string) => `sha256:${marker.repeat(64)}`;
const now = '2026-09-02T12:00:00.000Z';
const connections = () => ({
	cloudflare: { connectionRef: 'cloudflare-production', nonSecretConfig: { accountId: 'cf-account', zoneId: 'cf-zone' } },
	railway: { connectionRef: 'railway-production', nonSecretConfig: { workspaceId: 'rw-workspace', region: 'us-east' } },
});
const backend = () => bindHostedStateBackend({ schemaVersion: 'treeseed.hosted-state-backend/v1', type: 's3', teamId: 'team-treeseed', deploymentId: 'treeseed-cloud', environment: 'production', stackId: 'control-plane', connectionRef: 'cloudflare-state', bucket: 'treeseed-state-team', key: hostedTopologyStateKey({ teamId: 'team-treeseed', deploymentId: 'treeseed-cloud', environment: 'production', stackId: 'control-plane' }), region: 'auto', endpoint: 'https://account.r2.cloudflarestorage.com', usePathStyle: true, encryptionKeyRef: 'team-treeseed-control-plane' });
function declaration(): HostedTopologyDeclaration {
	return hostedTopologyDeclarationSchema.parse({
		schemaVersion: 'treeseed.hosted-topology/v1', id: 'production', teamId: 'team-treeseed', deploymentId: 'treeseed-cloud', stackId: 'control-plane', environment: 'production', mutation: 'agent-authorized',
		platform: { repository: 'treeseed-ai/platform', commit: 'a'.repeat(40) },
		stateBackend: { connectionRef: 'cloudflare-state' },
		providerConnections: { cloudflare: { connectionRef: 'cloudflare-production' }, railway: { connectionRef: 'railway-production' } },
		artifacts: { admin: { kind: 'archive', format: 'tar+gzip', digest: sha('a'), source: 'https://example.test/admin.tar.gz' }, api: { kind: 'oci-image', digest: sha('b'), identity: `treeseed/api@${sha('b')}` } },
		resources: [
			{ id: 'admin', provider: 'cloudflare', kind: 'pages-application', dependsOn: ['api-proxy'], parameters: { artifact: { artifact: 'admin' }, 'artifact-format': { literal: 'tar+gzip' }, name: { literal: 'treeseed-admin' }, 'production-branch': { literal: 'main' }, 'destination-dir': { literal: '.treeseed/app-dist' } }, adoption: { mode: 'adopt-or-create', externalIdInput: 'admin-resource-id', replacement: 'forbidden' } },
			{ id: 'api-proxy', provider: 'cloudflare', kind: 'api-proxy', dependsOn: ['api'], parameters: { upstream: { resourceOutput: { resourceId: 'api', output: 'public-url' } } }, adoption: { mode: 'adopt-or-create', replacement: 'forbidden' } },
			{ id: 'api', provider: 'railway', kind: 'control-plane-api', dependsOn: ['postgres'], parameters: { artifact: { artifact: 'api' }, 'variable.TREESEED_DATABASE_URL': { resourceOutput: { resourceId: 'postgres', output: 'database-url' } } }, adoption: { mode: 'adopt-or-create', replacement: 'forbidden' } },
			{ id: 'postgres', provider: 'railway', kind: 'postgresql', dependsOn: [], parameters: { region: { input: 'railway-region' } }, adoption: { mode: 'adopt-or-create', externalIdInput: 'postgres-resource-id', replacement: 'forbidden' } },
		],
	});
}

function observation(resource: HostedTopologyDeclaration['resources'][number], managedBy: 'treeseed' | 'external' = 'treeseed'): HostedResourceObservation {
	return { resourceId: resource.id, provider: resource.provider, kind: resource.kind, providerResourceId: `${resource.provider}-${resource.id}`, state: 'healthy', managedBy, observedDigest: deploymentDigest(resource), observedAt: now };
}

describe('reviewed hosted topology contracts', () => {
	it('derives the exact team deployment stack state key and rejects path escapes', () => {
		expect(hostedTopologyStateKey({ teamId: 'team-treeseed', deploymentId: 'treeseed-cloud', environment: 'production', stackId: 'control-plane' })).toBe('teams/team-treeseed/opentofu/v1/deployments/treeseed-cloud/environments/production/stacks/control-plane/terraform.tfstate');
		expect(() => hostedTopologyStateKey({ teamId: '../other-team', deploymentId: 'treeseed-cloud', environment: 'production', stackId: 'control-plane' })).toThrow();
		const { bindingDigest: _bindingDigest, ...core } = backend();
		expect(() => bindHostedStateBackend({ ...core, key: 'teams/other-team/opentofu/v1/state.tfstate' })).toThrow(/canonical/u);
	});

	it('produces deterministic plans independent of declaration and observation order', () => {
		const value = declaration(), selected = connections();
		const observations = value.resources.map((resource) => observation(resource));
		const first = planHostedTopology({ declaration: value, observations, connections: selected, stateBackend: backend() });
		const reordered = planHostedTopology({ declaration: { ...value, resources: [...value.resources].reverse() }, observations: [...observations].reverse(), connections: selected, stateBackend: backend() });
		expect(reordered.planDigest).toBe(first.planDigest);
		expect(first.actions.every(({ action }) => action === 'noop')).toBe(true);
		expect(authorizeHostedTopologyPlan(first)).toMatchObject({ executable: true, authorization: 'authenticated-agent' });
	});

	it('binds each executable action to the complete reviewed resource specification', () => {
		const value = declaration();
		const plan = planHostedTopology({ declaration: value, observations: [], connections: connections(), stateBackend: backend() });
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
		const accepted = planHostedTopology({ declaration: value, observations: [external], connections: connections(), stateBackend: backend() });
		expect(accepted.actions.find(({ resourceId }) => resourceId === 'postgres')?.action).toBe('adopt');
		const drifted = planHostedTopology({ declaration: value, observations: [{ ...external, observedDigest: sha('f') }], connections: connections(), stateBackend: backend() });
		expect(drifted.blockers).toMatchObject([{ code: 'adoption-drift', resourceId: 'postgres' }]);
	});

	it('fails closed for missing connections, dependency cycles, and custody mismatch', () => {
		const value = declaration();
		const unavailable = planHostedTopology({ declaration: value, observations: [], connections: {}, stateBackend: backend() });
		expect(unavailable.blockers.filter(({ code }) => code === 'connection-unavailable')).toHaveLength(2);
		const cyclic = hostedTopologyDeclarationSchema.parse({ ...value, resources: value.resources.map((resource) => resource.id === 'postgres' ? { ...resource, dependsOn: ['admin'] } : resource) });
		expect(planHostedTopology({ declaration: cyclic, observations: [], connections: connections(), stateBackend: backend() }).blockers.some(({ code }) => code === 'dependency-cycle')).toBe(true);
		const plan = planHostedTopology({ declaration: value, observations: [], connections: connections(), stateBackend: backend() });
		expect(authorizeHostedTopologyPlan(plan)).toMatchObject({ executable: true, authorization: 'authenticated-agent' });
		expect(() => planHostedTopology({ declaration: value, observations: [], connections: connections(), stateBackend: { ...backend(), teamId: 'other-team' } })).toThrow(/digest|custody/u);
	});

	it('verifies exact read-back, returns noop, and binds rollback lineage', () => {
		const value = declaration(), previous = value.resources.map((resource) => ({ ...observation(resource), state: 'missing' as const, managedBy: null, providerResourceId: null, observedDigest: null }));
		const plan = planHostedTopology({ declaration: value, observations: previous, connections: connections(), stateBackend: backend() });
		const authorized = authorizeHostedTopologyPlan(plan);
		const resources = value.resources.map((resource) => observation(resource));
		const receipt = verifyHostedTopologyReadback({ plan: authorized, previousResources: previous, resources, completedAt: now });
		expect(receipt.state).toBe('known-good');
		expect(planHostedTopology({ declaration: value, observations: resources, connections: connections(), stateBackend: backend() }).actions.every(({ action }) => action === 'noop')).toBe(true);
		const rollback = planHostedTopologyRollback(receipt);
		expect(rollback.operations.every(({ action }) => action === 'delete-created')).toBe(true);
		expect(authorizeHostedTopologyRollback(rollback).rollback.rollbackId).toBe(rollback.rollbackId);
		expect(() => authorizeHostedTopologyRollback({ ...rollback, rollbackDigest: sha('f') })).toThrow(/rollbackDigest/u);
		expect(() => verifyHostedTopologyReadback({ plan: authorized, previousResources: previous, resources: resources.map((resource, index) => index ? resource : { ...resource, observedDigest: sha('f') }), completedAt: now })).toThrow(/read-back failed/u);
	});

	it('rejects ambiguous, unknown, and identity-confused observations', () => {
		const value = declaration(), target = observation(value.resources[0]!);
		expect(() => planHostedTopology({ declaration: value, observations: [target, target], connections: connections(), stateBackend: backend() })).toThrow(/Duplicate/u);
		expect(() => planHostedTopology({ declaration: value, observations: [{ ...target, resourceId: 'unexpected' }], connections: connections(), stateBackend: backend() })).toThrow(/Unknown/u);
		expect(() => planHostedTopology({ declaration: value, observations: [{ ...target, provider: 'railway' }], connections: connections(), stateBackend: backend() })).toThrow(/identity mismatch/u);
	});

	it('binds rollback execution to the complete source and target plans', () => {
		const value = declaration(), current = value.resources.map((resource) => observation(resource));
		const unapprovedSource = planHostedTopology({ declaration: value, observations: [], connections: connections(), stateBackend: backend() });
		const sourcePlan = authorizeHostedTopologyPlan(unapprovedSource);
		const previous = current.map((resource) => ({ ...resource, state: 'missing' as const, managedBy: null, providerResourceId: null, observedDigest: null }));
		const receipt = verifyHostedTopologyReadback({ plan: sourcePlan, previousResources: previous, resources: current, completedAt: now });
		const rollback = planHostedTopologyRollback(receipt), targetDeclaration = hostedTopologyDeclarationSchema.parse({ ...value, resources: [] });
		const targetPlan = planHostedTopology({ declaration: targetDeclaration, observations: [], connections: connections(), stateBackend: backend() });
		const execution = planHostedTopologyRollbackExecution({ rollback, sourceReceipt: receipt, sourcePlan, targetPlan });
		expect(authorizeHostedTopologyRollbackExecution(execution).execution.targetPlanDigest).toBe(targetPlan.planDigest);
		const changedConnections = connections(); changedConnections.cloudflare.nonSecretConfig.zoneId = 'different-zone';
		const substitutedTarget = planHostedTopology({ declaration: targetDeclaration, observations: [], connections: changedConnections, stateBackend: backend() });
		const substitutedExecution = planHostedTopologyRollbackExecution({ rollback, sourceReceipt: receipt, sourcePlan, targetPlan: substitutedTarget });
		expect(() => authorizeHostedTopologyRollbackExecution({ ...substitutedExecution, executionDigest: execution.executionDigest })).toThrow(/executionDigest/u);
	});

	it('rejects provider-kind confusion, credential-shaped parameters, and personal paths', () => {
		const value = declaration(), target = value.resources[0]!;
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, provider: 'railway' }, ...value.resources.slice(1)] })).toThrow(/not owned/u);
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, parameters: { apiToken: { input: 'credential' } } }, ...value.resources.slice(1)] })).toThrow(/credential-like/u);
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, parameters: { path: { literal: '/home/person/work' } } }, ...value.resources.slice(1)] })).toThrow(/personal filesystem/u);
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: [{ ...target, parameters: { artifact: { artifact: 'admin' } } }, ...value.resources.slice(1)] })).toThrow(/production-branch|destination-dir|name/u);
		const api = value.resources.find(({ id }) => id === 'api')!;
		expect(() => hostedTopologyDeclarationSchema.parse({ ...value, resources: value.resources.map((resource) => resource.id === 'api' ? { ...api, parameters: { ...api.parameters, 'variable.TREESEED_WEB_SERVICE_SECRET': { input: 'forbidden' } } } : resource) })).toThrow(/credential-like/u);
	});
});
