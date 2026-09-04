"""UNPROVEN 的单次 Pressure Test Agent。

复用项目现有 OpenAI-compatible 环境配置调用百炼 Qwen。
模型只接收 Hypothesis V1 与服务端固定装入的 E01—E03；
不读取小说全文、Solution、Annotation，也不负责判断答案对错。
"""

import json
import logging
import os

from datetime import datetime, timezone
from typing import Any

import httpx

from content import EVIDENCE, SPOILER_TERMS
from schemas import AgentEvidence, AnalyzeRequest, AnalyzeResponse, PressureTestInput


logger = logging.getLogger("inkecho.ai_service")

# 保持 main 已有变量名不变；同伴的部署配置可直接继续使用。
AI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
AI_BASE_URL = os.environ.get("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
AI_MODEL = os.environ.get("AI_MODEL", "gpt-4o-mini")
AI_TIMEOUT_SECONDS = float(os.environ.get("AI_TIMEOUT_SECONDS", "10"))

FALLBACK_QUESTION = (
    "你的方案里，哪一步是文本已经明确证明的，"
    "哪一步其实是你自己补上的？"
)
ALLOWED_CATEGORIES = {
    "SPACE_PATH", "HUMAN_PASSAGE", "TOOL_SOURCE",
    "COMMUNICATION", "INSIDER_HELP", "UNCLEAR",
}
ALLOWED_EVIDENCE_IDS = {"E01", "E02", "E03"}
JUDGMENTAL_TERMS = ("你错了", "其实", "正确答案是", "标准答案")
SOLUTION_SEEKING_TERMS = (
    "你打算", "你准备", "你会如何", "你要如何",
    "利用什么", "具体条件", "具体方法", "怎样实现",
)
EVIDENCE_BOUNDARY_TERMS = ("文本", "证据", "证明", "支持")
KNOWN_SPOILER_TERMS = tuple(dict.fromkeys([
    *SPOILER_TERMS, "哈奇", "袜线", "布信", "老鼠送信",
    "排水管传递", "运输工具", "换上电工服",
]))

_AI_STATUS: dict[str, object] = {
    "api_key_configured": bool(AI_API_KEY),
    "base_url": AI_BASE_URL,
    "model": AI_MODEL,
    "mode": "model" if AI_API_KEY else "fallback",
    "last_call_at": None,
    "last_success": None,
    "last_error": None,
    "last_fallback": not bool(AI_API_KEY),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_ai_status() -> dict[str, object]:
    return dict(_AI_STATUS)


def _record_ai_status(*, success: bool | None, fallback: bool, error: str | None = None) -> None:
    _AI_STATUS.update({
        "api_key_configured": bool(AI_API_KEY),
        "base_url": AI_BASE_URL,
        "model": AI_MODEL,
        "mode": "model" if AI_API_KEY else "fallback",
        "last_call_at": _now_iso(),
        "last_success": success,
        "last_error": error,
        "last_fallback": fallback,
    })


def fallback_response() -> AnalyzeResponse:
    return AnalyzeResponse(
        selected_assumption=None,
        category="UNCLEAR",
        pressure_question=FALLBACK_QUESTION,
        rationale_evidence_ids=[],
    )


def build_pressure_test_input(request: AnalyzeRequest) -> PressureTestInput:
    """由服务端装入固定 Evidence，客户端无权扩大白名单。"""
    return PressureTestInput(
        checkpoint_id="CP2",
        hypothesis_v1=request.hypothesis_v1,
        unlocked_evidence=[
            AgentEvidence(id=evidence_id, fact=EVIDENCE[evidence_id].text)
            for evidence_id in ("E01", "E02", "E03")
        ],
    )


SYSTEM_PROMPT = """你是 UNPROVEN 的 AI Pressure Test Agent。

你不是解谜者、裁判、答案提示器或小说总结器。
你的唯一任务是：只对照提供的 Evidence，识别用户 Hypothesis V1 成立所依赖、但文本尚未证明的一个最关键前提，并提出一句中性、不剧透的压力问题。

严格规则：
1. Evidence-first：只能使用本次提供的 Evidence，不得使用小说全文、谜底、常识补全或外部知识。
2. Hypothesis-specific：必须针对用户自己的 V1。
3. One-shot：只选择一个关键未证前提；不要寻找用户遗漏的正确答案。
4. Neutral：禁止使用“你错了”“其实”“正确答案是”等判断性语言。
5. Non-spoiler：不得引入 Evidence 未出现的人物、工具、机制、身份或解决方案。
6. pressure_question 只问一个问题，长度必须为 20—60 个中文字。
7. rationale_evidence_ids 只能取本次提供的 Evidence ID，且必须与分析直接相关。
8. 若输入太短、混乱或无法可靠识别，必须返回固定 UNCLEAR 结果，不得硬猜。
9. 只返回合法 JSON，不要 Markdown，不要解释。

选择关键前提时，必须在内部完成以下判断，但不要输出过程：
- 从 V1 中辨认用户明确说出的行动或因果步骤。
- 找出连接这些步骤、却没有被 Evidence 明确支持的逻辑桥梁。
- 优先选择一旦被移除，就会让整套 V1 明显无法成立的那个前提。
- 不要把“用户没有猜到谜底”当作未证前提。

pressure_question 的写法必须审查证明边界，而不是邀请用户完善方案：
- 优先使用“文本证明了 A，但你的方案进一步默认 B；目前文本是否证明/支持 B？”的结构。
- 尽量沿用用户 V1 中已有的名词，不引入新的解法方向。
- 问题中必须出现“文本”“证据”“证明”或“支持”之一。
- 禁止使用“你打算怎么做”“你会如何”“利用什么”“具体方法”等要求用户发明方案的问法。

合格抽象示例：你的方案把“文本确认了 A”进一步理解成了“B 必然成立”。目前证据真的支持这一步吗？
不合格抽象示例：为了实现 B，你打算利用什么具体方法？

允许的 category：SPACE_PATH、HUMAN_PASSAGE、TOOL_SOURCE、COMMUNICATION、INSIDER_HELP、UNCLEAR。
JSON 必须且只能包含：selected_assumption、category、pressure_question、rationale_evidence_ids。"""


def build_agent_prompt(input_data: PressureTestInput) -> str:
    evidence_block = "\n".join(
        f"- {item.id}: {item.fact}" for item in input_data.unlocked_evidence
    )
    return f"""请根据以下输入执行一次 Pressure Test，并只返回 JSON。

[Hypothesis V1]
{input_data.hypothesis_v1.text}

[Confidence]
{input_data.hypothesis_v1.confidence}

[Unlocked Evidence]
{evidence_block}

如果无法可靠识别，请原样返回以下 JSON：
{json.dumps(fallback_response().model_dump(), ensure_ascii=False)}"""


def build_model_payload(input_data: PressureTestInput) -> dict[str, Any]:
    """构造百炼 OpenAI-compatible Chat Completions 请求体。"""
    return {
        "model": AI_MODEL,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_agent_prompt(input_data)},
        ],
        "response_format": {"type": "json_object"},
    }


