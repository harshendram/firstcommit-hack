"""Parent consent rules are rendered from a fixed template. The model never writes Cedar."""

from __future__ import annotations

from typing import Literal

import cedarpy

from core.ids import safe_entity_id

RuleTopic = Literal["routine", "mood", "health", "location", "all"]
# Safety is deliberately not forbiddable: the consent screen tells Amma that if she may be in
# danger, Ally will always tell her children.
FORBIDDABLE = ("routine", "mood", "health", "location")

TOPIC_WORDS = {
    "en-IN": {
        "routine": "your daily routine",
        "mood": "your mood",
        "health": "your health",
        "location": "where you are",
        "all": "anything except your safety",
    },
    "hi-IN": {
        "routine": "आपकी दिनचर्या",
        "mood": "आपका मूड",
        "health": "आपकी तबीयत",
        "location": "आप कहाँ हैं",
        "all": "सुरक्षा के अलावा कुछ भी",
    },
}


def render_forbid(rule_id: str, audience: str, topic: RuleTopic, except_emergency: bool) -> str:
    safe_entity_id(rule_id)
    if audience == "all_children":
        principal = "principal is Family"
    else:
        principal = 'principal == Family::"%s"' % safe_entity_id(audience)
    if topic != "all" and topic not in FORBIDDABLE:
        raise ValueError(f"topic {topic!r} cannot be restricted")
    topics = FORBIDDABLE if topic == "all" else (topic,)
    resources = ", ".join('Topic::"%s"' % t for t in topics)
    unless = ' unless { context.severity == "critical" }' if except_emergency else ""
    policy = (
        '@id("consent-%s")\n' % rule_id
        + "forbid(%s, action, resource)\n" % principal
        + "when { resource in [%s] }%s;\n" % (resources, unless)
    )
    cedarpy.format_policies(policy)  # raises ValueError on any syntax problem
    return policy


def describe(audience_name: str, topic: RuleTopic, except_emergency: bool, language: str) -> str:
    words = TOPIC_WORDS.get(language, TOPIC_WORDS["en-IN"])[topic]
    if language == "hi-IN":
        tail = ", सिवाय आपात स्थिति के" if except_emergency else ""
        return f"{audience_name} को {words} के बारे में नहीं बताया जाएगा{tail}।"
    tail = ", except in an emergency" if except_emergency else ""
    return f"{audience_name} won't be told about {words}{tail}."
