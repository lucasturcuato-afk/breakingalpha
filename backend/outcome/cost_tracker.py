"""Cost accumulation and abort logic for the outcome evaluator."""
from __future__ import annotations


class CostTracker:
    def __init__(self, abort_ceiling_usd: float = 5.0) -> None:
        self.abort_ceiling = abort_ceiling_usd
        self.total_cost = 0.0
        self.calls = 0
        self.costs_by_type: dict[str, float] = {}

    def add(self, output_type: str, cost_usd: float) -> None:
        self.total_cost += cost_usd
        self.calls += 1
        self.costs_by_type[output_type] = (
            self.costs_by_type.get(output_type, 0.0) + cost_usd
        )

    def should_abort(self) -> bool:
        return self.total_cost >= self.abort_ceiling

    def summary(self) -> dict:
        return {
            "total_cost_usd": round(self.total_cost, 4),
            "abort_ceiling_usd": self.abort_ceiling,
            "aborted": self.should_abort(),
            "calls": self.calls,
            "costs_by_type": {k: round(v, 4) for k, v in self.costs_by_type.items()},
        }
