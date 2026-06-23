import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getCourseWorkspace } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import ReviewPortalShell from "./ReviewPortalShell";
import { buildAssignmentReviewDetail } from "./reviewPortalData";

export default function AssignmentReviewDetailPage() {
  const { user } = useAuth();
  const { reviewId = "" } = useParams();
  const { data, loading, error } = useAsyncData(() => getCourseWorkspace(user.role, ""), [user.role]);
  const detail = useMemo(() => buildAssignmentReviewDetail(data?.list || [], reviewId), [data, reviewId]);

  if (user.role !== "teacher") {
    return (
      <LoadState loading={loading} error={error}>
        <div className="input-like">请使用教师身份进入作业批阅详情页。</div>
      </LoadState>
    );
  }

  return (
    <LoadState loading={loading} error={error}>
      <ReviewPortalShell
        active="assignment"
        title="作业详情"
        actions={
          <div className="review-detail-top-actions">
            <Link className="review-inline-link" to="/assignment-review">返回作业列表</Link>
            <button className="review-inline-link" type="button">导出作业包</button>
          </div>
        }
      >
        {detail ? (
          <div className="review-detail-page">
            <aside className="review-question-sidebar">
              <div className="review-question-panel">
                <h3>提交情况</h3>
                <div className="review-submission-stack">
                  {detail.students.map((student) => (
                    <div className="review-submission-card" key={student.id}>
                      <strong>{student.student}</strong>
                      <span>{student.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            <section className="review-detail-card">
              <div className="review-detail-header">
                <div>
                  <h2>{detail.title}</h2>
                  <p>总提交 {detail.submittedCount}，待批阅 {detail.pendingCount}，未提交 {detail.unsubmittedCount}</p>
                </div>
                <label className="review-answer-toggle">
                  <input type="checkbox" />
                  <span>显示评分建议</span>
                </label>
              </div>

              <div className="review-detail-section">
                <h3>作业说明</h3>
                <p>{detail.heroNote}</p>
              </div>

              <div className="review-panel-grid">
                {detail.panels.map((panel) => (
                  <article className="review-content-card" key={panel.id}>
                    <strong>{panel.title}</strong>
                    <p>{panel.note}</p>
                  </article>
                ))}
              </div>

              <div className="review-detail-section">
                <h3>评分维度</h3>
                <div className="review-score-list">
                  {detail.scoreBreakdown.map((item) => (
                    <div className="review-score-row" key={item.name}>
                      <div>
                        <strong>{item.name}</strong>
                        <p>{item.note}</p>
                      </div>
                      <span>{item.score} / {item.total}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="review-detail-section">
                <h3>附件与检查项</h3>
                <div className="review-check-grid">
                  <div className="review-content-card">
                    <strong>附件列表</strong>
                    {detail.attachments.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                  <div className="review-content-card">
                    <strong>核对清单</strong>
                    {detail.checklist.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                </div>
              </div>

              <div className="review-detail-section">
                <h3>批阅说明</h3>
                <p>{detail.reviewerNote}</p>
                <p>当前默认展示：{detail.currentStudent} · {detail.currentSubmissionTime}</p>
              </div>
            </section>
          </div>
        ) : (
          <div className="input-like">未找到对应作业。</div>
        )}
      </ReviewPortalShell>
    </LoadState>
  );
}
