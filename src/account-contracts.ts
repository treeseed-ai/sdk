export type AuthAvailabilityStatus = 'empty' | 'invalid' | 'reserved' | 'taken' | 'available' | 'throttled' | 'error';

export interface AuthAvailabilityResult {
	value: string;
	available: boolean;
	status: AuthAvailabilityStatus;
	message: string;
	retryAfterSeconds?: number;
}

export type AuthProviderId = 'github' | 'google' | 'microsoft' | 'apple';

export interface AuthProviderCapability {
	id: AuthProviderId;
	label: string;
}

export interface WebAuthenticationResult {
	accessToken: string;
	refreshToken?: string | null;
	tokenType: 'Bearer';
	expiresAt: string;
	expiresInSeconds: number;
	principal: ApiPrincipal;
}

export interface CredentialRegistrationRequest {
	firstName: string;
	lastName: string;
	username: string;
	email: string;
	password: string;
	returnTo?: string;
	inviteToken?: string;
}

export interface CredentialRegistrationResult extends Partial<WebAuthenticationResult> {
	confirmationRequired?: boolean;
	confirmationToken?: string;
}

export interface UsernameClaimResult extends WebAuthenticationResult {
	username: string;
}

export type ReauthenticationAction = 'password_change' | 'account_delete';

export interface ReauthenticationGrant {
	grantId: string;
	action: ReauthenticationAction;
	expiresInSeconds: number;
}

export interface AccountMutationResult {
	changed?: boolean;
	deleted?: boolean;
	id?: string;
	status?: 'updated' | 'revoked' | 'already-revoked' | 'not-found';
}

export interface AccountEmailAddress {
	id: string;
	email: string;
	status: 'pending' | 'verified';
	isPrimary: boolean;
	verificationRequestedAt?: string | null;
	verifiedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AccountEmailMutationResult {
	emailAddress: AccountEmailAddress;
	verificationSent?: boolean;
	confirmationToken?: string;
}

export interface AccountIdentity {
	id: string;
	username: string;
	displayName: string;
	firstName?: string | null;
	lastName?: string | null;
	image?: string | null;
	hasCredential: boolean;
	emails: AccountEmailAddress[];
	providers: Array<{ id: string; provider: string; email?: string | null; linkedAt: string; canUnlink: boolean }>;
}

export interface AccountWebSession {
	id: string;
	provider: string;
	expiresAt: string;
	revokedAt?: string | null;
	authenticatedAt: string;
	lastSeenAt?: string | null;
	ipAddress?: string | null;
	userAgent?: string | null;
	current: boolean;
}

export interface AccountDeletionBlocker {
	code: 'platform_admin' | 'team_owner';
	message: string;
	teamId?: string;
	teamSlug?: string;
	teamName?: string;
}

export const NOTIFICATION_EMAIL_CADENCES = ['immediate', 'daily', 'weekly'] as const;
export type NotificationEmailCadence = typeof NOTIFICATION_EMAIL_CADENCES[number];

export interface NotificationContentCapability {
	id: string;
	label: string;
	description: string;
	eventTypes: string[];
}

export const NOTIFICATION_CONTENT_CAPABILITIES: readonly NotificationContentCapability[] = [
	{ id: 'objectives', label: 'Objectives', description: 'Strategic objectives and changes to their status.', eventTypes: ['content.objective.published'] },
	{ id: 'questions', label: 'Questions', description: 'New research questions and published answers.', eventTypes: ['content.question.published'] },
	{ id: 'notes', label: 'Notes', description: 'Linked observations, feedback, and implementation notes.', eventTypes: ['content.note.published'] },
	{ id: 'proposals', label: 'Proposals', description: 'New proposals and material proposal updates.', eventTypes: ['content.proposal.published'] },
	{ id: 'decisions', label: 'Decisions', description: 'Accepted, rejected, deferred, or superseded decisions.', eventTypes: ['content.decision.published'] },
	{ id: 'agents', label: 'Agents', description: 'Project agent definition changes.', eventTypes: ['content.agent.published'] },
] as const;

export interface NotificationProjectOverride {
	projectId: string;
	contentTypes: string[];
}

export interface NotificationProject {
	id: string;
	slug: string;
	name?: string | null;
}

export interface NotificationPreferences {
	emailCadence: NotificationEmailCadence;
	timeZone: string;
	globalContentTypes: string[];
	projectOverrides: NotificationProjectOverride[];
}

export interface AccountNotification {
	id: string;
	eventType: string;
	contentType: string;
	projectId: string;
	title: string;
	summary?: string | null;
	targetUrl: string;
	createdAt: string;
	readAt?: string | null;
}

export interface PersonalThemePaletteMode {
	canvas: string;
	surface: string;
	text: string;
	accent: string;
}

export interface PersonalThemePalette {
	light: PersonalThemePaletteMode;
	dark: PersonalThemePaletteMode;
}

export interface PersonalThemeDraft {
	name: string;
	baseScheme: string;
	palette: PersonalThemePalette;
}

export interface PersonalTheme extends PersonalThemeDraft {
	id: string;
	schemeId: string;
	compilerVersion: number;
	createdAt: string;
	updatedAt: string;
}

export const PERSONAL_THEME_COMPILER_VERSION = 1;

export function normalizeNotificationPreferences(input: Partial<NotificationPreferences> | null | undefined): NotificationPreferences {
	const allowed = new Set(NOTIFICATION_CONTENT_CAPABILITIES.map((entry) => entry.id));
	const cadence = NOTIFICATION_EMAIL_CADENCES.includes(input?.emailCadence as NotificationEmailCadence)
		? input?.emailCadence as NotificationEmailCadence
		: 'daily';
	const normalizeTypes = (values: unknown) => Array.isArray(values)
		? [...new Set(values.filter((value): value is string => typeof value === 'string' && allowed.has(value)))].sort()
		: [];
	return {
		emailCadence: cadence,
		timeZone: typeof input?.timeZone === 'string' && input.timeZone.trim() ? input.timeZone.trim() : 'UTC',
		globalContentTypes: normalizeTypes(input?.globalContentTypes),
		projectOverrides: Array.isArray(input?.projectOverrides) ? input.projectOverrides
			.filter((entry): entry is NotificationProjectOverride => Boolean(entry && typeof entry.projectId === 'string' && entry.projectId.trim()))
			.map((entry) => ({ projectId: entry.projectId.trim(), contentTypes: normalizeTypes(entry.contentTypes) }))
			.sort((left, right) => left.projectId.localeCompare(right.projectId)) : [],
	};
}

export function isValidPersonalThemeDraft(input: unknown): input is PersonalThemeDraft {
	if (!input || typeof input !== 'object') return false;
	const draft = input as PersonalThemeDraft;
	const color = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
	return typeof draft.name === 'string' && draft.name.trim().length >= 2 && draft.name.trim().length <= 60
		&& typeof draft.baseScheme === 'string' && Boolean(draft.baseScheme.trim())
		&& Boolean(draft.palette?.light && draft.palette?.dark)
		&& ['canvas', 'surface', 'text', 'accent'].every((key) => color(draft.palette.light[key as keyof PersonalThemePaletteMode]) && color(draft.palette.dark[key as keyof PersonalThemePaletteMode]));
}
import type { ApiPrincipal } from './api/types.ts';
