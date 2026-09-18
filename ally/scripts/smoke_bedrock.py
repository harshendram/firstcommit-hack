"""Live smoke test against Bedrock: every schema, real calls, non-zero exit on any failure.

    python scripts/smoke_bedrock.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.schemas import DeviationJudgment, EvidenceAnswer, HealthProbe, MorningCheckin  # noqa: E402
from llm.bedrock import structured  # noqa: E402
from scoring.deviation import utterance_gate  # noqa: E402


async def main() -> int:
    failures = 0
    cases = [
        ("probe", "You are a health check.", "Return ok=true and word='ready'.", HealthProbe),
        (
            "morning",
            "Write a warm morning greeting in Hindi (Devanagari), at most three sentences, only using the facts.",
            '{"name": "Amma", "reminders_today": ["BP tablet after breakfast"]}',
            MorningCheckin,
        ),
        (
            "judge",
            "Judge conservatively whether family should be involved.",
            str({"signals": utterance_gate("मुझे चक्कर आ रहा है").reasons, "her_words_today": "मुझे चक्कर आ रहा है"}),
            DeviationJudgment,
        ),
        (
            "evidence",
            "Answer only from records. No records were returned, so say you are not sure.",
            "Did Amma take her tablet?",
            EvidenceAnswer,
        ),
    ]
    for name, system, prompt, model in cases:
        try:
            out = await structured(f"smoke_{name}", system, prompt, model, max_turns=2)
            print(f"OK   {name}: {out.model_dump()}")
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {exc} {getattr(exc, 'detail', '')}")
    return failures


if __name__ == "__main__":
    sys.exit(1 if asyncio.run(main()) else 0)
