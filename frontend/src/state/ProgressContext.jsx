import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
} from "../api";
import {
  createDefaultProgress,
  loadProgress,
  saveProgress,
  clearProgress as clearStoredProgress,
} from "./progress";

const ProgressContext = createContext(null);

export function ProgressProvider({ children }) {
  const [progress, setProgress] = useState(() => loadProgress());

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  const actions = useMemo(
    () => ({
      startExperience() {
        setProgress((prev) => ({
          ...prev,
          started: true,
          startedAt: prev.startedAt || new Date().toISOString(),
        }));
      },

      setCurrentStage(stageId) {
        setProgress((prev) => ({
          ...prev,
          reading: { ...prev.reading, currentStageId: stageId },
        }));
      },

      answerStatementCard(cardId, answerType) {
        setProgress((prev) => ({
          ...prev,
          reading: {
            ...prev.reading,
            cardAnswers: { ...prev.reading.cardAnswers, [cardId]: answerType },
          },
        }));
      },

      completeReading() {
        setProgress((prev) => ({
          ...prev,
          reading: { ...prev.reading, completed: true },
        }));
      },

      completeTraining() {
        setProgress((prev) => ({
          ...prev,
          reading: {
            ...prev.reading,
            trainingCompleted: true,
          },
        }));
      },

      updateHypothesisDraft(draft) {
        setProgress((prev) => ({
          ...prev,
          hypothesisDraft: { ...prev.hypothesisDraft, ...draft },
        }));
      },

      submitHypothesisV1(hypothesis) {
        setProgress((prev) => ({
          ...prev,
          hypothesisV1: {
            ...hypothesis,
            hypothesisId: "H_V1",
            evidenceState: ["E01", "E02"],
            submittedAt: new Date().toISOString(),
          },
          revisionDraft: {
            ...prev.revisionDraft,
            text: hypothesis.text,
            confidence: hypothesis.confidence,
          },
        }));
      },

      submitStressResult(result) {
        setProgress((prev) => ({ ...prev, stressResult: result }));
      },

      async refreshAnnotations() {
        const annotations = await listAnnotations(progress.sessionId);
        setProgress((prev) => ({ ...prev, annotations }));
        return annotations;
      },

      updateStressAnswer(text) {
        setProgress((prev) => ({ ...prev, stressAnswer: text }));
      },

      updateRevisionDraft(draft) {
        setProgress((prev) => ({
          ...prev,
          revisionDraft: { ...prev.revisionDraft, ...draft },
        }));
      },

      async addAnnotation(annotation) {
        const saved = await createAnnotation({
          sessionId: progress.sessionId,
          ...annotation,
        });
        setProgress((prev) => ({
          ...prev,
          annotations: [...prev.annotations, saved],
        }));
        return saved;
      },

      async removeAnnotation(annotationId) {
        await deleteAnnotation({
          sessionId: progress.sessionId,
          annotationId,
        });
        setProgress((prev) => ({
          ...prev,
          annotations: prev.annotations.filter((item) => item.id !== annotationId),
        }));
      },

      submitHypothesisV2(hypothesis) {
        setProgress((prev) => ({
          ...prev,
          hypothesisV2: {
            ...hypothesis,
            hypothesisId: "H_V2",
            parentHypothesisId: "H_V1",
            evidenceState: ["E01", "E02", "E03"],
            decision:
              hypothesis.revisionType === "revised"
                ? "modify"
                : "insist",
            submittedAt: new Date().toISOString(),
          },
        }));
      },

      submitFinalReasoning(text) {
        setProgress((prev) => ({
          ...prev,
          finalReasoning: {
            text,
            sourceHypothesisId:
              prev.hypothesisV2?.hypothesisId ||
              prev.hypothesisV1?.hypothesisId ||
              null,
            submittedAt: new Date().toISOString(),
          },
        }));
      },

      saveReasoningJourney(summary) {
        setProgress((prev) => ({
          ...prev,
          reasoningJourney: {
            ...summary,
            generatedAt: new Date().toISOString(),
          },
        }));
      },

      markReplayViewed() {
        setProgress((prev) => ({
          ...prev,
          completion: { ...prev.completion, replayViewed: true },
        }));
      },

      submitFeedback(feedback) {
        setProgress((prev) => ({
          ...prev,
          completion: { ...prev.completion, feedback },
        }));
      },

      resetProgress() {
        clearStoredProgress();
        setProgress(createDefaultProgress());
      },
    }),
    [progress.sessionId],
  );

  const value = useMemo(() => ({ progress, ...actions }), [progress, actions]);

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProgress() {
  const context = useContext(ProgressContext);
  if (!context) {
    throw new Error("useProgress 必须在 ProgressProvider 内部使用");
  }
  return context;
}
