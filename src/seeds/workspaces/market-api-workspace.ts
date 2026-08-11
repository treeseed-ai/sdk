import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from '../repositories/repository-history.js';
import type { SeedManifest } from '../types.js';
import { managedWorkspaceMatches, managedWorkspacePaths, missingApplicationBootstrapFiles, staleManagedWorkspacePaths } from './managed-workspace-overlay.js';

type BranchPlan = { branch: 'main' | 'staging'; targetCommit: string | null; action: 'create' | 'update' | 'noop' | 'blocked'; reason: string };
type Receipt = { branch: string; targetCommit: string; sdkRef: string; adminApiRef: string; workspaceDigest?: string; verified: boolean };

export type MarketApiWorkspacePlan = { repository: string; sdkRef: string; adminApiRef: string; descriptorDigest: string; branches: BranchPlan[] };

function project(manifest: SeedManifest, slug: string) {
	const value = manifest.resources.projects.find((entry) => entry.slug === slug);
	if (!value) throw new Error(`Seed ${manifest.name} does not declare ${slug}.`);
	return value;
}

function journalPath(projectRoot: string, repository: string) {
	return resolve(projectRoot, '.treeseed', 'repository-migrations', `${repository.replace('/', '--')}--workspace.json`);
}

function journal(projectRoot: string, repository: string) {
	try { return JSON.parse(readFileSync(journalPath(projectRoot, repository), 'utf8')) as { receipts?: Receipt[] }; } catch { return null; }
}

function writeJournal(projectRoot: string, plan: MarketApiWorkspacePlan, receipts: Receipt[]) {
	const path = journalPath(projectRoot, plan.repository);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.market-api-workspace', repository: plan.repository, status: receipts.length === plan.branches.length ? 'verified' : 'partial', updatedAt: new Date().toISOString(), receipts }, null, 2)}\n`, 'utf8');
}

function mergeReceipts(previous: Receipt[], current: Receipt[]) {
	const byBranch = new Map(previous.map((receipt) => [receipt.branch, receipt]));
	for (const receipt of current) byBranch.set(receipt.branch, receipt);
	return [...byBranch.values()].sort((left, right) => left.branch.localeCompare(right.branch));
}

function packageJson(sdkRef: string) {
	return `${JSON.stringify({
		name: '@treeseed/market-api', version: '0.1.0', private: true, license: 'UNLICENSED', type: 'module', engines: { node: '>=22' },
		workspaces: ['.'],
		scripts: { build: 'tsc -p tsconfig.json', test: 'vitest run', verify: 'npm run build && npm test', start: 'node dist/server.js' },
		dependencies: {
			'@octokit/auth-app': '^8.2.0', '@treeseed/sdk': `git+https://github.com/treeseed-ai/sdk.git#${sdkRef}`,
			'drizzle-orm': '^0.45.2', hono: '^4.8.2', 'libsodium-wrappers': '0.7.15', 'libsodium-wrappers-sumo': '0.7.15', octokit: '^5.0.5', pg: '^8.21.0', stripe: '^22.3.0', yaml: '^2.8.1',
		},
		devDependencies: { '@types/node': '^24.6.0', typescript: '^5.9.3', vitest: '^4.1.2' },
	}, null, 2)}\n`;
}

function siteManifest() {
	return `name: TreeSeed Market API\nslug: treeseed-market-api\nsiteUrl: https://api.treeseed.dev\ncontactEmail: hello@treeseed.email\nauthority:\n  kind: market-singleton\nmarket:\n  profile: treeseed\ncontrolPlane:\n  mode: market-passthrough\nhosting:\n  kind: treeseed_control_plane\n  registration: none\n  teamId: treeseed\n  projectId: market-api\nruntime:\n  mode: treeseed_managed\n  registration: none\nproviders:\n  deploy: railway\n  dns: cloudflare-dns\n`;
}

