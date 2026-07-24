import { sceneErrorDiagnostic, sceneWarningDiagnostic } from '../support/reporting/diagnostics.ts';
import { MarketClient, MarketClientError } from '../../entrypoints/clients/market-client.ts';
import { resolveMachineEnvironmentValues } from '../../operations/services/configuration/config-runtime.ts';
import type { SceneDiagnostic, SceneVisualAuditRole } from '../types.ts';

export const VISUAL_AUDIT_PASSWORD = 'TreeSeedVisualAudit!2026';

export const VISUAL_AUDIT_USERS: Record<string, { email: string; password: string; label: string }> = {
	owner: { email: 'visual.owner@treeseed.io', password: VISUAL_AUDIT_PASSWORD, label: 'Visual Audit Owner' },
	admin: { email: 'visual.admin@treeseed.io', password: VISUAL_AUDIT_PASSWORD, label: 'Visual Audit Admin' },
	member: { email: 'visual.member@treeseed.io', password: VISUAL_AUDIT_PASSWORD, label: 'Visual Audit Member' },
};

export function SceneVisualAuditUserForRole(role: SceneVisualAuditRole) {
	return VISUAL_AUDIT_USERS[role] ?? null;
}

export function validateSceneVisualAuditRoles(roles: SceneVisualAuditRole[]) {
	const diagnostics: SceneDiagnostic[] = [];
	for (const role of roles) {
		if (role === 'anonymous') continue;
		if (!SceneVisualAuditUserForRole(role)) {
			diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_role_unknown', `Visual audit role "${role}" has no built-in fixture login. Routes for this role will be skipped unless a future fixture provider supplies it.`, 'roles'));
		}
	}
	return diagnostics;
}

function usernameForRole(role: SceneVisualAuditRole) {
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
		const values = resolveMachineEnvironmentValues(input.projectRoot, input.environment);
		const value = values?.[name];
		return typeof value === 'string' && value.trim() ? value.trim() : null;
	} catch {
		return null;
	}
}

function serviceHeaders(input?: { projectRoot?: string; environment?: string }) {
	const localDevServiceSecret = input?.environment === 'local' ? 'treeseed-web-service-dev-secret' : null;
	return {
		'content-type': 'application/json',
		'x-treeseed-service-id': configuredValue(input, 'TREESEED_API_WEB_SERVICE_ID') ?? configuredValue(input, 'TREESEED_WEB_SERVICE_ID') ?? 'web',
		'x-treeseed-service-secret':
			process.env.TREESEED_API_WEB_SERVICE_SECRET?.trim()
			?? process.env.TREESEED_WEB_SERVICE_SECRET?.trim()
			?? localDevServiceSecret
			?? configuredValue(input, 'TREESEED_API_WEB_SERVICE_SECRET')
			?? configuredValue(input, 'TREESEED_WEB_SERVICE_SECRET')
			?? 'treeseed-web-service-dev-secret',
	};
}

async function sleep(ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number) {
	return Math.min(500 * attempt, 2000);
}

function isRetryableStatus(status: number) {
	return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function gotoSceneFixturePage(page: any, url: string) {
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
	await page.waitForLoadState?.('networkidle', { timeout: 5000 }).catch(() => undefined);
}

function isSignInUrl(value: string) {
	return /\/auth\/sign-in/u.test(value);
}

function seedActorsForRoles(roles: SceneVisualAuditRole[]) {
	const actors: Record<string, Record<string, unknown>> = {};
	for (const role of roles) {
		const user = SceneVisualAuditUserForRole(role);
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
	roles: SceneVisualAuditRole[];
	projectRoot?: string;
	environment?: string;
}): Promise<SceneDiagnostic[]> {
	const actors = seedActorsForRoles(input.roles);
	if (Object.keys(actors).length === 0) return [];
	let lastFailure: string | null = null;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const response = await fetch(new URL('/v1/acceptance/seed', input.baseUrl).toString(), {
				method: 'POST',
				headers: serviceHeaders(input),
				body: JSON.stringify({
					namespace: 'visual-audit',
					password: VISUAL_AUDIT_PASSWORD,
					actors,
				}),
			});
			const text = await response.text();
			if (response.ok) return [];
			lastFailure = `HTTP ${response.status}: ${text.slice(0, 500)}`;
			if (!isRetryableStatus(response.status) || attempt >= 3) break;
		} catch (error) {
			lastFailure = error instanceof Error ? error.message : String(error ?? 'local fixture API is unavailable');
			if (attempt >= 3) break;
		}
		await sleep(retryDelayMs(attempt));
	}
	return [sceneWarningDiagnostic(
		'scene.visual_audit_fixture_unavailable',
		`Visual audit API fixture seed failed against ${input.baseUrl}: ${lastFailure ?? 'local fixture API is unavailable'}.`,
		'roles',
	)];
}

