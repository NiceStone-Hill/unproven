const STORAGE_KEY = "inkecho_progress_v1";
const CURRENT_SCHEMA_VERSION = 5;

function createSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultProgress() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sessionId: createSessionId(),
    started: false,
    startedAt: null,
    initialJudgment: null,
    reading: {
      completed: false,
      trainingCompleted: false,
      cardAnswers: {},
      currentStageId: 1,
    },
    hypothesisDraft: { text: "", confidence: "medium" },
    hypothesisV1: null,
    stressResult: null,
    stressAnswer: "",
    revisionDraft: { mode: "keep", text: "", confidence: "medium", reason: "" },
    hypothesisV2: null,
    finalReasoning: null,
    reasoningJourney: null,
    annotations: [],
    completion: {
      replayViewed: false,
      feedback: "",
    },
  };
}

function migrateStressResult(result) {
  if (!result) {
    return null;
  }

  return {
    selected_assumption:
      result.selected_assumption ??
      null,
    category:
      result.category === "UNKNOWN"
        ? "UNCLEAR"
        : result.category,
    pressure_question:
      result.pressure_question ||
      result.question ||
      "",
    rationale_evidence_ids:
      result.rationale_evidence_ids ||
      [],
  };
}

export function loadProgress() {
  if (typeof window === "undefined") {
    return createDefaultProgress();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultProgress();
    }

    const parsed = JSON.parse(raw);
    const defaults = createDefaultProgress();
    const migrated = { ...parsed };
    const usesLegacyFinalReasoning =
      (parsed.schemaVersion || 0) < 3;

    // Schema v2 used completion.feedback to store the user's reveal-before
    // reasoning. Promote that value to a first-class domain object before
    // removing the unreachable second pressure-test state.
    if (
      usesLegacyFinalReasoning &&
      !migrated.finalReasoning &&
      parsed.completion?.feedback?.trim()
    ) {
      migrated.finalReasoning = {
        text: parsed.completion.feedback.trim(),
        sourceHypothesisId:
          parsed.hypothesisV2?.hypothesisId ||
          parsed.hypothesisV1?.hypothesisId ||
          null,
        submittedAt: null,
      };
    }

    delete migrated.stressResult2;
    delete migrated.stressAnswer2;
    delete migrated.revisionDraft2;
    delete migrated.hypothesisV3;

    return {
      ...defaults,
      ...migrated,
      schemaVersion:
        CURRENT_SCHEMA_VERSION,
      sessionId: parsed.sessionId || defaults.sessionId,
      hypothesisV1:
        migrated.hypothesisV1 || null,
      stressResult:
        migrateStressResult(
          migrated.stressResult,
        ),
      hypothesisV2:
        migrated.hypothesisV2 || null,
      finalReasoning:
        migrated.finalReasoning || null,
      reasoningJourney:
        migrated.reasoningJourney || null,
      reading: {
        ...defaults.reading,
        ...(parsed.reading || {}),
        currentStageId:
          migrated.reading
            ?.currentStageId || 1,
        trainingCompleted:
          Boolean(
            migrated.reading
              ?.trainingCompleted,
          ),
      },
      completion: {
        ...defaults.completion,
        ...(migrated.completion || {}),
        // Before schema v3 this field held the reveal-before reasoning. From
        // v3 onward it is reserved for actual experience feedback.
        feedback:
          usesLegacyFinalReasoning
            ? ""
            : migrated.completion
                ?.feedback || "",
      },
    };
  } catch (error) {
    console.error("读取本地进度失败", error);
    return createDefaultProgress();
  }
}

export function saveProgress(progress) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function clearProgress() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getResumeRoute(progress) {
  if (!progress.started) {
    return "/";
  }
  return "/workspace";
}
