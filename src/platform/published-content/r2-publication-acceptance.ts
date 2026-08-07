import { randomUUID } from 'node:crypto';
import { createR2PublicationClient,type R2PublicationConfig } from './r2-publication-client.ts';

export async function runR2PublicationAcceptance(input: {
	teamId: string;
	r2: R2PublicationConfig;
	runId?: string;
	fetchImpl?: typeof fetch;
}) {
	const runId = (input.runId ?? randomUUID()).replace(/[^A-Za-z0-9._-]/gu, '-');
	const root = `teams/${input.teamId}/acceptance/${runId}`;
	const objectKey = `${root}/object.txt`;
	const pointerKey = `${root}/pointer.json`;
	const client = createR2PublicationClient(input.r2, input.fetchImpl);
	const first = '{"revision":"first"}\n';
	const second = '{"revision":"second"}\n';
	try {
		await client.put(objectKey, 'content-publication-acceptance\n', { contentType: 'text/plain; charset=utf-8', ifNoneMatch: '*' });
		await client.put(pointerKey, first, { contentType: 'application/json; charset=utf-8', ifNoneMatch: '*' });
		const observedFirst = await client.get(pointerKey);
		if (!observedFirst?.etag || observedFirst.body !== first) throw new Error('R2 acceptance initial read-back failed.');
		await client.put(pointerKey, second, { contentType: 'application/json; charset=utf-8', ifMatch: observedFirst.etag });
		const observedSecond = await client.get(pointerKey);
		if (!observedSecond?.etag || observedSecond.body !== second) throw new Error('R2 acceptance conditional advance failed.');
		await client.put(pointerKey, first, { contentType: 'application/json; charset=utf-8', ifMatch: observedSecond.etag });
		if ((await client.get(pointerKey))?.body !== first) throw new Error('R2 acceptance rollback failed.');
		if ((await client.get(objectKey))?.body !== 'content-publication-acceptance\n') throw new Error('R2 acceptance object read-back failed.');
		return { contract: 'treeseed.content-publication-acceptance/v1', runId, objectKey, pointerKey, verified: true };
	} finally {
		await client.delete(pointerKey);
		await client.delete(objectKey);
	}
}
