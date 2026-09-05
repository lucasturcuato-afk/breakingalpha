#!/usr/bin/env node
/**
 * read-lint.mjs
 *
 * Static detector for one defect family: a read that DID NOT ANSWER rendering
 * as a read that answered EMPTY. The reader is told there is nothing there.
 * The truth is that we could not look.
 *
 * Shape, CLI and refusal behaviour are copied from scripts/design-lint.mjs,
 * which is the stated precedent and already solved this problem for design
 * rules. Same three modes, same dirty-tree refusal, same floor print.
 *
 *   node scripts/read-lint.mjs --all               the debt report
 *   node scripts/read-lint.mjs --since <sha>       only lines this branch added
 *   node scripts/read-lint.mjs <file> [file ...]   an explicit list
 *
 * REPORT ONLY. This run always exits 0 on findings. The ratchet lands in a
 * follow-up, once the floor below has been read and agreed. Exit 2 still
 * means the run could not be trusted: a bad ref, or a file in the diff with
 * uncommitted edits. --since refuses rather than answering with a caveat.
 *
 * ---------------------------------------------------------------------------
 * THE THREE CHECKS. All three are mechanically decidable from the syntax tree.
 * No type checker, no cross-file resolution, no judgement.
 *
 * 1. defaulted-unchecked-read
 *    A defaulting operator (|| or ??) in VALUE position whose left side roots
 *    at an identifier bound from a read whose error channel is never named
 *    anywhere in the binding's own function scope.
 *
 *    Three read shapes are recognised, and each one has exactly one error
 *    channel, which is why this is decidable rather than a guess:
 *
 *      const { data: x }  = await supabase.from(...)...   channel: an `error`
 *                                                         binding in the SAME
 *                                                         object pattern
 *      const r = await supabase.from(...)...              channel: `r.error`
 *      const [a, b] = await Promise.all([<chain>, ...])   channel: `a.error`
 *      const j = await res.json()                         channel: `res.ok` or
 *                                                         `res.status`
 *
 *    supabase-js does NOT throw on a failed read. It answers with
 *    { data: null, error }. So a surrounding try/catch is NOT an error channel
 *    for the first three shapes and is deliberately not treated as one. That
 *    single fact is what makes this check precise: a destructure that takes
 *    `data` and not `error` has no way to know the read faulted, whatever
 *    else the function does.
 *
 * 2. error-or-empty
 *    A condition that ORs an error operand together with an absence operand,
 *    so one branch answers for both. `if (error || !data) return notFound()`
 *    tells a stranger the document does not exist when the truth is that the
 *    read faulted. Both arms of the OR reach the same statement by
 *    construction, which is why no dataflow is needed to prove the conflation.
 *
 * 3. single-without-pgrst116
 *    `.single()` whose error IS inspected in scope, without PGRST116 named
 *    anywhere in that scope. PGRST116 is the one code that means the query
 *    ran and matched no row. Every other code is a read that did not answer.
 *    Treating them alike converts a fault into an absence.
 *    `.maybeSingle()` is deliberately NOT checked: it already answers
 *    { data: null, error: null } for a genuine miss, so it has no code to
 *    discriminate.
 *
 * ---------------------------------------------------------------------------
 * PRECISION OVER RECALL, ON PURPOSE. A detector that fires on the many
 * genuinely-optional defaults in this codebase gets switched off, and then it
 * detects nothing at all. Every rule above is written to skip rather than
 * guess. Known and accepted blind spots:
 *
 *   - a read passed through a helper function is not followed across the call
 *   - a default whose left side roots at a call expression is skipped, so
 *     `(safeParse(x) as T) || {}` is invisible here even though it is a real
 *     instance of the same lie
 *   - `||` in condition position is skipped by check 1, since a boolean OR is
 *     not a default. Check 2 covers the conflation shape that matters there.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = 'src';
const EXT = new Set(['.ts', '.tsx']);
const EXCLUDE_DIRS = new Set(['node_modules', '.next', 'design_handoff_signalera_mobile']);

/* Roots that own a `.from` which is not a table read. */
const NOT_A_CLIENT = new Set(['Array', 'Object', 'Buffer', 'Uint8Array', 'Int8Array', 'Float64Array']);

/* A chain carrying one of these is a write. Check 3 leaves writes alone. */
const WRITE_VERBS = new Set(['insert', 'upsert', 'update', 'delete']);

/* ------------------------------------------------------------------ */
/* Tiny AST helpers.                                                   */
/* ------------------------------------------------------------------ */

