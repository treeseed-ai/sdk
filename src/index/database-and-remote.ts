export { resolveSdkRecordVersion } from '../packages/sdk-version.ts';

export {
	normalizeAliasedRecord,
	preprocessAliasedRecord,
	resolveAliasedField,
} from '../entrypoints/models/field-aliases.ts';

export {
	canonicalizeFrontmatter,
	normalizeFilterFields,
	normalizeMutationData,
	normalizeRecordToCanonicalShape,
	normalizeSortFields,
	readCanonicalFieldValue,
	resolveModelField,
	validateModelFieldAliases,
} from '../entrypoints/models/sdk-fields.ts';

export {
	REMOTE_CONTRACT_HEADER,
	REMOTE_CONTRACT_VERSION,
	RemoteClient,
	RemoteAuthClient,
	RemoteDispatchClient,
	RemoteJobsClient,
	RemoteRunnerClient,
	RemoteSdkClient,
	RemoteOperationsClient,
} from '../entrypoints/clients/remote.ts';

export * from '../db/index.ts';

export type {
	FieldAliasBinding,
	FieldAliasRegistry,
} from '../entrypoints/models/field-aliases.ts';

export type { AgentDatabase } from '../persistence/d1-store.ts';

export type { D1DatabaseLike, D1PreparedStatementLike } from '../types/cloudflare.ts';

export { CloudflareHttpD1Database } from '../persistence/d1-http.ts';

export type * from '../entrypoints/clients/remote.ts';
