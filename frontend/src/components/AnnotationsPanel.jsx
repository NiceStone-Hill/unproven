import { useEffect, useState } from "react";
import { useProgress } from "../state/ProgressContext";
import HandwritingCanvas from "./HandwritingCanvas";

function formatAnnotationTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function AnnotationsPanel() {
  const {
    progress,
    refreshAnnotations,
    removeAnnotation,
  } = useProgress();

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [deletingId, setDeletingId] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    // 异步读取开始时同步展示 loading，避免先闪出空批注状态。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");

    refreshAnnotations()
      .catch(() => {
        if (!cancelled) {
          setError(
            "暂时无法读取批注，请确认后端服务正在运行。",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshAnnotations]);

  const annotations = [
    ...progress.annotations,
  ].sort((a, b) =>
    a.stageId === b.stageId
      ? a.segmentIndex - b.segmentIndex
      : a.stageId - b.stageId,
  );

  async function handleRemove(
    annotationId,
  ) {
    setDeletingId(annotationId);
    setError("");

    try {
      await removeAnnotation(annotationId);
    } catch {
      setError(
        "删除失败，请稍后重试。",
      );
    } finally {
      setDeletingId("");
    }
  }

  if (loading) {
    return (
      <p
        className="stageIntro"
        style={{ margin: 0 }}
      >
        正在读取你的批注...
      </p>
    );
  }

  if (annotations.length === 0) {
    return (
      <div className="annotationEmpty">
        <p
          className="stageIntro"
          style={{ margin: 0 }}
        >
          还没有推理证据。回到原文，
          长按或拖选一段可能影响判断的文字，把它保存下来。
        </p>

        {error && (
          <p className="annotationError">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="annotationsList">
      {error && (
        <p className="annotationError">
          {error}
        </p>
      )}

      {annotations.map(
        (annotation) => (
          <article
            className="annotationItem"
            key={annotation.id}
          >
            <div className="annotationMeta">
              <span>
                Stage {annotation.stageId}
              </span>

              <span>
                {annotation.segmentEndIndex >
                annotation.segmentIndex
                  ? `第 ${
                      annotation.segmentIndex +
                      1
                    } - ${
                      annotation.segmentEndIndex +
                      1
                    } 段`
                  : `第 ${
                      annotation.segmentIndex +
                      1
                    } 段`}
              </span>

              <span>
                {formatAnnotationTime(
                  annotation.createdAt,
                )}
              </span>

              <span>
                {annotation.inputMode ===
                "draw"
                  ? "手写保存理由"
                  : "键盘保存理由"}
              </span>
            </div>

            <p className="annotationQuote">
              “{annotation.quote}”
            </p>

            {annotation.inputMode ===
            "draw" ? (
              <>
                {annotation.strokes?.length >
                0 && (
                  <HandwritingCanvas
                    strokes={
                      annotation.strokes
                    }
                    readOnly
                  />
                )}

            {annotation.note ? (
              <p className="annotationNote">
                识别文字：
                {annotation.note}
              </p>
            ) : (
              <p className="annotationNote muted">
                未识别到保存理由。
              </p>
            )}
          </>
        ) : annotation.note ? (
          <p className="annotationNote">
            {annotation.note}
          </p>
        ) : (
          <p className="annotationNote muted">
            已保存原文，未填写保存理由。
          </p>
        )}

            <div className="annotationItemActions">
              <button
                type="button"
                className="secondaryButton"
                disabled={
                  deletingId ===
                  annotation.id
                }
                onClick={() =>
                  handleRemove(
                    annotation.id,
                  )
                }
              >
                {deletingId ===
                annotation.id
                  ? "删除中..."
                  : "删除"}
              </button>
            </div>
          </article>
        ),
      )}
    </div>
  );
}

export default AnnotationsPanel;
