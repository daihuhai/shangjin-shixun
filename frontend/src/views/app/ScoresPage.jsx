import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getScores, getTeacherScores, saveTeacherScore } from "../../services/appService";
import { formatTime } from "../../api/client";
import { MODEL_NAME } from "../../config/brand";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import { statusLabel, statusTone } from "./shared";

export default function ScoresPage() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState("");
  // 使用 callback 避免 user.role 为 undefined 时调用错误的 API
  const loader = useCallback(() => {
    if (!user?.role) return Promise.resolve([]);
    return user.role === "teacher" ? getTeacherScores(activeId) : getScores(user.role);
  }, [user?.role, activeId]);
  const { data, loading, error, reload } = useAsyncData(loader, [loader]);
  const [form, setForm] = useState({ teacherAdjustedScore: "", adjustmentReason: "", teacherComment: "" });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (user.role === "teacher" && !activeId && data?.activeId) {
      setActiveId(data.activeId);
    }
  }, [data, activeId, user.role]);

  useEffect(() => {
    if (user.role === "teacher" && data?.scoreDetail) {
      setForm({
        teacherAdjustedScore: String(data.scoreDetail.teacherAdjustedScore || data.scoreDetail.aiTotalScore || ""),
        adjustmentReason: data.scoreDetail.adjustmentReason || "",
        teacherComment: data.scoreDetail.teacherComment || ""
      });
    }
  }, [data, user.role]);

  async function handleSave(event) {
    event.preventDefault();
    if (!data?.scoreDetail) return;
    setSaving(true);
    setSaveMessage("");
    try {
      await saveTeacherScore({
        id: data.scoreDetail.id,
        teacherAdjustedScore: Number(form.teacherAdjustedScore),
        adjustmentReason: form.adjustmentReason,
        teacherComment: form.teacherComment
      });
      setSaveMessage("教师评分已保存");
      reload();
    } catch (err) {
      setSaveMessage(err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!user || user.role !== "teacher") {
    const records = Array.isArray(data) ? data : [];

    // 汇总统计
    const stats = useMemo(() => {
      const validScores = records
        .map(r => r.finalScore ?? r.score)
        .filter(s => typeof s === "number" && !isNaN(s));
      const avg = validScores.length ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1) : "--";
      const max = validScores.length ? Math.max(...validScores) : "--";
      const latest = records[0] || null;
      return { total: records.length, avg, max, latest };
    }, [records]);

    // 按任务分组
    const groupedByTask = useMemo(() => {
      const groups = {};
      records.forEach(r => {
        const key = r.taskTitle || "未知任务";
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });
      // 每个任务取最高分版本
      return Object.entries(groups).map(([taskName, submissions]) => {
        const best = submissions.reduce((a, b) => {
          const scoreA = a.finalScore ?? a.score ?? -1;
          const scoreB = b.finalScore ?? b.score ?? -1;
          return scoreB > scoreA ? b : a;
        }, submissions[0]);
        return { taskName, submissions, best };
      });
    }, [records]);

    // 分数颜色
    function scoreColor(score) {
      if (typeof score !== "number" || isNaN(score)) return "#9ca3af";
      if (score >= 90) return "#16a34a";
      if (score >= 80) return "#22c55e";
      if (score >= 70) return "#eab308";
      if (score >= 60) return "#f97316";
      return "#ef4444";
    }

    return (
      <LoadState loading={loading} error={error}>
        <div className="content-stack">
          <Panel title={user?.role === "admin" ? "成绩总览" : "我的成绩"} description={`提交后 ${MODEL_NAME} 会自动评价，教师复核后显示最终成绩。`}>
            {records.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>暂无提交记录</div>
                <div style={{ color: "#6b7280", fontSize: 14 }}>请先在「成果上传」中提交作业，提交后即可在此查看评分结果。</div>
              </div>
            ) : (
              <>
                {/* 成绩概览卡片 */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: 12,
                  marginBottom: 20
                }}>
                  {[
                    { label: "总提交数", value: stats.total, icon: "📝", color: "#3b82f6" },
                    { label: "平均分", value: stats.avg, icon: "📊", color: "#8b5cf6" },
                    { label: "最高分", value: stats.max, icon: "🏆", color: "#f59e0b" },
                    { label: "最近提交", value: stats.latest ? statusLabel(stats.latest.status) : "--", icon: "⏱", color: "#6b7280" },
                  ].map(card => (
                    <div key={card.label} style={{
                      background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
                      borderRadius: 10,
                      padding: "14px 16px",
                      border: "1px solid #e2e8f0"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 20 }}>{card.icon}</span>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{card.label}</span>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
                    </div>
                  ))}
                </div>

                {/* 成绩表格 */}
                <Table
                  columns={["任务", "版本", "状态", "AI评分", "最终分", "提交时间"]}
                  rows={records}
                  renderRow={(row) => {
                    const finalScore = row.finalScore ?? row.score;
                    const displayScore = typeof finalScore === "number" && !isNaN(finalScore)
                      ? finalScore
                      : (finalScore || "待评分");
                    return (
                      <tr key={row.submissionId}>
                        <td>{row.taskTitle}</td>
                        <td>v{row.version}</td>
                        <td><span className={`status-chip status-${statusTone(row.statusLabel || row.status)}`}>{row.statusLabel || statusLabel(row.status)}</span></td>
                        <td>{row.aiScore ?? "--"}</td>
                        <td>
                          <strong style={{ color: scoreColor(finalScore) }}>
                            {displayScore}
                          </strong>
                        </td>
                        <td>{formatTime(row.submittedAt)}</td>
                      </tr>
                    );
                  }}
                />
              </>
            )}
          </Panel>

          {/* 按任务分组汇总 */}
          {groupedByTask.length > 0 && (
            <Panel title="按任务汇总" description="每个任务的最高分版本概览">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {groupedByTask.map(({ taskName, submissions, best }) => {
                  const bestScore = best.finalScore ?? best.score;
                  return (
                    <div key={taskName} style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px 18px",
                      background: "#fafafa",
                      borderRadius: 10,
                      border: "1px solid #e5e7eb"
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{taskName}</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>共提交 {submissions.length} 次 · 最新状态：{statusLabel(best.statusLabel || best.status)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: scoreColor(bestScore) }}>
                          {typeof bestScore === "number" ? bestScore : "--"}
                        </div>
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>最高分</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {(() => {
            const focus = records.find((row) => row.dimensions?.length || row.feedback || row.highlights) || records[0];
            if (!focus) return null;

            // 新版评分详情展示
            const hasNewFormat = focus.feedback || focus.highlights || focus.errors;

            if (hasNewFormat) {
              return (
                <Panel title="详细评价" description={`${focus.taskTitle} · 由 ${MODEL_NAME} 智能分析`}>
                  {/* 总分和总结 */}
                  {focus.summary && (
                    <div className="callout-box" style={{ background: "#f0f9ff", borderLeft: "4px solid #3b82f6" }}>
                      <p style={{ margin: 0, fontWeight: 500 }}>{focus.summary}</p>
                    </div>
                  )}

                  {/* 分项得分 */}
                  {focus.dimensions?.length > 0 && (
                    <div className="score-stack top-gap">
                      {focus.dimensions.map((item) => (
                        <div className="score-box" key={item.name}>
                          <div className="status-row">
                            <span>{item.name}</span>
                            <strong>{item.score ?? item.aiScore} / {item.total}</strong>
                          </div>
                          <p className="footer-note">{item.evidence}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 做得好的地方（鼓励） */}
                  {focus.highlights?.length > 0 && (
                    <div className="callout-box top-gap" style={{ background: "#f0fdf4", borderLeft: "4px solid #22c55e" }}>
                      <strong style={{ color: "#16a34a" }}>✨ 做得很好的地方</strong>
                      <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                        {focus.highlights.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 发现的错误 */}
                  {focus.errors?.length > 0 && (
                    <div className="callout-box top-gap" style={{ background: "#fef2f2", borderLeft: "4px solid #ef4444" }}>
                      <strong style={{ color: "#dc2626"}}>🔍 需要注意的问题</strong>
                      {focus.errors.map((err, i) => (
                        <div key={i} style={{ marginTop: 10, padding: 10, background: "white", borderRadius: 6, fontSize: 14 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                            <span className={`status-chip status-${err.severity === "高" ? "danger" : err.severity === "中" ? "warning" : "info"}`}>
                              {err.type}
                            </span>
                            <strong>{err.location}</strong>
                          </div>
                          <p style={{ margin: "4px 0", color: "#666" }}>{err.description}</p>
                          {err.suggestion && (
                            <p style={{ margin: "4px 0 0", color: "#2563eb", fontWeight: 500 }}>
                              💡 建议：{err.suggestion}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 详细反馈 */}
                  {focus.feedback && (
                    <div className="callout-box top-gap">
                      <strong>📝 详细反馈</strong>
                      <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{focus.feedback}</p>
                    </div>
                  )}

                  {/* 教师评语 */}
                  {focus.teacherComment ? (
                    <div className="callout-box top-gap">
                      <strong>教师评语</strong>
                      <p>{focus.teacherComment}</p>
                    </div>
                  ) : null}
                </Panel>
              );
            }

            // 旧版格式兼容
            if (focus.dimensions?.length > 0) {
              return (
                <Panel title="分项评分" description={`${focus.taskTitle} · 由 ${MODEL_NAME} 生成`}>
                  <div className="score-stack">
                    {focus.dimensions.map((item) => (
                      <div className="score-box" key={item.name}>
                        <div className="status-row">
                          <span>{item.name}</span>
                          <strong>{item.aiScore} / {item.total}</strong>
                        </div>
                        <p className="footer-note">{item.evidence}</p>
                      </div>
                    ))}
                  </div>
                  {focus.teacherComment ? (
                    <div className="callout-box top-gap">
                      <strong>教师评语</strong>
                      <p>{focus.teacherComment}</p>
                    </div>
                  ) : null}
                </Panel>
              );
            }
            return (
              <Panel title="评价进度">
                <div className="callout-box">
                  <strong>{focus.statusLabel || statusLabel(focus.status)}</strong>
                  <p>尚进大模型正在处理您的提交，通常需 30 秒至 2 分钟。请稍后刷新「我的成绩」页面。</p>
                </div>
              </Panel>
            );
          })()}
        </div>
      </LoadState>
    );
  }

  const list = data?.list || [];
  const detail = data?.scoreDetail;

  return (
    <LoadState loading={loading} error={error}>
      <div className="split-layout teacher-score-layout">
        <Panel title="待评分学生" description={`左侧选择学生，右侧查看 ${MODEL_NAME} 打分并手动修正。`}>
          <Table
            columns={["学生", "任务", "状态", "AI评分", "最终分"]}
            rows={list}
            renderRow={(row) => (
              <tr
                key={row.id}
                className={row.id === (activeId || data?.activeId) ? "row-active" : ""}
                onClick={() => {
                  setSaveMessage("");
                  setActiveId(row.id);
                }}
              >
                <td>{row.student}<div className="table-subtext">{row.studentId}</div></td>
                <td>{row.task}</td>
                <td><span className={`status-chip status-${statusTone(row.status)}`}>{statusLabel(row.status)}</span></td>
                <td>{row.score === "--" ? "--" : `${row.score} 分`}</td>
                <td>{row.finalScore ?? row.score ?? "--"}</td>
              </tr>
            )}
          />
        </Panel>

        <Panel title="AI评分复核" description={`先看 ${MODEL_NAME} 的智能分析结果，再由教师写入最终分和理由。`}>
          {detail ? (
            <form className="teacher-score-form" onSubmit={handleSave}>
              <div className="mini-grid">
                <div className="mini-stat"><span>学生</span><strong>{detail.student}</strong></div>
                <div className="mini-stat"><span>AI自动评分</span><strong>{detail.aiTotalScore || "--"}</strong></div>
                <div className="mini-stat"><span>当前最终分</span><strong>{detail.finalScore || "--"}</strong></div>
              </div>

              {/* AI 详细分析结果 */}
              {detail.summary && (
                <div className="callout-box top-gap" style={{ background: "#f0f9ff", borderLeft: "4px solid #3b82f6" }}>
                  <p style={{ margin: 0, fontWeight: 500 }}>📊 AI总结：{detail.summary}</p>
                </div>
              )}

              <div className="score-stack top-gap">
                {(detail.dimensions || []).map((item) => (
                  <div className="score-box" key={item.name}>
                    <div className="status-row">
                      <span>{item.name}</span>
                      <strong>{item.score ?? item.aiScore} / {item.total}</strong>
                    </div>
                    <p className="footer-note">{item.evidence}</p>
                  </div>
                ))}
              </div>

              {/* 学生做得好的地方（供教师参考） */}
              {detail.highlights?.length > 0 && (
                <div className="callout-box top-gap" style={{ background: "#f0fdf4", borderLeft: "4px solid #22c55e" }}>
                  <strong style={{ color: "#16a34a" }}>✨ 学生亮点</strong>
                  <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                    {detail.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 发现的问题（供教师参考） */}
              {detail.errors?.length > 0 && (
                <div className="callout-box top-gap" style={{ background: "#fef2f2", borderLeft: "4px solid #ef4444" }}>
                  <strong style={{ color: "#dc2626"}}>⚠️ AI发现的问题</strong>
                  {detail.errors.map((err, i) => (
                    <div key={i} style={{ marginTop: 8, padding: 8, background: "white", borderRadius: 4, fontSize: 13 }}>
                      <span style={{ color: err.severity === "高" ? "#dc2626" : "#f59e0b" }}>
                        [{err.severity}] {err.type}
                      </span>
                      ：{err.description}
                      {err.suggestion && <span style={{ color: "#2563eb" }}> → {err.suggestion}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* AI详细反馈（供教师参考） */}
              {detail.feedback && (
                <div className="callout-box top-gap">
                  <strong>📝 AI详细反馈</strong>
                  <p style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 14 }}>{detail.feedback}</p>
                </div>
              )}

              <div className="callout-stack top-gap">
                <label className="form-field">
                  <span>教师最终分</span>
                  <input
                    value={form.teacherAdjustedScore}
                    onChange={(e) => setForm({ ...form, teacherAdjustedScore: e.target.value })}
                    type="number"
                    min="0"
                    max="100"
                  />
                </label>
                <label className="form-field">
                  <span>调分理由</span>
                  <textarea
                    value={form.adjustmentReason}
                    onChange={(e) => setForm({ ...form, adjustmentReason: e.target.value })}
                    rows="3"
                    placeholder="说明为什么要高于或低于AI评分"
                  />
                </label>
                <label className="form-field">
                  <span>教师评语</span>
                  <textarea
                    value={form.teacherComment}
                    onChange={(e) => setForm({ ...form, teacherComment: e.target.value })}
                    rows="4"
                    placeholder="给学生的具体反馈（可参考上方AI的分析结果）"
                  />
                </label>
              </div>

              {saveMessage ? <div className="success-text top-gap">{saveMessage}</div> : null}

              <div className="toolbar top-gap">
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? "保存中..." : "保存教师评分"}
                </button>
              </div>
            </form>
          ) : (
            <div className="panel">请选择一条待评分记录。</div>
          )}
        </Panel>
      </div>
    </LoadState>
  );
}