function unwrap(node) {
  let n = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isTypeAssertionExpression?.(n) ||
      ts.isSatisfiesExpression?.(n)
    ) {
      n = n.expression;
      continue;
    }
    return n;
  }
}

/** `a.b?.c[0]` -> the identifier `a`. A call anywhere in the base -> null. */
function rootIdentifier(node) {
  let n = unwrap(node);
  for (;;) {
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      n = unwrap(n.expression);
      continue;
    }
    return ts.isIdentifier(n) ? n : null;
  }
}

/** Nearest enclosing function-like node, else the SourceFile. */
function enclosingScope(node) {
  let n = node.parent;
  while (n) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isConstructorDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSourceFile(n)
    ) {
      return n;
    }
    n = n.parent;
  }
  return node.getSourceFile();
}

function forEachNode(node, fn) {
  fn(node);
  node.forEachChild((c) => forEachNode(c, fn));
}

/** Property names in a `x.from(...).select(...)` chain, outermost first. */
function chainNames(node) {
  const names = [];
  let n = unwrap(node);
  for (;;) {
    if (ts.isCallExpression(n)) { n = unwrap(n.expression); continue; }
    if (ts.isPropertyAccessExpression(n)) {
      names.push(n.name.text);
      n = unwrap(n.expression);
      continue;
    }
    if (ts.isElementAccessExpression(n)) { n = unwrap(n.expression); continue; }
    return { names, base: n };
  }
}

/** True for a supabase table or rpc read. */
function isSupabaseRead(node) {
  const { names, base } = chainNames(node);
  if (!names.includes('from') && !names.includes('rpc')) return false;
  if (ts.isIdentifier(base) && NOT_A_CLIENT.has(base.text)) return false;
  return true;
}

/** `await x` -> x, otherwise null. */
function awaited(node) {
  const n = unwrap(node);
  return n && ts.isAwaitExpression(n) ? unwrap(n.expression) : null;
}

/** `await r.json()` -> the response expression `r`, else undefined. */
function jsonCallTarget(node) {
  const inner = awaited(node);
  if (!inner || !ts.isCallExpression(inner)) return undefined;
  const callee = unwrap(inner.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'json') return undefined;
  return unwrap(callee.expression);
}

/** `await Promise.all([...])` -> the array literal elements, else null. */
function promiseAllElements(node) {
  const inner = awaited(node);
  if (!inner || !ts.isCallExpression(inner)) return null;
  const callee = unwrap(inner.expression);
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (callee.name.text !== 'all' && callee.name.text !== 'allSettled') return null;
  if (!ts.isIdentifier(unwrap(callee.expression)) || unwrap(callee.expression).text !== 'Promise') return null;
  const arg = inner.arguments[0] && unwrap(inner.arguments[0]);
  return arg && ts.isArrayLiteralExpression(arg) ? arg.elements : null;
}

function bindingKey(el) {
  const src = el.propertyName ?? el.name;
  return ts.isIdentifier(src) ? src.text : null;
}

/** Nearest enclosing Statement, for the collected-into-an-array idiom below. */
function enclosingStatement(node) {
  let n = node;
  while (n && !ts.isStatement(n)) n = n.parent;
  return n ?? null;
}

/* Does the scope subtree ever name `<ident>.error` (or destructure `error`
 * off it)? That, and only that, is the error channel for a result object.
 *
 * THE THIRD ARM IS THE ARRAY IDIOM, and leaving it out is what made the first
 * measured run of this detector fire on src/app/dashboard/page.tsx, a site
 * that checks its three results properly:
 *
 *     const failed = [total, bull, bear].filter((r) => r.error);
 *     if (failed.length > 0) { ...; return; }
 *
 * The error is named on the callback's parameter, never on `total`, so a
 * search for `total.error` finds nothing and the site looks unchecked when it
 * is the opposite: a deliberate fix someone already shipped, with a comment
 * saying so. Any statement that both collects the identifier into an array
 * literal and names `.error` counts as having consulted it. */
function namesErrorOn(scope, name) {
  let found = false;
  forEachNode(scope, (n) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'error') {
      const root = rootIdentifier(n.expression);
      if (root && root.text === name) found = true;
    }
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      const root = rootIdentifier(n.initializer);
      if (root && root.text === name && n.name.elements.some((e) => bindingKey(e) === 'error')) found = true;
    }
    if (ts.isArrayLiteralExpression(n) &&
        n.elements.some((el) => ts.isIdentifier(unwrap(el)) && unwrap(el).text === name)) {
      const stmt = enclosingStatement(n);
      if (stmt && /\.error\b/.test(stmt.getText(stmt.getSourceFile()))) found = true;
    }
  });
  return found;
}

