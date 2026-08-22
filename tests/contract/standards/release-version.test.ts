import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPackageReleaseTag, packageReleaseVersion } from '../../../scripts/packages/release-version.ts';

describe('SDK release version policy', () => {
	it('keeps stable releases on latest', () => {
		expect(packageReleaseVersion('0.13.0')).toEqual({ version: '0.13.0', channel: 'stable', npmDistTag: 'latest' });
	});

	it('routes release candidates to the rc dist-tag', () => {
		expect(packageReleaseVersion('0.13.0-rc.1')).toEqual({ version: '0.13.0-rc.1', channel: 'prerelease', npmDistTag: 'rc' });
	});

	it('rejects unsupported prerelease channels and zero-numbered candidates', () => {
		expect(() => packageReleaseVersion('0.13.0-beta.1')).toThrow('Unsupported SDK release version');
		expect(() => packageReleaseVersion('0.13.0-rc.0')).toThrow('Unsupported SDK release version');
	});

	it('requires the immutable tag to equal the package version', () => {
		expect(() => assertPackageReleaseTag('0.13.0-rc.2', '0.13.0-rc.1')).toThrow('does not match');
	});

	it('gates publication on exact SDK evidence and registry read-back without coupling to a consumer repository', () => {
		const root = resolve(import.meta.dirname, '../../..');
		const workflow = readFileSync(resolve(root, '.github/workflows/publish.yml'), 'utf8');
		const publisher = readFileSync(resolve(root, 'scripts/packages/publish-package.ts'), 'utf8');
		expect(workflow).toContain('npm run standards:baseline');
		expect(workflow).not.toContain('standards:consumer');
		expect(workflow).not.toContain('treeseed-ai/api');
		expect(workflow).toContain('npm run standards:release-evidence');
		expect(workflow).toContain('npm run release:readback');
		expect(workflow).not.toMatch(/actions\/(?:checkout|setup-node|upload-artifact)@v4/u);
		expect(publisher).toContain(".treeseed/standards/release-evidence.json");
		expect(publisher).toContain("['publish', packageArtifact");
	});
});
