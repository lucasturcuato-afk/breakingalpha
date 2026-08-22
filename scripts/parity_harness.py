#!/usr/bin/env python3
"""Emit a static parity harness for one screen of the mobile prototype.

WHY THIS EXISTS

`scripts/screen-audit.mjs parity` fingerprints the design and the build with
getComputedStyle and diffs the numbers. It needs the design side to actually
render. The prototype does not render over `file://`: its markup is a template
of `<sc-if>` branches and `{{ }}` placeholders resolved by a runtime that
loads React from the network and a design-system bundle from a path that is
not in the repo. Open the file directly and `#v3phone` comes back empty, so
every screen fingerprints as zero elements and diffs clean against anything.

This resolves the branches ahead of time and writes a plain page carrying the
prototype's own `<style>` blocks, so getComputedStyle reports the design's real
values. Point screen-audit at it with SIG_PROTOTYPE.

    python3 scripts/parity_harness.py --screen ledger
    SIG_PROTOTYPE=.parity-proto.html node scripts/screen-audit.mjs parity ledger \
        http://localhost:3000/ledger \
        --selector '[data-parity="ledger"]' --proto-selector '[data-parity="ledger"]'

HOW IT RESOLVES

Nothing here is a hand-maintained table of screen states. The prototype's own
`renderVals()` computes every flag and every string from one flat state object,
in forms that are almost all simple expressions:

    isLedger:   s.screen === 'ledger'
    briefReady: !s.briefStage || s.briefStage === 'ready' || s.briefStage === 'stale'
    openCount:  s.committed ? 7 : 6
    clock:      { landing: '6:48', ... }[s.screen] || '6:52'

So this reads the class's initial state, sets `screen` to the one you asked
for, and evaluates those expressions against it with a small JS subset
evaluator. The defaults are the design's defaults because they are read out of
the design. Add `--state` to move off them, which is how you reach a lifecycle
state the dev strip reaches by clicking:

    --state '{"briefStage":"loading"}'      the Ledger mid-load
    --state '{"committed":true}'            after the commit
    --state '{"wrapStage":"none"}'          the Evening Wrap with no wrap

WHAT IT REFUSES TO DO QUIETLY

An empty or half-resolved harness is the one failure mode that answers
confidently and wrongly, because a subtree that is not there diffs clean. So
every expression this cannot evaluate is named on stderr rather than blanked in
silence, an unknown screen lists the screens that exist, and a screen whose
subtree comes back empty exits 2 instead of writing a file.

Override anything it cannot reach with `--values '{"key":"text"}'` instead of
editing this script.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from html.parser import HTMLParser

DEFAULT_SRC = "design_handoff_signalera_mobile/Signalera Mobile v3.dc.html"
DEFAULT_OUT = ".parity-proto.html"

# Tags that carry no closing tag, so the emitter must not write one.
VOID = {
    "br", "img", "input", "hr", "meta", "link", "source", "wbr", "area",
    "col", "embed", "track",
    # SVG leaves the prototype uses.
    "path", "circle", "rect", "line", "polyline", "polygon", "ellipse",
    "use", "stop",
}

# Attributes to drop. Handlers reference runtime functions that do not exist
# here, and a stale `onclick` would make screen-audit read a plain div as
# interactive and demand a 44px tap target from it.
DROP_ATTRS = {"onclick", "oninput", "onchange", "onkeydown", "onsubmit", "onblur", "onfocus"}


class Unresolvable(Exception):
    """The expression is outside the subset. The caller names it and moves on."""


# ---------------------------------------------------------------------------
# A JS subset: enough for the shapes renderVals actually uses.
# ---------------------------------------------------------------------------

TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<line_comment>//[^\n]*)
  | (?P<block_comment>/\*.*?\*/)
  | (?P<number>\d+\.\d+|\d+)
  | (?P<ident>[A-Za-z_$][A-Za-z0-9_$]*)
  | (?P<punct>
        \?\?  | \?\.  | ===  | !== | ==  | != | >= | <= | \&\& | \|\|
      | => | > | < | \+ | - | \* | / | % | ! | \? | : | \. | , | \( | \) | \[ | \] | \{ | \}
    )
    """,
    re.VERBOSE | re.DOTALL,
)

