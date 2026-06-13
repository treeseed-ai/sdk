import { classifyTreeseedGitMode, runTreeseedGitText } from './git-runner.ts';

function runGit(args: string[], options: { cwd: string; capture?: boolean; timeoutMs?: number; maxBuffer?: number }) {
	return runTreeseedGitText(args, {
		cwd: options.cwd,
		mode: classifyTreeseedGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

export type GitRemoteWriteMode = 'ssh-pushurl' | 'off';

function normalizeRemote(remoteUrl: string | null | undefined) {
	return String(remoteUrl ?? '').trim();
}

export function sshPushUrlForRemote(remoteUrl: string | null | undefined) {
	const remote = normalizeRemote(remoteUrl).replace(/^git\+/u, '');
	if (!remote || remote.startsWith('/') || remote.startsWith('./') || remote.startsWith('../')) {
		return null;
	}
	if (/^(?:file|ssh):\/\//u.test(remote) || /^git@[^:]+:.+/u.test(remote)) {
		return null;
	}
	const httpsMatch = remote.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/u);
	if (!httpsMatch) {
		return null;
	}
	return `git@${httpsMatch[1]}:${httpsMatch[2]}.git`;
}

export function configuredPushUrl(repoDir: string, remoteName = 'origin') {
	try {
		return runGit(['config', '--get', `remote.${remoteName}.pushurl`], { cwd: repoDir, capture: true }).trim() || null;
	} catch {
		return null;
	}
}

export function remoteWriteUrl(repoDir: string, remoteName = 'origin') {
	const pushUrl = configuredPushUrl(repoDir, remoteName);
	if (pushUrl) return pushUrl;
	try {
		return runGit(['remote', 'get-url', remoteName], { cwd: repoDir, capture: true }).trim() || null;
	} catch {
		return null;
	}
}

export function ensureSshPushUrlForOrigin(repoDir: string, remoteUrl: string | null | undefined, mode: GitRemoteWriteMode = 'ssh-pushurl') {
	if (mode === 'off') {
		return { changed: false, pushUrl: configuredPushUrl(repoDir), reason: 'disabled' };
	}
	const nextPushUrl = sshPushUrlForRemote(remoteUrl);
	if (!nextPushUrl) {
		return { changed: false, pushUrl: configuredPushUrl(repoDir), reason: 'not-https' };
	}
	const currentPushUrl = configuredPushUrl(repoDir);
	if (currentPushUrl === nextPushUrl) {
		return { changed: false, pushUrl: currentPushUrl, reason: 'already-configured' };
	}
	runGit(['remote', 'set-url', '--push', 'origin', nextPushUrl], { cwd: repoDir });
	return { changed: true, pushUrl: nextPushUrl, reason: currentPushUrl ? 'updated' : 'configured' };
}