/* The error channel for a fetch response is its status. A try/catch around
 * `.json()` catches a transport fault but never a 500 that answered JSON. */
function namesStatusOn(scope, name) {
  let found = false;
  forEachNode(scope, (n) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n) && (n.name.text === 'ok' || n.name.text === 'status')) {
      const root = rootIdentifier(n.expression);
      if (root && root.text === name) found = true;
    }
  });
  return found;
}

function scopeText(scope) {
  return scope.getSourceFile().text.slice(scope.getStart(), scope.end);
}

/* ------------------------------------------------------------------ */
/* Read bindings.                                                      */
/* ------------------------------------------------------------------ */

/**
 * Every identifier in the file that is bound from a recognised read, with a
 * decided answer to "is this read's error channel ever named in its scope".
 */
function collectReadBindings(sourceFile) {
  const reads = [];

  const push = (ident, scope, decl, checked, kind) => {
    if (!ident || !ts.isIdentifier(ident)) return;
    reads.push({ name: ident.text, scope, declEnd: decl.end, checked, kind });
  };

  forEachNode(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    const scope = enclosingScope(node);
    const init = node.initializer;

    // const { data: x, error } = await supabase.from(...)...
    if (ts.isObjectBindingPattern(node.name)) {
      const inner = awaited(init) ?? unwrap(init);
      if (!isSupabaseRead(inner)) return;
      const dataEl = node.name.elements.find((e) => bindingKey(e) === 'data');
      const hasError = node.name.elements.some((e) => bindingKey(e) === 'error');
      if (dataEl && ts.isIdentifier(dataEl.name)) {
        push(dataEl.name, scope, node, hasError, 'supabase-destructure');
      }
      return;
    }

    // const [a, b] = await Promise.all([<chain>, <chain>])
    if (ts.isArrayBindingPattern(node.name)) {
      const els = promiseAllElements(init);
      if (!els) return;
      node.name.elements.forEach((bind, i) => {
        const src = els[i];
        if (!src || ts.isOmittedExpression(bind) || !ts.isIdentifier(bind.name)) return;
        if (!isSupabaseRead(src)) return;
        push(bind.name, scope, node, namesErrorOn(scope, bind.name.text), 'supabase-settled');
      });
      return;
    }

    if (!ts.isIdentifier(node.name)) return;
    const name = node.name.text;

    // const r = await supabase.from(...)...
    const inner = awaited(init) ?? unwrap(init);
    if (isSupabaseRead(inner)) {
      push(node.name, scope, node, namesErrorOn(scope, name), 'supabase-result');
      return;
    }

    // const j = await r.json()
    const target = jsonCallTarget(init);
    if (target !== undefined) {
      const respRoot = rootIdentifier(target);
      // No response identifier at all, as in `await (await fetch(u)).json()`,
      // means the status was thrown away at the call site and can never be
      // consulted. That is an unchecked read by construction.
      const checked = respRoot ? namesStatusOn(scope, respRoot.text) : false;
      push(node.name, scope, node, checked, 'fetch-json');
    }
  });

  return reads;
}

/* ------------------------------------------------------------------ */
/* Operand shapes.                                                     */
/* ------------------------------------------------------------------ */

const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);

/** `!x`, `a === b`, `true`. A default never has one of these as an operand. */
function isBooleanShaped(node) {
  const n = unwrap(node);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) return true;
  if (ts.isBinaryExpression(n) && COMPARISONS.has(n.operatorToken.kind)) return true;
  if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) return true;
  return false;
}

