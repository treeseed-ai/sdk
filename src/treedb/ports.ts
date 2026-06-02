export interface AuthPort {
	whoami(): Promise<unknown>;
	effectiveScope(input?: unknown): Promise<unknown>;
}

export interface RepositoryPort {
	createWorkspace(input: unknown): Promise<unknown>;
	closeWorkspace(workspaceId: string): Promise<void>;
	listTree(input: unknown): Promise<unknown>;
	readFile(input: unknown): Promise<unknown>;
	writeFile(input: unknown): Promise<unknown>;
	patchFile(input: unknown): Promise<unknown>;
	deleteFile(input: unknown): Promise<unknown>;
	search(input: unknown): Promise<unknown>;
	status(input: unknown): Promise<unknown>;
	diff(input: unknown): Promise<unknown>;
	commit(input: unknown): Promise<unknown>;
	exec(input: unknown): Promise<unknown>;
}

export interface RepositoryQueryPort {
	read(input: unknown): Promise<unknown>;
	paths(input: unknown): Promise<unknown>;
	query(input: unknown): Promise<unknown>;
	search(input: unknown): Promise<unknown>;
}

export interface GraphPort {
	refresh(input?: unknown): Promise<unknown>;
	searchFiles(query: string, options?: unknown): Promise<unknown>;
	searchSections(query: string, options?: unknown): Promise<unknown>;
	searchEntities(query: string, options?: unknown): Promise<unknown>;
	getNode(id: string, options?: unknown): Promise<unknown>;
	query(input: unknown): Promise<unknown>;
	buildContext(input: unknown): Promise<unknown>;
	parseDsl(source: string): Promise<unknown>;
}

export interface RegistryPort {
	resolveRepository(repoId: string): Promise<unknown>;
	resolveRepositories(repoIds: string[]): Promise<unknown[]>;
}