function packageManifest() {
	return `schemaVersion: treeseed.package/v1\nid: "@treeseed/market-api"\nname: TreeSeed Market API\nkind: node-typescript\ntype: singleton-hosted-service\nrepository: treeseed-ai/market-api\ncapabilities: { save: true, verify: true, publish: false, deploy: false, localOnly: false }\nworkflowTemplateVersion: "1"\ngithubEnvironments:\n  - staging\n  - production\nverify:\n  fast: npm run verify\n  local: npm run verify\n  release: npm run verify\nreleaseGate:\n  workflow: verify.yml\n  timeoutSeconds: 1800\nprojectArchitecture:\n  topology: single_repository_site\n  rootPath: .\n  contentRuntimeSource: r2_published_manifest\n  localContentMaterialization: none\n`;
}
function gatewaySource(descriptorDigest: string) {
	return `import { createAdminPassthroughHandler, createGatewayHealthHandlers } from '@treeseed/sdk';\nimport descriptor from '../artifacts/admin-api-descriptor.json' with { type: 'json' };\n\nexport type MarketHandler = (request: Request) => Promise<Response> | Response;\nexport type DependencyChecks = Parameters<typeof createGatewayHealthHandlers>[0]['checks'];\n\nexport function createMarketGateway(options: { adminBaseUrl: string; checks: DependencyChecks; marketHandler?: MarketHandler; serviceAssertion?: (request: Request) => Promise<string | null> | string | null; fetchImpl?: typeof fetch }) {\n\tconst health = createGatewayHealthHandlers({ checks: options.checks });\n\tconst admin = createAdminPassthroughHandler({ adminBaseUrl: options.adminBaseUrl, adminRoutes: descriptor.routes, fetchImpl: options.fetchImpl, serviceAssertion: options.serviceAssertion });\n\treturn async (request: Request) => {\n\t\tconst path = new URL(request.url).pathname;\n\t\tif (path === '/healthz') return health.process();\n\t\tif (path === '/healthz/deep') return health.deep();\n\t\tif (path === '/readyz') return health.ready();\n\t\tif (path === '/v1/market/status') return Response.json({ ok: true, service: 'market-api', adminDescriptor: '${descriptorDigest}' });\n\t\tif (path.startsWith('/v1/market/')) return options.marketHandler ? options.marketHandler(request) : Response.json({ error: 'market-route-not-found' }, { status: 404 });\n\t\tif (path.startsWith('/v1/')) return admin(request);\n\t\treturn Response.json({ error: 'not-found' }, { status: 404 });\n\t};\n}\n`;
}

function assertionSource() {
	return `import { createHmac, randomUUID } from 'node:crypto';\n\nconst encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');\n\nexport function createAudienceBoundAssertion(secret: string, audience: string, now = () => Date.now()) {\n\tif (!secret) throw new Error('Market service assertion secret is required.');\n\treturn (request: Request) => {\n\t\tconst issuedAt = Math.floor(now() / 1000);\n\t\tconst requestId = request.headers.get('x-request-id') ?? randomUUID();\n\t\tconst header = encode({ alg: 'HS256', typ: 'JWT' });\n\t\tconst payload = encode({ aud: audience, iss: 'market-api', iat: issuedAt, exp: issuedAt + 30, method: request.method, path: new URL(request.url).pathname, requestId });\n\t\tconst signature = createHmac('sha256', secret).update(\`\${header}.\${payload}\`).digest('base64url');\n\t\treturn \`\${header}.\${payload}.\${signature}\`;\n\t};\n}\n`;
}

