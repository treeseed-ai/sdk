import { spawnSync } from 'node:child_process';
import { statfsSync } from 'node:fs';

const GIB = 1024 ** 3;
const MINIMUM_RESERVE_BYTES = 4 * GIB;
const DEFAULT_RESERVE_RATIO = 0.1;

export type LocalDiskCapacity = {
	ok: boolean;
	path: string;
	totalBytes: number;
	availableBytes: number;
	reserveBytes: number;
	operationHeadroomBytes: number;
	requiredAvailableBytes: number;
	deficitBytes: number;
	reason: string | null;
};

function configuredBytes(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function observeLocalDiskCapacity(input: {
	path: string;
	operationHeadroomBytes?: number;
	minimumReserveBytes?: number;
	env?: NodeJS.ProcessEnv;
}): LocalDiskCapacity {
	const stat = statfsSync(input.path, { bigint: true });
	const totalBytes = Number(stat.blocks * stat.bsize);
	const availableBytes = Number(stat.bavail * stat.bsize);
	const proportionalReserve = Math.ceil(totalBytes * DEFAULT_RESERVE_RATIO);
	const configuredReserve = configuredBytes(
		(input.env ?? process.env).TREESEED_MIN_FREE_DISK_BYTES,
		input.minimumReserveBytes ?? 0,
	);
	const reserveBytes = Math.max(MINIMUM_RESERVE_BYTES, proportionalReserve, configuredReserve);
	const operationHeadroomBytes = Math.max(0, input.operationHeadroomBytes ?? 0);
	const requiredAvailableBytes = reserveBytes + operationHeadroomBytes;
	const deficitBytes = Math.max(0, requiredAvailableBytes - availableBytes);
	return {
		ok: deficitBytes === 0,
		path: input.path,
		totalBytes,
		availableBytes,
		reserveBytes,
		operationHeadroomBytes,
		requiredAvailableBytes,
		deficitBytes,
		reason: deficitBytes === 0
			? null
			: `disk-capacity-insufficient: ${availableBytes} bytes available; ${requiredAvailableBytes} required (${reserveBytes} reserve plus ${operationHeadroomBytes} operation headroom)`,
	};
}

export function directoryDiskBytes(path: string) {
	const result = spawnSync('du', ['-sk', path], { encoding: 'utf8' });
	if ((result.status ?? 1) !== 0) return 0;
	const kibibytes = Number.parseInt(result.stdout.trim().split(/\s+/u)[0] ?? '', 10);
	return Number.isSafeInteger(kibibytes) && kibibytes >= 0 ? kibibytes * 1024 : 0;
}

export function dockerBuildHeadroomBytes(input: { contextPath: string; env?: NodeJS.ProcessEnv }) {
	const env = input.env ?? process.env;
	const configured = configuredBytes(env.TREESEED_DOCKER_BUILD_DISK_HEADROOM_BYTES, 8 * GIB);
	return Math.max(configured, directoryDiskBytes(input.contextPath) * 2);
}
