"""Single source of truth for the Gemini model IDs used across the pipeline.

LEAF module: string constants only, no imports, no client init. Any module
(including observe.py) can import it safely without triggering SDK/client setup.

The value stays the bare id "gemini-2.5-flash": it resolves natively on our
endpoint to the stable 001 revision and is generation-locked (it will not roll to
3.x). No dated 2.5 Flash TEXT snapshot exists on our endpoint to pin more tightly
(gemini-2.5-flash-001 / -preview-* all 404), so this bare id is the pin. A move to
gemini-3.5-flash is a deliberate, roughly 5x-cost, separate decision - not this one.
"""

# Synthesis / grading / extraction: the monolith brief + market pulse, deal
# extractor, adversarial, graders, digest, user synthesis, thesis, trend headlines.
GEMINI_MODEL = "gemini-2.5-flash"

# Cheaper Flash-Lite tier for the high-volume ingest relevance filter.
GEMINI_FILTER_MODEL = "gemini-2.5-flash-lite"