function serverSource() {
	return `import { createServer } from 'node:http';\nimport { Readable } from 'node:stream';\nimport { createMarketGateway, type MarketHandler } from './gateway.js';\nimport { createAudienceBoundAssertion } from './service-assertion.js';\n\nconst adminBaseUrl = process.env.TREESEED_ADMIN_API_INTERNAL_URL ?? '';\nif (!adminBaseUrl) throw new Error('TREESEED_ADMIN_API_INTERNAL_URL is required.');\nconst assertionSecret = process.env.TREESEED_MARKET_SERVICE_ASSERTION_SECRET ?? '';\nconst checkUrl = async (url: string) => { try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };\nconst applicationModulePath = './market/app.js';\nconst application = await import(applicationModulePath) as { createMarketHandler: () => MarketHandler };\nconst gateway = createMarketGateway({\n\tadminBaseUrl,\n\tmarketHandler: application.createMarketHandler(),\n\tserviceAssertion: createAudienceBoundAssertion(assertionSecret, adminBaseUrl),\n\tchecks: {\n\t\t'market-database': async () => Boolean(process.env.TREESEED_MARKET_DATABASE_URL),\n\t\t'admin-api': async () => checkUrl(\`\${adminBaseUrl.replace(/\\/$/u, '')}/healthz\`),\n\t\t'internal-auth': async () => Boolean(assertionSecret),\n\t\t'provider-bindings': async () => process.env.TREESEED_PROVIDER_BINDINGS_READY === 'true',\n\t},\n});\n\nconst server = createServer(async (incoming, outgoing) => {\n\tconst origin = \`http://\${incoming.headers.host ?? '127.0.0.1'}\`;\n\tconst body = incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;\n\tconst response = await gateway(new Request(new URL(incoming.url ?? '/', origin), { method: incoming.method, headers: incoming.headers as HeadersInit, body, duplex: body ? 'half' : undefined } as RequestInit & { duplex?: 'half' }));\n\toutgoing.statusCode = response.status;\n\tfor (const [name, value] of response.headers) outgoing.setHeader(name, value);\n\tif (!response.body) return outgoing.end();\n\tReadable.fromWeb(response.body as never).pipe(outgoing);\n});\nserver.listen(Number(process.env.PORT ?? 3000));\n`;
}

function marketApplicationBootstrap() {
	return `import type { MarketHandler } from '../gateway.js';\n\nexport function createMarketHandler(): MarketHandler {\n\treturn async () => Response.json({ error: 'market-route-not-implemented' }, { status: 501 });\n}\n`;
}

function gatewayTest() {
	const sourceRoot = '../src';
	return `import { describe, expect, it, vi } from 'vitest';\nimport descriptor from '../artifacts/admin-api-descriptor.json' with { type: 'json' };\nimport { createMarketGateway } from '${sourceRoot}/gateway.js';\nimport { createAudienceBoundAssertion } from '${sourceRoot}/service-assertion.js';\n\nconst checks = { 'market-database': async () => true, 'admin-api': async () => true, 'internal-auth': async () => true, 'provider-bindings': async () => true };\nconst concretePath = (path: string) => path.replace(/:[^/]+/gu, 'fixture');\n\ndescribe('singleton Market gateway', () => {\n\tit('owns Market routes and passes every declared Admin method and path through exactly', async () => {\n\t\tconst fetchImpl = vi.fn(async () => Response.json({ admin: true }, { status: 202 }));\n\t\tconst gateway = createMarketGateway({ adminBaseUrl: 'http://admin.internal', checks, fetchImpl });\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/v1/market/status'))).status).toBe(200);\n\t\tfor (const route of descriptor.routes) {\n\t\t\tconst response = await gateway(new Request(\`https://api.treeseed.dev\${concretePath(route.path)}?inventory=true\`, { method: route.method }));\n\t\t\texpect(response.status, \`\${route.method} \${route.path}\`).toBe(202);\n\t\t}\n\t\texpect(fetchImpl).toHaveBeenCalledTimes(descriptor.routeCount);\n\t});\n\n\tit('rejects undeclared paths, method mismatches, and Admin shadowing of Market', async () => {\n\t\tconst fetchImpl = vi.fn(async () => Response.json({ admin: true }));\n\t\tconst gateway = createMarketGateway({ adminBaseUrl: 'http://admin.internal', checks, fetchImpl });\n\t\tconst route = descriptor.routes[0]!;\n\t\tconst methods = new Set(descriptor.routes.filter((candidate) => candidate.path === route.path).map((candidate) => candidate.method));\n\t\tconst mismatched = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].find((method) => !methods.has(method))!;\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/v1/not-declared'))).status).toBe(404);\n\t\texpect((await gateway(new Request(\`https://api.treeseed.dev\${concretePath(route.path)}\`, { method: mismatched }))).status).toBe(404);\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/v1/market/not-declared'))).status).toBe(404);\n\t\texpect(fetchImpl).not.toHaveBeenCalled();\n\t});\n\n\tit('fails readiness when hosted Admin is unavailable while process health remains available', async () => {\n\t\tconst gateway = createMarketGateway({ adminBaseUrl: 'http://admin.internal', checks: { ...checks, 'admin-api': async () => false } });\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/healthz'))).status).toBe(200);\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/healthz/deep'))).status).toBe(503);\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/readyz'))).status).toBe(503);\n\t});\n\n\tit('creates short-lived audience-bound service assertions', () => {\n\t\tconst assertion = createAudienceBoundAssertion('secret', 'http://admin.internal', () => 1000)(new Request('https://api.treeseed.dev/v1/projects', { headers: { 'x-request-id': 'request-1' } }));\n\t\tconst payload = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString());\n\t\texpect(payload).toMatchObject({ aud: 'http://admin.internal', method: 'GET', path: '/v1/projects', requestId: 'request-1', exp: 31 });\n\t});\n});\n`;
}

