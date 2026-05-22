"""WD49 backfill v2 — hardened against the 17h stall observed in v1 (PID 82112).

Diff vs v1:
  1. 60s timeout on every Gemini call (nested ThreadPoolExecutor).
  2. 30s timeout on every Supabase UPDATE.
  3. 429 backoff: sleep min(60, 2**attempt), 5 retries, then skip+log.
  4. WORKERS 5 -> 3 (reduce concurrency pressure).
  5. Per-worker watchdog: 10-minute stale threshold; main respawns dead workers.
  6. HEARTBEAT line every 60s (workers/processed/errors/queue_remaining).
  7. Bounded retry queue (cap 100); overflow flushes oldest to errors file.
  8. SIGTERM handler: drain in-flight, write summary, exit cleanly.
  +  WD49_LIMIT env var: process at most N rows then exit (for smoke tests).

Resumability unchanged: re-querying WHERE sentiment_reason IS NULL on start
naturally skips already-completed rows.

Scope unchanged: writes ONLY sentiment and sentiment_reason.
"""

import argparse
import json
import os
import queue
import signal
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone

# -----------------------------------------------------------------------------
# Env load
# -----------------------------------------------------------------------------

REPO_ROOT = "/Users/noahhanning/breakingalpha"
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
ENV_PATH = os.path.join(BACKEND_DIR, ".env")


def _load_env():
    try:
        from dotenv import load_dotenv
        load_dotenv(ENV_PATH)
        return
    except ImportError:
        pass
    if not os.path.exists(ENV_PATH):
        raise SystemExit(f"backend/.env not found at {ENV_PATH}")
    with open(ENV_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


_load_env()
for required in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "GEMINI_API_KEY"):
    if not os.environ.get(required):
        raise SystemExit(f"Missing env var: {required}. Check backend/.env.")

sys.path.insert(0, BACKEND_DIR)
import ingest  # noqa: E402
from google.genai import types  # noqa: E402

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------

WORKERS = 3
PER_WORKER_DELAY_SEC = 0.15
PROGRESS_EVERY = 50
SUMMARY_EVERY_SEC = 300
HEARTBEAT_EVERY_SEC = 60
WATCHDOG_CHECK_EVERY_SEC = 60
WORKER_STALE_THRESHOLD_SEC = 600  # 10 min
GEMINI_TIMEOUT_SEC = 60
DB_TIMEOUT_SEC = 30
MAX_429_RETRIES = 5
RETRY_QUEUE_CAP = 100

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(SCRIPTS_DIR, "wd49-backfill-log.txt")
ERR_PATH = os.path.join(SCRIPTS_DIR, "wd49-backfill-errors.txt")
FLIPS_PATH = os.path.join(SCRIPTS_DIR, "wd49-backfill-flips.txt")

# -----------------------------------------------------------------------------
# Globals
# -----------------------------------------------------------------------------

SHUTDOWN = threading.Event()
LOG_LOCK = threading.Lock()
STATS_LOCK = threading.Lock()
WORKER_STATE_LOCK = threading.Lock()

STATS = {
    "processed": 0,
    "errors": 0,
    "flip_counter": {},  # str -> int
}

# worker_name -> {last_success: float, alive: bool, started_at: float}
WORKER_STATE = {}

# Retry queue (bounded by RETRY_QUEUE_CAP); use deque under lock for FIFO with overflow.
RETRY_QUEUE = deque()
RETRY_LOCK = threading.Lock()


# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------

def _ts():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log_line(msg):
    line = f"{_ts()} {msg}"
    print(line, flush=True)
    with LOG_LOCK:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def err_log(article_id, msg):
    with LOG_LOCK:
        with open(ERR_PATH, "a", encoding="utf-8") as f:
            f.write(f"{_ts()} {article_id} {msg}\n")


