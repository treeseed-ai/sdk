import { describe, expect, it } from 'vitest';
import { compileHostedTopologyTemplate, hostedTopologyArtifactInputsSchema, hostedTopologyTemplateSchema } from '../../../src/deployment/index.ts';

const digest = (marker: string) => `sha256:${marker.repeat(64)}`;

function template(environment: 'staging' | 'production' = 'production') {
	return hostedTopologyTemplateSchema.parse({
		schemaVersion: 'treeseed.hosted-topology-template/v1', id: `treeseed-${environment}`, deploymentId: 'treeseed-cloud', stackId: 'control-plane', environment, mutation: 'agent-authorized',
		stateBackend: { connectionRef: 'r2-infrastructure-state' },
		providerConnections: { cloudflare: { connectionRef: 'cloudflare-hosting' }, railway: { connectionRef: 'railway-hosting' } },
		artifactBindings: { admin: { input: 'admin-pages', kind: 'archive' }, proxy: { input: 'api-proxy-worker', kind: 'file' }, api: { input: 'api-image', kind: 'oci-image' } },
		resources: [
			{ id: 'admin', provider: 'cloudflare', kind: 'pages-application', dependsOn: ['api'], parameters: { name: { input: 'admin-project-name' }, artifact: { artifact: 'admin' }, 'artifact-format': { literal: 'tar+gzip' }, 'production-branch': { input: 'production-branch' }, 'destination-dir': { literal: '.' } }, adoption: { mode: 'adopt-or-create', replacement: 'forbidden' } },
			{ id: 'proxy', provider: 'cloudflare', kind: 'api-proxy', dependsOn: ['api'], parameters: { name: { input: 'proxy-worker-name' }, artifact: { artifact: 'proxy' } }, adoption: { mode: 'adopt-or-create', replacement: 'forbidden' } },
			{ id: 'api', provider: 'railway', kind: 'control-plane-api', dependsOn: [], parameters: { name: { input: 'api-service-name' }, artifact: { artifact: 'api' }, 'healthcheck-path': { literal: '/health' } }, adoption: { mode: 'adopt-or-create', replacement: 'forbidden' } },
		],
	});
}

const artifacts = {
	'admin-pages': { kind: 'archive' as const, format: 'tar+gzip' as const, digest: digest('a'), source: 'https://releases.example.test/admin-pages.tgz' },
	'api-proxy-worker': { kind: 'file' as const, mediaType: 'application/javascript', digest: digest('c'), source: 'https://releases.example.test/api-proxy.mjs' },
	'api-image': { kind: 'oci-image' as const, digest: digest('b'), identity: `treeseed/api@${digest('b')}` },
};

describe('portable hosted topology templates', () => {
	it('validates a strict versioned runtime artifact input document', () => {
		expect(hostedTopologyArtifactInputsSchema.parse({ schemaVersion: 'treeseed.hosted-topology-artifacts/v1', artifacts })).toEqual({ schemaVersion: 'treeseed.hosted-topology-artifacts/v1', artifacts });
		expect(() => hostedTopologyArtifactInputsSchema.parse({ schemaVersion: 'treeseed.hosted-topology-artifacts/v1', artifacts, teamId: 'forbidden' })).toThrow();
	});
	it('binds runtime custody and exact typed artifacts deterministically', () => {
		const input = { template: template(), teamId: 'team-treeseed', platformCommit: 'c'.repeat(40), artifacts };
		const first = compileHostedTopologyTemplate(input), second = compileHostedTopologyTemplate(input);
		expect(second).toEqual(first);
		expect(first).toMatchObject({ teamId: 'team-treeseed', environment: 'production', platform: { repository: 'treeseed-ai/platform', commit: 'c'.repeat(40) } });
		expect(first.artifacts.admin.kind).toBe('archive'); expect(first.artifacts.proxy.kind).toBe('file'); expect(first.artifacts.api.kind).toBe('oci-image');
	});

	it('rejects substitutions, mutable images, and incomplete artifact closure', () => {
		const input = { template: template(), teamId: 'team-treeseed', platformCommit: 'c'.repeat(40), artifacts };
		expect(() => compileHostedTopologyTemplate({ ...input, artifacts: { 'admin-pages': artifacts['admin-pages'] } })).toThrow(/exact template bindings/u);
		expect(() => compileHostedTopologyTemplate({ ...input, artifacts: { ...artifacts, extra: artifacts['admin-pages'] } })).toThrow(/exact template bindings/u);
		expect(() => compileHostedTopologyTemplate({ ...input, artifacts: { ...artifacts, 'api-image': { kind: 'oci-image', digest: digest('b'), identity: 'treeseed/api:latest' } } })).toThrow();
		expect(() => compileHostedTopologyTemplate({ ...input, artifacts: { ...artifacts, 'admin-pages': artifacts['api-image'] } })).toThrow(/must be archive/u);
	});
});
