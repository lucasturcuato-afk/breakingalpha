-- Fix: outputs.user_scroll_depth was NUMERIC(3,2) which caps at 9.99.
-- Real scroll depths exceed this, causing Postgres error 22003 on every
-- nightly outcome_evaluator UPDATE that mirrors grades back to outputs.
-- Widen to NUMERIC(5,2) → max 999.99, enough headroom for any scroll metric.

ALTER TABLE outputs ALTER COLUMN user_scroll_depth TYPE NUMERIC(5,2);
