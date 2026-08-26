import { z } from 'zod';
import { defineOperation } from '../operation-builder.ts';
import type { ControlPlaneOperationDescriptor } from '../control-plane-operation.ts';

const empty = z.object({}).strict();
const none = z.undefined();
const record = z.record(z.unknown());

function operation<T extends z.ZodRawShape>(
	operationId: `${string}.${string}`,
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
	path: `/v1/${string}`,
	pathShape: T,
	options: { capability: string; risk?: ControlPlaneOperationDescriptor['riskClass']; concurrency?: boolean; pagination?: ControlPlaneOperationDescriptor['pagination']; redactedPaths?: string[] },
) {
	const read = method === 'GET';
	const riskClass = options.risk ?? 'ordinary';
	return defineOperation({
		operationId,
		description: `${read ? 'Read' : 'Apply'} ${operationId}.`,
		rest: { method, path },
		...(Object.keys(pathShape).length ? { parameters: `treeseed.${operationId}.parameters/v1` } : {}),
		capability: options.capability,
		authentication: 'oauth',
		oauthScopes: [read ? 'treeseed:read' : 'treeseed:projects:write'],
		kind: read ? 'read' : 'mutation',
		riskClass,
		confirmation: riskClass === 'ordinary' ? 'never' : 'input_required',
		surfaces: ['rest'],
		cacheScope: read ? 'principal' : 'none',
		pagination: options.pagination ?? 'none',
		concurrencyRequired: options.concurrency,
		redactedPaths: options.redactedPaths,
	}, {
		path: z.object(pathShape).strict(), query: read ? record : empty, body: read ? none : record, output: record,
	});
}

export const adminAccountOperations = {
	updateUsername: operation('accounts.username.update', 'PATCH', '/v1/auth/web/username', {}, { capability: 'accounts.write', concurrency: true }),
	notificationPreferences: operation('accounts.notification.preferences.show', 'GET', '/v1/auth/web/notifications/preferences', {}, { capability: 'accounts.read' }),
	updateNotificationPreferences: operation('accounts.notification.preferences.update', 'PUT', '/v1/auth/web/notifications/preferences', {}, { capability: 'accounts.write', concurrency: true }),
	themes: operation('accounts.themes.list', 'GET', '/v1/auth/web/themes', {}, { capability: 'accounts.read', pagination: 'cursor' }),
	createTheme: operation('accounts.themes.create', 'POST', '/v1/auth/web/themes', {}, { capability: 'accounts.write' }),
	updateTheme: operation('accounts.themes.update', 'PUT', '/v1/auth/web/themes/{themeId}', { themeId: z.string().min(1) }, { capability: 'accounts.write', concurrency: true }),
	deleteTheme: operation('accounts.themes.delete', 'DELETE', '/v1/auth/web/themes/{themeId}', { themeId: z.string().min(1) }, { capability: 'accounts.write', risk: 'destructive', concurrency: true }),
	unlinkProvider: operation('accounts.providers.unlink', 'DELETE', '/v1/auth/web/providers/{identityId}', { identityId: z.string().min(1) }, { capability: 'accounts.write', risk: 'credential' }),
} as const;

export const adminTeamOperations = {
	revokeInvite: operation('teams.invites.revoke', 'DELETE', '/v1/teams/{teamId}/invites/{inviteId}', { teamId: z.string().min(1), inviteId: z.string().min(1) }, { capability: 'teams.write', risk: 'destructive', concurrency: true }),
	resendInvite: operation('teams.invites.resend', 'POST', '/v1/teams/{teamId}/invites/{inviteId}/resend', { teamId: z.string().min(1), inviteId: z.string().min(1) }, { capability: 'teams.write' }),
	memberRemovalBlockers: operation('teams.members.removal.blockers', 'GET', '/v1/teams/{teamId}/members/{membershipId}/removal-blockers', { teamId: z.string().min(1), membershipId: z.string().min(1) }, { capability: 'teams.read' }),
	remove: operation('teams.delete', 'DELETE', '/v1/teams/{teamId}/permanent-delete', { teamId: z.string().min(1) }, { capability: 'teams.delete', risk: 'irreversible', concurrency: true, redactedPaths: ['body.confirmation', 'body.currentPassword', 'body.reauthenticationGrantId'] }),
} as const;
