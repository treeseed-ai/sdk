import { sceneErrorDiagnostic, sceneWarningDiagnostic } from './diagnostics.ts';
import { MarketClient, MarketClientError } from '../market-client.ts';
import { resolveTreeseedMachineEnvironmentValues } from '../operations/services/config-runtime.ts';
import type { TreeseedSceneDiagnostic, TreeseedSceneVisualAuditRole } from './types.ts';

export const TREESEED_VISUAL_AUDIT_PASSWORD = 'TreeSeedVisualAudit!2026';

export const TREESEED_VISUAL_AUDIT_USERS: Record<string, { email: string; password: string; label: string }> = {
	owner: { email: 'visual.owner@treeseed.io', password: TREESEED_VISUAL_AUDIT_PASSWORD, label: 'Visual Audit Owner' },
	admin: { email: 'visual.admin@treeseed.io', password: TREESEED_VISUAL_AUDIT_PASSWORD, label: 'Visual Audit Admin' },
	member: { email: 'visual.member@treeseed.io', password: TREESEED_VISUAL_AUDIT_PASSWORD, label: 'Visual Audit Member' },
};

export function treeseedSceneVisualAuditUserForRole(role: TreeseedSceneVisualAuditRole) {
	return TREESEED_VISUAL_AUDIT_USERS[role] ?? null;
}

export function validateTreeseedSceneVisualAuditRoles(roles: TreeseedSceneVisualAuditRole[]) {
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	for (const role of roles) {
		if (role === 'anonymous') continue;
		if (!treeseedSceneVisualAuditUserForRole(role)) {
			diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_role_unknown', `Visual audit role "${role}" has no built-in fixture login. Routes for this role will be skipped unless a future fixture provider supplies it.`, 'roles'));
		}
	}
	return diagnostics;
}

function usernameForRole(role: TreeseedSceneVisualAuditRole) {
	return `visual-${role}`;
}

function clientFor(baseUrl: string, accessToken?: string | null) {
	return new MarketClient({
		profile: {
			id: 'visual-audit-local',
			label: 'Visual audit local',
			baseUrl,
			kind: 'specialized',
		},
		accessToken: accessToken ?? undefined,
		userAgent: 'treeseed-scene-visual-audit',
	});
}

function isAuthFailure(error: unknown) {
	if (error instanceof MarketClientError) return error.status === 400 || error.status === 401 || error.status === 403 || error.status === 409;
	return false;
}

function configuredValue(input: { projectRoot?: string; environment?: string } | undefined, name: string) {
	const envValue = process.env[name];
	if (typeof envValue === 'string' && envValue.trim()) return envValue.trim();
	if (!input?.projectRoot || !input.environment) return null;
	try {
		const values = resolveTreeseedMachineEnvironmentValues(input.projectRoot, input.environment);
		const value = values?.[name];
		return typeof value === 'string' && value.trim() ? value.trim() : null;
	} catch {
		return null;
	}
}

function serviceHeaders(input?: { projectRoot?: string; environment?: string }) {
	return {
		'content-type': 'application/json',
		'x-treeseed-service-id': configuredValue(input, 'TREESEED_API_WEB_SERVICE_ID') ?? configuredValue(input, 'TREESEED_WEB_SERVICE_ID') ?? 'web',
		'x-treeseed-service-secret':
			configuredValue(input, 'TREESEED_API_WEB_SERVICE_SECRET')
			?? configuredValue(input, 'TREESEED_WEB_SERVICE_SECRET')
			?? 'treeseed-web-service-dev-secret',
	};
}

function seedActorsForRoles(roles: TreeseedSceneVisualAuditRole[]) {
	const actors: Record<string, Record<string, unknown>> = {};
	for (const role of roles) {
		const user = treeseedSceneVisualAuditUserForRole(role);
		if (!user) continue;
		actors[role] = {
			email: user.email,
			username: usernameForRole(role),
			displayName: user.label,
			siteRoles: role === 'admin' ? ['member'] : ['member'],
			teamRole: role === 'owner' ? 'team_owner' : role === 'admin' ? 'project_lead' : 'contributor',
		};
	}
	return actors;
}

async function seedVisualAuditFixtures(input: {
	baseUrl: string;
	roles: TreeseedSceneVisualAuditRole[];
	projectRoot?: string;
	environment?: string;
}): Promise<TreeseedSceneDiagnostic[]> {
	const actors = seedActorsForRoles(input.roles);
	if (Object.keys(actors).length === 0) return [];
	try {
		const response = await fetch(new URL('/v1/acceptance/seed', input.baseUrl).toString(), {
			method: 'POST',
			headers: serviceHeaders(input),
			body: JSON.stringify({
				namespace: 'visual-audit',
				password: TREESEED_VISUAL_AUDIT_PASSWORD,
				actors,
			}),
		});
		const text = await response.text();
		if (!response.ok) {
			return [sceneWarningDiagnostic(
				'scene.visual_audit_fixture_unavailable',
				`Visual audit API fixture seed failed with HTTP ${response.status}: ${text.slice(0, 500)}`,
				'roles',
			)];
		}
		return [];
	} catch (error) {
		return [sceneWarningDiagnostic(
			'scene.visual_audit_fixture_unavailable',
			`Visual audit API fixture seed failed against ${input.baseUrl}: ${error instanceof Error ? error.message : String(error ?? 'local fixture API is unavailable')}.`,
			'roles',
		)];
	}
}