def flip_log(rec):
    with LOG_LOCK:
        with open(FLIPS_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")


# -----------------------------------------------------------------------------
# Article fetch
# -----------------------------------------------------------------------------

def fetch_null_articles():
    rows = []
    page = 1000
    start = 0
    while True:
        chunk = (
            ingest.supabase.table("articles")
            .select("id, title, summary, source, sentiment")
            .is_("sentiment_reason", "null")
            .order("ingested_at", desc=False)
            .range(start, start + page - 1)
            .execute()
            .data or []
        )
        rows.extend(chunk)
        if len(chunk) < page:
            break
        start += page
    return rows


# -----------------------------------------------------------------------------
# Gemini + DB with timeouts
# -----------------------------------------------------------------------------

def _is_rate_limit(ex: Exception) -> bool:
    msg = str(ex)
    code = getattr(ex, "code", None) or getattr(ex, "status_code", None)
    if code == 429:
        return True
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        return True
    if "rate" in msg.lower() and "limit" in msg.lower():
        return True
    return False


def _gemini_call(prompt):
    return ingest.gemini_client.models.generate_content(
        model=ingest.GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.2,
            max_output_tokens=2048,
            response_mime_type="application/json",
            response_schema=ingest.FilterDecision,
        ),
    )


def classify_with_backoff(article):
    """Call Gemini with 60s per-attempt timeout and 429 backoff (5 retries)."""
    prompt = ingest.FILTER_PROMPT.format(
        title=article.get("title") or "",
        summary=article.get("summary") or "",
        source=article.get("source") or "",
    )
    last_ex = None
    for attempt in range(MAX_429_RETRIES + 1):
        if attempt > 0:
            sleep_s = min(60, 2 ** attempt)
            time.sleep(sleep_s)
        try:
            with ThreadPoolExecutor(max_workers=1) as ex:
                fut = ex.submit(_gemini_call, prompt)
                try:
                    resp = fut.result(timeout=GEMINI_TIMEOUT_SEC)
                except FuturesTimeoutError:
                    raise TimeoutError(f"Gemini call exceeded {GEMINI_TIMEOUT_SEC}s")
            text = (resp.text or "").strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            text = text.strip()
            return ingest.FilterDecision.model_validate_json(text)
        except Exception as ex:
            last_ex = ex
            if not _is_rate_limit(ex):
                raise
    raise last_ex if last_ex else RuntimeError("classify_with_backoff exhausted")


def update_with_timeout(article_id, sentiment, sentiment_reason):
    def _do():
        return (
            ingest.supabase.table("articles")
            .update({"sentiment": sentiment, "sentiment_reason": sentiment_reason})
            .eq("id", article_id)
            .execute()
        )

    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(_do)
        try:
            return fut.result(timeout=DB_TIMEOUT_SEC)
        except FuturesTimeoutError:
            raise TimeoutError(f"DB update exceeded {DB_TIMEOUT_SEC}s")


# -----------------------------------------------------------------------------
# Retry queue helpers
# -----------------------------------------------------------------------------

def retry_push(article):
    """Append to retry queue; evict oldest to errors file on overflow."""
    with RETRY_LOCK:
        if len(RETRY_QUEUE) >= RETRY_QUEUE_CAP:
            evicted = RETRY_QUEUE.popleft()
            err_log(evicted.get("id", "?"), "RETRY_QUEUE_OVERFLOW_DROPPED")
        RETRY_QUEUE.append(article)


def retry_pop():
    with RETRY_LOCK:
        if RETRY_QUEUE:
            return RETRY_QUEUE.popleft()
    return None


def retry_size():
    with RETRY_LOCK:
        return len(RETRY_QUEUE)


# -----------------------------------------------------------------------------
# Worker
# -----------------------------------------------------------------------------

