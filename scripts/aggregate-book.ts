import path from 'node:path';
import { exportTenantBookPackages } from '../src/platform/book-export.ts';

async function main() {
	console.log('Generating Treeseed AI book packages...');
	const result = await exportTenantBookPackages({ projectRoot: process.cwd() });
	for (const entry of result.bookPackages) {
		console.log(`Generated ${path.relative(result.projectRoot, entry.markdownPath)}`);
		console.log(`Generated ${path.relative(result.projectRoot, entry.indexPath)}`);
	}
	console.log(`Generated ${path.relative(result.projectRoot, result.libraryPackage.markdownPath)}`);
	console.log(`Generated ${path.relative(result.projectRoot, result.libraryPackage.indexPath)}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
