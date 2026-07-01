export type TreeseedWorkflowPhaseStatus = 'passed' | 'failed' | 'skipped';

export type TreeseedWorkflowTimingPhase = {
	id: string;
	label: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	status: TreeseedWorkflowPhaseStatus;
};

export type TreeseedWorkflowTiming = {
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	phases: TreeseedWorkflowTimingPhase[];
};

export type TreeseedWorkflowTimer = {
	readonly startedAt: string;
	phase<T>(id: string, label: string, action: () => T): T;
	phaseAsync<T>(id: string, label: string, action: () => Promise<T>): Promise<T>;
	skip(id: string, label: string): void;
	finish(): TreeseedWorkflowTiming;
};

function nowIso() {
	return new Date().toISOString();
}

function durationSince(startMs: number) {
	return Math.max(0, Date.now() - startMs);
}

export function createTreeseedWorkflowTimer(startedAt = nowIso()): TreeseedWorkflowTimer {
	const startMs = Date.parse(startedAt);
	const phases: TreeseedWorkflowTimingPhase[] = [];

	function record(id: string, label: string, started: string, startedMs: number, status: TreeseedWorkflowPhaseStatus) {
		const finishedAt = nowIso();
		phases.push({
			id,
			label,
			startedAt: started,
			finishedAt,
			durationMs: durationSince(startedMs),
			status,
		});
	}

	return {
		startedAt,
		phase<T>(id: string, label: string, action: () => T): T {
			const phaseStartedAt = nowIso();
			const phaseStartedMs = Date.now();
			try {
				const result = action();
				record(id, label, phaseStartedAt, phaseStartedMs, 'passed');
				return result;
			} catch (error) {
				record(id, label, phaseStartedAt, phaseStartedMs, 'failed');
				throw error;
			}
		},
		async phaseAsync<T>(id: string, label: string, action: () => Promise<T>): Promise<T> {
			const phaseStartedAt = nowIso();
			const phaseStartedMs = Date.now();
			try {
				const result = await action();
				record(id, label, phaseStartedAt, phaseStartedMs, 'passed');
				return result;
			} catch (error) {
				record(id, label, phaseStartedAt, phaseStartedMs, 'failed');
				throw error;
			}
		},
		skip(id: string, label: string) {
			const phaseStartedAt = nowIso();
			record(id, label, phaseStartedAt, Date.now(), 'skipped');
		},
		finish(): TreeseedWorkflowTiming {
			const finishedAt = nowIso();
			return {
				startedAt,
				finishedAt,
				durationMs: Math.max(0, Date.parse(finishedAt) - startMs),
				phases: [...phases],
			};
		},
	};
}

export function formatTreeseedDuration(durationMs: number) {
	const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes === 0 ? `${hours}h` : `${hours}h${remainingMinutes}m`;
}

export function slowestTreeseedWorkflowPhases(timing: TreeseedWorkflowTiming, limit = 5) {
	return [...timing.phases]
		.sort((left, right) => right.durationMs - left.durationMs)
		.slice(0, Math.max(0, limit));
}
