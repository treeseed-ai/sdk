import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { resolveMarketProfile, resolveMarketSession } from '../market-client.ts';
import { findNearestTreeseedRoot } from '../workflow-support.ts';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import type { TreeseedSceneAuthReport, TreeseedSceneAuthResolveOptions } from './types.ts';

export function resolveTreeseedSceneAuth(input: TreeseedSceneAuthResolveOptions): TreeseedSceneAuthReport {
	const required = input.scene.setup.auth?.required === true;
	const selector = input.scene.setup.auth?.profile ?? (input.environment === 'local' ? 'local' : null);
	const profile = resolveMarketProfile(selector);
	const authRoot = findNearestTreeseedRoot(input.projectRoot) ?? resolve(process.env.HOME || homedir());
	const session = resolveMarketSession(authRoot, profile.id);
	const diagnostics = [];
	if (required && !session?.accessToken) {
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