# A `/` opens a regex only where a value cannot already have ended.
REGEX_PRECEDERS = {"(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"}


def _read_string(src: str, i: int) -> tuple[str, int]:
    """Read a quoted string starting at src[i]. Returns the value and the index after it."""
    quote = src[i]
    out = []
    i += 1
    while i < len(src):
        c = src[i]
        if c == "\\":
            nxt = src[i + 1] if i + 1 < len(src) else ""
            out.append({"n": "\n", "t": "\t", "r": "\r"}.get(nxt, nxt))
            i += 2
            continue
        if c == quote:
            return "".join(out), i + 1
        out.append(c)
        i += 1
    raise Unresolvable("unterminated string")


def tokenize(src: str) -> list[tuple[str, object]]:
    toks: list[tuple[str, object]] = []
    i = 0
    while i < len(src):
        c = src[i]
        if c in "'\"":
            value, i = _read_string(src, i)
            toks.append(("str", value))
            continue
        if c == "`":
            # Template literals are used for handler-side strings only. Refuse
            # rather than mis-read one.
            raise Unresolvable("template literal")
        if c == "/":
            prev = next((t for t in reversed(toks) if t[0] != "ws"), None)
            prev_is_value = prev is not None and (
                prev[0] in ("str", "number")
                or (prev[0] == "ident" and prev[1] not in ("return", "typeof", "in", "of"))
                or (prev[0] == "punct" and prev[1] in (")", "]"))
            )
            if not prev_is_value:
                raise Unresolvable("regex literal")
        m = TOKEN_RE.match(src, i)
        if not m:
            raise Unresolvable(f"unexpected character {src[i]!r}")
        i = m.end()
        kind = m.lastgroup
        if kind in ("ws", "line_comment", "block_comment"):
            continue
        if kind == "number":
            text = m.group()
            toks.append(("number", float(text) if "." in text else int(text)))
        else:
            toks.append((kind, m.group()))
    return toks


