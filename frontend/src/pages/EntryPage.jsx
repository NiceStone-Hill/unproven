import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProgress } from "../state/ProgressContext";
import { getResumeRoute } from "../state/progress";
import { warmReadingContent } from "../api";

function EntryPage() {
  const navigate = useNavigate();
  const { progress, startExperience } = useProgress();

  const hasProgress = progress.started;
  const [prediction, setPrediction] = useState("");
  const [evidence, setEvidence] = useState("");

  const evidenceOptions = [
    "他只带最必要的衣物进入牢房",
    "他声称任何牢房都能在一周内离开",
    "监狱可以自行选择牢房与看守方式",
  ];

  useEffect(() => {
    // Wake the content service while the reader is still on the cover and
    // cache every chapter after the first successful visit.
    warmReadingContent().catch(() => {});
  }, []);

  function handleStart() {
    if (!prediction.trim() || !evidence) return;
    startExperience({
      restart: hasProgress,
      initialJudgment: {
        text: prediction.trim(),
        evidence,
      },
    });
    navigate("/workspace");
  }

  function handleResume() {
    navigate(getResumeRoute(progress));
  }

  return (
    <section className="hero">
      <div className="dossierTab">ACTIVE CASE</div>
      <div className="dossierStamp" aria-hidden="true">UNPROVEN</div>

      <p className="eyebrow">CASE FILE · NO.13 · UNPROVEN</p>

      <h1 className="entryTitle">
        《第十三号牢房》
      </h1>

      <p className="entryAuthor">雅克·福翠尔</p>

      <dl className="dossierMeta">
        <div>
          <dt>档案编号</dt>
          <dd>CELL-013</dd>
        </div>
        <div>
          <dt>案件状态</dt>
          <dd>待审查</dd>
        </div>
        <div>
          <dt>审查对象</dt>
          <dd>你的默认前提</dd>
        </div>
      </dl>

      <p className="introduction">
        奥古斯都·S·F·X·范·杜森教授，人称“思考机器”。过去三十五年里，
        他始终相信：万事皆有来由，也必有归宿；只要事实齐全，任何问题都能被推理还原。
      </p>

      <div className="editor entryMicroTask">
        <div className="microTaskHeader">
          <span>10 秒微判断</span>
          <strong>先留下一个会被后文检验的判断</strong>
        </div>
        <p className="caseSynopsis">
          一次争论最终变成了真正的挑战：把他关进任何一座监狱的任何一间牢房，
          只让他穿着最必要的衣物，他也能在一周之内脱身。
        </p>

        <label className="microTaskLabel" htmlFor="entry-prediction">
          根据目前的信息，你觉得教授会从哪里离开？
        </label>
        <input
          id="entry-prediction"
          className="predictionInput"
          value={prediction}
          onChange={(event) => setPrediction(event.target.value)}
          placeholder="例如：从窗户、牢门，或借某种身份离开……"
          maxLength={100}
        />

        <fieldset className="evidenceChoice">
          <legend>再选择一条支持它的证据</legend>
          {evidenceOptions.map((option) => (
            <label key={option} className={evidence === option ? "selected" : ""}>
              <input
                type="radio"
                name="entry-evidence"
                value={option}
                checked={evidence === option}
                onChange={(event) => setEvidence(event.target.value)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>

        <div className="actions">
          {hasProgress && (
            <button className="secondaryButton" type="button" onClick={handleResume}>
              继续上次的推理
            </button>
          )}
          <button
            className="primaryButton"
            type="button"
            disabled={!prediction.trim() || !evidence}
            onClick={handleStart}
          >
            {hasProgress ? "封存新判断并重新开始" : "封存判断，进入正文"}
          </button>
        </div>
        <p className="sealPromise">提交后即封存。之后的新证据可能会挑战这个判断。</p>
      </div>

      <p className="entryTagline">
        你不是来追一个谜底，而是在建立一个会被证据检验的世界模型。
      </p>

      <p className="sourceNote">
        文本说明：雅克·福翠尔公版作品 The Problem of Cell 13；中文修订全译本依据 Project Gutenberg 第 57669 号英文公版文本校核。
      </p>
    </section>
  );
}

export default EntryPage;
