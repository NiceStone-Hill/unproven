import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProgress } from "../state/ProgressContext";
import { getResumeRoute } from "../state/progress";
import { warmReadingContent } from "../api";

function EntryPage() {
  const navigate = useNavigate();
  const { progress, startExperience, resetProgress } = useProgress();

  const hasProgress = progress.started;

  useEffect(() => {
    // Wake the content service while the reader is still on the cover and
    // cache every chapter after the first successful visit.
    warmReadingContent().catch(() => {});
  }, []);

  function handleStart() {
    if (hasProgress) {
      resetProgress();
    }
    startExperience();
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

      <p className="entryTagline">
        越狱，你要逃出的，不是牢房，是你默认的世界。
      </p>

      <div className="readerPromise" aria-label="体验说明">
        <p><strong>为谁：</strong>第一次读经典推理、容易追着谜底走的年轻读者</p>
        <p><strong>你会做什么：</strong>收集线索，封存判断，接受一次无剧透的前提审查</p>
        <p><strong>你会带走什么：</strong>不是正确率，而是一份证据如何改变你的推理档案</p>
      </div>

      <p className="introduction">
        奥古斯都·S·F·X·范·杜森教授，人称“思考机器”。过去三十五年里，
        他始终相信：万事皆有来由，也必有归宿；只要事实齐全，任何问题都能被推理还原。
      </p>

      <div className="editor">
        <p className="caseSynopsis">
          一次争论最终变成了真正的挑战：把他关进任何一座监狱的任何一间牢房，
          只让他穿着最必要的衣物，他也能在一周之内脱身。
        </p>

        <div className="actions">
          {hasProgress && (
            <button className="secondaryButton" type="button" onClick={handleResume}>
              继续上次的推理
            </button>
          )}
          <button className="primaryButton" type="button" onClick={handleStart}>
            {hasProgress ? "重新开始" : "接受挑战"}
          </button>
        </div>
      </div>

      <p className="sourceNote">
        文本说明：雅克·福翠尔公版作品 The Problem of Cell 13；中文修订全译本依据 Project Gutenberg 第 57669 号英文公版文本校核。
      </p>
    </section>
  );
}

export default EntryPage;