class Undefined:
    """JS `undefined`, kept distinct from None so `??` behaves."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "undefined"


UNDEFINED = Undefined()


def truthy(v) -> bool:
    if v is None or isinstance(v, Undefined):
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v != ""
    return True


def js_str(v) -> str:
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, Undefined):
        return "undefined"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


class Lambda:
    """A single-expression arrow function, captured unevaluated.

    renderVals builds its chip, pill, tab and button styles through these:
    `const chip = on => '...' + (on ? a : b) + '...'`. They carry font, border
    and colour, which is exactly what a parity diff compares, so a harness that
    could not call them would leave every chip on the screen blank.
    """

    def __init__(self, params: list[str], body: list, scope: dict):
        self.params = params
        self.body = body
        self.scope = scope

    def call(self, args: list):
        local = dict(self.scope)
        for i, name in enumerate(self.params):
            local[name] = args[i] if i < len(args) else UNDEFINED
        return Parser(self.body, local).parse()


def scan_tokens_to_expr_end(toks: list, i: int) -> int:
    """Index of the first token that cannot belong to the expression at `i`.

    Ternary colons are tracked against their own `?` so that a `:` belonging to
    the expression is not read as the end of it.
    """
    depth = 0
    ternary = 0
    while i < len(toks):
        k, v = toks[i]
        if k == "punct":
            if v in ("(", "[", "{"):
                depth += 1
            elif v in (")", "]", "}"):
                if depth == 0:
                    return i
                depth -= 1
            elif depth == 0:
                if v == "?":
                    ternary += 1
                elif v == ":":
                    if ternary == 0:
                        return i
                    ternary -= 1
                elif v == ",":
                    return i
        i += 1
    return i


class Parser:
    """Recursive descent over the token list. Evaluates as it parses.

    Single pass is safe here because the subset has no loops, no assignment and
    no side effects, so evaluating a branch that a ternary later discards costs
    nothing but a little work.
    """

    def __init__(self, toks: list[tuple[str, object]], scope: dict):
        self.toks = toks
        self.i = 0
        self.scope = scope

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else (None, None)

    def eat(self, kind=None, value=None):
        k, v = self.peek()
        if k is None:
            raise Unresolvable("unexpected end of expression")
        if kind and k != kind:
            raise Unresolvable(f"expected {kind}, got {k} {v!r}")
        if value is not None and v != value:
            raise Unresolvable(f"expected {value!r}, got {v!r}")
        self.i += 1
        return v

    def at(self, value) -> bool:
        k, v = self.peek()
        return k == "punct" and v == value

    def parse(self):
        value = self.ternary()
        if self.i != len(self.toks):
            raise Unresolvable(f"trailing tokens at {self.peek()!r}")
        return value

    def ternary(self):
        cond = self.logical_or()
        if self.at("?"):
            self.eat()
            a = self.ternary()
            self.eat("punct", ":")
            b = self.ternary()
            return a if truthy(cond) else b
        return cond

    def logical_or(self):
        left = self.logical_and()
        while True:
            k, v = self.peek()
            if k == "punct" and v == "||":
                self.eat()
                right = self.logical_and()
                left = left if truthy(left) else right
            elif k == "punct" and v == "??":
                self.eat()
                right = self.logical_and()
                left = right if (left is None or isinstance(left, Undefined)) else left
            else:
                return left

    def logical_and(self):
        left = self.equality()
        while self.at("&&"):
            self.eat()
            right = self.equality()
            left = right if truthy(left) else left
        return left

    def equality(self):
        left = self.relational()
        while True:
            k, v = self.peek()
            if k != "punct" or v not in ("===", "!==", "==", "!="):
                return left
            self.eat()
            right = self.relational()
            same = self._loose_eq(left, right) if v in ("==", "!=") else self._strict_eq(left, right)
            left = same if v in ("===", "==") else not same

    @staticmethod
    def _strict_eq(a, b) -> bool:
        if isinstance(a, bool) != isinstance(b, bool):
            return False
        if isinstance(a, Undefined) or isinstance(b, Undefined):
            return isinstance(a, Undefined) and isinstance(b, Undefined)
        return a == b

    @staticmethod
    def _loose_eq(a, b) -> bool:
        nullish = lambda x: x is None or isinstance(x, Undefined)
        if nullish(a) or nullish(b):
            return nullish(a) and nullish(b)
        return a == b

    def relational(self):
        left = self.additive()
        while True:
            k, v = self.peek()
            if k != "punct" or v not in (">", "<", ">=", "<="):
                return left
            self.eat()
            right = self.additive()
            try:
                left = {">": left > right, "<": left < right,
                        ">=": left >= right, "<=": left <= right}[v]
            except TypeError:
                raise Unresolvable("comparison of unlike types")

    def additive(self):
        left = self.multiplicative()
        while True:
            k, v = self.peek()
            if k != "punct" or v not in ("+", "-"):
                return left
            self.eat()
            right = self.multiplicative()
            if v == "+":
                if isinstance(left, str) or isinstance(right, str):
                    left = js_str(left) + js_str(right)
                elif isinstance(left, (int, float)) and isinstance(right, (int, float)):
                    left = left + right
                else:
                    raise Unresolvable("addition of unlike types")
            else:
                if not (isinstance(left, (int, float)) and isinstance(right, (int, float))):
                    raise Unresolvable("subtraction of unlike types")
                left = left - right

    def multiplicative(self):
        left = self.unary()
        while True:
            k, v = self.peek()
            if k != "punct" or v not in ("*", "/", "%"):
                return left
            self.eat()
            right = self.unary()
            if not (isinstance(left, (int, float)) and isinstance(right, (int, float))):
                raise Unresolvable(f"{v} on unlike types")
            if v == "*":
                left = left * right
            elif right == 0:
                raise Unresolvable("division by zero")
            elif v == "/":
                left = left / right
            else:
                left = left % right

    def unary(self):
        k, v = self.peek()
        if k == "punct" and v == "!":
            self.eat()
            return not truthy(self.unary())
        if k == "punct" and v == "-":
            self.eat()
            operand = self.unary()
            if not isinstance(operand, (int, float)):
                raise Unresolvable("negation of a non-number")
            return -operand
        return self.postfix()

    def postfix(self):
        value = self.primary()
        while True:
            k, v = self.peek()
            if k == "punct" and v in (".", "?."):
                optional = v == "?."
                self.eat()
                name = self.eat("ident")
                if optional and (value is None or isinstance(value, Undefined)):
                    return UNDEFINED
                value = self.member(value, name)
            elif k == "punct" and v == "[":
                self.eat()
                index = self.ternary()
                self.eat("punct", "]")
                value = self.index(value, index)
            elif k == "punct" and v == "(" and isinstance(value, Lambda):
                self.eat()
                args = []
                while not self.at(")"):
                    args.append(self.ternary())
                    if self.at(","):
                        self.eat()
                self.eat("punct", ")")
                value = value.call(args)
            else:
                return value

    def member(self, obj, name):
        # A method call is the only place a `(` may follow a member.
        if self.at("("):
            self.eat()
            args = []
            while not self.at(")"):
                args.append(self.ternary())
                if self.at(","):
                    self.eat()
            self.eat("punct", ")")
            return self.call_method(obj, name, args)
        if isinstance(obj, dict):
            return obj.get(name, UNDEFINED)
        if isinstance(obj, str) and name == "length":
            return len(obj)
        if isinstance(obj, list) and name == "length":
            return len(obj)
        raise Unresolvable(f"member .{name} on {type(obj).__name__}")

    @staticmethod
    def call_method(obj, name, args):
        if isinstance(obj, str):
            if name == "trim" and not args:
                return obj.strip()
            if name == "toUpperCase" and not args:
                return obj.upper()
            if name == "toLowerCase" and not args:
                return obj.lower()
        if isinstance(obj, (int, float)) and name == "toFixed" and len(args) == 1:
            return f"{obj:.{int(args[0])}f}"
        if isinstance(obj, (list, str)) and len(args) == 1:
            if name == "includes":
                return args[0] in obj
            if name == "indexOf":
                try:
                    return obj.index(args[0])
                except ValueError:
                    return -1
        raise Unresolvable(f"call .{name}()")

    @staticmethod
    def index(obj, key):
        if isinstance(obj, dict):
            return obj.get(js_str(key), UNDEFINED)
        if isinstance(obj, list):
            if isinstance(key, (int, float)) and 0 <= int(key) < len(obj):
                return obj[int(key)]
            return UNDEFINED
        raise Unresolvable(f"index into {type(obj).__name__}")

    def arrow(self):
        """Match `x => expr` or `(a, b) => expr` at the current position.

        Returns a Lambda, or None if what follows is not an arrow function, in
        which case nothing has been consumed.
        """
        start = self.i
        k, v = self.peek()
        params: list[str] = []
        if k == "ident":
            self.i += 1
        elif k == "punct" and v == "(":
            self.i += 1
            while True:
                kk, vv = self.peek()
                if kk == "punct" and vv == ")":
                    self.i += 1
                    break
                if kk != "ident":
                    self.i = start
                    return None
                self.i += 1
                kk, vv = self.peek()
                if kk == "punct" and vv == ",":
                    self.i += 1
                elif not (kk == "punct" and vv == ")"):
                    self.i = start
                    return None
        else:
            return None
        if not self.at("=>"):
            self.i = start
            return None
        params = [t[1] for t in self.toks[start:self.i] if t[0] == "ident"]
        self.i += 1  # past =>
        if self.at("{"):
            self.i = start
            raise Unresolvable("arrow with a block body")
        body_start = self.i
        body_end = scan_tokens_to_expr_end(self.toks, body_start)
        self.i = body_end
        return Lambda(params, self.toks[body_start:body_end], self.scope)

    def primary(self):
        k, v = self.peek()
        if k == "str":
            self.eat()
            return v
        if k == "number":
            self.eat()
            return v
        if k in ("ident", "punct") and (k == "ident" or v == "("):
            fn = self.arrow()
            if fn is not None:
                return fn
            k, v = self.peek()
        if k == "ident":
            self.eat()
            if v == "true":
                return True
            if v == "false":
                return False
            if v == "null":
                return None
            if v == "undefined":
                return UNDEFINED
            if v in self.scope:
                return self.scope[v]
            raise Unresolvable(f"unknown identifier {v}")
        if k == "punct" and v == "(":
            self.eat()
            inner = self.ternary()
            self.eat("punct", ")")
            # An arrow function, not a parenthesised value.
            if self.at("=>"):
                raise Unresolvable("arrow function")
            return inner
        if k == "punct" and v == "{":
            return self.object_literal()
        if k == "punct" and v == "[":
            return self.array_literal()
        raise Unresolvable(f"unexpected token {v!r}")

    def object_literal(self):
        self.eat("punct", "{")
        out = {}
        while not self.at("}"):
            kk, kv = self.peek()
            if kk in ("ident", "str"):
                self.eat()
                key = kv
            elif kk == "number":
                self.eat()
                key = js_str(kv)
            else:
                raise Unresolvable("computed object key")
            if self.at(":"):
                self.eat()
                out[key] = self.ternary()
            else:
                out[key] = self.scope.get(key, UNDEFINED)  # shorthand
            if self.at(","):
                self.eat()
        self.eat("punct", "}")
        return out

    def array_literal(self):
        self.eat("punct", "[")
        out = []
        while not self.at("]"):
            out.append(self.ternary())
            if self.at(","):
                self.eat()
        self.eat("punct", "]")
        return out


def evaluate(expr: str, scope: dict):
    return Parser(tokenize(expr), scope).parse()


# ---------------------------------------------------------------------------
# Pulling the source apart. Brace-aware, string-aware, comment-aware.
# ---------------------------------------------------------------------------

def _skip_string(src: str, i: int) -> int:
    quote = src[i]
    i += 1
    while i < len(src):
        if src[i] == "\\":
            i += 2
            continue
        if src[i] == quote:
            return i + 1
        i += 1
    return i


def scan_forward(src: str, start: int, stop_at: set[str], depth_zero_only: bool = True) -> int:
    """Walk from `start` to the first character in `stop_at` at bracket depth 0.

    Strings, comments and regex literals are stepped over, so a `,` inside a
    style string or a `//` inside a URL cannot end a value early.
    """
    depth = 0
    i = start
    last_significant = ""
    while i < len(src):
        c = src[i]
        if c in "'\"":
            i = _skip_string(src, i)
            last_significant = "'"
            continue
        if c == "`":
            i += 1
            while i < len(src) and src[i] != "`":
                i += 2 if src[i] == "\\" else 1
            i += 1
            last_significant = "`"
            continue
        if c == "/" and i + 1 < len(src):
            if src[i + 1] == "/":
                i = src.find("\n", i)
                if i == -1:
                    return len(src)
                continue
            if src[i + 1] == "*":
                end = src.find("*/", i + 2)
                i = len(src) if end == -1 else end + 2
                continue
            if last_significant in REGEX_PRECEDERS or last_significant == "":
                # A regex literal. Step to its unescaped closing slash.
                i += 1
                in_class = False
                while i < len(src):
                    if src[i] == "\\":
                        i += 2
                        continue
                    if src[i] == "[":
                        in_class = True
                    elif src[i] == "]":
                        in_class = False
                    elif src[i] == "/" and not in_class:
                        break
                    i += 1
                i += 1
                last_significant = "/"
                continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0 and c in stop_at:
                return i
            depth -= 1
        elif c in stop_at and (depth == 0 or not depth_zero_only):
            return i
        if not c.isspace():
            last_significant = c
        i += 1
    return len(src)


def split_object_pairs(body: str) -> list[tuple[str, str]]:
    """Split an object literal body into (key, raw expression) pairs.

    Only top-level pairs. Nested objects come back inside their parent's
    expression text and are evaluated there.
    """
    pairs = []
    i = 0
    n = len(body)
    while i < n:
        while i < n and (body[i].isspace() or body[i] == ","):
            i += 1
        if i < n and body.startswith("//", i):
            j = body.find("\n", i)
            i = n if j == -1 else j + 1
            continue
        if i < n and body.startswith("/*", i):
            j = body.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        if i >= n:
            break
        m = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*", body[i:])
        if not m:
            # A spread, a computed key or something else outside the subset.
            i = scan_forward(body, i, {","}) + 1
            continue
        key = m.group(1)
        i += m.end()
        if i < n and body[i] == ":":
            i += 1
            end = scan_forward(body, i, {","})
            pairs.append((key, body[i:end].strip()))
            i = end + 1
        else:
            pairs.append((key, key))  # shorthand
    return pairs


def extract_block(src: str, header: str) -> tuple[int, int]:
    """Return the (start, end) character span of the `{...}` body after `header`."""
    at = src.find(header)
    if at == -1:
        raise SystemExit(f"parity-harness: could not find {header!r} in the prototype")
    open_brace = src.index("{", at + len(header) - 1)
    close = scan_forward(src, open_brace + 1, {"}"})
    return open_brace + 1, close


def parse_initial_state(src: str) -> dict:
    """Read the class's initial `state = { ... }` literal."""
    at = src.find("\n  state = {")
    if at == -1:
        raise SystemExit("parity-harness: could not find the prototype's initial state")
    open_brace = src.index("{", at)
    close = scan_forward(src, open_brace + 1, {"}"})
    state = {}
    for key, expr in split_object_pairs(src[open_brace + 1:close]):
        try:
            state[key] = evaluate(expr, {})
        except Unresolvable:
            state[key] = UNDEFINED
    return state


