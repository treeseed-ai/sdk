import type {
	SdkCursorEntity,
	SdkLeaseEntity,
	SdkMessageEntity,
	SdkRunEntity,
	SdkSubscriptionEntity,
	TreeseedAgentRunMeta,
	TreeseedAgentRunPayload,
	TreeseedContactSubmissionMeta,
	TreeseedContactSubmissionPayload,
	TreeseedCursorMeta,
	TreeseedCursorPayload,
	TreeseedLeaseMeta,
	TreeseedLeasePayload,
	TreeseedMessageMeta,
	TreeseedMessagePayload,
	TreeseedRecordEnvelope,
	TreeseedRuntimeRecordType,
	TreeseedSubscriptionMeta,
	TreeseedSubscriptionPayload,
} from '../sdk-types.ts';

export const TRESEED_ENVELOPE_SCHEMA_VERSION = 1;

export interface RuntimeRecordRow {
	id?: number;
	record_type?: string;
	record_key?: string | null;
	lookup_key?: string | null;
	secondary_key?: string | null;
	status?: string;
	schema_version?: number;
	created_at?: string;
	updated_at?: string;
	payload_json?: string;
	meta_json?: string;
}

export interface MessageQueueRow {
	id?: number;
	message_type?: string;
	status?: string;
	schema_version?: number;
	related_model?: string | null;
	related_id?: string | null;
	priority?: number;
	available_at?: string;
	claimed_by?: string | null;
	claimed_at?: string | null;
	lease_expires_at?: string | null;
	attempts?: number;
	max_attempts?: number;
	created_at?: string;
	updated_at?: string;
	payload_json?: string;
	meta_json?: string;
}

export interface CursorStateRow {
	agent_slug?: string;
	cursor_key?: string;
	status?: string;
	schema_version?: number;
	updated_at?: string;
	payload_json?: string;
	meta_json?: string;
}

export interface LeaseStateRow {
	model?: string;
	item_key?: string;
	status?: string;
	schema_version?: number;
	claimed_by?: string | null;
	claimed_at?: string | null;
	lease_expires_at?: string | null;
	created_at?: string;
	updated_at?: string;
	payload_json?: string;
	meta_json?: string;
}

function parseJsonObject<T>(value: unknown, fallback: T): T {
	if (typeof value !== 'string' || value.trim().length === 0) return fallback;
	try {
		return { ...fallback, ...(JSON.parse(value) as Record<string, unknown>) } as T;
	} catch {
		return fallback;
	}
}

export function createSubscriptionEnvelope(input: {
	email: string;
	name?: string | null;
	status?: string;
	source?: string;
	consentAt?: string | null;
	ipHash?: string;
	meta?: TreeseedSubscriptionMeta;
}): TreeseedRecordEnvelope<TreeseedSubscriptionPayload, TreeseedSubscriptionMeta> {
	return {
		recordType: 'subscription',
		schemaVersion: TRESEED_ENVELOPE_SCHEMA_VERSION,
		status: input.status ?? 'active',
		payload: {
			email: input.email,
			name: input.name ?? null,
			source: input.source ?? 'sdk',
			consentAt: input.consentAt ?? null,
			ipHash: input.ipHash ?? '',
		},
		meta: input.meta ?? {},
	};
}

export function subscriptionEntityFromEnvelope(row: RuntimeRecordRow): SdkSubscriptionEntity {
	const payload = parseJsonObject<TreeseedSubscriptionPayload>(row.payload_json, {
		email: String(row.record_key ?? row.lookup_key ?? ''),
		name: null,
		source: 'sdk',
		consentAt: null,
		ipHash: '',
	});
	return {
		id: row.id !== undefined ? Number(row.id) : undefined,
		recordType: 'subscription',
		schemaVersion: Number(row.schema_version ?? TRESEED_ENVELOPE_SCHEMA_VERSION),
		email: payload.email,
		name: payload.name,
		status: String(row.status ?? 'active'),
		source: payload.source,
		consent_at: payload.consentAt ?? undefined,
		created_at: row.created_at ? String(row.created_at) : undefined,
		updated_at: row.updated_at ? String(row.updated_at) : undefined,
		ip_hash: payload.ipHash,
		metaJson: typeof row.meta_json === 'string' ? row.meta_json : '{}',
	};
}