function descriptorTest() {
	return `import { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\nimport { describe, expect, it } from 'vitest';\n\nconst descriptor = JSON.parse(readFileSync(resolve(import.meta.dirname, '../artifacts/admin-api-descriptor.json'), 'utf8'));\nconst deployment = JSON.parse(readFileSync(resolve(import.meta.dirname, '../singleton.manifest.json'), 'utf8'));\n\ndescribe('Admin route descriptor pin', () => {\n\tit('pins the exact Admin image ref and exposes a unique disjoint route union', () => {\n\t\texpect(descriptor.sourceRef).toBe(deployment.adminApiRef);\n\t\texpect(descriptor.routeCount).toBe(descriptor.routes.length);\n\t\texpect(descriptor.routes.every((route: { path: string }) => !route.path.startsWith('/v1/market/'))).toBe(true);\n\t\texpect(new Set(descriptor.routes.map((route: { method: string; path: string }) => \`\${route.method} \${route.path}\`)).size).toBe(descriptor.routeCount);\n\t\tconst digest = createHash('sha256').update(JSON.stringify(descriptor.routes)).digest('hex');\n\t\texpect(\`sha256:\${digest}\`).toBe(descriptor.digest);\n\t\texpect(descriptor.digest).toBe(deployment.adminDescriptorDigest);\n\t});\n});\n`;
}

function workflow() {
	return `name: Verify\n\non:\n  pull_request:\n  push:\n    branches: [main, staging]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\nconcurrency:\n  group: verify-\${{ github.repository }}-\${{ github.ref }}\n  cancel-in-progress: true\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: npm install\n      - run: npm run verify\n`;
}

const managedPaths = [
	'.github/workflows/verify.yml',
	'LICENSE',
	'README.md',
	'artifacts/admin-api-descriptor.json',
	'package.json',
	'singleton.manifest.json',
	'src/gateway.ts',
	'src/server.ts',
	'src/service-assertion.ts',
	'tests/descriptor.test.ts',
	'tests/gateway.test.ts',
	'treeseed.package.yaml',
	'treeseed.site.yaml',
	'tsconfig.json',
].sort();

