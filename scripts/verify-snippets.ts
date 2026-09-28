/**
 * Verifies typescript.json:
 *   1. Structure: valid JSON, every prefix starts with "xp-", no duplicate prefixes,
 *      tab stops numbered 1..N in order of first appearance, mirrored tab stops share
 *      one default, a single $0, and no snippet variables (an unescaped `${PORT}`
 *      would be parsed as one), every prefix documented in README.md.
 *   2. Compilation: expands every snippet with its default placeholder values into a
 *      temporary project (strict, NodeNext, ESM, Express 5) and runs `tsc --noEmit`.
 *
 * Usage: npm run verify [-- --keep]   (--keep leaves the temp project on disk)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Snippet {
  prefix: string;
  body: string[];
  description: string;
}

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'tabstop'; index: number; children: Node[] | null }
  | { kind: 'variable'; name: string };

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Where each snippet's expansion is written, laid out like a real project so that
// snippets importing each other (xp-server -> xp-app, xp-mw-error -> xp-error-base,
// xp-mw-idempotency -> xp-mockdb) are checked together.
const SNIPPET_PATHS: Record<string, string> = {
  'xp-app': 'src/app.ts',
  'xp-server': 'src/server.ts',
  'xp-route': 'src/routes/route.ts',
  'xp-controller': 'src/controllers/controller.ts',
  'xp-service': 'src/services/service.ts',
  'xp-types': 'src/types/types.ts',
  'xp-mockdb': 'src/db/mockDb.ts',
  'xp-mw-idempotency': 'src/middleware/idempotency.ts',
  'xp-mw-base': 'src/middleware/base.ts',
  'xp-mw-log': 'src/middleware/log.ts',
  'xp-mw-error': 'src/middleware/error.ts',
  'xp-mw-auth': 'src/middleware/auth.ts',
  'xp-error-base': 'src/errors/AppError.ts',
  'xp-test-api': 'src/__tests__/api.test.ts',
  'xp-test-unit': 'src/__tests__/unit.test.ts',
};

// Sibling files that snippets import with their default placeholder names.
const STUBS: Record<string, string> = {
  'src/controllers/controllerFile.ts': [
    "import type { Request, Response } from 'express';",
    '',
    'export const controllerName = (_req: Request, res: Response): void => {',
    '  res.end();',
    '};',
  ].join('\n'),
  'src/services/serviceName.ts': [
    'export class ServiceName {',
    '  async methodName(id: string): Promise<{ id: string }> {',
    '    return { id };',
    '  }',
    '}',
  ].join('\n'),
  'src/types/typesFile.ts': [
    'export interface TypeName { id: string }',
    'export interface EntityType { id: string }',
  ].join('\n'),
  'src/auth/verifyToken.ts': [
    'export const verifyToken = async (token: string): Promise<{ id: string } | null> =>',
    "  token === 'valid' ? { id: 'user-1' } : null;",
  ].join('\n'),
  'src/app.ts': [
    "import express from 'express';",
    '',
    'export const app = express();',
    "app.get('/health', (_req, res) => {",
    "  res.json({ status: 'ok' });",
    '});',
  ].join('\n'),
};

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    verbatimModuleSyntax: true, // fails on type-only imports that are not `import type`
    skipLibCheck: true,
    noEmit: true,
    types: ['node', 'jest'],
  },
  include: ['src'],
};

// ---------------------------------------------------------------------------
// Snippet syntax parser (subset of the VS Code grammar: tab stops, placeholders,
// choices, variables, and backslash escapes of `$`, `}` and `\`).
// ---------------------------------------------------------------------------

function parse(source: string): Node[] {
  let pos = 0;

  const parseUntil = (terminator: string | null): Node[] => {
    const nodes: Node[] = [];
    let text = '';
    const flush = (): void => {
      if (text) nodes.push({ kind: 'text', value: text });
      text = '';
    };

    while (pos < source.length) {
      const ch = source[pos];

      if (ch === '\\' && pos + 1 < source.length && '$}\\'.includes(source[pos + 1])) {
        text += source[pos + 1];
        pos += 2;
        continue;
      }
      if (terminator !== null && ch === terminator) {
        pos++;
        flush();
        return nodes;
      }
      if (ch === '$') {
        const node = parseDollar();
        if (node) {
          flush();
          nodes.push(node);
          continue;
        }
      }
      text += ch;
      pos++;
    }

    if (terminator !== null) throw new Error(`Unterminated placeholder, expected "${terminator}"`);
    flush();
    return nodes;
  };

  const parseDollar = (): Node | null => {
    const rest = source.slice(pos);

    let m = /^\$(\d+)/.exec(rest);
    if (m) {
      pos += m[0].length;
      return { kind: 'tabstop', index: Number(m[1]), children: null };
    }
    m = /^\$\{(\d+)\}/.exec(rest);
    if (m) {
      pos += m[0].length;
      return { kind: 'tabstop', index: Number(m[1]), children: null };
    }
    m = /^\$\{(\d+):/.exec(rest);
    if (m) {
      pos += m[0].length;
      return { kind: 'tabstop', index: Number(m[1]), children: parseUntil('}') };
    }
    m = /^\$\{(\d+)\|([^|]*)\|\}/.exec(rest);
    if (m) {
      pos += m[0].length;
      const [first = ''] = m[2].split(',');
      return { kind: 'tabstop', index: Number(m[1]), children: [{ kind: 'text', value: first }] };
    }
    m = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
    if (m) {
      // Consume the whole variable, including any `${NAME:default}` body.
      const braced = rest[1] === '{';
      pos += m[0].length;
      if (braced) parseUntil('}');
      return { kind: 'variable', name: m[1] };
    }
    return null; // a lone `$` is literal text
  };

  return parseUntil(null);
}

function walk(nodes: Node[], visit: (node: Node) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.kind === 'tabstop' && node.children) walk(node.children, visit);
  }
}

function render(nodes: Node[], defaults: Map<number, Node[]>): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text') return node.value;
      if (node.kind === 'variable') return '';
      const value = node.children ?? defaults.get(node.index) ?? [];
      return render(value, defaults);
    })
    .join('');
}

/** Returns structural problems and the expanded source using default values. */
function inspect(snippet: Snippet): { problems: string[]; code: string } {
  const problems: string[] = [];
  let ast: Node[];
  try {
    ast = parse(snippet.body.join('\n'));
  } catch (error) {
    return { problems: [(error as Error).message], code: '' };
  }

  const firstSeen: number[] = [];
  const defaults = new Map<number, Node[]>();
  const defaultText = new Map<number, string>();
  let finalStops = 0;

  walk(ast, (node) => {
    if (node.kind === 'variable') {
      problems.push(`snippet variable "${node.name}" (escape literal dollars as \\\\$)`);
    }
    if (node.kind !== 'tabstop') return;
    if (node.index === 0) {
      finalStops++;
      return;
    }
    if (!firstSeen.includes(node.index)) firstSeen.push(node.index);
    if (node.children) {
      const text = render(node.children, new Map());
      const previous = defaultText.get(node.index);
      if (previous !== undefined && previous !== text) {
        problems.push(`tab stop $${node.index} mirrored with different defaults ("${previous}" vs "${text}")`);
      }
      if (!defaults.has(node.index)) {
        defaults.set(node.index, node.children);
        defaultText.set(node.index, text);
      }
    }
  });

  if (finalStops !== 1) problems.push(`expected exactly one $0, found ${finalStops}`);
  const expected = firstSeen.map((_, i) => i + 1);
  if (firstSeen.join() !== expected.join()) {
    problems.push(`tab stops should be numbered 1..N in order of appearance, got ${firstSeen.join(', ')}`);
  }

  return { problems, code: render(ast, defaults) + '\n' };
}

