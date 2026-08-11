import { createHash } from 'node:crypto';
import type { ArtifactRef } from '../../treedx/types.ts';

export const CONTENT_PUBLICATION_CONTRACT = 'treeseed.content-publication/v1' as const;

export type ContentPublicationChannel = 'preview' | 'staging' | 'production';

export interface ContentPublicationObject {
	path: string;
	objectKey: string;
	sha256: string;
	byteLength: number;
	mediaType: string;
}

export interface ContentPublicationManifest {
	contract: typeof CONTENT_PUBLICATION_CONTRACT;
	teamId: string;
	projectId: string;
	sourceCommit: string;
	ref: string;
	channel: ContentPublicationChannel;
	revision: string;
	generatedAt: string;
	objects: ContentPublicationObject[];
}

export interface ContentPublicationReceipt {
	contract: typeof CONTENT_PUBLICATION_CONTRACT;
	teamId: string;
	projectId: string;
	sourceCommit: string;
	channel: ContentPublicationChannel;
	revision: string;
	manifestKey: string;
	pointerKey: string;
	uploadedObjectCount: number;
	reusedObjectCount: number;
	artifacts: ArtifactRef[];
	verified: boolean;
}

function segment(value: string, label: string) {
	const normalized = value.trim().replace(/[^A-Za-z0-9._-]/gu, '-');
	if (!normalized || normalized === '.' || normalized === '..') throw new Error(`${label} is invalid.`);
	return normalized;
}

export function publicationKeys(input: {
	teamId: string;
	projectId: string;
	ref: string;
	revision: string;
	channel: ContentPublicationChannel;
}) {
	const team = segment(input.teamId, 'teamId');
	const project = segment(input.projectId, 'projectId');
	const revision = segment(input.revision, 'revision');
	const ref = input.ref.trim();
	segment(ref, 'ref');
	const refDigest = createHash('sha256').update(ref).digest('hex');
	const root = `content/${team}/${project}`;
	const channelRoot = input.channel === 'preview'
		? `${root}/previews/${refDigest}`
		: `${root}/${input.channel}`;
	const releaseRoot = `${channelRoot}/releases/${revision}`;
	return {
		manifestKey: `${releaseRoot}/manifest.json`,
		pointerKey: `${channelRoot}/${input.channel === 'preview' ? 'manifest.json' : 'channels/current.json'}`,
		objectRoot: `${releaseRoot}/content`,
	};
}
