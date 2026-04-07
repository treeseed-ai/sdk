import type { SdkContentEntry, SdkFilterCondition, SdkSortSpec } from './sdk-types.ts';

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

	return String(left ?? '').localeCompare(String(right ?? ''));
}

function getFieldValue(entry: SdkContentEntry | Record<string, unknown>, field: string) {
	if (field in entry) {
		return (entry as Record<string, unknown>)[field];
	}

	if ('frontmatter' in entry && entry.frontmatter && typeof entry.frontmatter === 'object') {
		return (entry.frontmatter as Record<string, unknown>)[field];
	}

	return undefined;
}

export function matchesFilter(
	entry: SdkContentEntry | Record<string, unknown>,
	filter: SdkFilterCondition,
) {
	const fieldValue = getFieldValue(entry, filter.field);

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
) {
	return items.filter((item) => filters.every((filter) => matchesFilter(item, filter)));
}

export function applySort<T extends SdkContentEntry | Record<string, unknown>>(
	items: T[],
	sort: SdkSortSpec[] = [],
) {
	if (sort.length === 0) {
		return items;
	}

	return [...items].sort((left, right) => {
		for (const spec of sort) {
			const direction = spec.direction === 'asc' ? 1 : -1;
			const comparison = compareScalar(getFieldValue(left, spec.field), getFieldValue(right, spec.field));
			if (comparison !== 0) {
				return comparison * direction;
			}
		}

		return 0;
	});
}
