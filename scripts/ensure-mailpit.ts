import { spawnSync } from 'node:child_process';
import { dockerIsAvailable, findRunningMailpitContainer } from '../src/operations/services/mailpit-runtime.ts';
import { packageRoot } from '../src/operations/services/runtime-paths.ts';

function mailpitConfig() {
	return {
		containerName: process.env.TREESEED_MAILPIT_CONTAINER_NAME?.trim() || 'treeseed_mailpit',
		smtpPort: process.env.TREESEED_MAILPIT_SMTP_PORT?.trim() || '1025',
		uiPort: process.env.TREESEED_MAILPIT_UI_PORT?.trim() || '8025',
	};
}

if (!dockerIsAvailable()) {
	console.error('Docker is required for Treeseed form email testing. Start Docker and rerun the Mailpit command.');
	process.exit(1);
}

const existingMailpit = findRunningMailpitContainer();
const config = mailpitConfig();
if (existingMailpit) {
	console.log(`Reusing existing Mailpit container "${existingMailpit.name}" on ports ${config.smtpPort} and ${config.uiPort}.`);
	process.exit(0);
}

spawnSync('docker', ['rm', '-f', config.containerName], { encoding: 'utf8', cwd: packageRoot, env: { ...process.env } });
const result = spawnSync('docker', [
	'run',
	'-d',
	'--name',
	config.containerName,
	'-p',
	`127.0.0.1:${config.smtpPort}:1025`,
	'-p',
	`127.0.0.1:${config.uiPort}:8025`,
	'axllent/mailpit:latest',
], {
	encoding: 'utf8',
	cwd: packageRoot,
	env: { ...process.env },
});

if (result.status !== 0) {
	const reusedMailpit = findRunningMailpitContainer();
	if (reusedMailpit) {
		console.log(`Reusing existing Mailpit container "${reusedMailpit.name}" on ports ${config.smtpPort} and ${config.uiPort}.`);
		process.exit(0);
	}

	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
}

process.exit(result.status ?? 1);