def parse_module_consts(src: str, limit: int, scope: dict) -> None:
    """Evaluate top-level `const NAME = ...;` so renderVals can reference them."""
    for m in re.finditer(r"\bconst\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*", src[:limit]):
        end = scan_forward(src, m.end(), {";"})
        try:
            scope[m.group(1)] = evaluate(src[m.end():end].strip(), dict(scope))
        except Unresolvable:
            continue


def parse_locals(src: str, start: int, end: int, scope: dict) -> None:
    """Evaluate renderVals' own `const` locals, in source order.

    One `const` may declare several names (`const a = 1, b = 2;`), and later
    locals reference earlier ones, so each declarator lands in scope before the
    next is evaluated.

    `let` is read too, but only its initialiser. A `let` that a loop reassigns
    keeps the value it was declared with, which is right for the state the
    prototype starts in and wrong once you drive it somewhere the loop matters.
    Force the flag with --flags when that bites.
    """
    for m in re.finditer(r"\b(?:const|let)\s+(?=[A-Za-z_$])", src[start:end]):
        pos = start + m.end()
        statement_end = scan_forward(src, pos, {";"})
        while pos < statement_end:
            d = re.match(r"\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*", src[pos:statement_end])
            if not d:
                break
            value_start = pos + d.end()
            value_end = scan_forward(src, value_start, {",", ";"})
            value_end = min(value_end, statement_end)
            try:
                scope[d.group(1)] = evaluate(src[value_start:value_end].strip(), scope)
            except Unresolvable:
                pass
            pos = value_end + 1


