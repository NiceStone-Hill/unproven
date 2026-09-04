import logging
import os

import contextlib

from datetime import (
    datetime,
    timezone,
)

from pathlib import Path

from uuid import uuid4

from dotenv import (
    load_dotenv,
)

from fastapi import (
    FastAPI,
    HTTPException,
)

from fastapi.middleware.cors import (
    CORSMiddleware,
)

from fastapi.responses import (
    StreamingResponse,
)

import json


load_dotenv(Path(__file__).resolve().parent / ".env")


from ai_service import (
    analyze_hypothesis,
    get_ai_status,
)

from handwriting_service import (
    recognize_handwriting,
)

from qa_service import (
    answer_question,
    stream_answer,
)

from reasoning_journey_service import summarize_reasoning_journey

from content import (
    SOLUTION_STEPS,
    STAGES,
    STAGES_BY_ID,
)

from schemas import (
    AnnotationCreate,
    AnnotationResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    QARequest,
    QAResponse,
    ReasoningJourneyRequest,
    ReasoningJourneyResponse,
    SolutionResponse,
    StageContent,
    StageSummary,
)

from state_store import (
    add_annotation,

    delete_annotation
    as delete_annotation_from_store,

    list_annotations
    as list_annotations_from_store,
)

from mcp_server import (
    mcp as inkecho_mcp,
)


logging.basicConfig(
    level=logging.INFO
)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    async with inkecho_mcp.session_manager.run():
        yield


app = FastAPI(
    title="UNPROVEN API",
    version="1.1.0",
    lifespan=lifespan,
)


# =========================
# CORS
# =========================


_DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


_EXTRA_ORIGINS = [
    origin.strip()

    for origin
    in os.environ.get(
        "ALLOWED_ORIGINS",
        "",
    ).split(",")

    if origin.strip()
]


app.add_middleware(
    CORSMiddleware,

    allow_origins=(
        _DEFAULT_ORIGINS
        +
        _EXTRA_ORIGINS
    ),

    allow_origin_regex=(
    r"^(http://(localhost|127\.0\.0\.1):\d+|"
    r"https://([a-z0-9-]+\.)?unproven\.vercel\.app)$"
    ),

    allow_credentials=False,

    allow_methods=["*"],

    allow_headers=["*"],
)


# =========================
# Basic API
# =========================


@app.get("/")
def root():

    return {
        "name":
            "UNPROVEN API",

        "message":
            "The backend is running.",
    }


@app.get("/api/health")
def health():

    return {
        "status":
            "ok",
    }


@app.get("/api/ai/status")
def ai_status():

    return (
        get_ai_status()
    )

# ========================================
# Local Handwriting OCR
# ========================================


@app.post(
    "/api/ocr/handwriting"
)
def handwriting_ocr(
    payload: dict,
):

    image_data_url = str(
        payload.get(
            "image_data_url",
            "",
        )
    ).strip()

    if not image_data_url:

        raise HTTPException(
            status_code=422,
            detail=(
                "image_data_url "
                "is required"
            ),
        )

    try:

        (
            transcript,
            confidence,
        ) = recognize_handwriting(
            image_data_url
        )

    except ValueError as exc:

        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except Exception as exc:

        logging.exception(
            "handwriting OCR failed"
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "handwriting OCR failed"
            ),
        ) from exc

    return {
        "transcript":
            transcript,

        "confidence":
            confidence,
    }

# =========================
# Reading Content
# =========================


@app.get(
    "/api/content/stages",
    response_model=(
        list[StageSummary]
    ),
)
def list_stages():

    return [
        StageSummary(
            stage_id=(
                stage.stage_id
            ),

            title=(
                stage.title
            ),

            order=(
                stage.order
            ),
        )

        for stage in STAGES
    ]


@app.get(
    "/api/content/stages/{stage_id}",
    response_model=StageContent,
)
def get_stage(
    stage_id: int,
):

    stage = (
        STAGES_BY_ID.get(
            stage_id
        )
    )

    if stage is None:

        raise HTTPException(
            status_code=404,

            detail=(
                "stage not found"
            ),
        )

    return stage


# =========================
# Pressure Test Agent
# =========================


@app.post(
    "/api/analyze",
    response_model=(
        AnalyzeResponse
    ),
)
def analyze(
    request: AnalyzeRequest,
):

    cleaned_text = (
        request
        .hypothesis_v1
        .text
        .strip()
    )

    if not cleaned_text:

        raise HTTPException(
            status_code=422,
            detail=(
                "hypothesis_v1.text "
                "is required"
            ),
        )

    normalized_request = (
        request.model_copy(
            update={
                "hypothesis_v1": (
                    request
                    .hypothesis_v1
                    .model_copy(
                        update={
                            "text": cleaned_text
                        }
                    )
                )
            }
        )
    )

    return (
        analyze_hypothesis(
            normalized_request
        )
    )


# =========================
# General QA Agent
# =========================


