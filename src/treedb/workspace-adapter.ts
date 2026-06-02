import { TreeDbApiError } from './errors.ts';
import { TreeDbClient } from './client.ts';
import type {
	TreeDbCommitRequest,
	TreeDbCommitResult,
	TreeDbCreateWorkspaceRequest,
	TreeDbDiff,
	TreeDbExecRequest,
	TreeDbExecResult,
	TreeDbFile,
	TreeDbFileMutationResult,
	TreeDbListTreeRequest,
	TreeDbPatchFileRequest,
	TreeDbReadFileRequest,
	TreeDbSearchRequest,
	TreeDbSearchResult,
	TreeDbStatus,
	TreeDbTreeEntry,
	TreeDbWorkspace,
	TreeDbWriteFileRequest,
	TreeDbDeleteFileRequest,
} from './types.ts';

export interface TreeDbWorkspaceAdapterOptions {
	client: TreeDbClient;
	repoId: string;
	workspaceId?: string;
}

export class TreeDbWorkspaceAdapter {
	private workspaceId?: string;

	constructor(private readonly options: TreeDbWorkspaceAdapterOptions) {
		this.workspaceId = options.workspaceId;
	}

	async create(input: TreeDbCreateWorkspaceRequest): Promise<TreeDbWorkspace> {
		const workspace = await this.options.client.createWorkspace({ ...input, repoId: input.repoId ?? this.options.repoId });
		this.workspaceId = workspace.workspaceId;
		return workspace;
	}

	close(workspaceId = this.requireWorkspaceId()): Promise<void> {
		return this.options.client.closeWorkspace(workspaceId);
	}

	listTree(path = ''): Promise<TreeDbTreeEntry[]> {
		return this.options.client.listTree({ workspaceId: this.requireWorkspaceId(), path });
	}

	readFile(path: string): Promise<TreeDbFile> {
		return this.options.client.readFile({ workspaceId: this.requireWorkspaceId(), path });
	}

	writeFile(path: string, content: string, options: Omit<TreeDbWriteFileRequest, 'workspaceId' | 'path' | 'content'> = {}): Promise<TreeDbFileMutationResult> {
		return this.options.client.writeFile({ ...options, workspaceId: this.requireWorkspaceId(), path, content });
	}

	patchFile(path: string, patch: string, options: Omit<TreeDbPatchFileRequest, 'workspaceId' | 'path' | 'patch'> = {}): Promise<TreeDbFileMutationResult> {
		return this.options.client.patchFile({ ...options, workspaceId: this.requireWorkspaceId(), path, patch });
	}

	deleteFile(path: string, options: Omit<TreeDbDeleteFileRequest, 'workspaceId' | 'path'> = {}): Promise<TreeDbFileMutationResult> {
		return this.options.client.deleteFile({ ...options, workspaceId: this.requireWorkspaceId(), path });
	}

	search(input: Omit<TreeDbSearchRequest, 'workspaceId'>): Promise<TreeDbSearchResult> {
		return this.options.client.search({ ...input, workspaceId: this.requireWorkspaceId() });
	}

	status(): Promise<TreeDbStatus> {
		return this.options.client.status({ workspaceId: this.requireWorkspaceId() });
	}

	diff(): Promise<TreeDbDiff> {
		return this.options.client.diff({ workspaceId: this.requireWorkspaceId() });
	}

	commit(input: Omit<TreeDbCommitRequest, 'workspaceId'>): Promise<TreeDbCommitResult> {
		return this.options.client.commit({ ...input, workspaceId: this.requireWorkspaceId() });
	}

	exec(input: Omit<TreeDbExecRequest, 'workspaceId'>): Promise<TreeDbExecResult> {
		return this.options.client.exec({ ...input, workspaceId: this.requireWorkspaceId() });
	}

	rawListTree(input: TreeDbListTreeRequest) {
		return this.options.client.listTree(input);
	}

	rawReadFile(input: TreeDbReadFileRequest) {
		return this.options.client.readFile(input);
	}

	private requireWorkspaceId() {
		if (!this.workspaceId) {
			throw new TreeDbApiError('TreeDB workspace ID is required.', {
				status: 400,
				code: 'workspace_required',
			});
		}
		return this.workspaceId;
	}
}
