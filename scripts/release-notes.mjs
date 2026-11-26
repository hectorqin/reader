#!/usr/bin/env node
// Writes the GitHub release notes for a tag as Markdown on stdout.
//
//   node scripts/release-notes.mjs v1.2.3 [owner/repo]
//
// The changes are the Conventional Commits between the previous v* tag and this
// one, grouped by type, each linked to the pull request that merged it. An
// annotated tag's own message (beyond its first line) is shown above them.
import { execFileSync } from 'node:child_process';

const [tag, repo = process.env.GITHUB_REPOSITORY ?? 'hectorqin/reader'] = process.argv.slice(2);
if (!tag) {
  console.error('usage: release-notes.mjs <tag> [owner/repo]');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return '';
  }
};

const version = tag.replace(/^v/, '');
const image = process.env.IMAGE ?? 'hectorqin/reader-pro';
const previous = tryGit('describe', '--tags', '--abbrev=0', '--match', 'v*', `${tag}^`);
const range = previous ? `${previous}..${tag}` : tag;

const HEADER = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;
const GROUPS = [
  ['breaking', '破坏性变更 Breaking changes'],
  ['feat', '新功能 Features'],
  ['fix', '修复 Fixes'],
  ['perf', '性能 Performance'],
  ['refactor', '重构 Refactoring'],
  ['docs', '文档 Documentation'],
  ['other', '维护 Maintenance'],
];

// Each commit's pull request: the oldest "Merge pull request #N" merge on the path
// from the commit to the tag is the one that brought it into the branch.
const prOf = new Map();
for (const line of tryGit('log', '--merges', '--reverse', '--format=%H%x1f%s', range).split('\n')) {
  if (!line) continue;
  const [merge, subject] = line.split('\x1f');
  const pr = /^Merge pull request #(\d+)/.exec(subject)?.[1];
  if (!pr) continue;
  for (const sha of tryGit('rev-list', `${merge}^1..${merge}^2`).split('\n')) {
    if (sha && !prOf.has(sha)) prOf.set(sha, pr);
  }
}

const groups = new Map(GROUPS.map(([key]) => [key, []]));
for (const line of tryGit('log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range).split('\x1e')) {
  const [sha, subject = '', body = ''] = line.trim().split('\x1f');
  if (!sha) continue;
  const match = HEADER.exec(subject);
  const [, type = '', scope, bang, text = subject] = match ?? [];
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body);
  const key = breaking ? 'breaking' : groups.has(type) && type !== 'other' ? type : 'other';
  const pr = prOf.get(sha);
  const ref = pr ? `#${pr}` : sha.slice(0, 7);
  groups.get(key).push(`- ${scope ? `**${scope}**: ` : ''}${match ? text : subject} (${ref})`);
}

const out = [];
// A lightweight tag has no message of its own; for-each-ref would print the commit's.
const annotated = tryGit('cat-file', '-t', `refs/tags/${tag}`) === 'tag';
const annotation = annotated ? tryGit('for-each-ref', '--format=%(contents:body)', `refs/tags/${tag}`) : '';
if (annotation) out.push(annotation, '');

for (const [key, title] of GROUPS) {
  const items = groups.get(key);
  if (!items.length) continue;
  if (key === 'other') {
    out.push(`<details><summary>${title} (${items.length})</summary>`, '', ...items, '', '</details>', '');
  } else {
    out.push(`## ${title}`, '', ...items, '');
  }
}
if (!GROUPS.some(([key]) => groups.get(key).length))
  out.push('_自上个版本以来无变更 / No changes since the previous release._', '');

out.push(
  '## 安装 Install',
  '',
  `- **Docker**（amd64 / arm64）: \`docker pull ${image}:${version}\``,
  `- **安卓 Android**: \`reader-pro-${version}.apk\`（下载后直接安装 / download and side-load）`,
  `- **网页客户端 Web client**: \`reader-web-${version}.zip\`（静态文件，可放到 \`WEB_DIR\` / static bundle for \`WEB_DIR\`）`,
  '- **校验和 Checksums**: `SHA256SUMS.txt`',
  '',
);
if (previous) out.push(`**完整变更 Full changelog**: https://github.com/${repo}/compare/${previous}...${tag}`);

console.log(out.join('\n'));
