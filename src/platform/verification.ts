import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { PlatformDiagnostic } from './schemas.ts';

export interface PlatformVerification { schemaVersion: 'treeseed.platform-verification/v1'; root: string; digest: string; ok: boolean; diagnostics: PlatformDiagnostic[] }

const allowedRoots = new Set(['.github', 'config', 'docs', 'profiles', 'seeds', 'templates']);
const allowedFiles = new Set(['.gitignore', 'AGENTS.md', 'LICENSE', 'LICENSE.md', 'README.md', 'treeseed.site.yaml']);
const allowedExtensions = new Set(['.md', '.yaml', '.yml', '.json', '.lock', '.toml']);
const forbiddenExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.sh', '.go', '.rs', '.java']);
const personalPath = /(?:^|[\s'"`:=])(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/u;

export function verifyPlatformRepository(root = process.cwd()): PlatformVerification {
	const absoluteRoot = resolve(root);
	const listed = execFileSync('git', ['ls-files', '-z'], { cwd: absoluteRoot, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
	const diagnostics: PlatformDiagnostic[] = [];
	const hash = createHash('sha256');
	for (const path of listed) {
		const fullPath = resolve(absoluteRoot, path);
		if (!fullPath.startsWith(`${absoluteRoot}/`) || lstatSync(fullPath).isSymbolicLink()) {
			diagnostics.push({ code: 'path_not_portable', path, message: 'Tracked paths must stay beneath the repository and cannot be symbolic links.' });
			continue;
		}
		const rootSegment = path.split('/')[0];
		const extension = extname(path);
		if (!allowedFiles.has(path) && !allowedRoots.has(rootSegment)) diagnostics.push({ code: 'content_root_forbidden', path, message: 'Platform may contain only declarations, documentation, locks, and GitHub configuration.' });
		if (forbiddenExtensions.has(extension)) diagnostics.push({ code: 'implementation_forbidden', path, message: 'Executable implementation belongs in its owning package.' });
		if (!allowedFiles.has(path) && !allowedExtensions.has(extension)) diagnostics.push({ code: 'file_type_forbidden', path, message: 'This tracked file type is outside the declarative Platform boundary.' });
		if (existsSync(fullPath)) {
			const source = readFileSync(fullPath);
			hash.update(relative(absoluteRoot, fullPath)).update('\0').update(source);
			if (personalPath.test(source.toString('utf8'))) diagnostics.push({ code: 'personal_path_forbidden', path, message: 'Committed home-directory paths are forbidden.' });
		}
	}
	return { schemaVersion: 'treeseed.platform-verification/v1', root: absoluteRoot, digest: `sha256:${hash.digest('hex')}`, ok: diagnostics.length === 0, diagnostics };
}
