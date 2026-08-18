export type PackageBootstrapInput = {
	workspaceRoot: string;
	packageId: string;
	name: string;
	repository: string;
	path: string;
	kind: 'node-typescript';
	type: string;
	license: 'Apache-2.0';
	template: 'metadata';
	defaultBranch: 'main';
	execute: boolean;
	remoteUrl?: string;
};

export type PackageBootstrapAction = {
	kind: 'create_checkout' | 'render_scaffold' | 'install_lockfile' | 'commit' | 'push' | 'register_submodule';
	target: string;
};

export type PackageBootstrapResult = {
	mode: 'plan' | 'execute';
	status: 'planned' | 'created' | 'recovered' | 'unchanged';
	packageId: string;
	repository: string;
	remoteUrl: string;
	path: string;
	branch: 'main';
	commitSha: string | null;
	actions: PackageBootstrapAction[];
	files: string[];
};
