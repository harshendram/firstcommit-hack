"""Structured JSON logs + CloudWatch Embedded Metric Format (no PutMetricData permission needed)."""

from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any

_logger = logging.getLogger("ally")
if not _logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))
    _logger.addHandler(handler)
    _logger.setLevel(logging.INFO)
    _logger.propagate = False


def log(event: str, level: int = logging.INFO, **fields: Any) -> None:
    _logger.log(level, json.dumps({"event": event, **fields}, default=str))


def metric(name: str, value: float, unit: str = "Count", **dims: str) -> None:
    payload: dict[str, Any] = {
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": "Ally",
                    "Dimensions": [list(dims.keys())] if dims else [[]],
                    "Metrics": [{"Name": name, "Unit": unit}],
                }
            ],
        },
        name: value,
        **dims,
    }
    _logger.info(json.dumps(payload))
