"""One-shot, end-of-reading reasoning journey summary."""

import json
import logging
from typing import Any

import httpx
from pydantic import TypeAdapter, ValidationError

from ai_service import AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_TIMEOUT_SECONDS
from content import EVIDENCE, SOLUTION_STEPS
from schemas import (
    ClueAdoptionRecord,
    CognitiveClaim,
    EvidenceImpact,
    JourneyShift,
    LateArrivingClue,
    ReasoningJourneyRequest,
    ReasoningJourneyResponse,
    ReasoningMapNode,
    SolutionCoverageItem,
    TheoryComponent,
    WorldModelJourney,
)


logger = logging.getLogger("inkecho.reasoning_journey")
ALLOWED_EVIDENCE_IDS = {"E01", "E02", "E03"}


SYSTEM_PROMPT = """你是 UNPROVEN 的终局推理复盘编辑。你的任务不是打分，而是根据用户已经留下的推理记录，写出克制、具体、有证据依据的个人复盘。

严格规则：
0. 核心产物是 world_model。它必须重建 Claim → Evidence Impact → Cognitive Operation → New Claim，而不是总结用户写过什么。
1. 只总结输入中的 V1、压力问题、用户对压力问题的回应、V2、最终推理、批注，以及服务端提供的 E01—E03 和 Solution Steps。
2. shift 必须拆成 kept / changed / added：分别写用户保留的判断、真正改变的解释、后来新增的机制。即使没有明显变化，也要如实说明“未改变”或“未新增”，不能编造。
3. clue_adoption 返回 1—4 条线索采用记录。结合批注 stage_id、V1、V2、Final 判断 noticed_at 和 adopted_at；同义表达视为同一线索。没有进入理论时写 NOT_USED，不要声称用户“差点错过”。late_arriving_clue 仍返回其中最有代表性的一条，供旧版界面兼容。
4. final_reconstruction 用一段话复述用户最终如何连接机制，不把标准答案冒充成用户自己的发现。
5. reasoning_map 必须返回 4 个“用户认知变化”节点，不是案件机制的因果链。节点严格按 V1 → CP2 → V2 → FINAL 排列；CP2 节点优先依据用户自己的 stress_answer，不能只根据 V1/V2 猜测其回应。
6. 语气像结案档案，不夸奖，不给分，不使用空泛人格标签。
7. headline 必须用“从 A 到 B”或“保留 A、补上 B”概括本次最大认知转变，不超过 70 字，不能复述整段输入。
8. theory_components 以“对象或机制”为单位比较版本，字段为 subject、before、after、status、source_stages。禁止把整段 V1/V2/Final 塞入 before 或 after；最多 6 项。
9. pressure_handling 描述用户面对质疑采取的认知动作，例如保留并辩护、收窄、重新定义、替换或补充机制。必须依据 stress_answer 与 V2，不能写人格标签。
10. confidence_insight 只解释本次确信度如何变化及其含义；不得把确信度当正确率或能力评分。
11. solution_coverage 对照 Solution Steps，列出用户已覆盖、部分覆盖或未连接的关键机制；不是评分，最多 5 项。
12. world_model.claims 只保留 2—3 个真正不同的世界模型；不得仅因措辞变化创建新节点。world_model.impacts 必须说明：哪条 Evidence 撞击了什么前提、用户执行了什么认知操作、改变前后分别相信什么。
13. operation 只能是 ASSUMPTION_EXPOSED、ROLE_REDEFINED、CLAIM_NARROWED、MECHANISM_ADDED、LINK_CREATED、IDEA_ABANDONED、CLAIM_REINFORCED。
14. counterfactual 回答“如果没有这次证据撞击，用户的解释最可能停在哪里”，只能依据版本先后关系，不得编造心理活动。
15. missing_bridge 指出用户从局部解释成长为完整系统时，最后补上的因果桥梁；不是指出标准答案遗漏项。
16. 只返回合法 JSON，字段必须且只能是 world_model、headline、shift、pressure_handling、confidence_insight、theory_components、final_reconstruction、late_arriving_clue、clue_adoption、reasoning_map、solution_coverage。solution_path 由服务端提供，不要生成。"""


