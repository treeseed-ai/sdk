import { createHash } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import { relative,resolve } from 'node:path';
import { runRepositoryGit } from '../../operations/services/operations/git-runner.ts';
import type { ArtifactRef } from '../../treedx/types.ts';
import { ARTIFACT_REF_CONTRACT } from '../../treedx/types.ts';
import { CONTENT_PUBLICATION_CONTRACT,publicationKeys,type ContentPublicationChannel,type ContentPublicationManifest,type ContentPublicationReceipt } from './publication-contracts.ts';
import { createR2PublicationClient,type R2PublicationConfig } from './r2-publication-client.ts';

export interface ReconcileContentPublicationInput {
	projectRoot: string;
	contentPath: string;
	teamId: string;
	projectId: string;
	sourceCommit: string;
	ref: string;
	channel: ContentPublicationChannel;
	generatedAt?: string;
	validateOnly?: boolean;
	r2?: R2PublicationConfig;
	fetchImpl?: typeof fetch;
	observeSourceCommit?: (projectRoot: string) => Promise<string>;
	observeSourceGeneratedAt?: (projectRoot: string, sourceCommit: string) => Promise<string>;
}

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const mediaType = (path: string) => path.endsWith('.mdx') ? 'text/mdx; charset=utf-8' : path.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';

async function forEachConcurrent<T>(values: T[], concurrency: number, operation: (value: T, index: number) => Promise<void>) {
	let next = 0;
	const worker = async () => {
		for (;;) {
			const index = next;
			next += 1;
			if (index >= values.length) return;
			await operation(values[index]!, index);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
}

async function filesUnder(root: string): Promise<string[]> {
	const result: string[] = [];
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	for (const entry of entries) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) result.push(...await filesUnder(path));
		else if (entry.isFile()) result.push(path);
	}
	return result.sort();
}

function validateSourceCommit(value: string) {
	if (!/^[0-9a-f]{40,64}$/u.test(value)) throw new Error('sourceCommit must be the exact fetched Git commit SHA.');
}

