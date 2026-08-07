import type { PackageBootstrapInput } from './contracts.ts';

const apacheLicense = `Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
`;

const sourceShapeScript = `import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const executableExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const ignored = new Set(['.git', 'coverage', 'dist', 'node_modules']);

function filesBelow(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (ignored.has(entry.name)) return [];
		const path = join(directory, entry.name);
		return entry.isDirectory() ? filesBelow(path) : [path];
	});
}

const files = filesBelow(root);
const handwritten = files.filter((path) => executableExtensions.has(extname(path)));
const oversized = handwritten.filter((path) => readFileSync(path, 'utf8').split(/\\r?\\n/u).length > 500);
if (oversized.length) throw new Error(\`Handwritten files exceed 500 lines: \${oversized.map((path) => relative(root, path)).join(', ')}\`);

const forbidden = files.filter((path) => {
	const name = relative(root, path);
	return !name.startsWith('dist/') && (name.endsWith('.js') || name.endsWith('.d.ts'));
});
if (forbidden.length) throw new Error(\`Checked-in JavaScript or declarations are forbidden: \${forbidden.map((path) => relative(root, path)).join(', ')}\`);

const counts = new Map<string, number>();
for (const path of handwritten) {
	const directory = relative(root, join(path, '..'));
	counts.set(directory, (counts.get(directory) ?? 0) + 1);
}
const crowded = [...counts].filter(([, count]) => count > 10);
if (crowded.length) throw new Error(\`Executable directories exceed ten files: \${crowded.map(([directory]) => directory).join(', ')}\`);

for (const path of handwritten) statSync(path);
`;

const metadataContractTest = `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const packageMetadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageManifest = parse(readFileSync(resolve(root, 'treeseed.package.yaml'), 'utf8'));
const workflow = readFileSync(resolve(root, '.github/workflows/verify.yml'), 'utf8');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

describe('AI package metadata', () => {
	it('declares the independent private Apache-2.0 package contract', () => {
		expect(packageMetadata).toMatchObject({ name: '@treeseed/ai', version: '0.1.0', private: true, license: 'Apache-2.0' });
		expect(packageMetadata.scripts).toMatchObject({ build: expect.any(String), test: expect.any(String), verify: expect.any(String) });
	});

	it('disables publishing and deployment', () => {
		expect(packageManifest).toMatchObject({ id: '@treeseed/ai', repository: 'treeseed-ai/ai', capabilities: { publish: false, deploy: false } });
		expect(workflow).not.toMatch(/deploy|publish|secret/i);
	});

	it('does not claim unfinished inference or training behavior', () => {
		expect(readme).toContain('None of those runtime capabilities is implemented or claimed yet.');
	});
});
`;

function packageJson(input: PackageBootstrapInput) {
	return JSON.stringify({
		name: input.packageId,
		version: '0.1.0',
		description: 'Installable local AI inference, training, and appliance runtime for TreeSeed.',
		license: input.license,
		private: true,
		repository: { type: 'git', url: `git+https://github.com/${input.repository}.git` },
		homepage: 'https://treeseed.dev',
		bugs: { url: `https://github.com/${input.repository}/issues` },
		type: 'module',
		engines: { node: '>=22' },
		types: './dist/index.d.ts',
		exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
		scripts: {
			build: 'tsc -p tsconfig.build.json',
			'check:file-lengths': 'node --import tsx ./scripts/support/check-source-shape.ts',
			'check:file-architecture': 'node --import tsx ./scripts/support/check-source-shape.ts',
			test: 'vitest run',
			verify: 'npm run check:file-lengths && npm run build && npm run test',
			'verify:local': 'npm run verify',
			'verify:direct': 'npm run verify',
		},
		devDependencies: { '@types/node': '^24.6.0', tsx: '^4.21.0', typescript: '^5.9.3', vitest: '^4.1.2', yaml: '^2.8.1' },
	}, null, 2) + '\n';
}

