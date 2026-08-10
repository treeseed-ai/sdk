import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from '../repositories/repository-history.js';
import type { SeedManifest } from '../types.js';

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

function packageJson(sdkRef: string) {
	return `${JSON.stringify({
		name: '@treeseed/market-api', version: '0.1.0', private: true, license: 'UNLICENSED', type: 'module', engines: { node: '>=22' },
		scripts: { build: 'tsc -p tsconfig.json', test: 'vitest run tests/gateway.test.ts tests/descriptor.test.ts', verify: 'npm run build && npm test', start: 'node dist/server.js' },
		dependencies: { '@treeseed/sdk': `git+https://github.com/treeseed-ai/sdk.git#${sdkRef}` },
		devDependencies: { '@types/node': '^24.6.0', typescript: '^5.9.3', vitest: '^4.1.2' },
	}, null, 2)}\n`;
}

function gatewaySource(descriptorDigest: string) {
	return `import { createAdminPassthroughHandler, createGatewayHealthHandlers, isAdminPassthroughPath } from '@treeseed/sdk';\n\nexport type MarketHandler = (request: Request) => Promise<Response> | Response;\nexport type DependencyChecks = Parameters<typeof createGatewayHealthHandlers>[0]['checks'];\n\nexport function createMarketGateway(options: { adminBaseUrl: string; checks: DependencyChecks; marketHandler?: MarketHandler; serviceAssertion?: (request: Request) => Promise<string | null> | string | null; fetchImpl?: typeof fetch }) {\n\tconst health = createGatewayHealthHandlers({ checks: options.checks });\n\tconst admin = createAdminPassthroughHandler({ adminBaseUrl: options.adminBaseUrl, fetchImpl: options.fetchImpl, serviceAssertion: options.serviceAssertion });\n\treturn async (request: Request) => {\n\t\tconst path = new URL(request.url).pathname;\n\t\tif (path === '/healthz') return health.process();\n\t\tif (path === '/healthz/deep') return health.deep();\n\t\tif (path === '/readyz') return health.ready();\n\t\tif (path === '/v1/market/status') return Response.json({ ok: true, service: 'market-api', adminDescriptor: '${descriptorDigest}' });\n\t\tif (path.startsWith('/v1/market/')) return options.marketHandler ? options.marketHandler(request) : Response.json({ error: 'market-route-not-found' }, { status: 404 });\n\t\tif (isAdminPassthroughPath(path)) return admin(request);\n\t\treturn Response.json({ error: 'not-found' }, { status: 404 });\n\t};\n}\n`;
}

function assertionSource() {
	return `import { createHmac, randomUUID } from 'node:crypto';\n\nconst encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');\n\nexport function createAudienceBoundAssertion(secret: string, audience: string, now = () => Date.now()) {\n\tif (!secret) throw new Error('Market service assertion secret is required.');\n\treturn (request: Request) => {\n\t\tconst issuedAt = Math.floor(now() / 1000);\n\t\tconst requestId = request.headers.get('x-request-id') ?? randomUUID();\n\t\tconst header = encode({ alg: 'HS256', typ: 'JWT' });\n\t\tconst payload = encode({ aud: audience, iss: 'market-api', iat: issuedAt, exp: issuedAt + 30, method: request.method, path: new URL(request.url).pathname, requestId });\n\t\tconst signature = createHmac('sha256', secret).update(\`\${header}.\${payload}\`).digest('base64url');\n\t\treturn \`\${header}.\${payload}.\${signature}\`;\n\t};\n}\n`;
}

