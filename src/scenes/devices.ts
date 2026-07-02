import { sceneErrorDiagnostic } from './diagnostics.ts';
import { defaultTreeseedSceneDeviceConfig } from './schema.ts';
import type {
	TreeseedSceneDeviceProfile,
	TreeseedSceneDiagnostic,
	TreeseedSceneManifest,
} from './types.ts';

export { defaultTreeseedSceneDeviceConfig };

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

export function listTreeseedSceneDeviceProfiles(scene: TreeseedSceneManifest): TreeseedSceneDeviceProfile[] {
	const sceneProfiles = scene.devices?.profiles ?? [];
	if (sceneProfiles.length === 0) return defaultTreeseedSceneDeviceConfig().profiles;
	const seen = new Set(sceneProfiles.map((entry) => entry.id));
	return [
		...sceneProfiles,
		...defaultTreeseedSceneDeviceConfig().profiles.filter((entry) => !seen.has(entry.id)),
	];
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
	const normalized = LEGACY_DEVICE_PROFILE_ALIASES[selected] ?? selected;
	const profile = profiles.find((entry) => entry.id === normalized)
		?? (selected in LEGACY_DEVICE_PROFILE_ALIASES
			? profiles.find((entry) => entry.id === input.scene.devices?.defaultProfile) ?? profiles[0] ?? null
			: null);
	if (!profile) {
		return {
			profile: null,
			diagnostics: [sceneErrorDiagnostic('scene.device_unknown', `Unknown scene device profile: ${selected}.`, 'device')],
		};
	}
	return { profile, diagnostics: [] };
}
