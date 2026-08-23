export type {
	TreeDxApiErrorPayload,
	TreeDxCursor,
	TreeDxJson,
	TreeDxPage,
	TreeDxRecord,
} from '@treeseed/treedx/treedx/types';

export interface TreeSeedTreeDxResourceLink {
	type: 'resource_link';
	uri: `treeseed://dx/projects/${string}/${string}`;
	name: string;
	mimeType?: string;
	expiresAt?: string;
}