function serverSource() {
	return `import { createServer } from 'node:http';\nimport { Readable } from 'node:stream';\nimport { createMarketGateway } from './gateway.js';\nimport { createAudienceBoundAssertion } from './service-assertion.js';\n\nconst adminBaseUrl = process.env.TREESEED_ADMIN_API_INTERNAL_URL ?? '';\nif (!adminBaseUrl) throw new Error('TREESEED_ADMIN_API_INTERNAL_URL is required.');\nconst assertionSecret = process.env.TREESEED_MARKET_SERVICE_ASSERTION_SECRET ?? '';\nconst checkUrl = async (url: string) => { try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };\nconst gateway = createMarketGateway({\n\tadminBaseUrl,\n\tserviceAssertion: createAudienceBoundAssertion(assertionSecret, adminBaseUrl),\n\tchecks: {\n\t\t'market-database': async () => Boolean(process.env.TREESEED_MARKET_DATABASE_URL),\n\t\t'admin-api': async () => checkUrl(\`\${adminBaseUrl.replace(/\\/$/u, '')}/healthz\`),\n\t\t'internal-auth': async () => Boolean(assertionSecret),\n\t\t'provider-bindings': async () => process.env.TREESEED_PROVIDER_BINDINGS_READY === 'true',\n\t},\n});\n\nconst server = createServer(async (incoming, outgoing) => {\n\tconst origin = \`http://\${incoming.headers.host ?? '127.0.0.1'}\`;\n\tconst body = incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;\n\tconst response = await gateway(new Request(new URL(incoming.url ?? '/', origin), { method: incoming.method, headers: incoming.headers as HeadersInit, body, duplex: body ? 'half' : undefined } as RequestInit & { duplex?: 'half' }));\n\toutgoing.statusCode = response.status;\n\tfor (const [name, value] of response.headers) outgoing.setHeader(name, value);\n\tif (!response.body) return outgoing.end();\n\tReadable.fromWeb(response.body as never).pipe(outgoing);\n});\nserver.listen(Number(process.env.PORT ?? 3000));\n`;
}

function gatewayTest() {
	const sourceRoot = '../src';
	return `import { describe, expect, it, vi } from 'vitest';\nimport { createMarketGateway } from '${sourceRoot}/gateway.js';\nimport { createAudienceBoundAssertion } from '${sourceRoot}/service-assertion.js';\n\nconst checks = { 'market-database': async () => true, 'admin-api': async () => true, 'internal-auth': async () => true, 'provider-bindings': async () => true };\n\ndescribe('singleton Market gateway', () => {\n\tit('owns Market routes and passes every other v1 route to Admin', async () => {\n\t\tconst fetchImpl = vi.fn(async () => Response.json({ admin: true }, { status: 202 }));\n\t\tconst gateway = createMarketGateway({ adminBaseUrl: 'http://admin.internal', checks, fetchImpl });\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/v1/market/status'))).status).toBe(200);\n\t\tconst response = await gateway(new Request('https://api.treeseed.dev/v1/projects?id=one'));\n\t\texpect(response.status).toBe(202);\n\t\texpect(fetchImpl).toHaveBeenCalledWith('http://admin.internal/v1/projects?id=one', expect.anything());\n\t});\n\n\tit('fails readiness when hosted Admin is unavailable while process health remains available', async () => {\n\t\tconst gateway = createMarketGateway({ adminBaseUrl: 'http://admin.internal', checks: { ...checks, 'admin-api': async () => false } });\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/healthz'))).status).toBe(200);\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/healthz/deep'))).status).toBe(503);\n\t\texpect((await gateway(new Request('https://api.treeseed.dev/readyz'))).status).toBe(503);\n\t});\n\n\tit('creates short-lived audience-bound service assertions', () => {\n\t\tconst assertion = createAudienceBoundAssertion('secret', 'http://admin.internal', () => 1000)(new Request('https://api.treeseed.dev/v1/projects', { headers: { 'x-request-id': 'request-1' } }));\n\t\tconst payload = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString());\n\t\texpect(payload).toMatchObject({ aud: 'http://admin.internal', method: 'GET', path: '/v1/projects', requestId: 'request-1', exp: 31 });\n\t});\n});\n`;
}

function descriptorTest() {
	return `import { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\nimport { describe, expect, it } from 'vitest';\n\nconst descriptor = JSON.parse(readFileSync(resolve(import.meta.dirname, '../artifacts/admin-api-descriptor.json'), 'utf8'));\nconst deployment = JSON.parse(readFileSync(resolve(import.meta.dirname, '../singleton.manifest.json'), 'utf8'));\n\ndescribe('Admin route descriptor pin', () => {\n\tit('pins the exact Admin image ref and exposes a disjoint route union', () => {\n\t\texpect(descriptor.sourceRef).toBe(deployment.adminApiRef);\n\t\texpect(descriptor.routeCount).toBe(descriptor.routes.length);\n\t\texpect(descriptor.routes.every((route: { path: string }) => !route.path.startsWith('/v1/market/'))).toBe(true);\n\t\tconst digest = createHash('sha256').update(JSON.stringify(descriptor.routes)).digest('hex');\n\t\texpect(\`sha256:\${digest}\`).toBe(descriptor.digest);\n\t\texpect(descriptor.digest).toBe(deployment.adminDescriptorDigest);\n\t});\n});\n`;
}

