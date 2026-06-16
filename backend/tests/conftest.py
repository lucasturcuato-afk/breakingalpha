"""Pytest path setup for the backend smoke tests.

The backend uses two import styles in the same tree:
  - bare:        `from outputs import record_output`   (needs backend/ on sys.path)
  - package:     `from backend.edgar import ...`        (needs repo root on sys.path)

Putting BOTH on sys.path lets either style resolve during a no-network,
no-secret import smoke. This does not change runtime behavior of the pipeline;
it only affects how pytest resolves imports during collection.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))      # backend/tests
_BACKEND = os.path.dirname(_HERE)                        # backend
_REPO = os.path.dirname(_BACKEND)                        # repo root

for _p in (_BACKEND, _REPO):
    if _p not in sys.path:
        sys.path.insert(0, _p)
