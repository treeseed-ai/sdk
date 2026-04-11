import { stopKnownMailpitContainers } from '../src/operations/services/mailpit-runtime.ts';

if (!stopKnownMailpitContainers()) {
	process.exit(1);
}

console.log('Mailpit is stopped.');