function workflow() {
	return `name: Verify\n\non:\n  pull_request:\n  push:\n    branches: [main, staging]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\nconcurrency:\n  group: verify-\${{ github.repository }}-\${{ github.ref }}\n  cancel-in-progress: true\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: npm install\n      - run: npm run verify\n`;
}

function files(projectRoot: string, sdkRef: string, adminApiRef: string) {
	const descriptor = JSON.parse(readFileSync(resolve(projectRoot, 'packages/api/dist/admin-api-descriptor.json'), 'utf8')) as { digest: string; sourceRef: string | null };
	descriptor.sourceRef = adminApiRef;
	const descriptorContent = `${JSON.stringify(descriptor, null, 2)}\n`;
	return {
		descriptorDigest: descriptor.digest,
		files: [
			['package.json', packageJson(sdkRef)], ['tsconfig.json', `${JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', outDir: 'dist', rootDir: '.', strict: true, skipLibCheck: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'] }, include: ['src/**/*.ts', 'tests/**/*.ts'] }, null, 2)}\n`],
			['LICENSE', 'UNLICENSED\n\nCopyright (c) TreeSeed. All rights reserved. No license is granted.\n'], ['README.md', '# TreeSeed Market API\n\nPrivate singleton Market implementation and hosted Admin API gateway for `api.treeseed.dev`. This repository is never provisioned by Platform. Hosted deployment remains suspended.\n'],
			['src/gateway.ts', gatewaySource(descriptor.digest)], ['src/service-assertion.ts', assertionSource()], ['src/server.ts', serverSource()],
			['tests/gateway.test.ts', gatewayTest()], ['tests/descriptor.test.ts', descriptorTest()], ['artifacts/admin-api-descriptor.json', descriptorContent],
			['singleton.manifest.json', `${JSON.stringify({ schemaVersion: 1, authority: 'market-singleton', sdkRef, adminApiRef, adminDescriptorDigest: descriptor.digest, deployment: 'suspended' }, null, 2)}\n`],
			['.github/workflows/verify.yml', workflow()],
		] as Array<[string, string]>,
	};
}

function workspaceDigest(projectRoot: string, sdkRef: string, adminApiRef: string) {
	const hash = createHash('sha256');
	for (const [path, content] of files(projectRoot, sdkRef, adminApiRef).files) hash.update(path).update('\0').update(content).update('\0');
	return `sha256:${hash.digest('hex')}`;
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
	const descriptorDigest = files(input.projectRoot, sdkRef, adminApiRef).descriptorDigest;
	const desiredWorkspaceDigest = workspaceDigest(input.projectRoot, sdkRef, adminApiRef);
	const recorded = journal(input.projectRoot, repository);
	const branches: BranchPlan[] = [];
	for (const branch of ['main', 'staging'] as const) {
		const targetCommit = await remoteHead(input.projectRoot, repository, branch, gitEnv);
		const receipt = recorded?.receipts?.find((entry) => entry.branch === branch);
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
		await git(temporary, ['read-tree', '--empty'], { env: indexEnv });
		for (const [path, content] of files(projectRoot, plan.sdkRef, plan.adminApiRef).files) {
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
	const receipts: Receipt[] = [];
	for (const branch of plan.branches) {
		let targetCommit = branch.targetCommit;
		if (branch.action === 'create' || branch.action === 'update') {
			targetCommit = await buildCommit(input.projectRoot, branch.branch, plan, branch.targetCommit, gitEnv);
		}
		const observed = await remoteHead(input.projectRoot, plan.repository, branch.branch, gitEnv);
		if (!targetCommit || observed !== targetCommit) throw new Error(`Fresh GitHub read-back returned ${observed ?? 'missing'}, expected ${targetCommit ?? 'missing'}.`);
		receipts.push({ branch: branch.branch, targetCommit, sdkRef: plan.sdkRef, adminApiRef: plan.adminApiRef, workspaceDigest: workspaceDigest(input.projectRoot, plan.sdkRef, plan.adminApiRef), verified: true });
		writeJournal(input.projectRoot, plan, receipts);
	}
	return { ...plan, status: 'verified' as const, receipts, journalPath: journalPath(input.projectRoot, plan.repository) };
}
