"""SEC EDGAR HTTP client. Handles User-Agent compliance and 5 req/sec rate limit."""
from __future__ import annotations

import os
import time
import logging
from typing import Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)
SEC_USER_AGENT = os.environ.get("SEC_USER_AGENT", "Signalera lucas@signalera.ai")
PACING_SEC = 0.2  # 5 req/sec, half of SEC's 10/sec limit

_last_call_ts = 0.0


def _pace():
    global _last_call_ts
    now = time.time()
    elapsed = now - _last_call_ts
    if elapsed < PACING_SEC:
        time.sleep(PACING_SEC - elapsed)
    _last_call_ts = time.time()


def sec_get(url: str, *, timeout: int = 15, max_retries: int = 3) -> Optional[requests.Response]:
    """
    Fetch a URL from SEC with mandatory User-Agent and rate limiting.
    Returns Response on success, None on failure (logged).
    Retries on 429 with exponential backoff.
    """
    headers = {
        "User-Agent": SEC_USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
        "Host": urlparse(url).netloc,
    }
    for attempt in range(max_retries):
        try:
            _pace()
            resp = requests.get(url, headers=headers, timeout=timeout)
            if resp.status_code == 429:
                wait = 2 ** attempt
                logger.warning("[edgar] 429 on %s, retrying in %ds", url, wait)
                time.sleep(wait)
                continue
            if resp.status_code >= 500:
                logger.warning("[edgar] %d on %s, retrying", resp.status_code, url)
                time.sleep(2 ** attempt)
                continue
            if resp.status_code >= 400:
                logger.error("[edgar] %d on %s: %s", resp.status_code, url, resp.text[:200])
                return None
            return resp
        except requests.exceptions.RequestException as e:
            logger.error("[edgar] Request failed on %s: %s", url, e)
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    return None