def _compact_annotations(request: ReasoningJourneyRequest) -> list[dict[str, Any]]:
    return [
        {
            "quote": item.quote.strip(),
            "note": item.note.strip(),
            "stage_id": item.stage_id,
            "created_at": item.created_at.isoformat() if item.created_at else None,
        }
        for item in request.annotations
        if item.quote.strip() or item.note.strip()
    ][:20]


def build_journey_prompt(request: ReasoningJourneyRequest) -> str:
    evidence = [
        {"id": evidence_id, "fact": EVIDENCE[evidence_id].text}
        for evidence_id in ("E01", "E02", "E03")
    ]
    solution = [step.model_dump() for step in SOLUTION_STEPS]
    payload = {
        "hypothesis_v1": request.hypothesis_v1.model_dump(),
        "stress_result": request.stress_result.model_dump() if request.stress_result else None,
        "stress_answer": request.stress_answer.strip(),
        "hypothesis_v2": request.hypothesis_v2.model_dump() if request.hypothesis_v2 else None,
        "final_reasoning": request.final_reasoning.strip(),
        "annotations": _compact_annotations(request),
        "evidence": evidence,
        "solution_steps": solution,
    }
    return "请生成一次终局个人推理复盘：\n" + json.dumps(payload, ensure_ascii=False)


def build_journey_model_payload(request: ReasoningJourneyRequest) -> dict[str, Any]:
    return {
        "model": AI_MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_journey_prompt(request)},
        ],
        "response_format": {"type": "json_object"},
    }


_SYNONYMS = {
    "通信": ("通信", "联系", "传信", "消息", "联络"),
    "通道": ("排水管", "管道", "隐藏路径", "隐藏通道", "出口"),
    "外界": ("外界", "外面", "墙外", "外部"),
    "维修身份": ("电工", "维修人员", "维修工", "工人身份"),
    "停电": ("停电", "灯灭", "照明故障", "供电故障"),
}

_CLUE_CONCEPTS = {
    "通道": ("排水管", "管道", "路径", "通道", "出口", "老鼠", "消失", "不见"),
    "通信": ("通信", "联系", "联络", "传信", "消息", "布信"),
    "外界": ("外界", "外面", "墙外", "外部", "记者", "哈奇"),
    "物资交换": ("五美元", "零钱", "纸币", "钱", "交换", "工具", "物资"),
    "化学破坏": ("硝酸", "化学", "腐蚀", "钢条", "窗栏"),
    "停电": ("停电", "灯灭", "照明", "供电", "电线"),
    "维修身份": ("电工", "维修人员", "维修工", "工人身份", "换装", "制服"),
}


def _canonicalize(text: str) -> str:
    compact = "".join(text.lower().split()).replace("和", "与")
    for canonical, variants in _SYNONYMS.items():
        for variant in variants:
            compact = compact.replace(variant, canonical)
    return compact.strip("。！？,.，")


def _semantic_changed(before: str, after: str) -> bool:
    return _canonicalize(before) != _canonicalize(after)


def _concepts(text: str) -> set[str]:
    compact = _canonicalize(text)
    return {
        concept
        for concept, terms in _CLUE_CONCEPTS.items()
        if any(_canonicalize(term) in compact for term in terms)
    }


def _clue_is_expressed(quote: str, note: str, theory: str) -> bool:
    canonical_theory = _canonicalize(theory)
    phrases = [
        _canonicalize(value)
        for value in (quote, note)
        if value.strip()
    ]
    if any(phrase and phrase in canonical_theory for phrase in phrases):
        return True

    clue_concepts = _concepts(f"{quote} {note}")
    theory_concepts = _concepts(theory)
    return bool(clue_concepts & theory_concepts)


def _confidence_insight(request: ReasoningJourneyRequest, changed: bool) -> str:
    before = request.hypothesis_v1.confidence
    after = (request.hypothesis_v2 or request.hypothesis_v1).confidence
    labels = {"low": "低", "medium": "中", "high": "高"}
    if before == after:
        return (
            f"确信度保持在{labels[after]}；"
            + ("你调整了解释，但仍保留相同的把握程度。" if changed else "压力审查没有改变你的判断强度。")
        )
    direction = "上升" if ("low", "medium", "high").index(after) > ("low", "medium", "high").index(before) else "下降"
    meaning = "新解释让因果链更完整。" if direction == "上升" else "你看见了解释中的不确定部分。"
    return f"确信度从{labels[before]}变为{labels[after]}，呈{direction}；{meaning}"