export function createContactSubmissionEnvelope(input: {
	name: string;
	email: string;
	organization?: string | null;
	contactType: string;
	subject: string;
	message: string;
	userAgent: string;
	ipHash: string;
	meta?: TreeseedContactSubmissionMeta;
}): TreeseedRecordEnvelope<TreeseedContactSubmissionPayload, TreeseedContactSubmissionMeta> {
	return {
		recordType: 'contact_submission',
		schemaVersion: TRESEED_ENVELOPE_SCHEMA_VERSION,
		status: 'received',
		payload: {
			name: input.name,
			email: input.email,
			organization: input.organization ?? null,
			contactType: input.contactType,
			subject: input.subject,
			message: input.message,
			userAgent: input.userAgent,
			ipHash: input.ipHash,
		},
		meta: input.meta ?? {},
	};
}

export function createMessageEnvelope(input: {
	type: string;
	payload: Record<string, unknown>;
	meta?: TreeseedMessageMeta;
}): TreeseedRecordEnvelope<TreeseedMessagePayload, TreeseedMessageMeta> {
	return {
		recordType: 'message',
		schemaVersion: TRESEED_ENVELOPE_SCHEMA_VERSION,
		status: 'pending',
		payload: { body: input.payload },
		meta: input.meta ?? {},
	};
}

export function messageEntityFromEnvelope(row: MessageQueueRow): SdkMessageEntity {
	const payload = parseJsonObject<TreeseedMessagePayload>(row.payload_json, { body: {} });
	return {
		id: Number(row.id ?? 0),
		recordType: 'message',
		schemaVersion: Number(row.schema_version ?? TRESEED_ENVELOPE_SCHEMA_VERSION),
		type: String(row.message_type ?? ''),
		status: String(row.status ?? 'pending'),
		payloadJson: JSON.stringify(payload.body ?? {}),
		metaJson: typeof row.meta_json === 'string' ? row.meta_json : '{}',
		relatedModel: row.related_model ? String(row.related_model) : null,
		relatedId: row.related_id ? String(row.related_id) : null,
		priority: Number(row.priority ?? 0),
		availableAt: String(row.available_at ?? ''),
		claimedBy: row.claimed_by ? String(row.claimed_by) : null,
		claimedAt: row.claimed_at ? String(row.claimed_at) : null,
		leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
		attempts: Number(row.attempts ?? 0),
		maxAttempts: Number(row.max_attempts ?? 3),
		createdAt: String(row.created_at ?? ''),
		updatedAt: String(row.updated_at ?? ''),
	};
}

export function createRunEnvelope(input: {
	runId: string;
	agentSlug: string;
	status: string;
	triggerSource: string;
	startedAt: string;
	handlerKind?: string | null;
	triggerKind?: string | null;
	selectedItemKey?: string | null;
	selectedMessageId?: number | null;
	claimedMessageId?: number | null;
	branchName?: string | null;
	prUrl?: string | null;
	summary?: string | null;
	error?: string | null;
	errorCategory?: string | null;
	commitSha?: string | null;
	changedPaths?: string[];
	finishedAt?: string | null;
}): TreeseedRecordEnvelope<TreeseedAgentRunPayload, TreeseedAgentRunMeta> {
	return {
		recordType: 'agent_run',
		schemaVersion: TRESEED_ENVELOPE_SCHEMA_VERSION,
		status: input.status,
		payload: {
			triggerSource: input.triggerSource,
			handlerKind: input.handlerKind ?? null,
			triggerKind: input.triggerKind ?? null,
			selectedItemKey: input.selectedItemKey ?? null,
			selectedMessageId: input.selectedMessageId ?? null,
			claimedMessageId: input.claimedMessageId ?? null,
			branchName: input.branchName ?? null,
			prUrl: input.prUrl ?? null,
			summary: input.summary ?? null,
			error: input.error ?? null,
			errorCategory: input.errorCategory ?? null,
			commitSha: input.commitSha ?? null,
			changedPaths: input.changedPaths ?? [],
			finishedAt: input.finishedAt ?? null,
		},
		meta: {
			runId: input.runId,
			agentSlug: input.agentSlug,
		},
	};
}

