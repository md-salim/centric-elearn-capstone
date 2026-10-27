import { Parser } from 'node-sql-parser';
import { ALLOWED_VIEWS } from './config.js';

export type GuardResult = { ok: true } | { ok: false; reason: string };

// The guard is the SECOND line of defence. The first is that the database user can only SELECT
// the five views. The parser is not trusted on its own: it can differ from MySQL, so the text is
// also checked, the whole syntax tree is walked and anything unexpected is rejected (fail closed).

const MAX_SQL_LENGTH = 20_000;
const MAX_DEPTH = 100;
const DEFAULT_DATABASE = 'larchmont';
const VIEW_SET: ReadonlySet<string> = new Set(ALLOWED_VIEWS);

// Keys a table entry in a FROM list may carry. Anything else is unexpected, so rejected.
const TABLE_ENTRY_KEYS = new Set(['db', 'table', 'as', 'join', 'on', 'using']);
const DERIVED_ENTRY_KEYS = new Set(['expr', 'as', 'join', 'on', 'using', 'prefix']);

const reject = (reason: string): GuardResult => ({ ok: false, reason });

class Reject extends Error {}
function fail(reason: string): never {
  throw new Reject(reason);
}

// Words that must never appear anywhere in the text (even inside a string literal: conservative).
const FORBIDDEN_TEXT: [RegExp, string][] = [
  [/\binto\b/i, 'INTO is not allowed'],
  [/\b(outfile|dumpfile)\b/i, 'OUTFILE and DUMPFILE are not allowed'],
  [/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i, 'locking clauses are not allowed'],
  [/\block\s+in\s+share\s+mode\b/i, 'locking clauses are not allowed'],
  [
    /\b(load_file|get_lock|release_lock|release_all_locks|is_free_lock|is_used_lock|master_pos_wait|source_pos_wait)\s*\(/i,
    'that function is not allowed',
  ],
];

let parser: Parser | undefined;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates one SQL text for run_readonly_query.
 * @param opts.database the configured database name; `larchmont` is always accepted as a qualifier.
 */
export function validateSql(sql: string, opts: { database?: string } = {}): GuardResult {
  try {
    return check(sql, opts);
  } catch (e) {
    if (e instanceof Reject) return reject(e.message);
    return reject('the statement could not be checked, so it was rejected');
  }
}

function check(sql: unknown, opts: { database?: string }): GuardResult {
  if (typeof sql !== 'string' || sql.trim() === '') return reject('empty statement');
  if (sql.length > MAX_SQL_LENGTH) return reject('statement is too long');

  // Rule 1: no comments of any kind, anywhere (also rejects /*! ... */ and /*M! ... */).
  if (sql.includes('/*') || sql.includes('--') || sql.includes('#')) {
    return reject('comments are not allowed (/*, -- and # are rejected anywhere in the text)');
  }
  // Defensive text checks that do not depend on the parser.
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E\t\n\r]/.test(sql)) return reject('only plain ASCII text is allowed');
  if (sql.includes('@')) return reject('user variables and @@ system variables are not allowed');
  if (!/^\s*(select|with)\b/i.test(sql)) return reject('only SELECT statements are allowed');

  // Rule 2: parse with the MySQL dialect; one statement of type select.
  parser ??= new Parser();
  let parsed: unknown;
  try {
    parsed = parser.astify(sql, { database: 'MySQL' });
  } catch {
    return reject('the statement could not be parsed');
  }
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  if (statements.length !== 1) return reject('only one statement is allowed');
  const ast = statements[0];
  if (!isObject(ast) || ast.type !== 'select') return reject('only SELECT statements are allowed');

  // Rule 3 (text part): INTO, locking, dangerous functions.
  for (const [re, why] of FORBIDDEN_TEXT) if (re.test(sql)) return reject(why);

  // Rules 3 (tree part) and 4: walk everything.
  const databases = new Set([DEFAULT_DATABASE]);
  if (opts.database) databases.add(opts.database.toLowerCase());
  walk(ast, new Set<string>(), databases, 0, new WeakSet<object>());
  return { ok: true };
}

