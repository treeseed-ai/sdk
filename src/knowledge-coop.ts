import type { ProjectConnection, RemoteJobStatus } from './sdk-types.ts';

export const KNOWLEDGE_COOP_TEAM_CAPABILITIES = [
	'launch_projects',
	'edit_direct',
	'manage_workstreams',
	'stage_releases',
	'publish_releases',
	'publish_market_listings',
	'manage_products',
	'manage_billing',
	'approve_remote_execution',
] as const;

export const KNOWLEDGE_COOP_JOB_STATUSES = [
	'queued',
	'running',
	'waiting_for_approval',
	'failed',
	'completed',
	'rolled_back',
	'cancelled',
] as const;

export const KNOWLEDGE_COOP_WORKSTREAM_STATES = [
	'drafting',
	'active_local',
	'verifying',
	'saved_remote',
	'in_staging',
	'archived',
] as const;

export const KNOWLEDGE_COOP_RELEASE_STATES = [
	'drafting',
	'waiting_on_verification',
	'ready_to_publish',
	'published',
	'rolled_back',
] as const;

export const KNOWLEDGE_COOP_SHARE_PACKAGE_STATES = [
	'draft',
	'packaged',
	'ready_to_publish',
	'published',
	'archived',
	'failed',
] as const;

export const KNOWLEDGE_COOP_AGENT_MESSAGE_KINDS = [
	'informational',
	'warning',
	'action_requested',
	'release_readiness',
] as const;

export type TeamCapability = (typeof KNOWLEDGE_COOP_TEAM_CAPABILITIES)[number];
export type KnowledgeCoopJobStatus = (typeof KNOWLEDGE_COOP_JOB_STATUSES)[number];
export type WorkstreamState = (typeof KNOWLEDGE_COOP_WORKSTREAM_STATES)[number];
export type ReleaseState = (typeof KNOWLEDGE_COOP_RELEASE_STATES)[number];
export type SharePackageState = (typeof KNOWLEDGE_COOP_SHARE_PACKAGE_STATES)[number];
export type AgentMessageKind = (typeof KNOWLEDGE_COOP_AGENT_MESSAGE_KINDS)[number];

export interface LinkedProjectRecordRef {
	model: 'objective' | 'question' | 'note' | 'proposal' | 'decision';
	id: string;
}

export interface DirectBoardItemSummary {
	model: 'objective' | 'question' | 'note' | 'proposal' | 'decision';
	id: string;
	title: string;
	status: string | null;
	updatedAt: string | null;
	linkedWorkstreamIds: string[];
	linkedReleaseIds: string[];
}

export interface WorkstreamEvent {
	id: string;
	workstreamId: string;
	projectId: string;
	kind: string;
	summary: string | null;
	data: Record<string, unknown>;
	createdAt: string;
}

