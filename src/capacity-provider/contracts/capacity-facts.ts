export type NativeCapacityUnit = 'wall_minute' | 'quota_minute' | 'usd' | 'token' | 'request' | 'gpu_second' | 'human_minute' | 'custom' | string;
export type NativeCapacityLimitScope = 'daily' | 'weekly' | 'monthly' | 'session' | 'rolling_window' | string;
export type NativeCapacityConfidence = 'exact' | 'estimated' | 'opaque' | string;
export type NativeCapacityLimitSource = 'configured' | 'observed' | 'learned' | 'manual_override' | string;
export type ProviderQuotaVisibility = 'exact' | 'partial' | 'opaque' | string;

export interface CapacityProviderCapability {
	id: string;
	agents: string[];
	operations: string[];
	models: string[];
	repositoryAccess: string;
	verification: string[];
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderNativeLimitCapacity {
	id?: string;
	scope?: NativeCapacityLimitScope;
	limitScope?: NativeCapacityLimitScope;
	nativeUnit?: NativeCapacityUnit;
	limitAmount: number;
	reserveBufferPercent?: number | null;
	resetCadence?: string | null;
	resetAt?: string | null;
	confidence?: NativeCapacityConfidence;
	source?: NativeCapacityLimitSource;
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderObservationCapacity {
	id?: string;
	observedAt?: string;
	health?: string;
	activeWorkers?: number | null;
	queuedTasks?: number | null;
	throttleState?: string | null;
	nativeRemaining?: Record<string, unknown>;
	resetAt?: string | null;
	confidence?: NativeCapacityConfidence;
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderNativeCapacity {
	id?: string;
	name: string;
	kind: string;
	status?: string;
	nativeUnit: NativeCapacityUnit;
	quotaVisibility?: ProviderQuotaVisibility;
	maxConcurrentWorkers?: number | null;
	resetCadence?: string | null;
	config?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	nativeLimits?: ExecutionProviderNativeLimitCapacity[];
	observation?: ExecutionProviderObservationCapacity;
}

export interface CapacityProviderNativeCapacity {
	executionProviders: ExecutionProviderNativeCapacity[];
}

export interface CapacityProviderBudgetCapacity {
	dailyCreditBudget?: number | null;
	monthlyCreditBudget?: number | null;
	maxConcurrentWorkdays?: number | null;
	maxConcurrentRunners?: number | null;
	nativeCapacity?: CapacityProviderNativeCapacity;
	[key: string]: unknown;
}