# ---------------------------------------------------------------------------
# Resolving one screen.
# ---------------------------------------------------------------------------

class Resolution:
    def __init__(self):
        self.flags: dict[str, bool] = {}
        self.values: dict[str, str] = {}
        self.unresolved: dict[str, str] = {}
        self.screens: list[str] = []


def resolve(src: str, screen: str, state_overrides: dict) -> Resolution:
    script_at = src.find('<script type="text/x-dc"')
    if script_at == -1:
        raise SystemExit("parity-harness: the prototype has no inline dc script")

    state = parse_initial_state(src)
    state["screen"] = screen
    state.update(state_overrides)

    render_at = src.find("  renderVals() {")
    if render_at == -1:
        raise SystemExit("parity-harness: could not find renderVals() in the prototype")
    return_at = src.index("return {", render_at)
    body_start, body_end = extract_block(src, src[return_at:return_at + 8])

    scope: dict = {}
    parse_module_consts(src, render_at, scope)
    scope["s"] = state
    parse_locals(src, render_at, return_at, scope)

    out = Resolution()
    for key, expr in split_object_pairs(src[body_start:body_end]):
        # Handlers are not values. Skipping them silently keeps the unresolved
        # report about things a harness might actually be missing.
        stripped = expr.lstrip()
        if stripped.startswith("()") or stripped.startswith("function") or "=>" in stripped[:24]:
            continue
        try:
            value = evaluate(expr, scope)
        except Unresolvable as exc:
            out.unresolved[key] = str(exc)
            continue
        if isinstance(value, bool):
            out.flags[key] = value
        elif isinstance(value, (str, int, float)):
            out.values[key] = js_str(value)
        # dicts, lists and undefined are not renderable text; leave them out.

    # The screens the prototype knows about, read off its own root flags.
    out.screens = sorted(set(re.findall(r"is[A-Z][A-Za-z0-9]*:\s*s\.screen === '([a-z]+)'", src)))
    return out


