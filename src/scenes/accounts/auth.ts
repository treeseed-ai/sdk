import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { resolveMarketProfile, resolveMarketSession } from '../../entrypoints/clients/market-client.ts';
import { findNearestRoot } from '../../operations/workflow-support.ts';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import type { SceneAuthReport, SceneAuthResolveOptions } from '../types.ts';

export function resolveSceneAuth(input: SceneAuthResolveOptions): SceneAuthReport {
	const required = input.scene.setup.auth?.required === true;
	const role = input.scene.setup.auth?.role?.trim();
	const selector = input.scene.setup.auth?.profile ?? (input.environment === 'local' ? 'local' : null);
	const profile = resolveMarketProfile(selector);
	const authRoot = findNearestRoot(input.projectRoot) ?? resolve(process.env.HOME || homedir());
	const session = resolveMarketSession(authRoot, profile.id);
	const diagnostics = [];
	if (required && !session?.accessToken && (!role || role === 'anonymous')) {
		diagnostics.push(sceneErrorDiagnostic('scene.auth_required', `Not logged in to market "${profile.id}". Run treeseed auth:login --market ${profile.id}.`, 'setup.auth'));
	}
	return {
		ok: diagnostics.length === 0,
		required,
		profileId: profile.id,
		authRoot,
		hasSession: Boolean(session?.accessToken),
		diagnostics,
	};
}
