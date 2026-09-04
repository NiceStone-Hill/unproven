import unittest

from unittest.mock import patch

from reasoning_journey_service import (
    _parse,
    build_journey_model_payload,
    build_journey_prompt,
    summarize_reasoning_journey,
)
from schemas import ReasoningJourneyRequest


def make_request() -> ReasoningJourneyRequest:
    return ReasoningJourneyRequest(
        hypothesis_v1={"text": "他会找到牢房中的隐藏出口并从那里离开。", "confidence": "high"},
        stress_result={
            "selected_assumption": "隐藏出口足以让成年人通过",
            "pressure_question": "老鼠能够消失，是否已经证明成年人也能从同一路径通过？",
            "rationale_evidence_ids": ["E02"],
        },
        stress_answer="这条路径只能证明存在联系，不能证明人能直接通过。",
        hypothesis_v2={"text": "隐藏路径也许用于与外界建立联系。", "confidence": "medium"},
        final_reasoning="他通过隐藏路径联系外界，再借停电和维修人员进入的机会离开。",
        annotations=[{
            "quote": "五美元变成了零钱",
            "note": "可能发生了交换",
            "stage_id": 6,
            "created_at": "2026-08-15T08:00:00Z",
        }],
    )


class ReasoningJourneyTests(unittest.TestCase):
    def test_prompt_reuses_existing_reasoning_and_fixed_solution(self):
        prompt = build_journey_prompt(make_request())
        self.assertIn("隐藏出口", prompt)
        self.assertIn("五美元变成了零钱", prompt)
        self.assertIn("E01", prompt)
        self.assertIn("solution_steps", prompt)
        self.assertIn("这条路径只能证明存在联系", prompt)

    def test_payload_is_one_low_temperature_json_call(self):
        payload = build_journey_model_payload(make_request())
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["temperature"], 0.2)
        self.assertNotIn("enable_thinking", payload)
        self.assertEqual(len(payload["messages"]), 2)

    def test_missing_api_key_returns_structured_fallback(self):
        with patch("reasoning_journey_service.AI_API_KEY", ""):
            result = summarize_reasoning_journey(make_request())
        self.assertEqual(result.source, "fallback")
        self.assertTrue(result.headline)
        self.assertEqual(result.world_model.claims[0].stage, "V1")
        self.assertEqual(result.world_model.claims[-1].stage, "FINAL")
        self.assertGreaterEqual(len(result.world_model.impacts), 1)
        self.assertTrue(result.world_model.impacts[0].counterfactual)
        self.assertTrue(result.pressure_handling)
        self.assertIn("确信度", result.confidence_insight)
        self.assertGreaterEqual(len(result.theory_components), 2)
        self.assertEqual(result.theory_components[0].status, "CHANGED")
        self.assertGreaterEqual(len(result.reasoning_map), 3)
        self.assertIn("隐藏出口", result.shift.changed)
        self.assertEqual([node.stage for node in result.reasoning_map], ["V1", "CP2", "V2", "FINAL"])
        self.assertEqual(result.late_arriving_clue.arrived_at, "ANNOTATION_ONLY")
        self.assertEqual(result.clue_adoption[0].noticed_at, "阅读阶段 S06")
        self.assertEqual(result.clue_adoption[0].adopted_at, "NOT_USED")
        self.assertEqual(len(result.solution_path), 5)
        self.assertEqual(len(result.solution_coverage), 4)
        self.assertIn(
            "COVERED",
            {item.status for item in result.solution_coverage},
        )
        self.assertIn("不能证明人能直接通过", result.reasoning_map[1].detail)

    def test_missing_annotations_do_not_claim_annotation_only_clue(self):
        request = make_request().model_copy(update={"annotations": []})
        with patch("reasoning_journey_service.AI_API_KEY", ""):
            result = summarize_reasoning_journey(request)
        self.assertEqual(result.late_arriving_clue.arrived_at, "NOT_USED")
        self.assertIn("没有留下", result.late_arriving_clue.basis)

    def test_partial_model_output_preserves_valid_fields_and_repairs_invalid_collection(self):
        raw = {
            "headline": "从把通道当作出口，到把它理解为联系外界的基础设施。",
            "theory_components": [{"broken": True}],
        }
        result = _parse(raw, make_request())
        self.assertEqual(result.source, "model")
        self.assertIn("基础设施", result.headline)
        self.assertGreaterEqual(len(result.theory_components), 1)
        self.assertTrue(result.confidence_insight)
        self.assertTrue(result.world_model.missing_bridge)

    def test_synonymous_v2_is_not_forced_into_changed(self):
        payload = make_request().model_dump()
        payload["hypothesis_v1"] = {"text": "排水管用来与外界联系。", "confidence": "medium"}
        payload["hypothesis_v2"] = {"text": "管道用来和外面联系。", "confidence": "medium"}
        request = ReasoningJourneyRequest(**payload)
        with patch("reasoning_journey_service.AI_API_KEY", ""):
            result = summarize_reasoning_journey(request)
        self.assertEqual(result.theory_components[0].status, "KEPT")

    def test_annotation_concept_is_tracked_even_when_user_paraphrases_it(self):
        payload = make_request().model_dump()
        payload["hypothesis_v1"] = {
            "text": "老鼠找到一条能让人逃出去的隐藏出口。",
            "confidence": "high",
        }
        payload["annotations"] = [{
            "quote": "老鼠都不见了",
            "note": "可能存在通向外面的细小通道",
            "stage_id": 6,
        }]
        request = ReasoningJourneyRequest(**payload)
        with patch("reasoning_journey_service.AI_API_KEY", ""):
            result = summarize_reasoning_journey(request)
        self.assertEqual(result.clue_adoption[0].adopted_at, "V1")
        self.assertEqual(result.late_arriving_clue.arrived_at, "NOT_USED")
        self.assertIn("不是后期", result.late_arriving_clue.basis)


if __name__ == "__main__":
    unittest.main()
