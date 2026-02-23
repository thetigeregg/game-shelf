import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [reportPath, projectPrefix] = process.argv.slice(2);

if (!reportPath || !projectPrefix) {
  console.error(
    'Usage: node scripts/coverage/normalize-lcov-paths.mjs <reportPath> <projectPrefix>'
  );
  process.exit(1);
}

const absoluteReportPath = resolve(process.cwd(), reportPath);
const original = readFileSync(absoluteReportPath, 'utf8');
const hasTrailingNewline = original.endsWith('\n');

const normalized = original
  .split('\n')
  .map((line) => {
    if (!line.startsWith('SF:')) {
      return line;
    }

    const rawPath = line.slice(3).trim();
    const unixPath = rawPath.replaceAll('\\', '/').replace(/^file:\/+/, '/');
    const noDotPrefix = unixPath.startsWith('./') ? unixPath.slice(2) : unixPath;

    if (noDotPrefix.startsWith(`${projectPrefix}/`)) {
      return `SF:${noDotPrefix}`;
    }

    if (noDotPrefix.startsWith('src/')) {
      return `SF:${projectPrefix}/${noDotPrefix}`;
    }

    const projectMarker = `/${projectPrefix}/`;
    const projectPathIndex = noDotPrefix.indexOf(projectMarker);
    if (projectPathIndex >= 0) {
      return `SF:${noDotPrefix.slice(projectPathIndex + 1)}`;
    }

    return `SF:${noDotPrefix}`;
  })
  .join('\n');

writeFileSync(
  absoluteReportPath,
  hasTrailingNewline ? `${normalized}\n` : normalized,
  'utf8'
);