def worker(worker_name, article_queue, total):
    with WORKER_STATE_LOCK:
        WORKER_STATE[worker_name] = {
            "last_success": time.time(),
            "alive": True,
            "started_at": time.time(),
        }

    try:
        while not SHUTDOWN.is_set():
            # Watchdog kill check
            with WORKER_STATE_LOCK:
                if not WORKER_STATE[worker_name]["alive"]:
                    log_line(f"WORKER {worker_name}: watchdog-marked-dead, exiting")
                    return

            article = None
            try:
                article = article_queue.get(timeout=2)
            except queue.Empty:
                # Try retry queue
                article = retry_pop()
                if article is None:
                    # Both empty — exit if shutdown or no more sources
                    if SHUTDOWN.is_set():
                        return
                    # Spin briefly; main may decide to terminate
                    continue

            article_id = article["id"]
            existing = article.get("sentiment") or ""
            title = (article.get("title") or "")[:80]

            try:
                decision = classify_with_backoff(article)
                new_sent = decision.sentiment
                new_reason = decision.sentiment_reason

                update_with_timeout(article_id, new_sent, new_reason)

                with WORKER_STATE_LOCK:
                    WORKER_STATE[worker_name]["last_success"] = time.time()

                with STATS_LOCK:
                    STATS["processed"] += 1
                    changed = existing != new_sent
                    flip_key = f"{existing}->{new_sent}" if changed else "unchanged"
                    STATS["flip_counter"][flip_key] = STATS["flip_counter"].get(flip_key, 0) + 1
                    processed_now = STATS["processed"]

                tag = "FLIP" if existing != new_sent else "    "
                log_line(f"  [{processed_now}/{total}] {article_id[:8]} {existing:>7}->{new_sent:<7} {tag}")

                if existing != new_sent:
                    flip_log({
                        "article_id": article_id,
                        "title": title,
                        "existing": existing,
                        "new": new_sent,
                        "reason": new_reason,
                    })

                if processed_now % PROGRESS_EVERY == 0:
                    elapsed = time.time() - START_TIME
                    rate = (processed_now / elapsed) * 60 if elapsed > 0 else 0
                    remaining = (total - processed_now) / (processed_now / elapsed) if processed_now and elapsed else 0
                    eta = f"{remaining/3600:.1f}h" if remaining >= 3600 else f"{remaining/60:.0f}m"
                    with STATS_LOCK:
                        err_n = STATS["errors"]
                    log_line(
                        f"PROGRESS {processed_now}/{total} | errors={err_n} | "
                        f"rate={rate:.1f}/min | ETA={eta}"
                    )

                time.sleep(PER_WORKER_DELAY_SEC)
            except Exception as ex:
                err_msg = f"{type(ex).__name__}: {str(ex)[:300]}"
                err_log(article_id, err_msg)
                with STATS_LOCK:
                    STATS["errors"] += 1
                log_line(f"  ERROR [{worker_name}] {article_id[:8]}: {err_msg}")
                retry_push(article)
    finally:
        with WORKER_STATE_LOCK:
            if worker_name in WORKER_STATE:
                WORKER_STATE[worker_name]["alive"] = False


# -----------------------------------------------------------------------------
# Heartbeat thread
# -----------------------------------------------------------------------------

def heartbeat_thread(article_queue):
    while not SHUTDOWN.is_set():
        # Sleep in short slices so SIGTERM is responsive.
        for _ in range(HEARTBEAT_EVERY_SEC):
            if SHUTDOWN.is_set():
                return
            time.sleep(1)
        with WORKER_STATE_LOCK:
            alive = sum(1 for v in WORKER_STATE.values() if v["alive"])
        with STATS_LOCK:
            processed = STATS["processed"]
            errors = STATS["errors"]
        q_remaining = article_queue.qsize() + retry_size()
        log_line(
            f"HEARTBEAT workers={alive} processed={processed} errors={errors} "
            f"queue_remaining={q_remaining}"
        )


# -----------------------------------------------------------------------------
# Watchdog thread
# -----------------------------------------------------------------------------

def watchdog_thread():
    while not SHUTDOWN.is_set():
        for _ in range(WATCHDOG_CHECK_EVERY_SEC):
            if SHUTDOWN.is_set():
                return
            time.sleep(1)
        now = time.time()
        with WORKER_STATE_LOCK:
            for name, state in list(WORKER_STATE.items()):
                if state["alive"] and (now - state["last_success"]) > WORKER_STALE_THRESHOLD_SEC:
                    log_line(
                        f"WATCHDOG {name}: stale "
                        f"({int(now - state['last_success'])}s since last write) -- marking dead"
                    )
                    state["alive"] = False  # worker self-exits on next loop top