class HarnessBuilder(HTMLParser):
    """Emit the requested screen's subtree with every `sc-if` resolved.

    `skip` counts enclosing sc-if blocks that evaluated false. While it is above
    zero nothing is emitted, which drops a whole false branch including nested
    tags. `stack` exists to find the close of the root sc-if and nothing else.
    """

    def __init__(self, flags: dict[str, bool], root_flag: str):
        super().__init__(convert_charrefs=False)
        self.flags = flags
        self.root_flag = root_flag
        self.on = False
        self.skip = 0
        self.stack: list[str] = []
        self.out: list[str] = []
        self.unknown_flags: set[str] = set()
        self.elements = 0

    def _truth(self, flag: str, record: bool) -> bool:
        if flag == "true":
            return True
        if flag == "false":
            return False
        if flag not in self.flags:
            # Only worth naming when the branch is one this screen would have
            # rendered. A flag inside an already-dropped branch is moot.
            if record:
                self.unknown_flags.add(flag)
            return False
        return self.flags[flag]

    def handle_starttag(self, tag, attrs):
        if tag == "sc-if":
            flag = re.sub(r"[{}\s]", "", dict(attrs).get("value", ""))
            if not self.on:
                if flag == self.root_flag and self._truth(flag, record=False):
                    self.on = True
                    self.stack.append("sc-if")
                return
            self.stack.append("sc-if")
            if not self._truth(flag, record=self.skip == 0):
                self.skip += 1
            return
        if not self.on or self.skip:
            if self.on and tag not in VOID:
                self.stack.append(tag)
            return
        if tag not in VOID:
            self.stack.append(tag)
        rendered = "".join(
            f' {k}="{v}"' for k, v in attrs if k not in DROP_ATTRS and v is not None
        )
        self.out.append(f"<{tag}{rendered}>")
        self.elements += 1

    def handle_startendtag(self, tag, attrs):
        if not self.on or self.skip or tag == "sc-if":
            return
        rendered = "".join(
            f' {k}="{v}"' for k, v in attrs if k not in DROP_ATTRS and v is not None
        )
        self.out.append(f"<{tag}{rendered}>")
        self.elements += 1

    def handle_endtag(self, tag):
        if not self.on:
            return
        if tag == "sc-if":
            if self.stack:
                self.stack.pop()
            if self.skip:
                self.skip -= 1
            elif not self.stack:
                self.on = False
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        if self.skip:
            return
        if tag not in VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.on and not self.skip:
            self.out.append(data)

    def handle_entityref(self, name):
        if self.on and not self.skip:
            self.out.append(f"&{name};")

    def handle_charref(self, name):
        if self.on and not self.skip:
            self.out.append(f"&#{name};")


PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}")


def substitute(markup: str, values: dict[str, str]) -> tuple[str, set[str]]:
    missing: set[str] = set()

    def repl(m):
        key = m.group(1)
        if key in values:
            return values[key]
        if key in ("true", "false"):
            return ""
        missing.add(key)
        return ""

    return PLACEHOLDER.sub(repl, markup), missing


def screen_to_root_flag(screen: str, flags: dict[str, bool]) -> str | None:
    """The root flag is whichever `is*` the prototype's own state made true."""
    live = [k for k, v in flags.items() if v and re.fullmatch(r"is[A-Z][A-Za-z0-9]*", k)]
    if len(live) == 1:
        return live[0]
    return None


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="parity_harness.py",
        description="Emit a static parity harness for one prototype screen.",
    )
    ap.add_argument("--screen", help="screen name, as the prototype names it (see --list)")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"output path (default {DEFAULT_OUT})")
    ap.add_argument("--src", default=DEFAULT_SRC, help="prototype .dc.html path")
    ap.add_argument("--theme", default="light", choices=("light", "dark"))
    ap.add_argument("--state", default="{}", help='JSON overrides for the prototype state, eg \'{"briefStage":"loading"}\'')
    ap.add_argument("--values", default="{}", help='JSON overrides for text placeholders this cannot evaluate')
    ap.add_argument("--flags", default="{}", help='JSON overrides for sc-if branches this cannot evaluate, eg \'{"hasProposal":true}\'')
    ap.add_argument("--width", type=int, default=390, help="harness width in px (default 390)")
    ap.add_argument("--list", action="store_true", help="list the screens the prototype defines and exit")
    args = ap.parse_args()

    src_path = pathlib.Path(args.src)
    if not src_path.exists():
        print(f"parity-harness: prototype not found at {src_path}", file=sys.stderr)
        return 2
    src = src_path.read_text(encoding="utf8")

    if args.list:
        screens = sorted(set(re.findall(r"is[A-Z][A-Za-z0-9]*:\s*s\.screen === '([a-z]+)'", src)))
        print("\n".join(screens))
        return 0

    if not args.screen:
        ap.error("--screen is required (or --list)")

    try:
        state_overrides = json.loads(args.state)
        value_overrides = json.loads(args.values)
        flag_overrides = json.loads(args.flags)
    except json.JSONDecodeError as exc:
        print(f"parity-harness: bad JSON: {exc}", file=sys.stderr)
        return 2

    res = resolve(src, args.screen, state_overrides)
    res.flags.update({k: bool(v) for k, v in flag_overrides.items()})
    if args.screen not in res.screens:
        print(f"parity-harness: unknown screen {args.screen!r}", file=sys.stderr)
        print(f"  the prototype defines: {', '.join(res.screens)}", file=sys.stderr)
        return 2

    root_flag = screen_to_root_flag(args.screen, res.flags)
    if root_flag is None:
        print(f"parity-harness: {args.screen!r} did not resolve to exactly one root flag", file=sys.stderr)
        return 2

    values = dict(res.values)
    values.update({k: str(v) for k, v in value_overrides.items()})

    builder = HarnessBuilder(res.flags, root_flag)
    builder.feed(src)
    raw_markup = "".join(builder.out)
    # Scope every report to this screen. The prototype holds 31 screens' worth
    # of keys and a report that names all of them is a report nobody reads.
    referenced = set(PLACEHOLDER.findall(raw_markup)) | builder.unknown_flags
    markup, missing = substitute(raw_markup, values)

    if builder.elements == 0:
        print(f"parity-harness: {args.screen!r} resolved to an empty subtree, nothing written", file=sys.stderr)
        print(f"  root flag {root_flag} never opened. Check --state.", file=sys.stderr)
        return 2

    styles = re.findall(r"<style[^>]*>.*?</style>", src, re.S)
    out_path = pathlib.Path(args.out)
    out_path.write_text(
        "<!doctype html>"
        f"<html data-theme=\"{args.theme}\"><head><meta charset=\"utf-8\">"
        + "\n".join(styles)
        # The phone element paints its own ground. `body` cannot be relied on
        # for it: the prototype's light tokens outrank [data-theme="dark"] on
        # the root, so a dark harness kept a cream body and only the subtree
        # under the attribute went dark. A capture scoped to this element then
        # showed dark cards on a light page. The build's own screen root sets
        # its background the same way, so the two sides match by construction.
        + "<style>body{margin:0;background:var(--c-bg)}"
        f"#v3phone{{width:{args.width}px;padding:0 var(--v3-pad);"
        "box-sizing:border-box;background:var(--c-bg)}</style>"
        + "</head><body>"
        + f"<div id=\"v3phone\" data-theme=\"{args.theme}\" data-parity=\"{args.screen}\">"
        + markup
        + "</div></body></html>",
        encoding="utf8",
    )

    print(f"parity-harness: wrote {out_path}")
    print(f"  screen {args.screen} via {root_flag}, {builder.elements} elements, {len(styles)} style blocks")
    if builder.unknown_flags:
        print(f"  sc-if flags with no value, treated as false: {', '.join(sorted(builder.unknown_flags))}", file=sys.stderr)
    if missing:
        print(f"  placeholders left blank, override with --values: {', '.join(sorted(missing))}", file=sys.stderr)
    blocked = {k: v for k, v in res.unresolved.items() if k in referenced}
    if blocked:
        named = ", ".join(f"{k} ({v})" for k, v in sorted(blocked.items()))
        print(f"  expressions outside the evaluator's subset: {named}", file=sys.stderr)
    print()
    print("  next:")
    print(f"    SIG_PROTOTYPE={out_path} node scripts/screen-audit.mjs parity {args.screen} \\")
    print(f"        http://localhost:3000/{args.screen} \\")
    print(f"        --selector '[data-parity=\"{args.screen}\"]' --proto-selector '[data-parity=\"{args.screen}\"]'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
