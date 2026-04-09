export interface GitMutationResult {
    branchName: string;
    commitMessage: string;
    worktreePath: string;
    commitSha: string | null;
    changedPaths: string[];
}
export declare class GitRuntime {
    private readonly repoRoot;
    private readonly disabled;
    constructor(repoRoot: string, disabled?: boolean);
    currentBranch(): Promise<string>;
    ensureWorktree(branchName: string): Promise<string>;
    commitFileChange(filePath: string, branchName: string, commitMessage: string): Promise<GitMutationResult>;
    commitFileChanges(filePaths: string[], branchName: string, commitMessage: string): Promise<GitMutationResult>;
}