/** Is this node the condition of a branch, rather than a value? */
function inConditionPosition(node) {
  let child = node;
  let p = node.parent;
  while (p) {
    if (ts.isParenthesizedExpression(p)) { child = p; p = p.parent; continue; }
    if (ts.isBinaryExpression(p) &&
        (p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
         p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
      child = p; p = p.parent; continue;
    }
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return true;
    if (ts.isIfStatement(p) && p.expression === child) return true;
    if (ts.isConditionalExpression(p) && p.condition === child) return true;
    if (ts.isWhileStatement(p) && p.expression === child) return true;
    if (ts.isDoStatement(p) && p.expression === child) return true;
    if (ts.isForStatement(p) && p.condition === child) return true;
    return false;
  }
  return false;
}

const ERROR_NAME = /^(error|err|e)$/i;
const ERROR_SUFFIX = /(Error|Err)$/;

/** An operand that is true when a read faulted. */
function isErrorOperand(node) {
  const n = unwrap(node);
  if (ts.isIdentifier(n)) return ERROR_NAME.test(n.text) || ERROR_SUFFIX.test(n.text);
  if (ts.isPropertyAccessExpression(n)) {
    if (n.name.text === 'error') return true;
    return ERROR_SUFFIX.test(n.name.text);
  }
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = unwrap(n.operand);
    // `!res.ok` is an error test, not an absence test.
    if (ts.isPropertyAccessExpression(inner) && inner.name.text === 'ok') return true;
  }
  return false;
}

/** An operand that is true when the read answered with nothing. */
function isAbsenceOperand(node) {
  const n = unwrap(node);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = unwrap(n.operand);
    if (isErrorOperand(n)) return false;
    if (ts.isIdentifier(inner)) return !ERROR_NAME.test(inner.text) && !ERROR_SUFFIX.test(inner.text);
    if (ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner)) {
      return inner.name?.text !== 'error' && inner.name?.text !== 'ok';
    }
    return false;
  }
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    const nullish = (x) => {
      const u = unwrap(x);
      return u.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(u) && u.text === 'undefined') ||
        (ts.isNumericLiteral(u) && u.text === '0');
    };
    if ((k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsEqualsToken) &&
        (nullish(n.right) || nullish(n.left))) {
      return true;
    }
  }
  return false;
}

/* TWO RULINGS THAT KEEP CHECK 2 OFF SITES THAT ARE ALREADY HONEST. Both are
 * mechanical, both are narrow, and both are here rather than in an ignore file
 * so that widening them is a visible diff. */

/** A branch that throws is not a rendering. It propagates, and the fault
 *  survives to whoever owns the stack. `internal-kpis.ts` does exactly
 *  this and puts `error?.message` in the thrown text, so nothing is conflated
 *  and nothing draws as empty. */
function branchThrows(branch) {
  if (!branch) return false;
  const stmts = ts.isBlock(branch) ? branch.statements : [branch];
  return stmts.some((s) => ts.isThrowStatement(s)) ||
    (!ts.isBlock(branch) && ts.isThrowStatement(branch));
}

/** A branch that USES the error is not hiding it. `trends-screen.tsx` ORs
 *  `error || !data`, then logs `error?.message` and draws its own failure
 *  state with a comment saying a failed read is never an empty list. That is
 *  the fix this detector exists to encourage, so firing on it would train
 *  people to stop reading the output. The test is narrow: the branch has to
 *  mention the very identifier the error operand named. */
function branchUsesError(branch, ops) {
  if (!branch) return false;
  const names = new Set();
  for (const o of ops) {
    if (!isErrorOperand(o)) continue;
    const n = unwrap(o);
    if (ts.isIdentifier(n)) names.add(n.text);
    else if (ts.isPropertyAccessExpression(n)) {
      const root = rootIdentifier(n);
      if (root) names.add(root.text);
    } else if (ts.isPrefixUnaryExpression(n)) {
      const root = rootIdentifier(n.operand);
      if (root) names.add(root.text);
    }
  }
  if (!names.size) return false;
  let used = false;
  forEachNode(branch, (n) => {
    if (!used && ts.isIdentifier(n) && names.has(n.text)) used = true;
  });
  return used;
}

/** `const { data: { user }, error } = await supabase.auth.getUser()` followed
 *  by `if (error || !user)` is NOT this defect. Both arms mean the same thing
 *  to the only decision downstream: nobody is signed in, and the request is
 *  denied either way. There is no third state to separate and no reader is
 *  told a document is empty. Narrow on purpose: the absence operand has to
 *  name the auth subject, and the scope has to contain the auth call. */
const AUTH_SUBJECT = /^(user|session|claims|authUser)$/;
function isAuthPresenceTest(node, ops) {
  const namesSubject = ops.some((o) => {
    const n = unwrap(o);
    if (!ts.isPrefixUnaryExpression(n) || n.operator !== ts.SyntaxKind.ExclamationToken) return false;
    const root = rootIdentifier(n.operand);
    return !!root && AUTH_SUBJECT.test(root.text);
  });
  if (!namesSubject) return false;
  return /\.auth\.(getUser|getSession|getClaims)\b/.test(scopeText(enclosingScope(node)));
}