def _annotation_adoption(request: ReasoningJourneyRequest) -> list[ClueAdoptionRecord]:
    v1 = request.hypothesis_v1.text
    v2 = (request.hypothesis_v2 or request.hypothesis_v1).text
    final = request.final_reasoning
    records = []
    for item in request.annotations:
        clue = item.quote.strip() or item.note.strip()
        if not clue:
            continue
        quote = item.quote.strip()
        note = item.note.strip()
        if _clue_is_expressed(quote, note, v1):
            adopted_at = "V1"
        elif _clue_is_expressed(quote, note, v2):
            adopted_at = "V2"
        elif _clue_is_expressed(quote, note, final):
            adopted_at = "FINAL"
        else:
            adopted_at = "NOT_USED"
        noticed_at = f"阅读阶段 S{item.stage_id:02d}" if item.stage_id else "批注记录"
        role = note or "被你标记为值得继续追踪的文本线索"
        basis = (
            f"这条线索于{noticed_at}被记录，并以原词或同义机制在 {adopted_at} 首次进入理论。"
            if adopted_at != "NOT_USED"
            else f"这条线索于{noticed_at}被记录，但没有在 V1、V2 或最终推理中找到可核对的同义机制。"
        )
        records.append(ClueAdoptionRecord(
            clue=clue[:120], noticed_at=noticed_at, adopted_at=adopted_at,
            role=role[:160], basis=basis[:220],
        ))
        if len(records) == 4:
            break
    return records


def _fallback_world_model(
    request: ReasoningJourneyRequest,
    *,
    changed: bool,
) -> WorldModelJourney:
    v1 = request.hypothesis_v1
    v2 = request.hypothesis_v2 or v1
    final_text = request.final_reasoning.strip()
    stress = request.stress_result
    pressure_answer = request.stress_answer.strip()

    claims = [
        CognitiveClaim(
            stage="V1", label="最初世界模型",
            claim=v1.text.strip()[:220], confidence=v1.confidence,
        ),
    ]
    if changed:
        claims.append(CognitiveClaim(
            stage="V2", label="压力审查后的模型",
            claim=v2.text.strip()[:220], confidence=v2.confidence,
        ))
    claims.append(CognitiveClaim(
        stage="FINAL", label="揭晓前的最终模型",
        claim=final_text[:220], confidence=v2.confidence,
    ))

    assumption = (
        stress.selected_assumption.strip()
        if stress and stress.selected_assumption
        else "最初解释中有一步超出了文本已经证明的范围"
    )
    evidence_ids = stress.rationale_evidence_ids if stress else []
    impacts = [EvidenceImpact(
        evidence_ids=evidence_ids,
        evidence_summary=(
            f"{', '.join(evidence_ids)} 让最初解释的证明边界变得可见"
            if evidence_ids else "压力问题让最初解释中的未证前提变得可见"
        ),
        challenged_assumption=assumption[:180],
        operation="ROLE_REDEFINED" if changed else "CLAIM_REINFORCED",
        operation_label="重新定义" if changed else "审查后保留",
        before_claim=v1.text.strip()[:180],
        after_claim=v2.text.strip()[:180],
        user_basis=(pressure_answer or "用户没有留下独立回应；只能确认最终选择。")[:220],
        counterfactual=(
            f"如果没有这次撞击，解释最可能继续停留在 V1：{v1.text.strip()}"
        )[:220],
    )]
    if _semantic_changed(v2.text, final_text):
        impacts.append(EvidenceImpact(
            evidence_ids=[],
            evidence_summary="后续阅读材料让局部解释必须连接成完整的逃脱路径",
            challenged_assumption="解释一个局部异常，就足以解释完整越狱",
            operation="LINK_CREATED",
            operation_label="建立因果连接",
            before_claim=v2.text.strip()[:180],
            after_claim=final_text[:180],
            user_basis="最终推理加入了 V2 中尚未明确连接的后续步骤。",
            counterfactual=(
                f"如果没有后续线索，理论最可能停在 V2：{v2.text.strip()}"
            )[:220],
        ))

    return WorldModelJourney(
        initial_world_model=v1.text.strip()[:240],
        final_world_model=final_text[:300],
        biggest_reconstruction=(
            "你没有简单替换答案，而是重新定义了原有线索在整个系统中的作用。"
            if changed else
            "你保留了核心判断，并把它从局部解释扩展为一条完整路径。"
        ),
        missing_bridge=(
            "从解释单个异常，到说明通信、条件制造与最终离场如何彼此连接。"
        ),
        claims=claims[:3],
        impacts=impacts[:3],
    )


