import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import "./checkpoint.css";

import {
  useEffect,
} from "react";

import {
  analyzeHypothesis,
  getStage,
  summarizeReasoningJourney,
} from "../api";

import {
  buildLocalReasoningJourney,
} from "../reasoningFallback";

import {
  useProgress,
} from "../state/ProgressContext";

import AnnotationLayer
  from "../components/AnnotationLayer";

import AnnotationsPanel
  from "../components/AnnotationsPanel";

import QAPanel
  from "../components/QAPanel";

import Panel
  from "../components/Panel";


const STAGE_COUNT = 8;
const TOTAL_PAGES = STAGE_COUNT + 1;
const HYPOTHESIS_MAX_LENGTH = 300;
const READER_TOOLS_HINT_KEY = "unproven_reader_tools_hint_seen_v1";


const CONFIDENCE_OPTIONS = [
  {
    value: "low",
    label: "低",
  },
  {
    value: "medium",
    label: "中",
  },
  {
    value: "high",
    label: "高",
  },
];


function hasText(text) {
  return Boolean(
    text?.trim(),
  );
}


function validHypothesisText(
  text,
) {
  const length =
    text?.trim().length || 0;

  return (
    length > 0 &&
    length <=
      HYPOTHESIS_MAX_LENGTH
  );
}


function checkpointDone(
  progress,
  checkpoint,
) {
  if (!checkpoint) {
    return true;
  }

  if (
    checkpoint.kind ===
    "training"
  ) {
    return Boolean(
      progress.reading
        .trainingCompleted,
    );
  }

  if (
    checkpoint.kind ===
    "capture"
  ) {
    return Boolean(
      progress.hypothesisV1,
    );
  }

  if (
    checkpoint.kind ===
    "pressure"
  ) {
    return Boolean(
      progress.hypothesisV2,
    );
  }

  if (
    checkpoint.kind ===
    "final"
  ) {
    return Boolean(
      progress.finalReasoning,
    );
  }

  return false;
}


function getCheckpointNoticeText(
  checkpoint,
) {
  if (!checkpoint) {
    return "";
  }

  if (checkpoint.kind === "training") {
    return (
      "在继续推理前，先判断两句话分别是文本事实，还是尚未证明的前提。"
    );
  }

  if (checkpoint.kind === "capture") {
    return (
      "读到这里了。要不要先把你现在的猜想记下来？"
    );
  }

  if (checkpoint.kind === "pressure") {
    return (
      "刚刚出现了新的线索。我有一个问题想问你。"
    );
  }

  if (checkpoint.kind === "final") {
    return (
      "揭晓之前，想看看你现在最完整的解释。"
    );
  }

  return checkpoint.prompt;
}


function CheckpointNotification({
  checkpoint,
  onOpen,
  onClose,
}) {
  if (!checkpoint) {
    return null;
  }

  function handleClose(event) {
    // 防止点击 × 时顺便触发整个气泡的 onOpen
    event.stopPropagation();
    onClose();
  }

  return (
    <div
      className="checkpointNotification"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" ||
          event.key === " "
        ) {
          onOpen();
        }
      }}
    >
      <div
        className="checkpointNotificationAvatar"
      >
        U
      </div>

      <div
        className="checkpointNotificationBody"
      >
        <div
          className="checkpointNotificationHeader"
        >
          <strong>
            UNPROVEN
          </strong>

          <span>
            刚刚
          </span>
        </div>

        <p>
          {
            getCheckpointNoticeText(
              checkpoint,
            )
          }
        </p>
      </div>

      <span
        className="checkpointNotificationDot"
      />

      <button
        type="button"
        className="checkpointNotificationClose"
        aria-label="关闭提醒"
        onClick={handleClose}
      >
        ×
      </button>
    </div>
  );
}


function FloatingMenu({
  open,
  annotationCount,
  hasPendingCheckpoint,
  showHint,
  onToggle,
  onDismissHint,
  onOpenAnnotations,
  onOpenQA,
  onOpenCheckpoint,
  onReset,
}) {
  return (
    <div
      className="readerMenu"
    >
      <button
        type="button"
        className="readerMenuButton readerToolsButton"
        aria-label={`打开阅读工具：${annotationCount} 条批注${hasPendingCheckpoint ? "，有待回应的思考" : ""}`}
        aria-expanded={open}
        aria-controls="reader-tools-menu"
        onClick={() => {
          onDismissHint();
          onToggle();
        }}
      >
        <span
          className="readerToolsIcon"
          aria-hidden="true"
        >
          ✎
        </span>
        <span className="readerToolsLabel">阅读工具</span>
        {annotationCount > 0 && (
          <span className="readerToolsCount" aria-label={`${annotationCount} 条批注`}>
            {annotationCount}
          </span>
        )}
        {hasPendingCheckpoint && (
          <span className="readerToolsAttention" aria-hidden="true" />
        )}
      </button>

      {showHint && !open && (
        <aside className="readerToolsHint" aria-label="阅读工具提示">
          <span>第一次使用</span>
          <strong>选中文字，留下你的证据判断</strong>
          <p>证据批注、无剧透释义和每一版观点都收在“阅读工具”里。</p>
          <button type="button" onClick={onDismissHint}>知道了</button>
        </aside>
      )}

      {open && (
        <div
          id="reader-tools-menu"
          className="readerMenuPanel"
        >
          <div className="readerToolsPanelIntro">
            <strong>阅读工具</strong>
            <span>拖选正文即可添加批注</span>
          </div>

          <button
            type="button"
            onClick={
              onOpenCheckpoint
            }
          >
            <span><b aria-hidden="true">◇</b>当前思考</span>
            <small>{hasPendingCheckpoint ? "待回应" : "查看"}</small>
          </button>

          <button
            type="button"
            onClick={
              onOpenAnnotations
            }
          >
            <span><b aria-hidden="true">✎</b>我的证据与批注</span>
            <small>{annotationCount || "暂无"}</small>
          </button>

          <button
            type="button"
            onClick={onOpenQA}
          >
            <span><b aria-hidden="true">?</b>无剧透释义</span>
            <small>名词与背景</small>
          </button>

          <button
            type="button"
            onClick={onReset}
          >
            <span><b aria-hidden="true">↺</b>重置体验</span>
          </button>
        </div>
      )}
    </div>
  );
}


function ConfidenceSelector({
  value,
  onChange,
}) {
  return (
    <div
      className="confidenceGroup"
    >
      {CONFIDENCE_OPTIONS.map(
        (option) => (
          <button
            key={option.value}
            type="button"
            className={
              `optionButton ${
                value ===
                option.value
                  ? "selected"
                  : ""
              }`
            }
            onClick={() =>
              onChange(
                option.value,
              )
            }
          >
            {option.label}
          </button>
        ),
      )}
    </div>
  );
}


