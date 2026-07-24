import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export interface LocalTreeDxSeedSource {
	localRoot: string;
	contentPath: string;
	seedPaths?: string[];
}

export interface LocalTreeDxSeedFile {
	path: string;
	content: string;
}

export interface LocalTreeDxSeedVerification {
	verified: boolean;
	desiredFileCount: number;
	verifiedFileCount: number;
	missingPaths: string[];
	mismatchedPaths: string[];
}

export function collectLocalTreeDxSeedFiles(source: LocalTreeDxSeedSource): LocalTreeDxSeedFile[] {
	const files: LocalTreeDxSeedFile[] = [];
	const visit = (absoluteDir: string) => {
		if (!existsSync(absoluteDir)) return;
		for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
			const absolutePath = resolve(absoluteDir, entry.name);
			if (entry.isDirectory()) {
				visit(absolutePath);
			} else if (entry.isFile() && /\.(md|mdx)$/iu.test(entry.name)) {
				files.push({
					path: relative(source.localRoot, absolutePath).replace(/\\/gu, '/'),
					content: readFileSync(absolutePath, 'utf8'),
				});
			}
		}
	};
	for (const seedPath of source.seedPaths?.length ? source.seedPaths : [source.contentPath]) {
		visit(resolve(source.localRoot, seedPath));
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function localTreeDxSeedDigest(source: LocalTreeDxSeedSource) {
	const hash = createHash('sha256');
	for (const file of collectLocalTreeDxSeedFiles(source)) {
		hash.update(file.path);
		hash.update('\0');
		hash.update(file.content);
		hash.update('\0');
	}
	return hash.digest('hex');
}

export function verifyLocalTreeDxSeedFiles(
	desiredFiles: LocalTreeDxSeedFile[],
	observedFiles: LocalTreeDxSeedFile[],
): LocalTreeDxSeedVerification {
	const observedByPath = new Map(observedFiles.map((file) => [file.path, file.content]));
	const missingPaths = desiredFiles
		.filter((file) => !observedByPath.has(file.path))
		.map((file) => file.path);
	const mismatchedPaths = desiredFiles
		.filter((file) => observedByPath.has(file.path) && observedByPath.get(file.path) !== file.content)
		.map((file) => file.path);
	return {
		verified: missingPaths.length === 0 && mismatchedPaths.length === 0,
		desiredFileCount: desiredFiles.length,
		verifiedFileCount: desiredFiles.length - missingPaths.length - mismatchedPaths.length,
		missingPaths,
		mismatchedPaths,
	};
}