export function marketApiWorkspaceFiles(projectRoot: string, sdkRef: string, adminApiRef: string) {
	const descriptor = JSON.parse(readFileSync(resolve(projectRoot, 'packages/api/dist/admin-api-descriptor.json'), 'utf8')) as { digest: string; sourceRef: string | null; routes: Array<{ method: string; path: string }> };
	descriptor.sourceRef = adminApiRef;
	const descriptorContent = `${JSON.stringify(descriptor, null, 2)}\n`;
	return {
		descriptorDigest: descriptor.digest,
		bootstrapFiles: [['src/market/app.ts', marketApplicationBootstrap()]] as Array<[string, string]>,
		files: [
			['package.json', packageJson(sdkRef)], ['treeseed.package.yaml', packageManifest()], ['treeseed.site.yaml', siteManifest()], ['tsconfig.json', `${JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', resolveJsonModule: true, outDir: 'dist', rootDir: '.', strict: true, skipLibCheck: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'] }, include: ['src/**/*.ts', 'tests/**/*.ts'] }, null, 2)}\n`],
			['LICENSE', 'UNLICENSED\n\nCopyright (c) TreeSeed. All rights reserved. No license is granted.\n'], ['README.md', '# TreeSeed Market API\n\nPrivate singleton Market implementation and hosted Admin API gateway for `api.treeseed.dev`. This repository is never provisioned by Platform. Hosted deployment remains suspended.\n'],
			['src/gateway.ts', gatewaySource(descriptor.digest)], ['src/service-assertion.ts', assertionSource()], ['src/server.ts', serverSource()],
			['tests/gateway.test.ts', gatewayTest()], ['tests/descriptor.test.ts', descriptorTest()], ['artifacts/admin-api-descriptor.json', descriptorContent],
			['singleton.manifest.json', `${JSON.stringify({ schemaVersion: 2, authority: 'market-singleton', sdkRef, adminApiRef, adminDescriptorDigest: descriptor.digest, deployment: 'suspended', managedPaths }, null, 2)}\n`],
			['.github/workflows/verify.yml', workflow()],
		] as Array<[string, string]>,
	};
}

function workspaceFilesDigest(entries: Array<[string, string]>) {
	const hash = createHash('sha256');
	for (const [path, content] of entries) hash.update(path).update('\0').update(content).update('\0');
	return `sha256:${hash.digest('hex')}`;
}

function workspaceDigest(projectRoot: string, sdkRef: string, adminApiRef: string) {
	return workspaceFilesDigest(marketApiWorkspaceFiles(projectRoot, sdkRef, adminApiRef).files);
}