export function renderMetadataPackage(input: PackageBootstrapInput): Record<string, string> {
	return {
		'.editorconfig': 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = tab\nindent_size = 2\n',
		'.gitignore': 'dist/\nnode_modules/\ncoverage/\n*.log\n.env\n.env.*\n!.env.example\n',
		'LICENSE': apacheLicense,
		'NOTICE': 'TreeSeed AI\nCopyright 2026 TreeSeed contributors\n',
		'package.json': packageJson(input),
		'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, isolatedModules: true, skipLibCheck: true, types: ['node', 'vitest/globals'] }, include: ['src', 'tests', 'scripts', 'vitest.config.ts'] }, null, 2) + '\n',
		'tsconfig.build.json': JSON.stringify({ extends: './tsconfig.json', compilerOptions: { declaration: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] }, null, 2) + '\n',
		'vitest.config.ts': "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });\n",
		'src/index.ts': '/** Public entrypoint for the future local AI appliance runtime. */\nexport {};\n',
		'scripts/support/check-source-shape.ts': sourceShapeScript,
		'tests/contract/package-metadata.test.ts': metadataContractTest,
		'treeseed.package.yaml': `schemaVersion: treeseed.package/v1\nid: "${input.packageId}"\nname: ${input.name}\nkind: ${input.kind}\ntype: ${input.type}\nrepository: ${input.repository}\ncapabilities: { save: true, verify: true, publish: false, deploy: false, localOnly: false }\nworkflowTemplateVersion: "1"\nverify:\n  fast: npm run verify\n  local: npm run verify:local\n  release: npm run verify\nreleaseGate:\n  workflow: verify.yml\nprojectArchitecture:\n  topology: single_repository_site\n  rootPath: .\n  sitePath: docs\n  contentPath: docs/src/content\n  contentRuntimeSource: none\n  localContentMaterialization: none\n`,
		'README.md': `# TreeSeed AI\n\nThis repository is the initialization scaffold for the future TreeSeed local AI appliance package.\n\nPlanned responsibilities include vLLM inference, Axolotl training, local appliance supervision, hardware diagnostics, and Debian packaging. None of those runtime capabilities is implemented or claimed yet.\n\nTreeSeed API remains the governance and control-plane scheduler. This appliance will not directly mutate project Git repositories: content uses assignment-scoped TreeDX operations, while provider work uses capacity assignments, leases, usage, and settlement.\n\n## Current commands\n\n\`npm run build\`, \`npm test\`, and \`npm run verify\` validate this metadata scaffold.\n`,
		'AGENTS.md': `# AI Package Guide\n\n- Follow the Market workspace capacity and reconciliation architecture.\n- Do not introduce a second project scheduler or task queue.\n- Do not expose vLLM management endpoints.\n- Do not write directly to project repositories; use assignment-scoped TreeDX operations.\n- Route provider work through assignments, leases, usage, and settlement.\n- Keep raw experience outside Git; Git receives curated manifests and content only.\n- Keep handwritten source and tests below 500 lines and direct executable directories below ten files.\n- Preserve independent package build and test operation.\n- Do not add a push-triggered hosted deployment workflow.\n- Use plan for non-mutating previews and live execution for work; never add dry-run behavior.\n`,
		'.github/workflows/verify.yml': `name: Verify TreeSeed AI\n\non:\n  push:\n  pull_request:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24.12.0\n          cache: npm\n      - run: npm ci --ignore-scripts --no-audit --no-fund\n      - run: npm run verify\n`,
		'guarantees/project/package/initialize-ai-appliance-package.guarantee.yaml': `schemaVersion: treeseed.guarantee/v1\nid: initialize-ai-appliance-package\ntitle: Initialize the AI appliance package\ntype: project\nsubtype: package\nsurface: ai-package\nownerPackage: "${input.packageId}"\nstatus: planned\nnotes:\n  - Activation requires an executable package-verification guarantee verifier.\n`,
	};
}