def _fallback(request: ReasoningJourneyRequest) -> ReasoningJourneyResponse:
    v2 = request.hypothesis_v2 or request.hypothesis_v1
    assumption = (
        request.stress_result.selected_assumption
        if request.stress_result and request.stress_result.selected_assumption
        else "最初解释中有一步仍缺少文本直接证明"
    )
    annotated = next(
        (item.quote.strip() for item in request.annotations if item.quote.strip()),
        "",
    )
    v1_text = request.hypothesis_v1.text.strip()
    v2_text = v2.text.strip()
    final_text = request.final_reasoning.strip()
    stress_answer = request.stress_answer.strip()
    clue_adoption = _annotation_adoption(request)
    if not annotated:
        annotated = "现有记录不足以确定一条更晚进入推理的具体线索"
        clue_stage = "NOT_USED"
        clue_basis = "你没有留下可供核对的批注；因此不虚构一条只存在于批注中的线索。"
    elif clue_adoption and clue_adoption[0].adopted_at in {"V2", "FINAL"}:
        clue_stage = clue_adoption[0].adopted_at
        clue_basis = clue_adoption[0].basis
    elif clue_adoption and clue_adoption[0].adopted_at == "V1":
        clue_stage = "NOT_USED"
        clue_basis = "这条线索已经在 V1 进入理论，因此它不是后期才加入的线索。"
    elif clue_adoption and clue_adoption[0].adopted_at == "NOT_USED":
        clue_stage = "ANNOTATION_ONLY"
        clue_basis = "这条线索被批注记录，但没有在 V1、V2 或最终推理中找到可核对的同义机制。"
    else:
        annotated = "E01—E03 中仍未被你的版本变化明确引用的线索"
        clue_stage = "NOT_USED"
        clue_basis = "现有记录不能证明某条具体线索是后期才加入；因此不虚构一个“差点错过”的节点。"
    changed = _semantic_changed(v1_text, v2_text)
    world_model = _fallback_world_model(request, changed=changed)
    if changed:
        headline = "你没有放弃最初线索，而是在压力审查后重新定义了它在方案中的作用。"
        pressure_handling = "你先承认原解释的证明边界，再用 V2 收窄或重新定义了原有机制。"
        components = [
            TheoryComponent(
                subject="核心解释",
                before=v1_text[:120],
                after=v2_text[:120],
                status="CHANGED",
                source_stages=["V1", "CP2", "V2"],
            )
        ]
    else:
        headline = "你保留了最初判断，并在最终推理中补齐了后续连接。"
        pressure_handling = "你回应了未证前提，但选择保留原判断；变化主要发生在后续机制的补充上。"
        components = [
            TheoryComponent(
                subject="核心判断",
                before=v1_text[:120],
                after=v2_text[:120],
                status="KEPT",
                source_stages=["V1", "CP2", "V2"],
            )
        ]
    if final_text != v2_text:
        components.append(
            TheoryComponent(
                subject="最终连接",
                before="V2 尚未形成完整的端到端路径",
                after=final_text[:120],
                status="ADDED",
                source_stages=["V2", "FINAL"],
            )
        )

    final_lower = final_text.lower()
    coverage_terms = [
        ("隐藏通道与外界联系", ("排水", "通道", "联系", "外界")),
        ("工具或物资进入牢房", ("工具", "物资", "酸", "硝酸")),
        ("制造照明故障", ("停电", "照明", "供电", "故障")),
        ("利用维修人员身份离场", ("电工", "维修", "身份", "换装")),
    ]
    coverage = []
    for mechanism, terms in coverage_terms:
        hits = sum(term in final_lower for term in terms)
        status = "COVERED" if hits >= 2 else "PARTIAL" if hits == 1 else "NOT_CONNECTED"
        note = {
            "COVERED": "你的最终推理已经连接了这一机制。",
            "PARTIAL": "你注意到了相关线索，但尚未写清它在因果链中的作用。",
            "NOT_CONNECTED": "这项机制没有明确进入你的最终推理。",
        }[status]
        coverage.append(SolutionCoverageItem(mechanism=mechanism, status=status, note=note))

    return ReasoningJourneyResponse(
        world_model=world_model,
        headline=headline,
        shift=JourneyShift(
            kept=(f"你仍保留了对原始机制的追问：{request.hypothesis_v1.text.strip()}" if changed else f"你保留了 V1 的核心判断：{v2.text.strip()}")[:180],
            changed=(f"你不再停留在“{request.hypothesis_v1.text.strip()}”，而把解释修正为“{v2.text.strip()}”。" if changed else "压力测试后，你没有改变原有判断。")[:180],
            added=(f"最终推理新增了完整连接：{request.final_reasoning.strip()}" if request.final_reasoning.strip() != v2.text.strip() else "最终推理没有再加入新的机制。")[:180],
        ),
        pressure_handling=pressure_handling,
        confidence_insight=_confidence_insight(request, changed),
        theory_components=components,
        final_reconstruction=request.final_reasoning.strip()[:360],
        late_arriving_clue=LateArrivingClue(
            clue=annotated[:180],
            arrived_at=clue_stage,
            basis=clue_basis,
            evidence_ids=[],
        ),
        clue_adoption=clue_adoption,
        reasoning_map=[
            ReasoningMapNode(stage="V1", label="最初判断", detail=request.hypothesis_v1.text.strip()[:100], evidence_ids=[]),
            ReasoningMapNode(
                stage="CP2",
                label="回应质疑",
                detail=(stress_answer or f"压力测试要求重新检查：{assumption}")[:100],
                evidence_ids=(request.stress_result.rationale_evidence_ids if request.stress_result else []),
            ),
            ReasoningMapNode(stage="V2", label="审查决定", detail=v2.text.strip()[:100], evidence_ids=[]),
            ReasoningMapNode(stage="FINAL", label="最终连接", detail=request.final_reasoning.strip()[:100], evidence_ids=[]),
        ],
        solution_coverage=coverage,
        solution_path=SOLUTION_STEPS,
        source="fallback",
    )


