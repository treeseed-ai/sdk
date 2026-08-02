import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import { defaultSceneDeviceConfig } from '../support/validation/schema.ts';
import type {
SceneDeviceProfile,
SceneDiagnostic,
SceneManifest,
} from '../types.ts';

export { defaultSceneDeviceConfig };

const LEGACY_DEVICE_PROFILE_ALIASES: Record<string, string> = {
	desktop_chromium: 'desktop',
	desktop_firefox: 'desktop',
	desktop_webkit: 'desktop',
	tablet_chromium: 'tablet',
	tablet_firefox: 'tablet',
	tablet_webkit: 'tablet',
	mobile_chromium: 'mobile',
	mobile_firefox: 'mobile',
	mobile_webkit: 'mobile',
};

export function listSceneDeviceProfiles(scene: SceneManifest): SceneDeviceProfile[] {
	const sceneProfiles = scene.devices?.profiles ?? [];
	if (sceneProfiles.length === 0) return defaultSceneDeviceConfig().profiles;
	return sceneProfiles;
}

export function resolveSceneDeviceProfile(input: {
	scene: SceneManifest;
	device?: string;
}): {
	profile: SceneDeviceProfile | null;
	diagnostics: SceneDiagnostic[];
} {
	const profiles = listSceneDeviceProfiles(input.scene);
	const selected = input.device ?? input.scene.devices?.defaultProfile ?? 'desktop';
	const normalized = LEGACY_DEVICE_PROFILE_ALIASES[selected] ?? selected;
	const profile = profiles.find((entry) => entry.id === selected)
		?? profiles.find((entry) => entry.id === normalized)
		?? profiles.find((entry) => LEGACY_DEVICE_PROFILE_ALIASES[entry.id] === selected)
		?? null;
	if (!profile) {
		return {
			profile: null,
			diagnostics: [sceneErrorDiagnostic('scene.device_unknown', `Unknown scene device profile: ${selected}.`, 'device')],
		};
	}
	return { profile, diagnostics: [] };
}
