export type ManagedWorkspaceFile = readonly [path: string, content: string];

export function managedWorkspacePaths(files: readonly ManagedWorkspaceFile[]) {
	return files.map(([path]) => path).sort();
}

export function managedWorkspaceMatches(input: {
	expected: readonly ManagedWorkspaceFile[];
	observed: ReadonlyMap<string, string>;
	declaredManagedPaths?: readonly string[] | null;
	legacyObservedPaths?: readonly string[];
}) {
	const expectedPaths = managedWorkspacePaths(input.expected);
	if (input.declaredManagedPaths) {
		const declared = [...input.declaredManagedPaths].sort();
		if (declared.length !== expectedPaths.length || declared.some((path, index) => path !== expectedPaths[index])) return false;
	} else {
		const observed = [...(input.legacyObservedPaths ?? [])].sort();
		if (observed.length !== expectedPaths.length || observed.some((path, index) => path !== expectedPaths[index])) return false;
	}
	return input.expected.every(([path, content]) => input.observed.get(path) === content.trimEnd());
}

export function staleManagedWorkspacePaths(previous: readonly string[] | null | undefined, desired: readonly string[]) {
	const desiredPaths = new Set(desired);
	return [...new Set(previous ?? [])].filter((path) => !desiredPaths.has(path)).sort();
}

export function missingApplicationBootstrapFiles(existingPaths: readonly string[], bootstrap: readonly ManagedWorkspaceFile[]) {
	const existing = new Set(existingPaths);
	return bootstrap.filter(([path]) => !existing.has(path));
}
