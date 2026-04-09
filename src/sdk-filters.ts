import { readCanonicalFieldValue } from './sdk-fields.ts';
import type { SdkContentEntry, SdkFilterCondition, SdkModelDefinition, SdkSortSpec } from './sdk-types.ts';

function toArray(value: unknown) {
	if (Array.isArray(value)) {
		return value;
	}

	if (value === undefined || value === null) {
		return [];
	}

	return [value];
}

function compareScalar(left: unknown, right: unknown) {
	if (typeof left === 'number' && typeof right === 'number') {
		return left - right;
	}

	if (left instanceof Date || right instanceof Date) {
		return new Date(String(left ?? 0)).valueOf() - new Date(String(right ?? 0)).valueOf();
	}

	return String(left ?? '').localeCompare(String(right ?? ''));
}

export function matchesFilter(
	entry: SdkContentEntry | Record<string, unknown>,
	filter: SdkFilterCondition,
	definition?: SdkModelDefinition,
) {
	const fieldValue = definition
		? readCanonicalFieldValue(definition, entry as Record<string, unknown>, filter.field)
		: (entry as Record<string, unknown>)[filter.field];

	switch (filter.op) {
		case 'eq':
			return fieldValue === filter.value;
		case 'in':
			return toArray(filter.value).includes(fieldValue);
		case 'contains':
			if (Array.isArray(fieldValue)) {
				return fieldValue.includes(filter.value);
			}
			return String(fieldValue ?? '')
				.toLowerCase()
				.includes(String(filter.value ?? '').toLowerCase());
		case 'prefix':
			return String(fieldValue ?? '')
				.toLowerCase()
				.startsWith(String(filter.value ?? '').toLowerCase());
		case 'gt':
			return compareScalar(fieldValue, filter.value) > 0;
		case 'gte':
			return compareScalar(fieldValue, filter.value) >= 0;
		case 'lt':
			return compareScalar(fieldValue, filter.value) < 0;
		case 'lte':
			return compareScalar(fieldValue, filter.value) <= 0;
		case 'updated_since':
			return new Date(String(fieldValue ?? 0)).valueOf() >= new Date(String(filter.value)).valueOf();
		case 'related_to':
			return Array.isArray(fieldValue) && fieldValue.includes(filter.value);
		default:
			return false;
	}
}

export function applyFilters<T extends SdkContentEntry | Record<string, unknown>>(
	items: T[],
	filters: SdkFilterCondition[] = [],
	definition?: SdkModelDefinition,
) {
	return items.filter((item) => filters.every((filter) => matchesFilter(item, filter, definition)));
}

export function applySort<T extends SdkContentEntry | Record<string, unknown>>(
	items: T[],
	sort: SdkSortSpec[] = [],
	definition?: SdkModelDefinition,
) {
	if (sort.length === 0) {
		return items;
	}

	return [...items].sort((left, right) => {
		for (const spec of sort) {
			const direction = spec.direction === 'asc' ? 1 : -1;
			const leftValue = definition
				? readCanonicalFieldValue(definition, left as Record<string, unknown>, spec.field)
				: (left as Record<string, unknown>)[spec.field];
			const rightValue = definition
				? readCanonicalFieldValue(definition, right as Record<string, unknown>, spec.field)
				: (right as Record<string, unknown>)[spec.field];
			const comparison = compareScalar(leftValue, rightValue);
			if (comparison !== 0) {
				return comparison * direction;
			}
		}

		return 0;
	});
}