@app.post(
    "/api/qa/ask",
    response_model=QAResponse,
)
def ask_question(
    request: QARequest,
):

    normalized_request = (
        _validate_qa_request(
            request
        )
    )

    return (
        answer_question(
            normalized_request
        )
    )


def _validate_qa_request(
    request: QARequest,
) -> QARequest:

    cleaned_question = (
        request
        .question
        .strip()
    )

    if not cleaned_question:

        raise HTTPException(
            status_code=422,

            detail=(
                "question "
                "is required"
            ),
        )

    if (
        request.stage_id
        is not None
        and
        request.stage_id
        not in STAGES_BY_ID
    ):

        raise HTTPException(
            status_code=422,

            detail=(
                "unknown stage_id"
            ),
        )

    return request.model_copy(
        update={
            "question":
                cleaned_question
        }
    )


@app.post(
    "/api/qa/ask/stream"
)
def ask_question_stream(
    request: QARequest,
):

    normalized_request = (
        _validate_qa_request(
            request
        )
    )

    def _event_source():

        for event in stream_answer(
            normalized_request
        ):

            yield (
                f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            )

    return StreamingResponse(
        _event_source(),

        media_type=(
            "text/event-stream"
        ),

        headers={
            "Cache-Control":
                "no-cache",

            "X-Accel-Buffering":
                "no",
        },
    )


# =========================
# Solution
# =========================


@app.get(
    "/api/solution",
    response_model=(
        SolutionResponse
    ),
)
def get_solution():

    return (
        SolutionResponse(
            steps=(
                SOLUTION_STEPS
            )
        )
    )


@app.post(
    "/api/reasoning-journey",
    response_model=ReasoningJourneyResponse,
)
def create_reasoning_journey(request: ReasoningJourneyRequest):
    """Generate one structured retrospective after final reasoning is sealed."""
    return summarize_reasoning_journey(request)


# =========================
# Annotation
# =========================


@app.get(
    "/api/annotations",
    response_model=(
        list[
            AnnotationResponse
        ]
    ),
)
def list_annotations(
    session_id: str,
):

    return (
        list_annotations_from_store(
            session_id
        )
    )


@app.post(
    "/api/annotations",
    response_model=(
        AnnotationResponse
    ),
)
def create_annotation(
    request: AnnotationCreate,
):

    if (
        request.stage_id
        not in STAGES_BY_ID
    ):

        raise HTTPException(
            status_code=422,

            detail=(
                "unknown stage_id"
            ),
        )

    stage = (
        STAGES_BY_ID[
            request.stage_id
        ]
    )

    if (
        request.segment_end_index
        <
        request.segment_index
    ):

        raise HTTPException(
            status_code=422,

            detail=(
                "segment_end_index "
                "must not be "
                "before "
                "segment_index"
            ),
        )

    if (
        request.segment_end_index
        >=
        len(stage.segments)
    ):

        raise HTTPException(
            status_code=422,

            detail=(
                "unknown "
                "segment_index"
            ),
        )

    expected_segment_indexes = list(
        range(
            request.segment_index,
            request.segment_end_index
            + 1,
        )
    )

    spans_by_segment = {
        span.segment_index: span
        for span in request.spans
    }

    if (
        sorted(
            spans_by_segment.keys()
        )
        != expected_segment_indexes
    ):

        raise HTTPException(
            status_code=422,

            detail=(
                "spans must cover "
                "exactly "
                "segment_index "
                "through "
                "segment_end_index, "
                "one span per "
                "segment"
            ),
        )

    for (
        segment_index
    ) in expected_segment_indexes:

        span = spans_by_segment[
            segment_index
        ]

        segment = (
            stage.segments[
                segment_index
            ]
        )

        if (
            span.quote
            not in segment
        ):

            raise HTTPException(
                status_code=422,

                detail=(
                    "quote does not "
                    "belong to "
                    "segment "
                    f"{segment_index}"
                ),
            )

    annotation = (
        AnnotationResponse(
            id=(
                uuid4().hex
            ),

            session_id=(
                request.session_id
            ),

            stage_id=(
                request.stage_id
            ),

            segment_index=(
                request.segment_index
            ),

            segment_end_index=(
                request.segment_end_index
            ),

            quote=(
                request.quote
            ),

            spans=(
                request.spans
            ),

            note=(
                request.note.strip()
            ),

            input_mode=(
                request.input_mode
            ),

            strokes=(
                request.strokes
            ),

            created_at=(
                datetime.now(
                    timezone.utc
                ).isoformat()
            ),
        )
    )

    return (
        add_annotation(
            annotation
        )
    )


@app.delete(
    "/api/annotations/{annotation_id}"
)
def delete_annotation(
    annotation_id: str,
    session_id: str,
):

    deleted = (
        delete_annotation_from_store(
            session_id=(
                session_id
            ),

            annotation_id=(
                annotation_id
            ),
        )
    )

    if not deleted:

        raise HTTPException(
            status_code=404,

            detail=(
                "annotation "
                "not found"
            ),
        )

    return {
        "status":
            "deleted"
    }


app.mount(
    "/",
    inkecho_mcp.streamable_http_app(),
)
