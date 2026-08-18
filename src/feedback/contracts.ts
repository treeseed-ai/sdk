export const FEEDBACK_TYPES = ['bug', 'feature_suggestion', 'question', 'content_issue', 'ux_issue'] as const;
export const FEEDBACK_STATUSES = ['new', 'triaged', 'in_progress', 'resolved'] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackSubmissionContext {
	canonicalPath: string;
	routePattern?: string;
	capabilityId?: string;
	teamId?: string;
	projectId?: string;
	environment?: 'local' | 'staging' | 'production';
	buildId?: string;
	revision?: string;
	source?: 'page' | 'help';
	knowledgePageId?: string;
}

export interface FeedbackClientContext {
	userAgent?: string;
	viewport: { width: number; height: number; devicePixelRatio: number };
	locale?: string;
	timeZone?: string;
	theme?: string;
	reducedMotion?: boolean;
}

export interface FeedbackScreenshotCapture {
	dataUrl: string;
	mimeType: 'image/png';
	byteSize: number;
	width: number;
	height: number;
	digest: string;
	redactionVersion: string;
	maskedRegionCount: number;
	redacted: true;
}

export interface FeedbackSubmissionRequest {
	type: FeedbackType;
	message: string;
	allowContact: boolean;
	context: FeedbackSubmissionContext;
	client: FeedbackClientContext;
	screenshot?: FeedbackScreenshotCapture;
}

export interface FeedbackAttachmentMetadata {
	id: string;
	feedbackId: string;
	mimeType: 'image/png' | 'application/zip';
	byteSize: number;
	width?: number;
	height?: number;
	digest: string;
	redactionVersion?: string;
	maskedRegionCount?: number;
	createdAt: string;
	expiresAt?: string;
	expiredAt?: string;
}

export interface FeedbackStatusEvent {
	id: string;
	fromStatus?: FeedbackStatus;
	toStatus: FeedbackStatus;
	note?: string;
	actorId: string;
	actorLabel?: string;
	createdAt: string;
}

export interface FeedbackSummary {
	id: string;
	type: FeedbackType;
	status: FeedbackStatus;
	message: string;
	submitterId: string;
	submitterLabel?: string;
	teamId?: string;
	teamLabel?: string;
	projectId?: string;
	canonicalPath: string;
	hasScreenshot: boolean;
	exported: boolean;
	createdAt: string;
	updatedAt: string;
	resolvedAt?: string;
	version: number;
}

export interface FeedbackDetail extends FeedbackSummary {
	allowContact: boolean;
	contactEmail?: string;
	context: FeedbackSubmissionContext;
	client: FeedbackClientContext;
	attachments: FeedbackAttachmentMetadata[];
	history: FeedbackStatusEvent[];
}

export interface FeedbackCollectionFilters {
	query?: string;
	status?: FeedbackStatus;
	type?: FeedbackType;
	teamId?: string;
	hasScreenshot?: boolean;
	exported?: boolean;
	from?: string;
	to?: string;
	cursor?: string;
	limit?: number;
}

export interface FeedbackCollection {
	items: FeedbackSummary[];
	nextCursor?: string;
	teams?: Array<{ id: string; slug: string; label: string }>;
	counts: Record<FeedbackStatus, number>;
}

export interface FeedbackPrivacyManifest {
	schema: 'treeseed.feedback-export/v1';
	createdAt: string;
	sourceClosure?: string;
	filters: FeedbackCollectionFilters;
	count: number;
	includeScreenshots: boolean;
	omittedFields: string[];
	redactionPolicy: string;
}

export interface FeedbackExportRecord {
	id: string;
	status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
	itemCount: number;
	includeScreenshots: boolean;
	createdAt: string;
	expiresAt: string;
	completedAt?: string;
	error?: string;
}

export const FEEDBACK_CAPTURE_VERSION = 'treeseed.feedback-capture/v3';
export const FEEDBACK_EXPORT_SCHEMA = 'treeseed.feedback-export/v1';

export function isFeedbackType(value: unknown): value is FeedbackType {
	return typeof value === 'string' && (FEEDBACK_TYPES as readonly string[]).includes(value);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
	return typeof value === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}
