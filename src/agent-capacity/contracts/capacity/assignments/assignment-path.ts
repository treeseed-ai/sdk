/** Assignment paths are relative, traversal-free, and bounded by their workspace grant. */
export function assignmentPathAllowed(path: string, allowed: readonly string[]): boolean {
	const safe = (value: string) => value.length > 0 && !value.includes('\\') && !value.includes('\0')
		&& value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
	if (!safe(path) || /[*?]/u.test(path)) return false;
	return allowed.some(value => {
		const prefix = value.replace(/\/$/u, '');
		if (prefix === '.' || prefix === '**') return true;
		// A recursive directory grant means its descendants, not a literal '**' directory.
		const directory = prefix.endsWith('/**') ? prefix.slice(0, -3) : prefix;
		return safe(directory) && !/[*?]/u.test(directory)
			&& (path === directory || path.startsWith(`${directory}/`));
	});
}