// ---------------------------------------------------------------------------

const keep = process.argv.includes('--keep');
const snippets = JSON.parse(readFileSync(join(REPO_ROOT, 'typescript.json'), 'utf8')) as Record<string, Snippet>;
const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

let failed = false;
const fail = (message: string): void => {
  failed = true;
  console.log(`  FAIL ${message}`);
};

console.log('Structure');
const seenPrefixes = new Map<string, string>();
const files = new Map<string, string>(); // relative path -> prefix

for (const [name, snippet] of Object.entries(snippets)) {
  const { prefix } = snippet;
  if (!prefix.startsWith('xp-')) fail(`${name}: prefix "${prefix}" does not start with "xp-"`);
  const clash = seenPrefixes.get(prefix);
  if (clash) fail(`${name}: prefix "${prefix}" already used by "${clash}"`);
  seenPrefixes.set(prefix, name);
  if (!readme.includes(`\`${prefix}\``)) fail(`${prefix}: not documented in README.md`);

  const { problems } = inspect(snippet);
  for (const problem of problems) fail(`${prefix}: ${problem}`);
}
if (!failed) console.log(`  ok   ${seenPrefixes.size} snippets, all "xp-", no duplicate prefixes, tab stops valid`);

console.log('\nCompile (tsc --noEmit, strict, NodeNext, Express 5)');
const projectDir = mkdtempSync(join(tmpdir(), 'verify-snippets-'));
try {
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
  writeFileSync(join(projectDir, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(projectDir, 'node_modules'), 'dir');

  const write = (relativePath: string, content: string): void => {
    const target = join(projectDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };

  for (const [path, content] of Object.entries(STUBS)) write(path, content + '\n');

  for (const [index, snippet] of Object.values(snippets).entries()) {
    let path = SNIPPET_PATHS[snippet.prefix] ?? `src/unmapped/${snippet.prefix}.ts`;
    if (!(snippet.prefix in SNIPPET_PATHS)) {
      console.log(`  warn ${snippet.prefix}: no entry in SNIPPET_PATHS, compiled at ${path}`);
    }
    // A duplicate prefix must not overwrite (and hide) the other snippet's file.
    if (files.has(path)) path = path.replace(/\.ts$/, `.${index}.ts`);
    write(path, inspect(snippet).code);
    files.set(path, snippet.prefix);
  }

  const tsc = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;

  // tsc lines look like: src/app.ts(3,1): error TS2307: Cannot find module ...
  const errorsByFile = new Map<string, string[]>();
  for (const line of result.stdout.split('\n').filter(Boolean)) {
    const file = /^(.+?)\(\d+,\d+\)/.exec(line)?.[1] ?? '(global)';
    errorsByFile.set(file, [...(errorsByFile.get(file) ?? []), line]);
  }

  for (const [path, prefix] of files) {
    const errors = errorsByFile.get(path);
    errorsByFile.delete(path);
    if (!errors) {
      console.log(`  ok   ${prefix.padEnd(18)} ${path}`);
      continue;
    }
    fail(`${prefix.padEnd(18)} ${path}`);
    for (const error of errors) console.log(`         ${error}`);
  }
  for (const [file, errors] of errorsByFile) {
    fail(`${file} (stub or global)`);
    for (const error of errors) console.log(`         ${error}`);
  }
  if (result.status !== 0 && !failed) fail(`tsc exited with ${result.status}: ${result.stderr}`);
} finally {
  if (keep) console.log(`\nTemp project kept at ${projectDir}`);
  else rmSync(projectDir, { recursive: true, force: true });
}

console.log(failed ? '\nVerification failed.' : '\nAll snippets verified.');
process.exit(failed ? 1 : 0);
