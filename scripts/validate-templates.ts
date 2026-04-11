#!/usr/bin/env node

import { validateAllTemplateDefinitions } from '../src/operations/services/template-registry.ts';

const definitions = await validateAllTemplateDefinitions({
	writeWarning: (message) => console.warn(message),
});

console.log(`Validated ${definitions.length} template definition${definitions.length === 1 ? '' : 's'}.`);