/** Flatten an `a || b || c` chain into its operands. */
function orOperands(node, out = []) {
  const n = unwrap(node);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    orOperands(n.left, out);
    orOperands(n.right, out);
    return out;
  }
  out.push(n);
  return out;
}

/* ------------------------------------------------------------------ */
/* The lint.                                                           */
/* ------------------------------------------------------------------ */

const KIND_LABEL = {
  'supabase-destructure': 'no `error` in the destructure',
  'supabase-settled': 'the settled result\'s `.error` is never named',
  'supabase-result': 'the result\'s `.error` is never named',
  'fetch-json': 'the response status is never named',
};

export function lintText(file, text) {
  const isTsx = extname(file) === '.tsx';
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const findings = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const add = (node, rule, detail) =>
    findings.push({ file, line: at(node), rule, detail });

  const reads = collectReadBindings(sf);

  /**
   * The read binding `name` actually refers to at `pos`: innermost scope
   * first, then the LATEST declaration at or before the use.
   *
   * The second tiebreak is not decoration. `src/lib/radar-calls-data.ts`
   * declares four separate `const { data ... } = await supabase...` in one
   * function body. Taking the first match made every later use read the first
   * declaration's error answer, so a block that checks its error properly
   * (`const { data, error: evErr } = ...; if (!evErr) ...`) was reported as
   * unchecked. A detector that mis-resolves a name is worse than no detector,
   * because the finding looks specific and is about the wrong line.
   */
  function readFor(name, pos) {
    let best = null;
    for (const r of reads) {
      if (r.name !== name) continue;
      if (pos < r.declEnd) continue;
      const s = r.scope.getStart(sf);
      if (pos < s || pos > r.scope.end) continue;
      if (!best) { best = r; continue; }
      const bs = best.scope.getStart(sf);
      if (s > bs) best = r;
      else if (s === bs && r.declEnd > best.declEnd) best = r;
    }
    return best;
  }

  forEachNode(sf, (node) => {
    /* ---- check 1 ------------------------------------------------- */
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      const isNullish = node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
      // A boolean OR is not a default. `??` is always a default, whatever
      // position it sits in, so only `||` is filtered on position.
      const valuePosition =
        isNullish ||
        (!inConditionPosition(node) && !isBooleanShaped(node.left) && !isBooleanShaped(node.right));
      if (valuePosition) {
        const root = rootIdentifier(node.left);
        if (root) {
          const r = readFor(root.text, root.getStart(sf));
          if (r && !r.checked) {
            const op = isNullish ? '??' : '||';
            add(
              node,
              'defaulted-unchecked-read',
              `\`${root.text}\` is bound from a read (${r.kind}) where ${KIND_LABEL[r.kind]}; ` +
                `\`${op}\` then draws the fallback for a fault and for a genuine absence alike`,
            );
          }
        }
      }
    }

    /* ---- check 2 ------------------------------------------------- */
    let cond = null;
    let branch = null;
    if (ts.isIfStatement(node)) { cond = node.expression; branch = node.thenStatement; }
    else if (ts.isConditionalExpression(node)) { cond = node.condition; branch = node.whenTrue; }
    if (cond) {
      const inner = unwrap(cond);
      if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        const ops = orOperands(inner);
        const errs = ops.filter(isErrorOperand);
        const gone = ops.filter(isAbsenceOperand);
        if (errs.length && gone.length && !branchThrows(branch) &&
            !branchUsesError(branch, ops) && !isAuthPresenceTest(node, ops)) {
          add(
            node,
            'error-or-empty',
            `\`${cond.getText(sf).replace(/\s+/g, ' ').slice(0, 70)}\` sends a fault and an ` +
              `absence down the same branch, so a read that did not answer draws as one that answered empty`,
          );
        }
      }
    }

    /* ---- check 3 ------------------------------------------------- */
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'single' &&
      node.arguments.length === 0 &&
      // A `.single()` hanging off a write is not a read, and PGRST116 there
      // means the write matched no row, which is a different question with a
      // different right answer. `src/app/api/user-profile/route.ts` upserts
      // and selects in one chain; asking it to discriminate a read code would
      // be asking for the wrong check.
      !chainNames(node).names.some((n) => WRITE_VERBS.has(n))
    ) {
      const scope = enclosingScope(node);
      const body = scopeText(scope);
      if (!body.includes('PGRST116')) {
        // Only a fault the code already looks at can be misread. If nothing
        // inspects the error at all, that is check 1's business, not this one.
        if (/\berror\b/.test(body) || /\.code\b/.test(body)) {
          add(
            node,
            'single-without-pgrst116',
            '`.single()` error is inspected without discriminating PGRST116, the one code ' +
              'that means the query ran and matched no row; every other code is a read that did not answer',
          );
        }
      }
    }
  });

  return findings;
}

