const CONFIGURED_API_URL =
  import.meta.env.VITE_API_URL?.trim();

const API_URL =
  CONFIGURED_API_URL ||
  (import.meta.env.DEV
    ? "http://127.0.0.1:8000"
    : "");

const REQUEST_TIMEOUT_MS = 12000;

const STAGE_CACHE_KEY =
  "unproven_stage_cache_v1";

function readStageCache() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    return JSON.parse(
      window.localStorage.getItem(STAGE_CACHE_KEY) || "{}",
    );
  } catch {
    return {};
  }
}

function cacheStage(stage) {
  if (!stage?.stage_id || typeof window === "undefined") {
    return;
  }

  try {
    const cache = readStageCache();
    cache[stage.stage_id] = stage;
    window.localStorage.setItem(
      STAGE_CACHE_KEY,
      JSON.stringify(cache),
    );
  } catch {
    // Storage may be unavailable. The live response remains usable.
  }
}


const PROGRESS_STORAGE_KEY =
  "inkecho_progress_v1";


// 同一阅读会话、同一版假说只允许产生一个 Pressure Test 请求。
// Panel 与 Workspace 即使同时触发，也会复用同一个 Promise。
const pressureTestRequests =
  new Map();


async function request(
  path,
  options = {},
) {
  if (!API_URL) {
    throw new Error("生产环境尚未配置内容服务地址（VITE_API_URL）。");
  }

  const {
    timeoutMs = REQUEST_TIMEOUT_MS,
    ...fetchOptions
  } = options;

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  let response;

  try {
    response = await fetch(
      `${API_URL}${path}`,
      {
        headers: {
          "Content-Type":
            "application/json",

          ...(
            fetchOptions.headers ||
            {}
          ),
        },

        ...fetchOptions,
        signal: fetchOptions.signal || controller.signal,
      },
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("内容服务响应超时，请稍后重试。", { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }


  if (!response.ok) {

    let detail =
      `HTTP ${response.status}`;

    try {

      const body =
        await response.json();

      if (
        body &&
        body.detail
      ) {
        detail =
          body.detail;
      }

    } catch {
      // response 不是 JSON
    }

    throw new Error(
      detail
    );
  }


  return (
    response.json()
  );
}


function getCurrentSessionId() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) {
      return "";
    }
    return JSON.parse(raw).sessionId || "";
  } catch {
    return "";
  }
}


function toFrontendAnnotation(
  annotation,
) {
  return {
    id:
      annotation.id,

    sessionId:
      annotation.session_id,

    stageId:
      annotation.stage_id,

    segmentIndex:
      annotation.segment_index,

    segmentEndIndex:
      annotation.segment_end_index ??
      annotation.segment_index,

    quote:
      annotation.quote,

    spans:
      (
        annotation.spans ||
        []
      ).map(
        (span) => ({
          segmentIndex:
            span.segment_index,

          quote:
            span.quote,
        }),
      ),

    note:
      annotation.note,

    inputMode:
      annotation.input_mode ||
      "text",

    strokes:
      annotation.strokes ||
      [],

    createdAt:
      annotation.created_at,
  };
}


export function checkHealth() {

  return request(
    "/api/health",
  );
}


export function getAiStatus() {

  return request(
    "/api/ai/status",
  );
}

export async function recognizeHandwriting(
  imageDataUrl,
) {
  const result =
    await request(
      "/api/ocr/handwriting",
      {
        method: "POST",

        body:
          JSON.stringify({
            image_data_url:
              imageDataUrl,
          }),
      },
    );

  return {
    transcript:
      result.transcript ||
      "",

    confidence:
      result.confidence ??
      null,
  };
}


export function getStages() {

  return request(
    "/api/content/stages",
  );
}


export function getStage(
  stageId,
) {
  const cached = readStageCache()[stageId];

  if (cached) {
    return Promise.resolve(cached);
  }

  return request(
    `/api/content/stages/${stageId}`,
    { timeoutMs: 30000 },
  ).then((stage) => {
    cacheStage(stage);
    return stage;
  });
}

export async function warmReadingContent() {
  const stageIds = Array.from(
    { length: 8 },
    (_, index) => index + 1,
  );

  const results = await Promise.allSettled(
    stageIds.map((stageId) => getStage(stageId)),
  );

  return results.some(
    (result) => result.status === "fulfilled",
  );
}


export function analyzeHypothesis({
  checkpointId = "CP2",
  hypothesisText,
  confidence,
  sessionId = getCurrentSessionId(),
  force = false,
}) {
  const requestKey = [
    sessionId || "anonymous",
    checkpointId,
    confidence,
    hypothesisText.trim(),
  ].join("::");

  if (
    !force &&
    pressureTestRequests.has(
      requestKey,
    )
  ) {
    return pressureTestRequests.get(
      requestKey,
    );
  }

  const pending = request(
    "/api/analyze",

    {
      method:
        "POST",

      body:
        JSON.stringify(
          {
            checkpoint_id:
              checkpointId,

            hypothesis_v1: {
              text:
                hypothesisText,

              confidence,
            },
          },
      ),

      timeoutMs: 25000,
    },
  );

  pressureTestRequests.set(
    requestKey,
    pending,
  );

  pending.catch(() => {
    if (
      pressureTestRequests.get(
        requestKey,
      ) === pending
    ) {
      pressureTestRequests.delete(
        requestKey,
      );
    }
  });

  return pending;
}