def _parse(raw: dict[str, Any], request: ReasoningJourneyRequest) -> ReasoningJourneyResponse:
    """Accept valid model fields independently instead of discarding the whole dossier."""
    fallback = _fallback(request).model_dump(exclude={"solution_path", "source"})
    expected = set(fallback)
    merged = dict(fallback)
    for field, value in raw.items():
        if field not in expected:
            continue
        try:
            annotation = ReasoningJourneyResponse.model_fields[field].annotation
            merged[field] = TypeAdapter(annotation).validate_python(value)
        except (TypeError, ValueError, ValidationError):
            logger.info("reasoning journey field fallback: %s", field)

    result = ReasoningJourneyResponse(**merged, solution_path=SOLUTION_STEPS, source="model")
    for node in result.reasoning_map:
        if not set(node.evidence_ids).issubset(ALLOWED_EVIDENCE_IDS):
            raise ValueError("journey evidence id is outside the whitelist")
    if [node.stage for node in result.reasoning_map] != ["V1", "CP2", "V2", "FINAL"]:
        raise ValueError("journey stages are not the required cognition sequence")
    if not set(result.late_arriving_clue.evidence_ids).issubset(ALLOWED_EVIDENCE_IDS):
        raise ValueError("late clue evidence id is outside the whitelist")
    return result


def summarize_reasoning_journey(request: ReasoningJourneyRequest) -> ReasoningJourneyResponse:
    if not AI_API_KEY:
        return _fallback(request)
    try:
        with httpx.Client(timeout=AI_TIMEOUT_SECONDS) as client:
            response = client.post(
                f"{AI_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
                json=build_journey_model_payload(request),
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        raw = json.loads(content)
        if not isinstance(raw, dict):
            raise TypeError("journey output must be a JSON object")
        return _parse(raw, request)
    except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("reasoning journey fallback: %s", exc)
        return _fallback(request)