function EvidenceStrip({
  evidence = [],
  activeIds = [],
  collision = false,
  assumption = "",
}) {
  if (!evidence.length) {
    return null;
  }

  const activeSet = new Set(activeIds);

  return (
    <section
      className={`checkpointEvidence ${collision ? "checkpointEvidenceCollision" : ""}`}
      aria-label="当前已解锁证据"
    >
      <div className="checkpointEvidenceHeading">
        <span>CURRENT EVIDENCE</span>
        <small>{evidence.length} 条已解锁</small>
      </div>

      <div className="checkpointEvidenceList">
        {evidence.map((item) => {
          const active = activeSet.has(item.evidence_id);
          return (
            <article
              className={`checkpointEvidenceCard ${active ? "isActive" : ""}`}
              key={item.evidence_id}
            >
              <strong>{item.evidence_id}</strong>
              <p>{item.text}</p>
              <small>{active ? "本次审查依据" : "已解锁"}</small>
            </article>
          );
        })}
      </div>

      {collision && assumption && (
        <div className="evidenceCollisionMoment" role="status">
          <div className="evidenceCollisionMark" aria-hidden="true">×</div>
          <div>
            <span>被证据撞击的未证前提</span>
            <p>{assumption}</p>
          </div>
        </div>
      )}
    </section>
  );
}


function CaptureCheckpoint({
  progress,
  stage,
  checkpoint,
  onClose,
}) {
  const {
    updateHypothesisDraft,
    submitHypothesisV1,
  } = useProgress();

  const draft =
    progress.hypothesisDraft;

  const canSubmit =
    validHypothesisText(
      draft.text,
    );


  if (
    progress.hypothesisV1
  ) {
    return (
      <div
        className="checkpointReadOnly"
      >
        <div
          className="chatMessage chatMessageUser"
        >
          <div
            className="chatBubble"
          >
            {
              progress
                .hypothesisV1
                .text
            }
          </div>
        </div>

        <button
          className="primaryButton"
          type="button"
          onClick={onClose}
        >
          继续阅读
        </button>
      </div>
    );
  }


  function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    submitHypothesisV1({
      checkpointId:
        checkpoint.checkpoint_id,

      text:
        draft.text.trim(),

      confidence:
        draft.confidence,
    });

    onClose();
  }


  return (
    <>
      <EvidenceStrip evidence={stage.allowed_evidence} />

      <div
        className="chatMessage chatMessageAgent"
      >
        <div
          className="chatAvatar"
        >
          U
        </div>

        <div
          className="chatBubble"
        >
          {checkpoint.prompt}
        </div>
      </div>

      <div
        className="chatComposer"
      >
        <textarea
          value={draft.text}
          onChange={(event) =>
            updateHypothesisDraft({
              text:
                event.target.value,
            })
          }
          placeholder="说说你现在怎么想……"
          maxLength={
            HYPOTHESIS_MAX_LENGTH
          }
        />

        <div className="hypothesisLength">
          <span>
            写下你的推理（最多 300 字）
          </span>
          <span>
            {draft.text.trim().length} / {HYPOTHESIS_MAX_LENGTH}
          </span>
        </div>

        <div
          className="chatComposerFooter"
        >
          <span>
            确信程度
          </span>

          <ConfidenceSelector
            value={
              draft.confidence
            }
            onChange={(
              confidence,
            ) =>
              updateHypothesisDraft({
                confidence,
              })
            }
          />
        </div>

        <button
          className="primaryButton"
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          发送
        </button>
      </div>
    </>
  );
}