export interface WorkstreamSummary {
	id: string;
	projectId: string;
	title: string;
	summary: string | null;
	state: WorkstreamState;
	branchName: string | null;
	branchRef: string | null;
	owner: string | null;
	linkedItems: LinkedProjectRecordRef[];
	verificationStatus: 'completed' | 'failed' | 'waiting' | null;
	verificationSummary: string | null;
	lastSaveAt: string | null;
	lastStageAt: string | null;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

export interface WorkstreamDetail extends WorkstreamSummary {
	events: WorkstreamEvent[];
}

export interface ReleaseSummary {
	id: string;
	projectId: string;
	version: string;
	title: string | null;
	state: ReleaseState;
	summary: string | null;
	workstreamIds: string[];
	releaseTag: string | null;
	commitSha: string | null;
	publishedAt: string | null;
	rolledBackAt: string | null;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

export interface ReleaseDetail extends ReleaseSummary {
	items: Array<{
		id: string;
		workstreamId: string | null;
		model: string | null;
		recordId: string | null;
		summary: string | null;
		metadata?: Record<string, unknown>;
		createdAt: string;
	}>;
}

export interface SharePackageStatus {
	id: string;
	projectId: string;
	kind: 'export' | 'template' | 'knowledge_pack' | 'market_listing';
	state: SharePackageState;
	title: string;
	summary: string | null;
	version: string | null;
	outputPath: string | null;
	artifactKey: string | null;
	manifestKey: string | null;
	publishedItemId: string | null;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

export interface AgentStatusRecord {
	agentSlug: string;
	handler: string;
	status: 'active' | 'idle' | 'failed' | 'waiting';
	currentTask: string | null;
	workstreamId: string | null;
	lastMessage: string | null;
	lastRunAt: string | null;
}

export interface AgentMessageRecord {
	id: string;
	agentSlug: string;
	kind: AgentMessageKind;
	type: string;
	status: string;
	summary: string;
	workstreamId: string | null;
	releaseId: string | null;
	createdAt: string;
	metadata?: Record<string, unknown>;
}

export interface ProjectConnectionStatus {
	projectId: string;
	connection: ProjectConnection | null;
	connected: boolean;
	hubMode?: 'treeseed_hosted' | 'customer_hosted' | null;
	runtimeMode?: 'none' | 'byo_attached' | 'treeseed_managed' | null;
	runtimeRegistration?: 'optional' | 'required' | 'none' | null;
	runtimeAttached?: boolean;
	runtimeReady?: boolean;
	runnerReady: boolean;
	projectApiReady: boolean;
	mode: ProjectConnection['mode'] | 'disconnected';
}

export interface ProjectOverviewSummary {
	projectId: string;
	teamId: string;
	health: {
		state: string;
		label: string;
		reason: string;
	};
	counts: {
		objectives: number;
		questions: number;
		notes: number;
		proposals: number;
		decisions: number;
		activeWorkstreams: number;
		agents: number;
		releases: number;
	};
	connection: ProjectConnectionStatus;
	nextBestAction: string;
	recentActivity: Array<{
		kind: string;
		id: string;
		title: string;
		status: string | null;
		timestamp: string | null;
		summary: string | null;
		metadata?: Record<string, unknown>;
	}>;
}

export interface TeamHomeSummary {
	teamId: string;
	projects: ProjectOverviewSummary[];
	inboxCount: number;
	productsCount: number;
}

export interface TeamMemberSummary {
	id: string;
	teamId: string;
	userId: string;
	status: string;
	displayName: string | null;
	email: string | null;
	roles: string[];
	createdAt: string;
	updatedAt: string;
}

export interface InboxItem {
	id: string;
	teamId: string;
	projectId: string | null;
	kind: string;
	state: KnowledgeCoopJobStatus | string;
	title: string;
	summary: string | null;
	href: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface LaunchProjectRequest {
	teamId: string;
	name: string;
	slug: string;
	summary?: string | null;
	sourceKind: 'blank' | 'template' | 'knowledge_pack';
	sourceRef?: string | null;
	hostingMode: 'managed' | 'hybrid' | 'self_hosted';
	publicSite?: boolean;
	repoProvider?: 'github';
	repoVisibility?: 'private' | 'public';
	enableDefaultAgents?: boolean;
	initialObjectives?: string[];
}

export interface LaunchProjectResult {
	project: {
		id: string;
		teamId: string;
		slug: string;
		name: string;
		description: string | null;
	};
	connection: ProjectConnection | null;
	launchJobId: string | null;
	overview: ProjectOverviewSummary | null;
}

export function normalizeKnowledgeCoopJobStatus(status: string | null | undefined): KnowledgeCoopJobStatus {
	switch (String(status ?? '').trim()) {
		case 'running':
			return 'running';
		case 'waiting_for_approval':
			return 'waiting_for_approval';
		case 'failed':
			return 'failed';
		case 'completed':
			return 'completed';
		case 'rolled_back':
			return 'rolled_back';
		case 'cancelled':
			return 'cancelled';
		case 'claimed':
		case 'pending':
		default:
			return 'queued';
	}
}

export function normalizeRemoteJobStatus(status: RemoteJobStatus): KnowledgeCoopJobStatus {
	return normalizeKnowledgeCoopJobStatus(status);
}