async function recoverGeneratedReceipt(projectRoot: string, repository: string, branch: string, commit: string, gitEnv: NodeJS.ProcessEnv): Promise<Receipt | null> {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-market-api-observe-'));
	try {
		await git(temporary, ['init', '--quiet']);
		await git(temporary, ['fetch', '--quiet', '--no-tags', `https://github.com/${repository}.git`, commit], { env: gitEnv });
		const manifestResult = await git(temporary, ['show', `${commit}:singleton.manifest.json`], { allowFailure: true });
		if (manifestResult.code !== 0) return null;
		const manifest = JSON.parse(manifestResult.stdout) as { authority?: unknown; sdkRef?: unknown; adminApiRef?: unknown; deployment?: unknown; managedPaths?: unknown };
		if (manifest.authority !== 'market-singleton' || manifest.deployment !== 'suspended') return null;
		if (typeof manifest.sdkRef !== 'string' || !/^[a-f0-9]{40}$/u.test(manifest.sdkRef)) return null;
		if (typeof manifest.adminApiRef !== 'string' || !/^[a-f0-9]{40}$/u.test(manifest.adminApiRef)) return null;
		const expected = marketApiWorkspaceFiles(projectRoot, manifest.sdkRef, manifest.adminApiRef).files;
		const legacySourceRoot = ['..', 'src'].join('/');
		const historicalSourceExtension = ['.', 'ts'].join('');
		const legacyExpected = expected.map(([path, content]) => [path, path === 'tests/gateway.test.ts'
			? content.replace(`${legacySourceRoot}/gateway.js`, `${legacySourceRoot}/gateway${historicalSourceExtension}`).replace(`${legacySourceRoot}/service-assertion.js`, `${legacySourceRoot}/service-assertion${historicalSourceExtension}`)
			: content] as [string, string]);
		const observedPaths = (await git(temporary, ['ls-tree', '-r', '--name-only', commit])).stdout.split('\n').filter(Boolean).sort();
		const observedFiles = new Map<string, string>();
		for (const path of managedWorkspacePaths(expected)) {
			const observed = await git(temporary, ['show', `${commit}:${path}`], { allowFailure: true });
			if (observed.code !== 0) return null;
			observedFiles.set(path, observed.stdout);
		}
		const declaredManagedPaths = Array.isArray(manifest.managedPaths) && manifest.managedPaths.every((path) => typeof path === 'string')
			? manifest.managedPaths as string[]
			: null;
		const matched = [expected, legacyExpected].find((candidate) => managedWorkspaceMatches({
			expected: candidate,
			observed: observedFiles,
			declaredManagedPaths,
			legacyObservedPaths: observedPaths,
		}));
		if (!matched) return null;
		return { branch, targetCommit: commit, sdkRef: manifest.sdkRef, adminApiRef: manifest.adminApiRef, workspaceDigest: workspaceFilesDigest(matched), verified: true };
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

export async function planMarketApiWorkspace(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const marketApi = project(input.manifest, 'market-api');
	const repository = `${marketApi.repository.owner}/${marketApi.repository.name}`;
	const credential = migrationCredential(input.projectRoot, repository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${repository}.`);
	const gitEnv = credentialEnvironment(credential.token);
	const sdkRef = await remoteHead(input.projectRoot, 'treeseed-ai/sdk', 'staging', gitEnv);
	const adminApiRef = await remoteHead(input.projectRoot, 'treeseed-ai/api', 'staging', gitEnv);
	if (!sdkRef || !adminApiRef) throw new Error('Live SDK and Admin API staging refs are required.');
	const descriptorDigest = marketApiWorkspaceFiles(input.projectRoot, sdkRef, adminApiRef).descriptorDigest;
	const desiredWorkspaceDigest = workspaceDigest(input.projectRoot, sdkRef, adminApiRef);
	const recorded = journal(input.projectRoot, repository);
	const branches: BranchPlan[] = [];
	for (const branch of ['main', 'staging'] as const) {
		const targetCommit = await remoteHead(input.projectRoot, repository, branch, gitEnv);
		const receipt = recorded?.receipts?.find((entry) => entry.branch === branch)
			?? (targetCommit ? await recoverGeneratedReceipt(input.projectRoot, repository, branch, targetCommit, gitEnv) : null);
		const owned = Boolean(targetCommit && receipt?.verified && receipt.targetCommit === targetCommit);
		const verified = Boolean(owned && receipt?.sdkRef === sdkRef && receipt?.adminApiRef === adminApiRef && receipt?.workspaceDigest === desiredWorkspaceDigest);
		branches.push({ branch, targetCommit, action: verified ? 'noop' : owned ? 'update' : targetCommit ? 'blocked' : 'create', reason: verified ? 'Live branch matches the verified singleton workspace receipt.' : owned ? 'Fast-forward the reconciler-owned singleton workspace.' : targetCommit ? 'Target branch has unrecognized history.' : 'Create the private singleton gateway workspace.' });
	}
	return { repository, sdkRef, adminApiRef, descriptorDigest, branches } satisfies MarketApiWorkspacePlan;
}

async function buildCommit(projectRoot: string, branch: string, plan: MarketApiWorkspacePlan, parent: string | null, gitEnv: NodeJS.ProcessEnv) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-market-api-'));
	const indexPath = resolve(temporary, 'index');
	const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
	try {
		await git(temporary, ['init', '--quiet']);
		if (parent) await git(temporary, ['fetch', '--quiet', '--no-tags', `https://github.com/${plan.repository}.git`, parent], { env: gitEnv });
		await git(temporary, ['read-tree', ...(parent ? [parent] : ['--empty'])], { env: indexEnv });
		const desiredWorkspace = marketApiWorkspaceFiles(projectRoot, plan.sdkRef, plan.adminApiRef);
		const desiredFiles = desiredWorkspace.files;
		const existingPaths = parent ? (await git(temporary, ['ls-tree', '-r', '--name-only', parent])).stdout.split('\n').filter(Boolean) : [];
		let previousManagedPaths: string[] = [];
		if (parent) {
			const previousManifest = await git(temporary, ['show', `${parent}:singleton.manifest.json`], { allowFailure: true });
			if (previousManifest.code === 0) {
				try {
					const parsed = JSON.parse(previousManifest.stdout) as { managedPaths?: unknown };
					if (Array.isArray(parsed.managedPaths) && parsed.managedPaths.every((path) => typeof path === 'string')) previousManagedPaths = parsed.managedPaths as string[];
				} catch { /* A malformed managed manifest is rejected during planning. */ }
			}
		}
		for (const path of staleManagedWorkspacePaths(previousManagedPaths, managedWorkspacePaths(desiredFiles))) {
			await git(temporary, ['update-index', '--force-remove', path], { env: indexEnv });
		}
		for (const [path, content] of desiredFiles) {
			const blob = (await git(temporary, ['hash-object', '-w', '--stdin'], { input: content })).stdout;
			await git(temporary, ['update-index', '--add', '--cacheinfo', '100644', blob, path], { env: indexEnv });
		}
		for (const [path, content] of missingApplicationBootstrapFiles(existingPaths, desiredWorkspace.bootstrapFiles)) {
			const blob = (await git(temporary, ['hash-object', '-w', '--stdin'], { input: content })).stdout;
			await git(temporary, ['update-index', '--add', '--cacheinfo', '100644', blob, path], { env: indexEnv });
		}
		const tree = (await git(temporary, ['write-tree'], { env: indexEnv })).stdout;
		const commit = (await git(temporary, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `${parent ? 'Reconcile' : 'Create'} Market API ${branch} gateway workspace`], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
		await git(temporary, ['push', `https://github.com/${plan.repository}.git`, `${commit}:refs/heads/${branch}`], { env: gitEnv });
		return commit;
	} finally { rmSync(temporary, { recursive: true, force: true }); }
}

export async function applyMarketApiWorkspace(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = await planMarketApiWorkspace(input);
	if (plan.branches.some((branch) => branch.action === 'blocked')) throw new Error('Market API target contains unrecognized history.');
	const credential = migrationCredential(input.projectRoot, plan.repository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const previousReceipts = journal(input.projectRoot, plan.repository)?.receipts ?? [];
	const receipts: Receipt[] = [];
	for (const branch of plan.branches) {
		let targetCommit = branch.targetCommit;
		if (branch.action === 'create' || branch.action === 'update') {
			targetCommit = await buildCommit(input.projectRoot, branch.branch, plan, branch.targetCommit, gitEnv);
		}
		const observed = await remoteHead(input.projectRoot, plan.repository, branch.branch, gitEnv);
		if (!targetCommit || observed !== targetCommit) throw new Error(`Fresh GitHub read-back returned ${observed ?? 'missing'}, expected ${targetCommit ?? 'missing'}.`);
		receipts.push({ branch: branch.branch, targetCommit, sdkRef: plan.sdkRef, adminApiRef: plan.adminApiRef, workspaceDigest: workspaceDigest(input.projectRoot, plan.sdkRef, plan.adminApiRef), verified: true });
		writeJournal(input.projectRoot, plan, mergeReceipts(previousReceipts, receipts));
	}
	return { ...plan, status: 'verified' as const, receipts, journalPath: journalPath(input.projectRoot, plan.repository) };
}
