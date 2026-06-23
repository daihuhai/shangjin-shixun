import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getCourseWorkspace } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import ReviewPortalShell from "./ReviewPortalShell";
import { buildExamReviewDetail } from "./reviewPortalData";

export default function ExamReviewDetailPage() {
  const { user } = useAuth();
  const { reviewId = "" } = useParams();
  const [showAnswer, setShowAnswer] = useState(false);
  const { data, loading, error } = useAsyncData(() => getCourseWorkspace(user.role, ""), [user.role]);
  const detail = useMemo(() => buildExamReviewDetail(data?.list || [], reviewId), [data, reviewId]);

  if (user.role !== "teacher") {
    return (
      <LoadState loading={loading} error={error}>
        <div className="input-like">请使用教师身份进入考试批阅详情页。</div>
      </LoadState>
    );
  }

  return (
    <LoadState loading={loading} error={error}>
      <ReviewPortalShell
        active="exam"
        title="试卷详情"
        actions={
          <div className="review-detail-top-actions">
            <Link className="review-inline-link" to="/exam-review">返回考试列表</Link>
            <button className="review-inline-link" type="button">试卷结构分析</button>
            <button className="review-inline-link" type="button">导出试卷</button>
          </div>
        }
      >
        {detail ? (
          <div className="review-detail-page">
            <aside className="review-question-sidebar">
              {detail.sections.map((section) => (
                <div className="review-question-panel" key={section.id}>
                  <h3>{section.title}（共{section.questions.length}题，{section.total}分）</h3>
                  <div className="review-outline-list">
                    {section.questions.map((question) => (
                      <div className="review-outline-item" key={question.id}>
                        <span>{question.number}</span>
                        <p>（{question.score}分） {question.stem}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </aside>

            <section className="review-detail-card">
              <div className="review-detail-header">
                <div>
                  <h2>{detail.title}</h2>
                  <p>总题量 {detail.totalCount}，总分值 {detail.totalScore}</p>
                </div>
                <label className="review-answer-toggle">
                  <input checked={showAnswer} onChange={() => setShowAnswer((value) => !value)} type="checkbox" />
                  <span>显示答案</span>
                </label>
              </div>

              {detail.sections.map((section) => (
                <div className="review-detail-section" key={section.id}>
                  <h3>{section.title}（共{section.questions.length}题，{section.total}分）</h3>
                  {section.questions.map((question) => (
                    <article className="review-question-card" key={question.id}>
                      <p className="review-question-type">{question.number}.（{question.score}分）</p>
                      <strong>{question.stem}</strong>
                      {question.options.length ? (
                        <div className="review-option-list">
                          {question.options.map((option, optionIndex) => (
                            <p key={`${question.id}-${option}`}>
                              {String.fromCharCode(65 + optionIndex)}. {option}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {showAnswer ? <p className="review-answer-text">参考答案：{question.answer}</p> : null}
                    </article>
                  ))}
                </div>
              ))}
            </section>
          </div>
        ) : (
          <div className="input-like">未找到对应试卷。</div>
        )}
      </ReviewPortalShell>
    </LoadState>
  );
}