# -----------------------------------------------------------------------------
# SIGTERM handler
# -----------------------------------------------------------------------------

def install_signal_handlers():
    def _handler(signum, _frame):
        log_line(f"Signal {signum} received -- draining and exiting cleanly")
        SHUTDOWN.set()

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

START_TIME = time.time()


def main():
    install_signal_handlers()

    parser = argparse.ArgumentParser(description="WD49 backfill v2 (hardened).")
    args = parser.parse_args()

    log_line("Fetching NULL-sentiment_reason articles from production...")
    articles = fetch_null_articles()
    log_line(f"Found {len(articles)} articles where sentiment_reason IS NULL.")

    limit_env = os.environ.get("WD49_LIMIT")
    if limit_env:
        try:
            limit = int(limit_env)
            articles = articles[:limit]
            log_line(f"WD49_LIMIT={limit} active: processing first {len(articles)} only.")
        except ValueError:
            log_line(f"WD49_LIMIT={limit_env!r} not an int -- ignoring.")

    if not articles:
        log_line("Nothing to backfill. Exiting.")
        return

    total = len(articles)
    article_queue = queue.Queue()
    for a in articles:
        article_queue.put(a)

    log_line(f"=== WD49 backfill v2 start: articles={total} | workers={WORKERS} ===")

    # Aux threads (daemon: die on main exit)
    hb_t = threading.Thread(target=heartbeat_thread, args=(article_queue,), name="heartbeat", daemon=True)
    hb_t.start()
    wd_t = threading.Thread(target=watchdog_thread, name="watchdog", daemon=True)
    wd_t.start()

    # Workers
    worker_threads = []
    next_worker_id = [1]  # mutable closure

    def spawn_worker():
        name = f"W{next_worker_id[0]}"
        next_worker_id[0] += 1
        t = threading.Thread(
            target=worker, args=(name, article_queue, total),
            name=name, daemon=False,
        )
        t.start()
        worker_threads.append(t)
        return name

    for _ in range(WORKERS):
        spawn_worker()

    # Main supervision loop: respawn workers if pool drops below WORKERS while work remains.
    while not SHUTDOWN.is_set():
        time.sleep(5)
        q_total = article_queue.qsize() + retry_size()
        with WORKER_STATE_LOCK:
            alive = sum(1 for v in WORKER_STATE.values() if v["alive"])
        if q_total == 0 and alive == 0:
            break  # done
        if alive < WORKERS and q_total > 0:
            for _ in range(WORKERS - alive):
                name = spawn_worker()
                log_line(f"RESPAWN: spawned new worker {name} (pool was {alive}/{WORKERS})")

    # Final drain
    log_line("Main supervision loop exiting -- waiting for workers to drain.")
    SHUTDOWN.set()
    for t in worker_threads:
        t.join(timeout=90)

    elapsed = time.time() - START_TIME

    log_line("=" * 70)
    log_line(f"BACKFILL v2 COMPLETE")
    log_line("=" * 70)
    with STATS_LOCK:
        processed = STATS["processed"]
        errors_n = STATS["errors"]
        flip_counter = dict(STATS["flip_counter"])
    log_line(f"Total processed: {processed}")
    log_line(f"Total errors:    {errors_n}")
    log_line(f"Total runtime:   {elapsed/60:.1f} min ({elapsed/3600:.2f} h)")
    log_line("FLIP DISTRIBUTION:")
    for k in sorted(flip_counter.keys()):
        log_line(f"  {k}: {flip_counter[k]}")
    est_cost = processed * 0.000167
    log_line(f"COST ESTIMATE: ~${est_cost:.4f}")
    log_line(f"LOG FILE:   {LOG_PATH}")
    log_line(f"ERROR FILE: {ERR_PATH}")
    log_line(f"FLIPS FILE: {FLIPS_PATH}")


if __name__ == "__main__":
    main()
