export interface TextFileChange {
	path: string;
	before: string | null;
	after: string | null;
}

function commonPrefix(before: string[], after: string[]) {
	let count = 0;
	while (count < before.length && count < after.length && before[count] === after[count]) count += 1;
	return count;
}

function commonSuffix(before: string[], after: string[], prefix: number) {
	let count = 0;
	while (count < before.length - prefix && count < after.length - prefix
		&& before[before.length - count - 1] === after[after.length - count - 1]) count += 1;
	return count;
}

export function createTextFileDiff(change: TextFileChange) {
	if (change.before === null && change.after === null) {
		throw new Error(`Changeset path ${change.path} has no before or after content.`);
	}
	if (change.before === change.after) return '';

	const before = change.before === null ? [] : change.before.split('\n');
	const after = change.after === null ? [] : change.after.split('\n');
	const prefix = commonPrefix(before, after);
	const suffix = commonSuffix(before, after, prefix);
	const start = Math.max(0, prefix - 3);
	const beforeEnd = before.length - Math.max(0, suffix - 3);
	const afterEnd = after.length - Math.max(0, suffix - 3);
	const oldSlice = before.slice(start, beforeEnd);
	const newSlice = after.slice(start, afterEnd);
	const leadingContext = prefix - start;
	const trailingContext = Math.min(3, suffix);
	const body = [
		...oldSlice.slice(0, leadingContext).map((line) => ` ${line}`),
		...oldSlice.slice(leadingContext, oldSlice.length - trailingContext).map((line) => `-${line}`),
		...newSlice.slice(leadingContext, newSlice.length - trailingContext).map((line) => `+${line}`),
		...newSlice.slice(newSlice.length - trailingContext).map((line) => ` ${line}`),
	].join('\n');
	const oldStart = change.before === null ? 0 : start + 1;
	const newStart = change.after === null ? 0 : start + 1;
	const metadata = change.before === null ? ['new file mode 100644'] : change.after === null ? ['deleted file mode 100644'] : [];

	return [
		`diff --git a/${change.path} b/${change.path}`,
		...metadata,
		`--- ${change.before === null ? '/dev/null' : `a/${change.path}`}`,
		`+++ ${change.after === null ? '/dev/null' : `b/${change.path}`}`,
		`@@ -${oldStart},${oldSlice.length} +${newStart},${newSlice.length} @@`,
		body,
	].join('\n');
}

export function createUnifiedChangeset(changes: TextFileChange[]) {
	const paths = new Set<string>();
	for (const change of changes) {
		if (paths.has(change.path)) throw new Error(`Duplicate changeset path: ${change.path}`);
		paths.add(change.path);
	}
	return changes.map(createTextFileDiff).filter(Boolean).join('\n');
}
