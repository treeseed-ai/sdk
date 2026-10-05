export interface PackageReleaseVersion {
	version: string;
	channel: 'stable' | 'prerelease';
	npmDistTag: 'latest' | 'rc';
}

const stablePattern = /^\d+\.\d+\.\d+$/u;
const releaseCandidatePattern = /^\d+\.\d+\.\d+-rc\.[1-9]\d*$/u;

export function packageReleaseVersion(version: string): PackageReleaseVersion {
	if (stablePattern.test(version)) return { version, channel: 'stable', npmDistTag: 'latest' };
	if (releaseCandidatePattern.test(version)) return { version, channel: 'prerelease', npmDistTag: 'rc' };
	throw new Error(`Unsupported SDK release version "${version}". Expected X.Y.Z or X.Y.Z-rc.N with N greater than zero.`);
}

export function assertPackageReleaseTag(tagName: string, packageVersion: string) {
	const release = packageReleaseVersion(tagName);
	if (tagName !== packageVersion) {
		throw new Error(`Release tag version "${tagName}" does not match @treeseed/sdk version "${packageVersion}".`);
	}
	return release;
}