export async function ensureSceneVisualAuditRoleFixtures(input: {
	baseUrl: string;
	roles: SceneVisualAuditRole[];
	projectRoot?: string;
	environment?: string;
}): Promise<SceneDiagnostic[]> {
	const diagnostics: SceneDiagnostic[] = [];
	const roles = [...new Set(input.roles)].filter((role) => role !== 'anonymous');
	const seedDiagnostics = await seedVisualAuditFixtures({
		baseUrl: input.baseUrl,
		roles,
		projectRoot: input.projectRoot,
		environment: input.environment,
	});
	let roleSetupFailed = false;
	for (const role of roles) {
		const user = SceneVisualAuditUserForRole(role);
		if (!user) continue;
		const client = clientFor(input.baseUrl);
		try {
			await client.webSignIn({ login: user.email, password: user.password });
			continue;
		} catch (error) {
			if (!isAuthFailure(error)) {
				roleSetupFailed = true;
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
				roleSetupFailed = true;
				diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_fixture_unavailable', `Visual audit fixture user ${user.email} requires email confirmation, but the local API did not return a confirmation token.`, 'roles'));
			}
		} catch (error) {
			try {
				await client.webSignIn({ login: user.email, password: user.password });
			} catch {
				roleSetupFailed = true;
				diagnostics.push(sceneWarningDiagnostic(
					'scene.visual_audit_fixture_unavailable',
					`Visual audit fixture setup for ${role} failed against ${input.baseUrl}: ${error instanceof Error ? error.message : String(error ?? 'local fixture API is unavailable')}. Authenticated screenshots require the local API and database to be healthy.`,
					'roles',
				));
			}
		}
	}
	if (roleSetupFailed) diagnostics.unshift(...seedDiagnostics);
	return diagnostics;
}

export async function signInSceneVisualAuditRole(input: {
	page: any;
	baseUrl: string;
	apiBaseUrl?: string | null;
	role: SceneVisualAuditRole;
}): Promise<SceneDiagnostic[]> {
	const user = SceneVisualAuditUserForRole(input.role);
	if (!user) {
		return [sceneErrorDiagnostic('scene.visual_audit_role_unknown', `Visual audit role "${input.role}" has no fixture login.`, 'role')];
	}
	const apiBaseUrl = input.apiBaseUrl?.trim() || input.baseUrl;
	let lastError: unknown = null;
	try {
		for (let attempt = 1; attempt <= 3; attempt += 1) {
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
				await gotoSceneFixturePage(input.page, new URL('/app/', input.baseUrl).toString());
				if (!isSignInUrl(input.page.url())) return [];
			}
			await sleep(retryDelayMs(attempt));
		}
	} catch {
		// Fall back to the browser form below. The direct cookie path is preferred for deterministic visual-audit fixtures.
	}
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const signInUrl = new URL('/auth/sign-in', input.baseUrl);
			signInUrl.searchParams.set('returnTo', '/app/');
			await gotoSceneFixturePage(input.page, signInUrl.toString());
			await input.page.locator('input[name="login"], input[name="email"], input[name="emailOrUsername"], input[name="username"]').first().fill(user.email, { timeout: 10_000 });
			await input.page.locator('input[name="password"]').first().fill(user.password, { timeout: 10_000 });
			await input.page.getByRole('button', { name: /sign in/i }).click({ timeout: 10_000 });
			await input.page.waitForURL?.((url: URL) => !isSignInUrl(url.pathname), { timeout: 15_000 }).catch(() => undefined);
			await input.page.waitForLoadState?.('networkidle', { timeout: 5000 }).catch(() => undefined);
			if (!isSignInUrl(input.page.url())) {
				return [];
			}
			lastError = new Error(`Visual audit login for ${input.role} did not leave the sign-in page. Ensure deterministic fixture user ${user.email} exists.`);
		} catch (error) {
			lastError = error;
		}
		await sleep(retryDelayMs(attempt));
	}
	return [sceneWarningDiagnostic(
		'scene.visual_audit_role_login_failed',
		lastError instanceof Error ? lastError.message : String(lastError ?? `Visual audit login for ${input.role} failed.`),
		'roles',
	)];
}
