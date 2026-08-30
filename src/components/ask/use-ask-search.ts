"use client";

import { useEffect, useRef, useState } from "react";
import {
  ASK_PENDING_VISIBLE_AFTER_MS,
  ASK_SEARCH_DEBOUNCE_MS,
  askSearchUrl,
  parseAliasOf,
  parseAskSearchRows,
  payloadFaulted,
  reachesCorpus,
  type AskSearchAnswer,
  type AskSearchState,
} from "@/lib/ask-search";

/**
 * What landed. `answer` null is a request that FAULTED, which is a different
 * fact from a request that answered with no rows and takes a different branch
 * on the screen.
 */
interface Landed {
  query: string;
  answer: AskSearchAnswer | null;
}

/**
 * The previous answer, when it is still the right thing to leave on screen
 * while a new search is in flight, and null when it is not.
 *
 * THE TEST IS A PREFIX RELATION, and it is a test rather than a stored flag for
 * a reason worth writing down. The carry exists so a list never empties and
 * refills between two keystrokes, which is what happens while a reader REFINES
 * a search: "st", "sta", "star". It must NOT happen when the reader clears the
 * field and starts a different one, because the standing directory has come
 * back by then and flashing the last search's rows over it would be a list
 * describing a query nobody typed. Every refinement leaves one string a prefix
 * of the other; a fresh search almost never does. So the relation between the
 * two strings answers the question, and no ref, no epoch and no state write
 * during an effect is needed to answer it.
 */
function heldAnswer(landed: Landed | null, typed: string): AskSearchAnswer | null {
  const answer = landed?.answer ?? null;
  if (answer === null) return null;
  return typed.startsWith(answer.query) || answer.query.startsWith(typed) ? answer : null;
}

/**
 * The one request Ask's field makes, and the guards around it.
 *
 * PENDING IS DERIVED, NOT SET, and that is the shape to keep. The obvious
 * version calls `setState({kind:"pending"})` at the top of the effect on every
 * keystroke, which is a synchronous state write inside an effect: it schedules
 * a second render pass for something the first pass already knew. There is only
 * ONE piece of state here, the answer that landed, and it is only ever written
 * from the async callback. Everything else is computed: if what landed answers
 * the string in the field, the field is `ready` or `error`; if it does not, the
 * field is `pending`. That also makes the state machine impossible to desync
 * from the input, because it is a function of the input.
 *
 * THE RACE IS GUARDED TWICE. A reader typing "starbucks" can have several
 * requests open, and PostgREST does not promise they return in order: "st" over
 * a broad `ilike` is a heavier query than "starbucks" and can land after it. A
 * slower earlier answer overwriting a faster later one would put rows on screen
 * that do not match the field. So every run takes a sequence number and drops
 * its own answer if a newer run has started, AND the superseded run is aborted
 * in the effect cleanup. The abort is the cheap half, since it stops the
 * transfer; the sequence check is the correct half, since an abort that arrives
 * after the response already resolved does nothing.
 *
 * IT NEVER ISSUES THE UNBOUNDED DEFAULT. `reachesCorpus` gates the whole
 * effect, so a one-character field makes no request at all. The route ignores
 * `q` under two characters and would answer with its 500-row default, measured
 * at 1.6 to 1.9 seconds; that request is never sent from here.
 */
export function useAskSearch(query: string): {
  state: AskSearchState;
  /**
   * Whether the screen should SAY it is searching. False for the whole of an
   * ordinary search, so the pending sentence cannot appear and disappear inside
   * half a second.
   */
  pendingVisible: boolean;
} {
  const trimmed = query.trim();
  const active = reachesCorpus(trimmed);

  const [landed, setLanded] = useState<Landed | null>(null);
  /** The query a pending run has been slow for, or null. */
  const [slowFor, setSlowFor] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!active) return;
    /* Already answered. Re-firing here would loop, since landing writes the
       state this effect depends on. */
    if (landed !== null && landed.query === trimmed) return;

    seq.current += 1;
    const mine = seq.current;
    const controller = new AbortController();

    const request = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(askSearchUrl(trimmed), { signal: controller.signal });
          const json: unknown = await res.json();
          if (mine !== seq.current) return;
          /* The route answers 200 with an `error` FIELD rather than a status
             code, so both have to be read. A faulted read is not an empty
             result and does not land as one. */
          if (!res.ok || payloadFaulted(json)) {
            setSlowFor(null);
            setLanded({ query: trimmed, answer: null });
            return;
          }
          setSlowFor(null);
          setLanded({
            query: trimmed,
            answer: {
              query: trimmed,
              rows: parseAskSearchRows(json),
              aliasOf: parseAliasOf(json),
            },
          });
        } catch (err) {
          /* An abort is this hook superseding itself, not a failure, and must
             never draw the failed-read notice. */
          if (controller.signal.aborted) return;
          if (mine !== seq.current) return;
          console.error("[ask-search] company search failed", err);
          setSlowFor(null);
          setLanded({ query: trimmed, answer: null });
        }
      })();
    }, ASK_SEARCH_DEBOUNCE_MS);

    /* Measured from the KEYSTROKE, not from the request, so the debounce is
       inside it. The threshold sits well past the ordinary total, which is what
       keeps the pending sentence off the screen for a search that is simply
       working. */
    const admit = setTimeout(() => setSlowFor(trimmed), ASK_PENDING_VISIBLE_AFTER_MS);

    return () => {
      clearTimeout(request);
      clearTimeout(admit);
      controller.abort();
    };
  }, [active, trimmed, landed]);

  let state: AskSearchState;
  if (!active) {
    state = { kind: "off" };
  } else if (landed !== null && landed.query === trimmed) {
    state =
      landed.answer === null
        ? { kind: "error", query: trimmed }
        : { kind: "ready", ...landed.answer };
  } else {
    state = { kind: "pending", query: trimmed, held: heldAnswer(landed, trimmed) };
  }

  return { state, pendingVisible: state.kind === "pending" && slowFor === trimmed };
}