export function getSolution() {

  return request(
    "/api/solution",
  );
}


export function summarizeReasoningJourney({
  hypothesisV1,
  stressResult,
  stressAnswer = "",
  hypothesisV2,
  finalReasoning,
  annotations = [],
}) {
  return request(
    "/api/reasoning-journey",
    {
      method: "POST",
      body: JSON.stringify({
        hypothesis_v1: {
          text: hypothesisV1.text,
          confidence: hypothesisV1.confidence,
        },
        stress_result: stressResult
          ? {
              selected_assumption: stressResult.selected_assumption || null,
              pressure_question: stressResult.pressure_question || "",
              rationale_evidence_ids: stressResult.rationale_evidence_ids || [],
            }
          : null,
        stress_answer: stressAnswer,
        hypothesis_v2: hypothesisV2
          ? {
              text: hypothesisV2.text,
              confidence: hypothesisV2.confidence,
            }
          : null,
        final_reasoning: finalReasoning.text,
        annotations: annotations.map((item) => ({
          quote: item.quote || "",
          note: item.note || "",
          stage_id: item.stageId ?? null,
          created_at: item.createdAt || null,
        })),
      }),

      timeoutMs: 30000,
    },
  );
}


export function askQuestion({
  sessionId,
  stageId = null,
  question,
}) {

  const resolvedSessionId =
    sessionId ||
    getCurrentSessionId();


  if (!resolvedSessionId) {

    throw new Error(
      "missing sessionId"
    );
  }


  return request(
    "/api/qa/ask",

    {
      method: "POST",

      body:
        JSON.stringify(
          {
            session_id:
              resolvedSessionId,

            stage_id:
              stageId,

            question,
          },
        ),
    },
  );
}


// 流式版本：edge 事件通过 onDelta 逐段推送，
// 结束时调用 onDone({ fallback, replace, answer })。
//
// - replace === true 时，说明前面推过的 delta
//   都作废了（比如中途命中剧透词），
//   调用方应该整体替换成 answer。
export async function askQuestionStream(
  {
    sessionId,
    stageId = null,
    question,
  },
  {
    onDelta,
    onDone,
  } = {},
) {

  const resolvedSessionId =
    sessionId ||
    getCurrentSessionId();


  if (!resolvedSessionId) {

    throw new Error(
      "missing sessionId"
    );
  }


  const response =
    await fetch(
      `${API_URL}/api/qa/ask/stream`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            session_id:
              resolvedSessionId,

            stage_id:
              stageId,

            question,
          }),
      },
    );


  if (!response.ok) {

    let detail =
      `HTTP ${response.status}`;

    try {

      const body =
        await response.json();

      if (body && body.detail) {
        detail = body.detail;
      }

    } catch {
      // 不是 JSON
    }

    throw new Error(detail);
  }


  if (!response.body) {

    // 环境不支持流式读取，
    // 退回一次性请求。
    const result =
      await askQuestion({
        sessionId:
          resolvedSessionId,
        stageId,
        question,
      });

    onDelta?.(result.answer);

    onDone?.({
      fallback: result.fallback,
      replace: false,
      answer: result.answer,
    });

    return;
  }


  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder("utf-8");

  let buffer = "";


  while (true) {

    const { done, value } =
      await reader.read();

    if (done) {
      break;
    }

    buffer +=
      decoder.decode(value, {
        stream: true,
      });

    const chunks =
      buffer.split("\n\n");

    buffer =
      chunks.pop() ?? "";

    for (const chunk of chunks) {

      const line =
        chunk
          .split("\n")
          .find((row) =>
            row.startsWith("data:"),
          );

      if (!line) {
        continue;
      }

      const raw =
        line.slice(5).trim();

      if (!raw) {
        continue;
      }

      let event;

      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }

      if (event.type === "delta") {
        onDelta?.(event.text);
      } else if (event.type === "done") {
        onDone?.({
          fallback:
            Boolean(event.fallback),
          replace:
            Boolean(event.replace),
          answer:
            event.answer ?? "",
        });
      }
    }
  }
}


export async function listAnnotations(
  sessionId,
) {

  const annotations =
    await request(
      `/api/annotations?session_id=${encodeURIComponent(
        sessionId,
      )}`,
    );


  return annotations.map(
    toFrontendAnnotation,
  );
}


export async function createAnnotation({
  sessionId,
  stageId,
  segmentIndex,
  segmentEndIndex,
  quote,
  spans,
  note,
  inputMode = "text",
  strokes = [],
}) {

  const annotation =
    await request(
      "/api/annotations",

      {
        method:
          "POST",

        body:
          JSON.stringify(
            {
              session_id:
                sessionId,

              stage_id:
                stageId,

              segment_index:
                segmentIndex,

              segment_end_index:
                segmentEndIndex ??
                segmentIndex,

              quote,

              spans:
                (spans || []).map(
                  (span) => ({
                    segment_index:
                      span.segmentIndex,

                    quote:
                      span.quote,
                  }),
                ),

              note,

              input_mode:
                inputMode,

              strokes,
            },
          ),
      },
    );


  return (
    toFrontendAnnotation(
      annotation,
    )
  );
}


export function deleteAnnotation({
  sessionId,
  annotationId,
}) {

  return request(
    `/api/annotations/${encodeURIComponent(
      annotationId,
    )}?session_id=${encodeURIComponent(
      sessionId,
    )}`,

    {
      method:
        "DELETE",
    },
  );
}