/* ------------------------------------------------------------------ */
/* CLI. Lifted from design-lint.mjs so both gates behave alike.        */
/* ------------------------------------------------------------------ */

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(e) || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(extname(p)) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function git(argv) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...argv], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
}

function addedLinesSince(ref) {
  let out;
  try {
    out = git(['diff', '-U0', '--no-color', '--diff-filter=d', `${ref}...HEAD`]);
  } catch (e) {
    console.error(`read-lint: git diff against ${ref} failed`);
    console.error(String(e.stderr || e.message).trim());
    process.exit(2);
  }
  const added = new Map();
  let file = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (file && !added.has(file)) added.set(file, new Set());
      continue;
    }
    if (!file || !line.startsWith('@@')) continue;
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
    for (let i = 0; i < count; i++) added.get(file).add(start + i);
  }
  return added;
}

function uncommitted(files) {
  if (!files.length) return [];
  try {
    return git(['diff', '--name-only', 'HEAD', '--', ...files]).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function main(args) {
  const isExcluded = (f) => f.split('/').some((seg) => EXCLUDE_DIRS.has(seg));

  const sinceIdx = args.indexOf('--since');
  const sinceRef = sinceIdx === -1 ? null : args[sinceIdx + 1];
  if (sinceIdx !== -1 && (!sinceRef || sinceRef.startsWith('--'))) {
    console.error('read-lint: --since needs a ref, e.g. --since origin/main');
    process.exit(2);
  }

  const addedByFile = sinceRef ? addedLinesSince(sinceRef) : null;

  let files;
  if (sinceRef) {
    /* The diff numbers lines in HEAD's blob; this lints the working tree.
     * While they disagree the new / pre-existing split cannot be trusted, and
     * a gate that cannot trust its own answer refuses to run. */
    const drifted = uncommitted([...addedByFile.keys()]);
    if (drifted.length) {
      console.error(
        `read-lint --since ${sinceRef}: refusing to run. ${drifted.length} file(s) in the ` +
          'diff have uncommitted changes.');
      console.error('Commit or stash, then re-run:');
      for (const d of drifted) console.error(`  ${d}`);
      process.exit(2);
    }
    files = [...addedByFile.keys()].filter(
      (f) => EXT.has(extname(f)) && !f.endsWith('.d.ts') && !isExcluded(f) && existsSync(f),
    );
  } else if (args.includes('--all')) {
    files = walk(SRC);
  } else {
    files = args.filter((f) => EXT.has(extname(f)) && !isExcluded(f));
  }

  if (!files.length) {
    console.log(
      sinceRef
        ? `read-lint --since ${sinceRef}: no lintable files touched`
        : 'read-lint: no files to check');
    process.exit(0);
  }

  const findings = [];
  for (const f of files) {
    try {
      findings.push(...lintText(f, readFileSync(f, 'utf8')));
    } catch (e) {
      findings.push({ file: f, line: 0, rule: 'unreadable', detail: e.message });
    }
  }

  const reported = sinceRef
    ? findings.filter((f) => f.line === 0 || addedByFile.get(f.file)?.has(f.line))
    : findings;

  for (const f of reported) {
    console.log(`READ  ${f.file}:${f.line}  [${f.rule}]  ${f.detail}`);
  }

  const byRule = {};
  for (const f of reported) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  const touchedFiles = new Set(reported.map((f) => f.file)).size;

  console.log('');
  if (sinceRef) {
    const preExisting = findings.length - reported.length;
    console.log(`read-lint --since ${sinceRef}: ${files.length} files touched`);
    console.log(`${reported.length} new, ${preExisting} pre-existing in touched files`);
  } else {
    console.log(`read-lint: ${files.length} files scanned`);
  }
  console.log(`FLOOR: ${reported.length} findings across ${touchedFiles} files`);
  for (const rule of Object.keys(byRule).sort()) {
    console.log(`  ${String(byRule[rule]).padStart(4)}  ${rule}`);
  }
  console.log('');
  console.log('Report only. This run exits 0 whatever it found. The ratchet lands next,');
  console.log('once the floor above has been read and agreed.');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
