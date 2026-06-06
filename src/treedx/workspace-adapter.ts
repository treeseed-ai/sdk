import { TreeDxApiError } from './errors.ts';
import { TreeDxClient } from './client.ts';
import type {
	TreeDxCommitRequest,
	TreeDxCommitResult,
	TreeDxCreateWorkspaceRequest,
	TreeDxDiff,
	TreeDxExecRequest,
	TreeDxExecResult,
	TreeDxFile,
	TreeDxFileMutationResult,
	TreeDxListTreeRequest,
	TreeDxPatchFileRequest,
	TreeDxReadFileRequest,
	TreeDxSearchRequest,
	TreeDxSearchResult,
	TreeDxStatus,
	TreeDxTreeEntry,
	TreeDxWorkspace,
	TreeDxWriteFileRequest,
	TreeDxDeleteFileRequest,
} from './types.ts';

export interface TreeDxWorkspaceAdapterOptions {
	client: TreeDxClient;
	repoId: string;
	workspaceId?: string;
}

export class TreeDxWorkspaceAdapter {
	private workspaceId?: string;

	constructor(private readonly options: TreeDxWorkspaceAdapterOptions) {
		this.workspaceId = options.workspaceId;
	}

	async create(input: TreeDxCreateWorkspaceRequest): Promise<TreeDxWorkspace> {
		const workspace = await this.options.client.createWorkspace({ ...input, repoId: input.repoId ?? this.options.repoId });
		this.workspaceId = workspace.workspaceId;
		return workspace;
	}

	close(workspaceId = this.requireWorkspaceId()): Promise<void> {
		return this.options.client.closeWorkspace(workspaceId);
	}

	listTree(path = ''): Promise<TreeDxTreeEntry[]> {
		return this.options.client.listTree({ workspaceId: this.requireWorkspaceId(), path });
	}

	readFile(path: string): Promise<TreeDxFile> {
		return this.options.client.readFile({ workspaceId: this.requireWorkspaceId(), path });
	}

	writeFile(path: string, content: string, options: Omit<TreeDxWriteFileRequest, 'workspaceId' | 'path' | 'content'> = {}): Promise<TreeDxFileMutationResult> {
		return this.options.client.writeFile({ ...options, workspaceId: this.requireWorkspaceId(), path, content });
	}

	patchFile(path: string, patch: string, options: Omit<TreeDxPatchFileRequest, 'workspaceId' | 'path' | 'patch'> = {}): Promise<TreeDxFileMutationResult> {
		return this.options.client.patchFile({ ...options, workspaceId: this.requireWorkspaceId(), path, patch });
	}

	deleteFile(path: string, options: Omit<TreeDxDeleteFileRequest, 'workspaceId' | 'path'> = {}): Promise<TreeDxFileMutationResult> {
		return this.options.client.deleteFile({ ...options, workspaceId: this.requireWorkspaceId(), path });
	}

	search(input: Omit<TreeDxSearchRequest, 'workspaceId'>): Promise<TreeDxSearchResult> {
		return this.options.client.search({ ...input, workspaceId: this.requireWorkspaceId() });
	}

	status(): Promise<TreeDxStatus> {
		return this.options.client.status({ workspaceId: this.requireWorkspaceId() });
	}

	diff(): Promise<TreeDxDiff> {
		return this.options.client.diff({ workspaceId: this.requireWorkspaceId() });
	}

	commit(input: Omit<TreeDxCommitRequest, 'workspaceId'>): Promise<TreeDxCommitResult> {
		return this.options.client.commit({ ...input, workspaceId: this.requireWorkspaceId() });
	}

	exec(input: Omit<TreeDxExecRequest, 'workspaceId'>): Promise<TreeDxExecResult> {
		return this.options.client.exec({ ...input, workspaceId: this.requireWorkspaceId() });
	}

	rawListTree(input: TreeDxListTreeRequest) {
		return this.options.client.listTree(input);
	}

	rawReadFile(input: TreeDxReadFileRequest) {
		return this.options.client.readFile(input);
	}

	private requireWorkspaceId() {
		if (!this.workspaceId) {
			throw new TreeDxApiError('TreeDX workspace ID is required.', {
				status: 400,
				code: 'workspace_required',
			});
		}
		return this.workspaceId;
	}
}