export async function ensureTreeseedSceneVisualAuditRoleFixtures(input: {
	baseUrl: string;
	roles: TreeseedSceneVisualAuditRole[];
	projectRoot?: string;
	environment?: string;
}): Promise<TreeseedSceneDiagnostic[]> {
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	const roles = [...new Set(input.roles)].filter((role) => role !== 'anonymous');
	diagnostics.push(...await seedVisualAuditFixtures({
		baseUrl: input.baseUrl,
		roles,
		projectRoot: input.projectRoot,
		environment: input.environment,
	}));
	for (const role of roles) {
		const user = treeseedSceneVisualAuditUserForRole(role);
		if (!user) continue;
		const client = clientFor(input.baseUrl);
		try {
			await client.webSignIn({ login: user.email, password: user.password });
			continue;
		} catch (error) {
			if (!isAuthFailure(error)) {
				diagnostics.push(sceneWarningDiagnostic(
					'scene.visual_audit_fixture_unavailable',
					`Visual audit fixture setup for ${role} failed against ${input.baseUrl}: ${error instanceof Error ? error.message : String(error ?? 'local fixture API is unavailable')}. Authenticated screenshots require the local API and database to be healthy.`,
					'roles',
				));
				continue;
			}
		}
		try {
			const [firstName = 'Visual', lastName = String(role)] = user.label.split(/\s+/u);
			const signup = await client.webSignUp({
				email: user.email,
				username: usernameForRole(role),
				password: user.password,
				firstName,
				lastName,
				name: user.label,
			});
			const payload = signup.payload as typeof signup.payload & { confirmationToken?: string | null; confirmationRequired?: boolean };
			if (payload.confirmationToken) {
				await client.confirmWebEmail({ token: payload.confirmationToken });
			} else if (payload.confirmationRequired) {
				diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_fixture_unavailable', `Visual audit fixture user ${user.email} requires email confirmation, but the local API did not return a confirmation token.`, 'roles'));
			}
		} catch (error) {
			try {
				await client.webSignIn({ login: user.email, password: user.password });
			} catch {
				diagnostics.push(sceneWarningDiagnostic(
					'scene.visual_audit_fixture_unavailable',
					`Visual audit fixture setup for ${role} failed against ${input.baseUrl}: ${error instanceof Error ? error.message : String(error ?? 'local fixture API is unavailable')}. Authenticated screenshots require the local API and database to be healthy.`,
					'roles',
				));
			}
		}
	}
	return diagnostics;
}

export async function signInTreeseedSceneVisualAuditRole(input: {
	page: any;
	baseUrl: string;
	apiBaseUrl?: string | null;
	role: TreeseedSceneVisualAuditRole;
}): Promise<TreeseedSceneDiagnostic[]> {
	const user = treeseedSceneVisualAuditUserForRole(input.role);
	if (!user) {
		return [sceneErrorDiagnostic('scene.visual_audit_role_unknown', `Visual audit role "${input.role}" has no fixture login.`, 'role')];
	}
	const apiBaseUrl = input.apiBaseUrl?.trim() || input.baseUrl;
	try {
		const session = await clientFor(apiBaseUrl).webSignIn({ login: user.email, password: user.password });
			const accessToken = session.payload.accessToken;
			if (accessToken) {
			const webUrl = new URL(input.baseUrl);
			await input.page.context().addCookies([{
				name: 'ts_market_api_access',
				value: accessToken,
				domain: webUrl.hostname,
				path: '/',
				httpOnly: true,
				secure: webUrl.protocol === 'https:',
				sameSite: 'Lax',
				expires: Math.floor(Date.now() / 1000) + Number(session.payload.expiresInSeconds ?? 900),
			}]);
			await input.page.goto(new URL('/app/', input.baseUrl).toString(), { waitUntil: 'networkidle', timeout: 20000 });
			if (!/\/auth\/sign-in/u.test(input.page.url())) return [];
		}
	} catch {
		// Fall back to the browser form below. The direct cookie path is preferred for deterministic visual-audit fixtures.
	}
	try {
		await input.page.goto(new URL('/auth/sign-in', input.baseUrl).toString(), { waitUntil: 'networkidle', timeout: 20000 });
		await input.page.locator('input[name="login"], input[name="email"], input[name="emailOrUsername"], input[name="username"]').first().fill(user.email, { timeout: 5000 });
		await input.page.locator('input[name="password"]').first().fill(user.password, { timeout: 5000 });
		await input.page.getByRole('button', { name: /sign in/i }).click({ timeout: 5000 });
		await input.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
		const url = input.page.url();
		if (/\/auth\/sign-in/u.test(url)) {
			return [sceneWarningDiagnostic('scene.visual_audit_role_login_failed', `Visual audit login for ${input.role} did not leave the sign-in page. Ensure deterministic fixture user ${user.email} exists.`, 'roles')];
		}
		return [];
	} catch (error) {
		return [sceneWarningDiagnostic('scene.visual_audit_role_login_failed', error instanceof Error ? error.message : String(error ?? `Visual audit login for ${input.role} failed.`), 'roles')];
	}
}