export function runEntityFromEnvelope(row: RuntimeRecordRow): SdkRunEntity {
	const payload = parseJsonObject<TreeseedAgentRunPayload>(row.payload_json, {
		triggerSource: '',
		selectedItemKey: null,
		selectedMessageId: null,
		branchName: null,
		prUrl: null,
		summary: null,
		error: null,
		changedPaths: [],
		finishedAt: null,
	});
	const meta = parseJsonObject<TreeseedAgentRunMeta>(row.meta_json, {
		runId: String(row.record_key ?? ''),
		agentSlug: String(row.lookup_key ?? ''),
	});
	return {
		recordType: 'agent_run',
		schemaVersion: Number(row.schema_version ?? TRESEED_ENVELOPE_SCHEMA_VERSION),
		runId: meta.runId,
		agentSlug: meta.agentSlug,
		status: String(row.status ?? ''),
		triggerSource: payload.triggerSource,
		handlerKind: payload.handlerKind ?? null,
		triggerKind: payload.triggerKind ?? null,
		selectedItemKey: payload.selectedItemKey ?? null,
		selectedMessageId: payload.selectedMessageId ?? null,
		claimedMessageId: payload.claimedMessageId ?? null,
		branchName: payload.branchName ?? null,
		prUrl: payload.prUrl ?? null,
		summary: payload.summary ?? null,
		error: payload.error ?? null,
		errorCategory: payload.errorCategory ?? null,
		commitSha: payload.commitSha ?? (row.secondary_key ? String(row.secondary_key) : null),
		changedPaths: payload.changedPaths ?? [],
		startedAt: String(row.created_at ?? ''),
		finishedAt: payload.finishedAt ?? null,
	};
}

export function createCursorEnvelope(input: {
	agentSlug: string;
	cursorKey: string;
	cursorValue: string;
	meta?: TreeseedCursorMeta;
}): TreeseedRecordEnvelope<TreeseedCursorPayload, TreeseedCursorMeta> {
	return {
		recordType: 'agent_cursor',
		schemaVersion: TRESEED_ENVELOPE_SCHEMA_VERSION,
		status: 'active',
		payload: { cursorValue: input.cursorValue },
		meta: input.meta ?? {},
	};
}

export function cursorEntityFromEnvelope(row: CursorStateRow): SdkCursorEntity {
	const payload = parseJsonObject<TreeseedCursorPayload>(row.payload_json, { cursorValue: '' });
	return {
		recordType: 'agent_cursor',
		schemaVersion: Number(row.schema_version ?? TRESEED_ENVELOPE_SCHEMA_VERSION),
		agentSlug: String(row.agent_slug ?? ''),
		cursorKey: String(row.cursor_key ?? ''),
		cursorValue: payload.cursorValue,
		updatedAt: row.updated_at ? String(row.updated_at) : null,
	};
}

export function createLeaseEnvelope(input: {
	token: string;
	meta?: TreeseedLeaseMeta;
}): TreeseedRecordEnvelope<TreeseedLeasePayload, TreeseedLeaseMeta> {
	return {
		recordType: 'content_lease',
		schemaVersion: TRESEED_ENVELOPE_SCHEMA_VERSION,
		status: 'claimed',
		payload: { token: input.token },
		meta: input.meta ?? {},
	};
}

export function leaseEntityFromEnvelope(row: LeaseStateRow): SdkLeaseEntity {
	const payload = parseJsonObject<TreeseedLeasePayload>(row.payload_json, { token: '' });
	return {
		recordType: 'content_lease',
		schemaVersion: Number(row.schema_version ?? TRESEED_ENVELOPE_SCHEMA_VERSION),
		model: String(row.model ?? ''),
		itemKey: String(row.item_key ?? ''),
		claimedBy: row.claimed_by ? String(row.claimed_by) : '',
		claimedAt: row.claimed_at ? String(row.claimed_at) : '',
		leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : '',
		token: payload.token,
	};
}
