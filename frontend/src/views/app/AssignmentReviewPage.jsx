import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getCourseWorkspace } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import ReviewPortalShell from "./ReviewPortalShell";
import { buildAssignmentReviewSummaries } from "./reviewPortalData";

export default function AssignmentReviewPage() {
  const { user } = useAuth();
  const [keyword, setKeyword] = useState("");
  const { data, loading, error } = useAsyncData(() => getCourseWorkspace(user.role, ""), [user.role]);
  const summaries = useMemo(() => buildAssignmentReviewSummaries(data?.list || []), [data]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) {
      return summaries;
    }
    return summaries.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.courseName.toLowerCase().includes(q) ||
        item.className.toLowerCase().includes(q)
    );
  }, [keyword, summaries]);

  if (user.role !== "teacher") {
    return (
      <LoadState loading={loading} error={error}>
        <div className="input-like">请使用教师身份进入作业批阅系统。</div>
      </LoadState>
    );
  }

  return (
    <LoadState loading={loading} error={error}>
      <ReviewPortalShell
        active="assignment"
        title="作业批阅"
        actions={
          <div className="review-toolbar-actions">
            <input
              className="review-search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索作业名 / 课程 / 班级"
            />
          </div>
        }
      >
        <section className="review-board">
          <div className="review-board-header">
            <div className="review-board-tabs">
              <button className="review-chip primary" type="button">新建作业</button>
              <button className="review-chip" type="button">作业库</button>
              <button className="review-chip" type="button">评分规则</button>
            </div>
            <div className="review-board-filters">
              <select className="review-select" defaultValue="all">
                <option value="all">全部班级</option>
                <option value="software-2301">软件 2301</option>
                <option value="software-2302">软件 2302</option>
              </select>
              <div className="review-radio-group">
                <span>状态</span>
                <label><input defaultChecked name="assignment-status" type="radio" /> 全部</label>
                <label><input name="assignment-status" type="radio" /> 待批阅</label>
                <label><input name="assignment-status" type="radio" /> 进行中</label>
                <label><input name="assignment-status" type="radio" /> 已结束</label>
              </div>
            </div>
          </div>

          <div className="review-list">
            {filtered.map((item) => (
              <article className="review-list-card" key={item.id}>
                <div className="review-list-copy">
                  <Link className="review-list-title" to={`/assignment-review/${item.id}`}>
                    {item.title}
                  </Link>
                  <p className="review-list-meta">{item.courseName} · {item.className}</p>
                  <p className="review-list-submeta">截止时间：{item.due} · 提交次数：{item.attempts}</p>
                </div>
                <div className="review-list-stats">
                  <div className="review-stat-box">
                    <strong>{item.pendingCount}</strong>
                    <span>待批</span>
                  </div>
                  <div className="review-stat-inline">
                    <span>{item.submittedCount} 已交</span>
                    <span>{item.unsubmittedCount} 未交</span>
                  </div>
                  <Link className="review-link-button" to={`/assignment-review/${item.id}`}>
                    批阅
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </ReviewPortalShell>
    </LoadState>
  );
}