def _call_model(input_data: PressureTestInput) -> dict[str, Any]:
    payload = build_model_payload(input_data)
    with httpx.Client(timeout=AI_TIMEOUT_SECONDS) as client:
        response = client.post(
            f"{AI_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {AI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        body = response.json()

    content = body["choices"][0]["message"]["content"]
    if not isinstance(content, str):
        raise TypeError("model content must be a JSON string")
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise TypeError("model output must be a JSON object")
    return parsed


def _introduces_spoiler(generated_text: str, input_data: PressureTestInput) -> bool:
    source_text = " ".join([
        input_data.hypothesis_v1.text,
        *(item.fact for item in input_data.unlocked_evidence),
    ])
    return any(
        term in generated_text and term not in source_text
        for term in KNOWN_SPOILER_TERMS
    )


def parse_model_output(raw: dict[str, Any], input_data: PressureTestInput) -> AnalyzeResponse:
    expected_keys = {
        "selected_assumption", "category",
        "pressure_question", "rationale_evidence_ids",
    }
    if set(raw) != expected_keys:
        raise ValueError("model output fields do not match schema")

    selected_assumption = raw["selected_assumption"]
    category = raw["category"]
    pressure_question = raw["pressure_question"]
    rationale_ids = raw["rationale_evidence_ids"]

    if category == "UNCLEAR":
        if selected_assumption is not None or pressure_question != FALLBACK_QUESTION or rationale_ids != []:
            raise ValueError("UNCLEAR must use the fixed fallback")
        return fallback_response()
    if category not in ALLOWED_CATEGORIES:
        raise ValueError("invalid category")
    if not isinstance(selected_assumption, str) or len(selected_assumption.strip()) < 12:
        raise ValueError("selected_assumption is unreliable")
    if not isinstance(pressure_question, str):
        raise ValueError("pressure_question must be a string")

    pressure_question = pressure_question.strip()
    if not 20 <= len(pressure_question) <= 60:
        raise ValueError("pressure_question length is out of range")
    if sum(pressure_question.count(mark) for mark in ("?", "？")) != 1:
        raise ValueError("pressure_question must contain exactly one question")
    if not isinstance(rationale_ids, list) or not rationale_ids:
        raise ValueError("rationale_evidence_ids must be a non-empty list")
    if len(rationale_ids) != len(set(rationale_ids)):
        raise ValueError("rationale_evidence_ids must be unique")
    if not set(rationale_ids).issubset(ALLOWED_EVIDENCE_IDS):
        raise ValueError("evidence id is outside the fixed whitelist")

    generated_text = f"{selected_assumption} {pressure_question}"
    if any(term in generated_text for term in JUDGMENTAL_TERMS):
        raise ValueError("judgmental language detected")
    if any(term in pressure_question for term in SOLUTION_SEEKING_TERMS):
        raise ValueError("solution-seeking language detected")
    if not any(term in pressure_question for term in EVIDENCE_BOUNDARY_TERMS):
        raise ValueError("question does not examine the evidence boundary")
    if _introduces_spoiler(generated_text, input_data):
        raise ValueError("spoiler detected")

    return AnalyzeResponse(
        selected_assumption=selected_assumption.strip(),
        category=category,
        pressure_question=pressure_question,
        rationale_evidence_ids=rationale_ids,
    )


def analyze_hypothesis(request: AnalyzeRequest) -> AnalyzeResponse:
    input_data = build_pressure_test_input(request)
    compact_text = "".join(input_data.hypothesis_v1.text.split())
    if len(compact_text) < 8:
        _record_ai_status(success=None, fallback=True, error="hypothesis too short")
        return fallback_response()
    if not AI_API_KEY:
        _record_ai_status(success=None, fallback=True, error="OPENAI_API_KEY is not configured")
        return fallback_response()

    try:
        result = parse_model_output(_call_model(input_data), input_data)
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("Pressure Test failed; using fixed fallback. reason=%s", type(exc).__name__)
        _record_ai_status(success=False, fallback=True, error=type(exc).__name__)
        return fallback_response()

    _record_ai_status(success=True, fallback=result.category == "UNCLEAR")
    return result
