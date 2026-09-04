import unittest

from unittest.mock import patch

import httpx

from ai_service import (
    FALLBACK_QUESTION,
    analyze_hypothesis,
    build_agent_prompt,
    build_model_payload,
    build_pressure_test_input,
    fallback_response,
    parse_model_output,
)
from schemas import AnalyzeRequest


def make_request(text: str = "他发现边界通道后，会把洞扩大，然后从那里爬出去。") -> AnalyzeRequest:
    return AnalyzeRequest(
        checkpoint_id="CP2",
        hypothesis_v1={
            "text": text,
            "confidence": "medium",
        },
    )


def valid_output(**updates):
    result = {
        "selected_assumption": "用户默认供老鼠通过的边界通道也足以让范·杜森本人通行。",
        "category": "HUMAN_PASSAGE",
        "pressure_question": "你的方案把老鼠能够通过进一步理解成了人也能通过，目前文本真的证明了这一步吗？",
        "rationale_evidence_ids": ["E02"],
    }
    result.update(updates)
    return result


class PressureTestTests(unittest.TestCase):
    def setUp(self):
        self.request = make_request()
        self.input_data = build_pressure_test_input(self.request)

    def assert_fallback(self, result):
        self.assertEqual(result, fallback_response())
        self.assertIsNone(result.selected_assumption)
        self.assertEqual(result.category, "UNCLEAR")
        self.assertEqual(result.pressure_question, FALLBACK_QUESTION)
        self.assertEqual(result.rationale_evidence_ids, [])

    def test_prompt_contains_only_hypothesis_and_fixed_evidence(self):
        prompt = build_agent_prompt(self.input_data)
        self.assertIn("Hypothesis V1", prompt)
        self.assertIn("E01:", prompt)
        self.assertIn("E02:", prompt)
        self.assertIn("E03:", prompt)
        self.assertNotIn("哈奇", prompt)
        self.assertNotIn("Solution", prompt)
        self.assertNotIn("Annotation", prompt)

    def test_qwen_payload_uses_json_mode_and_low_temperature(self):
        payload = build_model_payload(self.input_data)
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["temperature"], 0.1)
        self.assertNotIn("enable_thinking", payload)
        self.assertIn("JSON", payload["messages"][0]["content"])
        self.assertIn("JSON", payload["messages"][1]["content"])

    def test_valid_human_passage_output(self):
        result = parse_model_output(valid_output(), self.input_data)
        self.assertEqual(result.category, "HUMAN_PASSAGE")
        self.assertEqual(result.rationale_evidence_ids, ["E02"])

    def test_valid_tool_source_output(self):
        raw = valid_output(
            selected_assumption="用户默认入狱时没有普通工具，之后也不可能获得任何工具。",
            category="TOOL_SOURCE",
            pressure_question="入狱时没有携带普通工具，是否已经证明他之后也不可能获得工具？",
            rationale_evidence_ids=["E01"],
        )
        self.assertEqual(parse_model_output(raw, self.input_data).category, "TOOL_SOURCE")

    def test_valid_communication_output(self):
        raw = valid_output(
            selected_assumption="用户默认常规信息传递受限就意味着所有信息交换都不可能。",
            category="COMMUNICATION",
            pressure_question="常规书写和信息传递受限，是否足以证明所有信息交换路径都已排除？",
            rationale_evidence_ids=["E01"],
        )
        self.assertEqual(parse_model_output(raw, self.input_data).category, "COMMUNICATION")

    def test_short_input_returns_fixed_fallback_without_model_call(self):
        with patch("ai_service.AI_API_KEY", "test-key"), patch(
            "ai_service._call_model"
        ) as model_call:
            result = analyze_hypothesis(make_request("不知道"))
        self.assert_fallback(result)
        model_call.assert_not_called()

    def test_missing_field_returns_fallback(self):
        raw = valid_output()
        raw.pop("pressure_question")
        with self.assertRaises(ValueError):
            parse_model_output(raw, self.input_data)

    def test_evidence_outside_whitelist_returns_fallback(self):
        with self.assertRaises(ValueError):
            parse_model_output(
                valid_output(rationale_evidence_ids=["E04"]),
                self.input_data,
            )

    def test_multiple_questions_return_fallback(self):
        with self.assertRaises(ValueError):
            parse_model_output(
                valid_output(
                    pressure_question="目前文本证明了这一步吗？如果不成立怎么办？"
                ),
                self.input_data,
            )

    def test_judgmental_or_spoiler_language_returns_fallback(self):
        with self.assertRaises(ValueError):
            parse_model_output(
                valid_output(
                    pressure_question="其实可以用老鼠送信，你的方案还需要让人从这条通道通过吗？"
                ),
                self.input_data,
            )

    def test_solution_seeking_question_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_model_output(
                valid_output(
                    pressure_question="在没有普通工具的情况下，你打算利用什么具体方法扩大这个通道？"
                ),
                self.input_data,
            )

    def test_question_must_examine_evidence_boundary(self):
        with self.assertRaises(ValueError):
            parse_model_output(
                valid_output(
                    pressure_question="如果这个通道不能让成年人通过，你的整套方案还能够成立吗？"
                ),
                self.input_data,
            )

    def test_unclear_must_match_fixed_fallback(self):
        result = parse_model_output(
            {
                "selected_assumption": None,
                "category": "UNCLEAR",
                "pressure_question": FALLBACK_QUESTION,
                "rationale_evidence_ids": [],
            },
            self.input_data,
        )
        self.assert_fallback(result)

    def test_model_failure_returns_fixed_fallback(self):
        request = httpx.Request("POST", "https://example.test")
        with patch("ai_service.AI_API_KEY", "test-key"), patch(
            "ai_service._call_model",
            side_effect=httpx.ConnectError("offline", request=request),
        ):
            result = analyze_hypothesis(self.request)
        self.assert_fallback(result)


if __name__ == "__main__":
    unittest.main()
