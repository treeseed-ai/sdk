import type {
	CapacitySupplyCandidate,
	CapacitySupplyPolicy,
	CapacitySupplySelection,
} from '../../../contracts/capacity/providers/supply-policy.ts';

function position(values: string[] | undefined, id: string) {
	const index = values?.indexOf(id) ?? -1;
	return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function pressureRank(value: CapacitySupplyCandidate['pressure']) {
	return { idle: 0, normal: 1, busy: 2, throttled: 3, exhausted: 4 }[value] ?? 5;
}

export function selectCapacitySupply(input: {
	candidates: CapacitySupplyCandidate[];
	requiredCapabilities: string[];
	policy: CapacitySupplyPolicy;
}): CapacitySupplySelection {
	const required = [...new Set(input.requiredCapabilities)].sort();
	const rejected: CapacitySupplySelection['rejected'] = [];
	const eligible = input.candidates.filter((candidate) => {
		const reasons = [
			...(candidate.status !== 'available' ? [`status:${candidate.status}`] : []),
			...(candidate.pressure === 'exhausted' || candidate.pressure === 'throttled' ? [`pressure:${candidate.pressure}`] : []),
			...(candidate.availableConcurrency < 1 ? ['concurrency_exhausted'] : []),
			...(candidate.reliability < input.policy.reliabilityFloor ? ['reliability_below_floor'] : []),
			...(input.policy.disallowedCapacityProviderIds?.includes(candidate.capacityProviderId) ? ['capacity_provider_disallowed'] : []),
			...(input.policy.disallowedExecutionProviderIds?.includes(candidate.executionProviderId) ? ['execution_provider_disallowed'] : []),
			...required.filter((capability) => !candidate.capabilities.includes(capability)).map((capability) => `missing_capability:${capability}`),
		];
		if (reasons.length) rejected.push({ candidate, reasons });
		return reasons.length === 0;
	}).sort((left, right) =>
		right.reliability - left.reliability
		|| pressureRank(left.pressure) - pressureRank(right.pressure)
		|| position(input.policy.preferredCapacityProviderIds, left.capacityProviderId) - position(input.policy.preferredCapacityProviderIds, right.capacityProviderId)
		|| position(input.policy.preferredExecutionProviderIds, left.executionProviderId) - position(input.policy.preferredExecutionProviderIds, right.executionProviderId)
		|| (left.estimatedCost ?? Number.MAX_SAFE_INTEGER) - (right.estimatedCost ?? Number.MAX_SAFE_INTEGER)
		|| left.capacityProviderId.localeCompare(right.capacityProviderId)
		|| left.executionProviderId.localeCompare(right.executionProviderId));
	return { selected: eligible[0] ?? null, eligible, rejected };
}
