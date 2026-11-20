#!/usr/bin/env node
// commit-msg hook: enforce Conventional Commits, the style this repo already uses,
// e.g. `feat(web): a phone sheet drags by its grip` or `fix: ...`.
// Merge, revert, fixup/squash and git-generated messages pass through untouched.
import { readFileSync } from 'node:fs';

const TYPES = ['feat', 'fix', 'perf', 'refactor', 'style', 'test', 'docs', 'build', 'ci', 'chore', 'revert'];
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([\\w./,-]+\\))?!?: \\S.*$`);
const PASSTHROUGH = /^(Merge |Revert "|fixup! |squash! |amend! )/;
const MAX_HEADER = 100;

const file = process.argv[2];
if (!file) {
  console.error('usage: check-commit-msg.mjs <commit-msg-file>');
  process.exit(2);
}

const header =
  readFileSync(file, 'utf8')
    .split('\n')
    .find((line) => line.trim() !== '' && !line.startsWith('#')) ?? '';

if (PASSTHROUGH.test(header)) process.exit(0);

const problems = [];
if (!HEADER.test(header)) {
  problems.push(`header must be "<type>(<optional scope>): <subject>", type one of: ${TYPES.join(', ')}`);
}
if (header.length > MAX_HEADER) problems.push(`header is ${header.length} chars; keep it within ${MAX_HEADER}`);

if (problems.length) {
  console.error(`\n✖ Invalid commit message:\n\n    ${header || '(empty)'}\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n  Example: feat(web): add a sort menu to the shelf\n');
  process.exit(1);
}