function walk(
  node: unknown,
  ctes: ReadonlySet<string>,
  databases: ReadonlySet<string>,
  depth: number,
  handled: WeakSet<object>,
): void {
  if (depth > MAX_DEPTH) fail('statement is nested too deeply');
  if (Array.isArray(node)) {
    for (const n of node) walk(n, ctes, databases, depth + 1, handled);
    return;
  }
  if (!isObject(node)) return;

  let scope = ctes;

  // CTEs: the body is checked with the names defined before it (plus its own name only for
  // RECURSIVE); the names then become visible to the rest of this query, unions included.
  if (node.with !== null && node.with !== undefined) {
    if (!Array.isArray(node.with)) fail('unexpected WITH clause');
    const visible = new Set(ctes);
    for (const clause of node.with) {
      if (!isObject(clause)) fail('unexpected WITH clause');
      const nm = isObject(clause.name) ? clause.name.value : undefined;
      if (typeof nm !== 'string' || nm === '') fail('unexpected WITH clause');
      const lower = nm.toLowerCase();
      const bodyScope = new Set(visible);
      if (clause.recursive === true) bodyScope.add(lower);
      walk(clause.stmt, bodyScope, databases, depth + 1, handled);
      visible.add(lower);
    }
    scope = visible;
  }

  if (node.type === 'select') {
    // INTO in any form (the parser leaves {position: null} when there is none).
    if (node.into !== null && node.into !== undefined) {
      if (!isObject(node.into)) fail('INTO is not allowed');
      for (const [k, v] of Object.entries(node.into)) if (!(k === 'position' && v === null)) fail('INTO is not allowed');
    }
    if (node.locking_read) fail('locking clauses are not allowed');
    const from = node.from;
    if (from === null || from === undefined || (Array.isArray(from) && from.length === 0)) {
      fail('a SELECT without FROM is not allowed');
    }
  }

  if (node.from !== null && node.from !== undefined) checkFrom(node.from, scope, databases, depth, handled);

  for (const [key, value] of Object.entries(node)) {
    if (key === 'with' || key === 'from' || key === 'tableList' || key === 'columnList') continue;
    if (typeof value === 'object' && value !== null) {
      // A table-like object that did not come through a FROM list is unexpected.
      if (isObject(value) && typeof value.table === 'string' && value.type !== 'column_ref' && !handled.has(value)) {
        fail('unexpected table reference');
      }
      walk(value, scope, databases, depth + 1, handled);
    }
  }
}

function checkFrom(
  from: unknown,
  ctes: ReadonlySet<string>,
  databases: ReadonlySet<string>,
  depth: number,
  handled: WeakSet<object>,
): void {
  if (depth > MAX_DEPTH) fail('statement is nested too deeply');
  if (Array.isArray(from)) {
    for (const entry of from) checkEntry(entry, ctes, databases, depth + 1, handled);
    return;
  }
  // Parenthesised join: { expr: [entries], parentheses, joins }
  if (isObject(from) && Array.isArray(from.expr)) {
    for (const k of Object.keys(from)) if (!['expr', 'parentheses', 'joins'].includes(k)) fail('unexpected FROM clause');
    checkFrom(from.expr, ctes, databases, depth + 1, handled);
    if (Array.isArray(from.joins) && from.joins.length > 0) checkFrom(from.joins, ctes, databases, depth + 1, handled);
    return;
  }
  fail('unexpected FROM clause');
}

function checkEntry(
  entry: unknown,
  ctes: ReadonlySet<string>,
  databases: ReadonlySet<string>,
  depth: number,
  handled: WeakSet<object>,
): void {
  if (!isObject(entry)) fail('unexpected FROM clause');
  handled.add(entry);

  if (typeof entry.table === 'string' && entry.expr === undefined) {
    for (const k of Object.keys(entry)) if (!TABLE_ENTRY_KEYS.has(k)) fail('unexpected table syntax');
    const name = entry.table.toLowerCase();
    const db = entry.db;
    if (db !== null && db !== undefined) {
      if (typeof db !== 'string' || !databases.has(db.toLowerCase())) {
        fail('only the vw_ views are allowed (other schemas are rejected)');
      }
      if (!VIEW_SET.has(name)) fail('only the vw_ views are allowed');
    } else if (!VIEW_SET.has(name) && !ctes.has(name)) {
      fail('only the vw_ views are allowed');
    }
  } else if (entry.expr !== undefined && entry.table === undefined) {
    for (const k of Object.keys(entry)) if (!DERIVED_ENTRY_KEYS.has(k)) fail('unexpected FROM syntax');
    if (Array.isArray(entry.expr)) checkFrom(entry.expr, ctes, databases, depth + 1, handled);
    else walk(entry.expr, ctes, databases, depth + 1, handled);
  } else {
    // dual, table functions, VALUES and anything else the parser may invent.
    fail('unsupported FROM source');
  }

  if (entry.on !== undefined && entry.on !== null) walk(entry.on, ctes, databases, depth + 1, handled);
  if (entry.using !== undefined && entry.using !== null) walk(entry.using, ctes, databases, depth + 1, handled);
}
