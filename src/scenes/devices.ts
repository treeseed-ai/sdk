import { sceneErrorDiagnostic } from './diagnostics.ts';
import { defaultTreeseedSceneDeviceConfig } from './schema.ts';
import type {
	TreeseedSceneDeviceProfile,
	TreeseedSceneDiagnostic,
	TreeseedSceneManifest,
} from './types.ts';

export { defaultTreeseedSceneDeviceConfig };

export function listTreeseedSceneDeviceProfiles(scene: TreeseedSceneManifest): TreeseedSceneDeviceProfile[] {
	return scene.devices?.profiles?.length ? scene.devices.profiles : defaultTreeseedSceneDeviceConfig().profiles;
}

export function resolveTreeseedSceneDeviceProfile(input: {
	scene: TreeseedSceneManifest;
	device?: string;
}): {
	profile: TreeseedSceneDeviceProfile | null;
	diagnostics: TreeseedSceneDiagnostic[];
} {
	const profiles = listTreeseedSceneDeviceProfiles(input.scene);
	const selected = input.device ?? input.scene.devices?.defaultProfile ?? 'desktop';
	const profile = profiles.find((entry) => entry.id === selected) ?? null;
	if (!profile) {
		return {
			profile: null,
			diagnostics: [sceneErrorDiagnostic('scene.device_unknown', `Unknown scene device profile: ${selected}.`, 'device')],
		};
	}
	return { profile, diagnostics: [] };
}