export async function reconcileContentPublication(input: ReconcileContentPublicationInput): Promise<ContentPublicationReceipt> {
	validateSourceCommit(input.sourceCommit);
	const projectRoot = resolve(input.projectRoot);
	const root = resolve(projectRoot, input.contentPath);
	const contentRelative = relative(projectRoot, root);
	if (!contentRelative || contentRelative === '..' || contentRelative.startsWith('../') || contentRelative.startsWith('..\\')) {
		throw new Error('contentPath must identify a directory inside projectRoot.');
	}
	const observeSourceCommit = input.observeSourceCommit ?? (async (cwd: string) => runRepositoryGit(
		['rev-parse', 'HEAD'], { cwd, mode: 'read' },
	).stdout.trim());
	if (await observeSourceCommit(projectRoot) !== input.sourceCommit) {
		throw new Error('sourceCommit does not match the fetched project checkout HEAD.');
	}
	if (!input.observeSourceCommit) {
		const dirty = runRepositoryGit(['status', '--porcelain=v1', '--', contentRelative], { cwd: projectRoot, mode: 'read' }).stdout.trim();
		if (dirty) throw new Error('Content publication requires the exact clean content tree from sourceCommit.');
	}
	const sourceFiles = await filesUnder(root);
	const values = await Promise.all(sourceFiles.map(async (file) => {
		const bytes = await readFile(file);
		const text = bytes.toString('utf8');
		if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`${file} is not valid UTF-8.`);
		const sha256 = digest(bytes);
		return { path: relative(root, file).replaceAll('\\', '/'), bytes, sha256, byteLength: bytes.byteLength, mediaType: mediaType(file) };
	}));
	const provisional = { teamId: input.teamId, projectId: input.projectId, sourceCommit: input.sourceCommit, ref: input.ref, channel: input.channel };
	const revision = digest(JSON.stringify({ ...provisional, objects: values.map(({ path, sha256 }) => ({ path, sha256 })) }));
	const keys = publicationKeys({ ...provisional, revision });
	const objects = values.map((value) => ({ path: value.path, objectKey: `${keys.objectRoot}/${value.sha256}`, sha256: value.sha256, byteLength: value.byteLength, mediaType: value.mediaType }));
	const observeGeneratedAt = input.observeSourceGeneratedAt ?? (async (cwd: string, commit: string) => runRepositoryGit(
		['show', '-s', '--format=%cI', commit], { cwd, mode: 'read' },
	).stdout.trim());
	const generatedAt = input.generatedAt ?? await observeGeneratedAt(projectRoot, input.sourceCommit);
	if (!generatedAt) throw new Error('The exact source commit timestamp is required for deterministic publication replay.');
	const manifest: ContentPublicationManifest = { contract: CONTENT_PUBLICATION_CONTRACT, ...provisional, revision, generatedAt, objects };
	const body = `${JSON.stringify(manifest, null, 2)}\n`;
	const artifacts: ArtifactRef[] = objects.map((object) => ({ contract: ARTIFACT_REF_CONTRACT, kind: 'r2-object', objectKey: object.objectKey, path: object.path, commitSha: input.sourceCommit, sha256: object.sha256, byteLength: object.byteLength, mediaType: object.mediaType, visibility: input.channel === 'production' ? 'public' : 'team', provenance: { projectId: input.projectId, sourceCommit: input.sourceCommit } }));
	if (input.validateOnly) return { contract: CONTENT_PUBLICATION_CONTRACT, teamId: input.teamId, projectId: input.projectId, sourceCommit: input.sourceCommit, channel: input.channel, revision, manifestKey: keys.manifestKey, pointerKey: keys.pointerKey, uploadedObjectCount: 0, reusedObjectCount: objects.length, artifacts, verified: true };
	if (!input.r2) throw new Error('R2 publication credentials are required.');

	const client = createR2PublicationClient(input.r2, input.fetchImpl);
	let uploadedObjectCount = 0;
	await forEachConcurrent(objects, 8, async (object, index) => {
		if (await client.exists(object.objectKey)) return;
		await client.put(object.objectKey, values[index]!.bytes.toString('utf8'), { contentType: object.mediaType, ifNoneMatch: '*' });
		uploadedObjectCount += 1;
	});
	await forEachConcurrent(objects, 8, async (object) => {
		const readback = await client.get(object.objectKey);
		if (!readback || digest(readback.body) !== object.sha256 || Buffer.byteLength(readback.body, 'utf8') !== object.byteLength) {
			throw new Error(`R2 content object read-back verification failed for ${object.path}.`);
		}
	});
	const existingManifest = await client.get(keys.manifestKey);
	if (existingManifest && existingManifest.body !== body) throw new Error('Immutable publication manifest digest collision.');
	if (!existingManifest) await client.put(keys.manifestKey, body, { contentType: 'application/json; charset=utf-8', ifNoneMatch: '*' });
	const prior = await client.get(keys.pointerKey);
	if (prior?.body !== body) {
		await client.put(keys.pointerKey, body, { contentType: 'application/json; charset=utf-8', ...(prior?.etag ? { ifMatch: prior.etag } : { ifNoneMatch: '*' as const }) });
	}
	const [manifestReadback, pointerReadback] = await Promise.all([client.get(keys.manifestKey), client.get(keys.pointerKey)]);
	if (manifestReadback?.body !== body || pointerReadback?.body !== body) throw new Error('R2 publication read-back verification failed.');
	return { contract: CONTENT_PUBLICATION_CONTRACT, teamId: input.teamId, projectId: input.projectId, sourceCommit: input.sourceCommit, channel: input.channel, revision, manifestKey: keys.manifestKey, pointerKey: keys.pointerKey, uploadedObjectCount, reusedObjectCount: objects.length - uploadedObjectCount, artifacts, verified: true };
}