function TrainingCheckpoint({
  checkpoint,
  onClose,
}) {
  const {
    completeTraining,
  } = useProgress();

  const [
    answers,
    setAnswers,
  ] = useState({});

  const items = [
    {
      id: "entry_tools",
      text: "范·杜森进入十三号牢房时，没有携带锤子、锉刀等普通越狱工具。",
      correct: "fact",
    },
    {
      id: "future_tools",
      text: "因此，在接下来的一周里，他也不可能获得任何可用于越狱的工具。",
      correct: "assumption",
    },
  ];

  const answeredAll =
    items.every(
      (item) =>
        answers[item.id],
    );

  function finishTraining() {
    if (!answeredAll) {
      return;
    }

    completeTraining();
    onClose();
  }

  return (
    <>
      <p className="checkpointPrompt">
        {checkpoint.prompt}
      </p>

      <div className="trainingList">
        {items.map((item, index) => {
          const answer =
            answers[item.id];
          const correct =
            answer === item.correct;

          return (
            <section
              className="trainingItem"
              key={item.id}
            >
              <span>
                0{index + 1}
              </span>

              <p>{item.text}</p>

              <div className="checkpointSwitch">
                <button
                  type="button"
                  className={`optionButton ${answer === "fact" ? "selected" : ""}`}
                  onClick={() =>
                    setAnswers((prev) => ({
                      ...prev,
                      [item.id]: "fact",
                    }))
                  }
                >
                  文本已经证明
                </button>

                <button
                  type="button"
                  className={`optionButton ${answer === "assumption" ? "selected" : ""}`}
                  onClick={() =>
                    setAnswers((prev) => ({
                      ...prev,
                      [item.id]: "assumption",
                    }))
                  }
                >
                  尚未被证明
                </button>
              </div>

              {answer && (
                <p className={`trainingFeedback ${correct ? "correct" : "incorrect"}`}>
                  {item.id === "entry_tools"
                    ? "这是文本明确写出的入狱状态。"
                    : "文本只证明他入狱时没有工具；“之后也不可能获得”已经多走了一步。"}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <div className="actions">
        <button
          type="button"
          className="primaryButton"
          disabled={!answeredAll}
          onClick={finishTraining}
        >
          记住这种差别，继续阅读
        </button>
      </div>
    </>
  );
}


function PressureCheckpoint({
  progress,
  stage,
  checkpoint,
  onClose,
}) {
  const {
    submitHypothesisV1,

    submitStressResult,

    updateStressAnswer,

    updateRevisionDraft,

    submitHypothesisV2,
  } = useProgress();


  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    localHypothesis,
    setLocalHypothesis,
  ] = useState({
    text: "",
    confidence: "medium",
  });

  const [
    localSubmitted,
    setLocalSubmitted,
  ] = useState(null);


  const sourceVersionLabel =
    "V1";

  const nextVersionLabel =
    "V2";


  const draft =
    progress.revisionDraft;


  const stressResult =
    progress.stressResult;

  const stressAnswer =
    progress.stressAnswer;


  const updateDraft =
    updateRevisionDraft;


  const submitResult =
    submitStressResult;


  const submitNextHypothesis =
    submitHypothesisV2;


  const completedHypothesis =
    progress.hypothesisV2;


  const savedSourceHypothesis =
    progress.hypothesisV1;


  const sourceHypothesis =
    savedSourceHypothesis ||
    localSubmitted;


  const revisionText =
    draft.mode === "revise"
      ? draft.text
      : (
          sourceHypothesis
            ?.text ||
          ""
        );


  const canSubmit =
    hasText(stressAnswer) &&
    (
      draft.mode === "keep" ||
      validHypothesisText(
        revisionText,
      )
    );


  const runAnalysis =
    useCallback(
      async ({
        force = false,
      } = {}) => {
        if (
          !sourceHypothesis ||
          (
            stressResult &&
            !force
          )
        ) {
          return;
        }

        setLoading(true);
        setError("");

        try {
          const result =
            await analyzeHypothesis({
              sessionId:
                progress.sessionId,

              hypothesisText:
                sourceHypothesis
                  .text,

              confidence:
                sourceHypothesis
                  .confidence,

              force,
            });

          console.log(
            "Pressure Test result:",
            result,
          );

          submitResult(result);
        } catch (
          requestError
        ) {
          console.error(
            requestError,
          );

          setError(
            "暂时无法生成问题，请确认后端服务正在运行。",
          );
        } finally {
          setLoading(false);
        }
      },

      [
        progress.sessionId,
        stressResult,
        sourceHypothesis,
        submitResult,
      ],
    );


  useEffect(() => {
    // 打开压力检查面板后立即发起一次异步分析。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runAnalysis();
  }, [runAnalysis]);


  if (!sourceHypothesis) {
    const canSaveLocal =
      validHypothesisText(
        localHypothesis.text,
      );


    function handleLocalSubmit() {
      if (!canSaveLocal) {
        return;
      }

      const hypothesis = {
        checkpointId:
          checkpoint.checkpoint_id,

        text:
          localHypothesis
            .text
            .trim(),

        confidence:
          localHypothesis
            .confidence,
      };


      submitHypothesisV1({
        ...hypothesis,

        generatedAtCheckpoint:
          true,
      });


      setLocalSubmitted(
        hypothesis,
      );
    }


    return (
      <>
        <div
          className="chatMessage chatMessageAgent"
        >
          <div
            className="chatAvatar"
          >
            U
          </div>

          <div
            className="chatBubble"
          >
            我没有找到你的上一版想法。
            你可以先在这里补写一版，
            然后我们继续。
          </div>
        </div>

        <div
          className="chatComposer"
        >
          <textarea
            value={
              localHypothesis.text
            }
            onChange={(event) =>
              setLocalHypothesis(
                (prev) => ({
                  ...prev,

                  text:
                    event
                      .target
                      .value,
                }),
              )
            }
            placeholder="写下你现在的解释……"
            maxLength={
              HYPOTHESIS_MAX_LENGTH
            }
          />

          <div className="hypothesisLength">
            <span>最多 300 字</span>
            <span>
              {localHypothesis.text.trim().length} / {HYPOTHESIS_MAX_LENGTH}
            </span>
          </div>

          <ConfidenceSelector
            value={
              localHypothesis
                .confidence
            }
            onChange={(
              confidence,
            ) =>
              setLocalHypothesis(
                (prev) => ({
                  ...prev,
                  confidence,
                }),
              )
            }
          />

          <button
            className="primaryButton"
            type="button"
            disabled={
              !canSaveLocal
            }
            onClick={
              handleLocalSubmit
            }
          >
            发送
          </button>
        </div>
      </>
    );
  }


  function handleSubmit() {
    if (!canSubmit) {
      return;
    }


    const finalText =
      draft.mode === "keep"
        ? sourceHypothesis.text
        : revisionText.trim();


    const finalConfidence =
      draft.confidence ||
      sourceHypothesis.confidence;


    submitNextHypothesis({
      checkpointId:
        checkpoint.checkpoint_id,

      text:
        finalText,

      confidence:
        finalConfidence,

      pressureAnswer:
        stressAnswer.trim(),

      revisionType:
        draft.mode === "revise"
          ? "revised"
          : "kept",

      textChanged:
        finalText !==
        sourceHypothesis.text,

      confidenceChanged:
        finalConfidence !==
        sourceHypothesis
          .confidence,
    });


    onClose();
  }


  if (completedHypothesis) {
    const unchanged =
      completedHypothesis.text
      === sourceHypothesis.text;


    return (
      <div
        className="checkpointReadOnly"
      >
        <div
          className="chatMessage chatMessageAgent"
        >
          <div
            className="chatAvatar">
            U
          </div>

          <div
            className="chatBubble"
          >
            {unchanged
              ? `你在 ${nextVersionLabel} 中保留了上一版观点。`
              : `你已经形成了新的 ${nextVersionLabel}。`}
          </div>
        </div>

        <section className={`hypothesisDelta ${unchanged ? "isKept" : "isRevised"}`}>
          <div className="hypothesisDeltaVersion">
            <span>V1 · 原判断</span>
            <p>{sourceHypothesis.text}</p>
          </div>

          <div className="hypothesisDeltaCollision">
            <b aria-hidden="true">×</b>
            <span>未证前提</span>
            <p>{stressResult?.selected_assumption || stressResult?.pressure_question}</p>
          </div>

          <div className="hypothesisDeltaVersion hypothesisDeltaResult">
            <span>V2 · {unchanged ? "保留判断" : "修正后的判断"}</span>
            <p>{completedHypothesis.text}</p>
          </div>
        </section>

        <button
          className="primaryButton"
          type="button"
          onClick={onClose}
        >
          继续阅读
        </button>
      </div>
    );
  }


  return (
    <>
      <div
        className="versionContext"
      >
        <span>
          当前观点 · {
            sourceVersionLabel
          }
        </span>

        <p>
          {
            sourceHypothesis.text
          }
        </p>
      </div>


      {loading && (
        <div
          className="chatMessage chatMessageAgent"
        >
          <div
            className="chatAvatar"
          >
            U
          </div>

          <div
            className="chatBubble"
          >
            我正在看看刚出现的线索……
          </div>
        </div>
      )}


      {error && (
        <p
          className="checkpointError"
        >
          {error}
        </p>
      )}


      {stressResult && (
        <>
          <EvidenceStrip
            evidence={stage.allowed_evidence}
            activeIds={stressResult.rationale_evidence_ids}
            collision={stressResult.category !== "UNCLEAR"}
            assumption={stressResult.selected_assumption}
          />

          {stressResult.category ===
            "UNCLEAR" && (
            <div
              className="fallbackNotice"
              role="status"
            >
              <strong>
                通用自检
              </strong>

              <p>
                本次未能可靠识别一个个性化前提，下面显示的是通用检查问题，不代表模型已经判断了你的方案。
              </p>

              <button
                type="button"
                className="secondaryButton"
                disabled={loading}
                onClick={() =>
                  runAnalysis({
                    force: true,
                  })
                }
              >
                {loading
                  ? "正在重新检查…"
                  : "重新检查一次"}
              </button>
            </div>
          )}

          <div
            className="chatMessage chatMessageAgent"
          >
            <div
              className="chatAvatar"
            >
              U
            </div>

            <div
              className="chatBubble"
            >
              {
                stressResult.pressure_question
              }
            </div>
          </div>

          <div className="agentBoundary" role="note">
            <strong>无剧透证据边界</strong>
            <p>
              Agent 只读取你的 V1 与当前已解锁证据
              {stressResult.rationale_evidence_ids?.length
                ? `（${stressResult.rationale_evidence_ids.join(" · ")}）`
                : ""}
              ，看不到后文与谜底。
            </p>
          </div>

          <div className="chatComposer revisionComposer">
            <label className="checkpointResponseLabel" htmlFor="stress-answer">
              我的回应
            </label>
            <textarea
              id="stress-answer"
              value={stressAnswer}
              onChange={(event) => updateStressAnswer(event.target.value)}
              placeholder="这一步为什么仍成立，或为什么需要修改？"
              maxLength={500}
            />
            <div className="hypothesisLength">
              <span>先回应这个问题，再决定是否修改观点</span>
              <span>{stressAnswer.trim().length} / 500</span>
            </div>
          </div>


          <div
            className="revisionChoice"
          >
            <p>
              回答之后，你现在还坚持
              {
                sourceVersionLabel
              }
              吗？
            </p>

            <div
              className="checkpointSwitch"
            >
              <button
                type="button"
                className={
                  `optionButton ${
                    draft.mode !==
                    "revise"
                      ? "selected"
                      : ""
                  }`
                }
                onClick={() =>
                  updateDraft({
                    mode: "keep",
                  })
                }
              >
                我的观点没变
              </button>

              <button
                type="button"
                className={
                  `optionButton ${
                    draft.mode ===
                    "revise"
                      ? "selected"
                      : ""
                  }`
                }
                onClick={() =>
                  updateDraft({
                    mode: "revise",

                    text:
                      draft.text ||
                      sourceHypothesis
                        .text,

                    confidence:
                      draft.confidence ||
                      sourceHypothesis
                        .confidence,
                  })
                }
              >
                我要修改为 {
                  nextVersionLabel
                }
              </button>
            </div>
          </div>


          {draft.mode ===
            "keep" && (
            <div className="keepConfidence">
              <span>
                现在的确信程度
              </span>

              <ConfidenceSelector
                value={
                  draft.confidence ||
                  sourceHypothesis
                    .confidence
                }
                onChange={(
                  confidence,
                ) =>
                  updateDraft({
                    confidence,
                  })
                }
              />
            </div>
          )}


          {draft.mode ===
            "revise" && (
            <div
              className="chatComposer revisionComposer"
            >
              <textarea
                value={
                  draft.text
                }
                onChange={(event) =>
                  updateDraft({
                    text:
                      event
                        .target
                        .value,
                  })
                }
                placeholder={
                  `写下你的 ${nextVersionLabel}……`
                }
                maxLength={
                  HYPOTHESIS_MAX_LENGTH
                }
              />

              <div className="hypothesisLength">
                <span>最多 300 字</span>
                <span>
                  {draft.text.trim().length} / {HYPOTHESIS_MAX_LENGTH}
                </span>
              </div>

              <div
                className="chatComposerFooter"
              >
                <span>
                  确信程度
                </span>

                <ConfidenceSelector
                  value={
                    draft.confidence
                  }
                  onChange={(
                    confidence,
                  ) =>
                    updateDraft({
                      confidence,
                    })
                  }
                />
              </div>
            </div>
          )}


          <div
            className="actions"
          >
            <button
              className="primaryButton"
              type="button"
              disabled={
                !canSubmit
              }
              onClick={
                handleSubmit
              }
            >
              发送并继续阅读
            </button>
          </div>
        </>
      )}
    </>
  );
}


function VersionMiniHistory({
  progress,
}) {
  const versions = [
    {
      label: "V1",
      value:
        progress.hypothesisV1,
      previous: null,
    },

    {
      label: "V2",
      value:
        progress.hypothesisV2,
      previous:
        progress.hypothesisV1,
    },

  ];


  return (
    <div
      className="versionMiniHistory"
    >
      {versions.map(
        ({
          label,
          value,
          previous,
        }) => {
          if (!value) {
            return null;
          }


          const unchanged =
            previous &&
            value.text ===
              previous.text;


          return (
            <div
              key={label}
              className={
                `versionMiniItem ${
                  unchanged
                    ? "unchanged"
                    : ""
                }`
              }
            >
              <strong>
                {label}
              </strong>

              {unchanged ? (
                <span>
                  保留上一版
                </span>
              ) : (
                <span>
                  {value.text}
                </span>
              )}
            </div>
          );
        },
      )}
    </div>
  );
}


function FinalCheckpoint({
  progress,
  checkpoint,
  onClose,
}) {
  const {
    submitFinalReasoning,
    markReplayViewed,
  } = useProgress();


  const [
    text,
    setText,
  ] = useState(
    progress.finalReasoning
      ?.text ||
    "",
  );


  const finalReasoningLength =
    text.trim().length;

  const canSubmit =
    finalReasoningLength >= 20;


  function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    submitFinalReasoning(
      text.trim(),
    );

    markReplayViewed();

    onClose();
  }


  return (
    <>
      <div
        className="chatMessage chatMessageAgent"
      >
        <div
          className="chatAvatar"
        >
          U
        </div>

        <div
          className="chatBubble"
        >
          {checkpoint.prompt}
        </div>
      </div>


      <VersionMiniHistory
        progress={progress}
      />

      <div className="finalReasoningGuide" aria-label="最终推理参考结构">
        <strong>如果需要，可以沿着这四步整理</strong>
        <ul>
          <li>他如何与外界建立联系？</li>
          <li>工具或物资如何进入？</li>
          <li>他如何离开牢房？</li>
          <li>他如何穿过监狱并完成离场？</li>
        </ul>
        <small>不必逐题回答，也不要求猜对；只写下你当前能够连接起来的部分。</small>
      </div>


      <div
        className="chatComposer"
      >
        <textarea
          value={text}
          onChange={(event) =>
            setText(
              event.target.value,
            )
          }
          placeholder="例如：他先通过……联系外界，再利用……制造机会，最后借助……离开。"
          maxLength={1200}
        />

        <div className="hypothesisLength">
          <span>{finalReasoningLength < 20 ? "至少写下 20 个字" : "最终推理将被封存"}</span>
          <span>{finalReasoningLength} / 1200</span>
        </div>

        <button
          className="primaryButton"
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          提交我的最终推理
        </button>
      </div>
    </>
  );
}


function CheckpointPanel({
  stage,
  progress,
  onClose,
}) {
  const checkpoint =
    stage?.checkpoint;


  if (!checkpoint) {
    return (
      <p
        className="checkpointPrompt"
      >
        当前没有新的消息。
      </p>
    );
  }


  return (
    <div
      className="checkpointContent"
    >
      {
        checkpoint.kind ===
          "training" && (
          <TrainingCheckpoint
            checkpoint={checkpoint}
            onClose={onClose}
          />
        )
      }


      {
        checkpoint.kind ===
          "capture" && (
          <CaptureCheckpoint
            progress={progress}
            stage={stage}
            checkpoint={
              checkpoint
            }
            onClose={onClose}
          />
        )
      }


      {
        checkpoint.kind ===
          "pressure" && (
          <PressureCheckpoint
            progress={progress}
            stage={stage}

            checkpoint={
              checkpoint
            }

            onClose={onClose}
          />
        )
      }


      {
        checkpoint.kind ===
          "final" && (
          <FinalCheckpoint
            progress={progress}
            checkpoint={
              checkpoint
            }
            onClose={onClose}
          />
        )
      }
    </div>
  );
}


function ThinkingJourney({
  progress,
}) {
  const {
    saveReasoningJourney,
    submitFeedback,
  } = useProgress();
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState(
    progress.completion.feedback || "",
  );
  const [feedbackSaved, setFeedbackSaved] = useState(
    Boolean(progress.completion.feedback),
  );
  const requestedSummary = useRef(false);

  const requestSummary = useCallback((force = false) => {
    const hasModelSummary =
      progress.reasoningJourney?.source === "model" &&
      progress.reasoningJourney?.headline &&
      progress.reasoningJourney?.world_model &&
      progress.reasoningJourney?.shift &&
      progress.reasoningJourney?.confidence_insight &&
      progress.reasoningJourney?.late_arriving_clue &&
      progress.reasoningJourney?.clue_adoption &&
      progress.reasoningJourney?.theory_components &&
      progress.reasoningJourney?.solution_coverage;

    if (
      (!force && requestedSummary.current) ||
      hasModelSummary ||
      !progress.hypothesisV1 ||
      !progress.finalReasoning
    ) {
      return;
    }
    requestedSummary.current = true;
    setSummaryLoading(true);
    setSummaryError("");
    summarizeReasoningJourney({
      hypothesisV1: progress.hypothesisV1,
      stressResult: progress.stressResult,
      stressAnswer: progress.stressAnswer,
      hypothesisV2: progress.hypothesisV2,
      finalReasoning: progress.finalReasoning,
      annotations: progress.annotations,
    })
      .then((remoteJourney) => {
        const localJourney =
          buildLocalReasoningJourney(progress);

        saveReasoningJourney({
          ...localJourney,
          ...remoteJourney,
          world_model:
            remoteJourney?.world_model ||
            localJourney.world_model,
          confidence_insight:
            remoteJourney?.confidence_insight ||
            localJourney.confidence_insight,
          clue_adoption:
            remoteJourney?.clue_adoption ||
            localJourney.clue_adoption,
          theory_components:
            remoteJourney?.theory_components ||
            localJourney.theory_components,
          solution_coverage:
            remoteJourney?.solution_coverage ||
            localJourney.solution_coverage,
        });
      })
      .catch(() => {
        saveReasoningJourney(
          buildLocalReasoningJourney(progress),
        );
        setSummaryError("AI 档案生成时间较长，当前先展示本地复盘。你的原始记录仍完整保留。");
      })
      .finally(() => setSummaryLoading(false));
  }, [progress, saveReasoningJourney]);

  const retrySummary = useCallback(() => {
    requestedSummary.current = false;
    requestSummary(true);
  }, [requestSummary]);

  useEffect(() => {
    requestSummary();
  }, [requestSummary]);

  if (
    !progress.hypothesisV1
  ) {
    return (
      <p
        className="readerMessage"
      >
        完成阅读并提交你的推理方案后，这里会展示你的思路历程。
      </p>
    );
  }

  const summary = progress.reasoningJourney;
  const worldModel = summary?.world_model;
  const operationDescriptions = {
    ASSUMPTION_EXPOSED: "原本隐藏的前提被证据照亮",
    ROLE_REDEFINED: "同一线索在理论中承担了新的角色",
    CLAIM_NARROWED: "主张被收窄到证据能够支持的范围",
    MECHANISM_ADDED: "解释中加入了新的行动机制",
    LINK_CREATED: "原本孤立的线索被连接成因果链",
    IDEA_ABANDONED: "原有解释被后续证据排除",
    CLAIM_REINFORCED: "主张承受审查后被保留",
  };


  return (
    <section className="thinkingJourney caseClosure">
      <header className="caseClosureHeader">
        <div>
          <span>UNPROVEN · CASE FILE 013</span>
          <h2>你的世界模型，如何被证据改写</h2>
          <p>这里不统计猜中了几步，只重建哪条证据改变了你相信的世界。</p>
        </div>
        <div className="caseClosureStamp">已封存</div>
      </header>

      <div className="caseClosureMeta">
        <div><span>案件</span><strong>第十三号牢房</strong></div>
        <div><span>世界模型</span><strong>{worldModel?.claims?.length || 0} 个状态</strong></div>
        <div><span>证据撞击</span><strong>{worldModel?.impacts?.length || 0} 次</strong></div>
        <div><span>记录状态</span><strong>{summaryLoading ? "正在重建" : "已封存"}</strong></div>
      </div>

      <section className="caseClosureFinding journeyHeadline">
        <span>THE RECONSTRUCTION</span>
        <h3>最大的重建，不是换了答案，而是改变了世界如何运作</h3>
        <p>{worldModel?.biggest_reconstruction || "正在辨认哪条证据真正改变了你的解释……"}</p>
      </section>

      <section className="caseClosureSection worldModelSection">
        <div className="caseClosureSectionTitle">
          <span>01</span>
          <div><h3>Evidence Impact Map</h3><p>主张不是被答案替换，而是被证据逐次撞击、收窄和重组</p></div>
        </div>
        {summaryLoading && <div className="journeySummaryStatus">正在重建证据与你的判断之间的关系……</div>}
        {summaryError && (
          <div className="journeySummaryStatus journeySummaryError" role="status">
            <div>
              <strong>当前为临时复盘</strong>
              <p>{summaryError}</p>
            </div>
            <button
              type="button"
              className="journeySummaryRetry"
              disabled={summaryLoading}
              onClick={retrySummary}
            >
              {summaryLoading ? "正在重新生成…" : "重新生成 AI 档案"}
            </button>
          </div>
        )}
        {worldModel?.claims?.length ? (
          <div className="impactMap" role="list" aria-label="证据如何改变你的世界模型">
            <article className="worldClaim worldClaimInitial" role="listitem">
              <div className="worldClaimStage">{worldModel.claims[0].stage}</div>
              <div><span>{worldModel.claims[0].label}</span><p>{worldModel.claims[0].claim}</p></div>
            </article>
            {worldModel.impacts.map((impact, index) => {
              const isFinalImpact = index === worldModel.impacts.length - 1;
              const nextClaim = worldModel.claims.find((claim) =>
                claim.claim === impact.after_claim,
              );
              return (
                <div className="impactTransition" key={`${impact.operation}-${index}`} role="listitem">
                  <article className="evidenceImpact">
                    <div className="impactEvidence">
                      <span>{impact.evidence_ids?.length ? impact.evidence_ids.join(" · ") : "NEW EVIDENCE"}</span>
                      <p>{impact.evidence_summary}</p>
                    </div>
                    <div className="impactCollision" aria-hidden="true"><span>×</span></div>
                    <div className="impactAssumption">
                      <span>被撞击的前提</span>
                      <p>{impact.challenged_assumption}</p>
                    </div>
                    <div className="impactOperation">
                      <strong>{impact.operation_label}</strong>
                      <small>{operationDescriptions[impact.operation] || impact.operation}</small>
                    </div>
                    <details className="impactEvidenceTrace">
                      <summary>为什么判定发生了这次变化</summary>
                      <p><b>你的依据：</b>{impact.user_basis}</p>
                      <p><b>如果没有这条证据：</b>{impact.counterfactual}</p>
                    </details>
                  </article>
                  <article className={`worldClaim ${isFinalImpact ? "worldClaimFinal" : ""}`}>
                    <div className="worldClaimStage">{nextClaim?.stage || (isFinalImpact ? "FINAL" : "V2")}</div>
                    <div><span>{nextClaim?.label || (isFinalImpact ? "揭晓前的最终模型" : "证据撞击后的模型")}</span><p>{impact.after_claim}</p></div>
                  </article>
                </div>
              );
            })}
          </div>
        ) : <p>正在等待世界模型重建结果。</p>}
      </section>

      <section className="missingBridgeSection">
        <span>THE MISSING BRIDGE</span>
        <h3>让局部解释成为完整系统的最后一座桥</h3>
        <p>{worldModel?.missing_bridge || "正在寻找你的理论最后补上的因果连接……"}</p>
      </section>

      <section className="caseClosureSection dossierAppendix">
        <div className="caseClosureSectionTitle">
          <span>02</span>
          <div><h3>档案依据</h3><p>世界模型重建所使用的原始记录与对照材料</p></div>
        </div>
        <details className="appendixRecord" open>
          <summary>压力问题与我的回应</summary>
          <div className="appendixBody">
            <p><b>问题：</b>{progress.stressResult?.pressure_question || "本轮没有生成个性化压力问题。"}</p>
            <p><b>回应：</b>{progress.stressAnswer || "没有留下独立回应。"}</p>
            <p><b>认知操作：</b>{summary?.pressure_handling}</p>
          </div>
        </details>
        <details className="appendixRecord">
          <summary>封存的 V1 / V2 / Final</summary>
          <div className="appendixBody">
            <p><b>V1：</b>{progress.hypothesisV1.text}</p>
            <p><b>V2：</b>{progress.hypothesisV2?.text || "保留 V1"}</p>
            <p><b>Final：</b>{progress.finalReasoning?.text}</p>
          </div>
        </details>
        <details className="appendixRecord">
          <summary>线索采用记录</summary>
          <div className="appendixBody compactClueList">
            {summary?.clue_adoption?.length
              ? summary.clue_adoption.map((record, index) => (
                  <p key={`${record.clue}-${index}`}><b>{record.clue}</b> · {record.noticed_at} · {record.adopted_at === "NOT_USED" ? "仅注意，未进入理论" : `进入 ${record.adopted_at}`}</p>
                ))
              : <p>没有足够的批注记录。</p>}
          </div>
        </details>
        <details className="appendixRecord">
          <summary>与教授完整行动机制对照</summary>
          <div className="appendixBody solutionPath" role="list">
            {summary?.solution_path?.map((step) => <article role="listitem" key={step.step_id}><b>{String(step.step_id).padStart(2, "0")}</b><p>{step.text}</p></article>)}
          </div>
        </details>
      </section>

      <section className="readerFeedbackSection">
        <span>READER FEEDBACK</span>
        <h3>这次阅读，哪一刻改变了你的判断？</h3>
        <p>请写下具体线索、卡住的位置或新的理解。反馈只保存在当前设备，可随时修改。</p>
        <textarea
          value={feedbackDraft}
          onChange={(event) => {
            setFeedbackDraft(event.target.value);
            setFeedbackSaved(false);
          }}
          placeholder="例如：我原本把排水管理解成人的出口，直到……"
          maxLength={500}
        />
        <button
          className="secondaryButton"
          type="button"
          disabled={!feedbackDraft.trim()}
          onClick={() => {
            submitFeedback(feedbackDraft.trim());
            setFeedbackSaved(true);
          }}
        >
          {feedbackSaved ? "反馈已保存" : "保存我的体验反馈"}
        </button>
      </section>

      <footer className="caseClosureFooter">
        <strong>UNPROVEN</strong>
        <span>文本证明到哪里，你的判断就从哪里开始。</span>
      </footer>
    </section>
  );
}


function WorkspacePage() {

  const [
  checkpointNoticeDismissed,
  setCheckpointNoticeDismissed,
  ] = useState(false);

  const {
  progress,
  setCurrentStage,
  completeReading,
  resetProgress,

  submitStressResult,
} = useProgress();


  const initialPage =
    Math.min(
      TOTAL_PAGES,

      Math.max(
        1,

        progress.reading
          .currentStageId ||
          1,
      ),
    );


  const [
    pageId,
    setPageId,
  ] = useState(
    initialPage,
  );


  const [
    stagesData,
    setStagesData,
  ] = useState({});


  const [
    loading,
    setLoading,
  ] = useState(true);


  const [
    error,
    setError,
  ] = useState("");

  const [
    stageRetryToken,
    setStageRetryToken,
  ] = useState(0);


  const [
    openPanel,
    setOpenPanel,
  ] = useState(null);


  const [
    menuOpen,
    setMenuOpen,
  ] = useState(false);

  const [
    showReaderToolsHint,
    setShowReaderToolsHint,
  ] = useState(() => {
    try {
      return window.localStorage.getItem(READER_TOOLS_HINT_KEY) !== "1";
    } catch {
      return true;
    }
  });


  const [
    touchStartX,
    setTouchStartX,
  ] = useState(null);


  const ebookSurfaceRef =
    useRef(null);

  const pressurePrefetchRef =
    useRef(new Set());


  const stage =
    stagesData[pageId];


  const checkpoint =
    stage?.checkpoint;

  useEffect(() => {
  if (
    !stage ||
    !checkpoint ||
    checkpoint.kind !== "pressure"
  ) {
    return;
  }

  const sourceHypothesis =
    progress.hypothesisV1;

  const existingResult =
    progress.stressResult;

  if (
    !sourceHypothesis ||
    existingResult
  ) {
    return;
  }

  const prefetchKey =
    `${checkpoint.checkpoint_id}:${sourceHypothesis.text}`;

  if (
    pressurePrefetchRef.current.has(
      prefetchKey,
    )
  ) {
    return;
  }

  pressurePrefetchRef.current.add(
    prefetchKey,
  );

  console.log(
    "Prefetch Pressure Test:",
    checkpoint.checkpoint_id,
  );

  analyzeHypothesis({
    sessionId:
      progress.sessionId,

    stageId: stage.stage_id,

    hypothesisText:
      sourceHypothesis.text,

    confidence:
      sourceHypothesis.confidence,
  })
    .then((result) => {
      console.log(
        "Pressure Test prefetched:",
        result,
      );

      submitStressResult(
        result,
      );
    })
    .catch((error) => {
      console.error(
        "Pressure Test prefetch failed:",
        error,
      );

      pressurePrefetchRef.current.delete(
        prefetchKey,
      );
    });
}, [
  stage,
  checkpoint,

  progress.hypothesisV1,
  progress.sessionId,

  progress.stressResult,

  submitStressResult,
]);


  const showCheckpointNotice =
  checkpoint &&
  !checkpointDone(
    progress,
    checkpoint,
  ) &&
  openPanel !== "checkpoint" &&
  !checkpointNoticeDismissed;

  const hasPendingCheckpoint = Boolean(
    checkpoint &&
    !checkpointDone(progress, checkpoint),
  );

  function dismissReaderToolsHint() {
    setShowReaderToolsHint(false);

    try {
      window.localStorage.setItem(READER_TOOLS_HINT_KEY, "1");
    } catch {
      // 浏览器禁用存储时，仅在当前页面隐藏提示。
    }
  }

  // 每到一个新的 checkpoint，重新允许气泡出现
  useEffect(() => {
    // checkpoint 变化时生成一条新的、可关闭的提醒。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckpointNoticeDismissed(false);
  }, [
    checkpoint?.checkpoint_id,
  ]);


  // 气泡出现 15 秒后自动消失
  useEffect(() => {
    if (!showCheckpointNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCheckpointNoticeDismissed(true);
    }, 30000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    showCheckpointNotice,
    checkpoint?.checkpoint_id,
  ]);
    

  useEffect(() => {
    let cancelled =
      false;

    let retryTimer =
      null;

    if (
      pageId >
      STAGE_COUNT
    ) {
      // 推理档案是本地汇总页，不需要等待后端内容。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      setError("");

      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError("");


    function loadStage(
      attempt = 0,
    ) {
      getStage(pageId)
      .then((data) => {
        if (cancelled) {
          return;
        }

        setStagesData(
          (prev) => ({
            ...prev,

            [pageId]:
              data,
          }),
        );

        setCurrentStage(
          pageId,
        );


        if (
          pageId ===
          STAGE_COUNT
        ) {
          completeReading();
        }

        setLoading(false);
      })

      .catch((requestError) => {
        if (cancelled) {
          return;
        }

        if (attempt === 0) {
          setError(
            "正在唤醒阅读服务，将自动重试一次……",
          );

          retryTimer = window.setTimeout(
            () => loadStage(1),
            1500,
          );

          return;
        }

        setError(
          requestError?.message ||
          "这一页暂时没有载入。你的进度仍保存在本机，可以重试或返回上一页。",
        );

        setLoading(false);
      });
    }

    loadStage();


    return () => {
      cancelled = true;

      if (retryTimer) {
        window.clearTimeout(
          retryTimer,
        );
      }
    };
  }, [
    pageId,
    stageRetryToken,
    setCurrentStage,
    completeReading,
  ]);


  /*
   * 注意：
   *
   * 原来的代码这里有一个 useEffect，
   * 到 checkpoint 就自动：
   *
   * setOpenPanel("checkpoint")
   *
   * 现在故意删除。
   *
   * Checkpoint 只发消息提醒，
   * 用户点击后才打开。
   */


  // 每次翻页（无论前进还是后退），
  // 阅读区域都滚动回顶部
  useEffect(() => {
    ebookSurfaceRef.current?.scrollTo({
      top: 0,
    });
  }, [pageId]);


  const canPrev =
    pageId > 1;


  const canNext =
    pageId <
    TOTAL_PAGES;


  const checkpointBlocking =
    Boolean(
      checkpoint &&
      !checkpointDone(
        progress,
        checkpoint,
      ),
    );


  const pageLabel =
    useMemo(
      () =>
        `${String(
          pageId,
        ).padStart(
          2,
          "0",
        )} / ${String(
          TOTAL_PAGES,
        ).padStart(
          2,
          "0",
        )}`,

      [pageId],
    );


  function turnPage(
    direction,
  ) {
    if (
      direction > 0 &&
      checkpointBlocking
    ) {
      setMenuOpen(false);
      setCheckpointNoticeDismissed(true);
      setOpenPanel("checkpoint");
      return;
    }

    setMenuOpen(false);
    setOpenPanel(null);

    setPageId(
      (prev) => {
        const next =
          prev +
          direction;

        return Math.min(
          TOTAL_PAGES,

          Math.max(
            1,
            next,
          ),
        );
      },
    );
  }


  function goToPage(
    target,
  ) {
    setMenuOpen(false);
    setOpenPanel(null);

    setPageId(
      Math.min(
        TOTAL_PAGES,

        Math.max(
          1,
          target,
        ),
      ),
    );
  }


  function handleTouchEnd(
    event,
  ) {
    if (
      touchStartX ===
      null
    ) {
      return;
    }


    const delta =
      event
        .changedTouches[0]
        .clientX -
      touchStartX;


    if (
      Math.abs(delta) >
      55
    ) {
      turnPage(
        delta < 0
          ? 1
          : -1,
      );
    }


    setTouchStartX(
      null,
    );
  }


  function handleOpenCheckpoint() {
    setMenuOpen(false);

    setOpenPanel(
      "checkpoint",
    );
  }


  return (
    <section
      className={
        `readerPage ${
          openPanel ===
          "checkpoint"
            ? "checkpointDocked"
            : ""
        }`
      }

      onTouchStart={(
        event,
      ) =>
        setTouchStartX(
          event
            .touches[0]
            .clientX,
        )
      }

      onTouchEnd={
        handleTouchEnd
      }
    >
      <FloatingMenu
        open={menuOpen}

        annotationCount={progress.annotations.length}

        hasPendingCheckpoint={hasPendingCheckpoint}

        showHint={
          showReaderToolsHint &&
          progress.annotations.length === 0 &&
          pageId <= STAGE_COUNT
        }

        onDismissHint={dismissReaderToolsHint}

        onToggle={() =>
          setMenuOpen(
            (prev) =>
              !prev,
          )
        }

        onOpenAnnotations={() => {
          setMenuOpen(false);

          setOpenPanel(
            "annotations",
          );
        }}

        onOpenQA={() => {
          setMenuOpen(false);

          setOpenPanel("qa");
        }}

        onOpenCheckpoint={
          handleOpenCheckpoint
        }

        onReset={() => {
          setMenuOpen(false);

          resetProgress();

          setPageId(1);

          setOpenPanel(null);
        }}
      />


      {showCheckpointNotice && (
        <CheckpointNotification
          checkpoint={checkpoint}

          onOpen={() => {
            setCheckpointNoticeDismissed(true);
            handleOpenCheckpoint();
          }}

          onClose={() => {
            setCheckpointNoticeDismissed(true);
          }}
        />
      )}


      <button
        type="button"
        className="pageTurnButton pageTurnPrev"
        aria-label="上一页"
        disabled={!canPrev}
        onClick={() =>
          turnPage(-1)
        }
      >
        ‹
      </button>


      <button
        type="button"
        className="pageTurnButton pageTurnNext"
        aria-label={
          checkpointBlocking
            ? "完成当前思考后继续"
            : "下一页"
        }
        disabled={!canNext}
        onClick={() =>
          turnPage(1)
        }
      >
        ›
      </button>


      <main
        ref={ebookSurfaceRef}
        className={
          pageId === TOTAL_PAGES
            ? "ebookSurface archiveSurface"
            : "ebookSurface"
        }
      >
        <div
          className="ebookTopline"
        >
          <span>
            {pageId ===
            TOTAL_PAGES
              ? "推理档案"
              : "第十三号牢房"}
          </span>

          <span>
            {pageLabel}
          </span>
        </div>


        {loading &&
          !stage && (
          <p
            className="readerMessage"
          >
            正在翻开这一页...
          </p>
        )}


        {error && !stage && (
          <div className="readerMessage readerError stageLoadError">
            <p>{error}</p>
            {!loading && (
              <div className="actions">
                <button
                  type="button"
                  className="primaryButton"
                  onClick={() =>
                    setStageRetryToken(
                      (value) => value + 1,
                    )
                  }
                >
                  重新加载这一页
                </button>
                {pageId > 1 && (
                  <button
                    type="button"
                    className="secondaryButton"
                    onClick={() => goToPage(pageId - 1)}
                  >
                    返回上一页
                  </button>
                )}
              </div>
            )}
          </div>
        )}


        {stage &&
          pageId <=
            STAGE_COUNT && (
          <>
            <h1
              className="ebookTitle"
            >
              {stage.title}
            </h1>

            <AnnotationLayer
              stageId={
                pageId
              }

              segments={
                stage.segments
              }

              onOpenAnnotations={() =>
                setOpenPanel(
                  "annotations",
                )
              }
            />

            {pageId ===
              STAGE_COUNT && (
              <div
                className="viewJourneyRow"
              >
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() =>
                    goToPage(
                      TOTAL_PAGES,
                    )
                  }
                >
                  查看我的推理档案
                </button>
              </div>
            )}
          </>
        )}


        {pageId ===
          TOTAL_PAGES && (
          <ThinkingJourney
            progress={
              progress
            }
          />
        )}
      </main>


      <div
        className="readerFooter"
      >
        <span>
          {
            checkpoint
              ? checkpointBlocking
                ? "完成当前思考后继续"
                : "思考已记录"
              : ""
          }
        </span>

        <span>
          {pageLabel}
        </span>
      </div>


      <Panel
        title={
          checkpoint?.title ||
          "当前思考"
        }

        subtitle={
          checkpoint
            ? checkpoint
                .checkpoint_id
            : "READING"
        }

        open={
          openPanel ===
          "checkpoint"
        }

        onClose={() =>
          setOpenPanel(null)
        }

        variant="side"
      >
        <CheckpointPanel
          stage={stage}

          progress={
            progress
          }

          onClose={() =>
            setOpenPanel(
              null,
            )
          }
        />
      </Panel>


      <Panel
        title="我的证据与批注"
        subtitle="EVIDENCE NOTES"

        open={
          openPanel ===
          "annotations"
        }

        onClose={() =>
          setOpenPanel(null)
        }
      >
        <AnnotationsPanel />
      </Panel>


      <Panel
        title="无剧透释义"
        subtitle="CONTEXT ASSISTANT"

        open={
          openPanel === "qa"
        }

        onClose={() =>
          setOpenPanel(null)
        }

        variant="side"
      >
        <QAPanel
          stageId={
            pageId <= STAGE_COUNT
              ? pageId
              : null
          }
        />
      </Panel>
    </section>
  );
}


export default WorkspacePage;
