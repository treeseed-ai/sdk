import { spawnSync } from 'node:child_process';

const EXPECTED_PORTS = ['1025->1025/tcp', '8025->8025/tcp'];
const KNOWN_MAILPIT_NAMES = ['treeseed_mailpit', 'docs_mailpit'];

export type TreeseedMailpitContainer = {
	name: string;
	image: string;
	ports: string;
};

type RunDocker = typeof runDocker;

function runDocker(args: string[], options = {}) {
	return spawnSync('docker', args, {
		encoding: 'utf8',
		...options,
	});
}

function parseDockerPsOutput(stdout: string) {
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [name = '', image = '', ports = ''] = line.split('\t');
			return { name, image, ports };
		});
}

function isCompatibleMailpitContainer(container: TreeseedMailpitContainer) {
	const nameMatch = KNOWN_MAILPIT_NAMES.includes(container.name);
	const imageMatch = container.image.includes('mailpit');
	const portsMatch = EXPECTED_PORTS.every((port) => container.ports.includes(port));
	return (nameMatch || imageMatch) && portsMatch;
}

export function dockerIsAvailable() {
	const result = runDocker(['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}']);
	return result.status === 0;
}

function findKnownMailpitContainers({ all = false, run = runDocker }: { all?: boolean; run?: RunDocker } = {}) {
	const args = [
		'ps',
		...(all ? ['-a'] : []),
		'--format',
		'{{.Names}}\t{{.Image}}\t{{.Ports}}',
	];
	const result = run(args);
	if (result.status !== 0) {
		return [];
	}
	return parseDockerPsOutput(result.stdout).filter(isCompatibleMailpitContainer);
}

export function findRunningMailpitContainer(options: { run?: RunDocker } = {}) {
	return findKnownMailpitContainers(options).at(0) ?? null;
}

export function stopKnownMailpitContainers(options: { run?: RunDocker } = {}) {
	const run = options.run ?? runDocker;
	const containers = findKnownMailpitContainers({ all: true, run });
	if (containers.length === 0) {
		return true;
	}

	return containers.every((container) => run(['rm', '-f', container.name]).status === 0);
}

export function streamKnownMailpitLogs() {
	const container = findRunningMailpitContainer();
	if (!container) {
		console.error('No running Mailpit container was found on ports 1025 and 8025.');
		process.exit(1);
	}

	const result = runDocker(['logs', '-f', container.name], { stdio: 'inherit' });
	process.exit(result.status ?? 1);
}
