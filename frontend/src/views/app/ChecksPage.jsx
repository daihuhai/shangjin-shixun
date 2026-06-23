import { useState } from "react";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getSubmissions, markCheckItem, runCheck } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import { statusTone } from "./shared";

export default function ChecksPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsyncData(getSubmissions, []);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const rows = data || [];
  const detail = active || rows[0] || null;

  async function handleRunCheck(id) {
    if (user.role === "student") return;
    setBusy(true);
    setMessage("");
    try {
      const result = await runCheck(id);
      setActive(result);
      reload();
      setMessage("智能核查完成");
    } catch (err) {
      setMessage(err.message || "核查失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleMark(itemId, teacherMark) {
    if (!detail) return;
    await markCheckItem(detail.id, itemId, teacherMark);
    // 重新获取最新数据
    reload();
    setMessage(teacherMark ? `已${teacherMark === "误判" ? "标记误判，该项将从评分中排除" : "确认问题"}` : "已撤销标记");
  }

  // 计算有效高风险数（排除误判项）
  const effectiveHighRiskCount = (detail?.checkReport?.items || []).filter(
    (i) => i.riskLevel === "高" && i.teacherMark !== "误判"
  ).length;

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel title="智能核查" description="结合大模型与规则清单，输出可解释核查结论与修复建议。">
          <Table
            columns={["学生", "任务", "状态", "风险", "结论"]}
            rows={rows}
            renderRow={(row) => (
              <tr key={row.id} className={detail?.id === row.id ? "row-active" : ""} onClick={() => setActive(row)}>
                <td>{row.studentName}</td>
                <td>{row.taskTitle}</td>
                <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
                <td><span className={`status-chip status-${statusTone(row.riskLevel)}`}>{row.riskLevel}</span></td>
                <td>{row.checkReport?.overall_conclusion || "未核查"}</td>
              </tr>
            )}
          />
        </Panel>

        {detail ? (
          <div className="split-layout">
            <Panel title="核查摘要" description="总体结论与模型版本信息。">
              <div className="mini-grid">
                <div className="mini-stat"><span>提交人</span><strong>{detail.studentName}</strong></div>
                <div className="mini-stat"><span>任务</span><strong>{detail.taskTitle}</strong></div>
                <div className="mini-stat"><span>高风险项</span><strong>{effectiveHighRiskCount}</strong></div>
              </div>
              <p className="top-gap">{detail.checkReport?.overall_conclusion || "尚未执行核查"}</p>
              {user.role !== "student" ? (
                <button className="primary-button top-gap" type="button" disabled={busy} onClick={() => handleRunCheck(detail.id)}>
                  {busy ? "核查中..." : "发起智能核查"}
                </button>
              ) : null}
            </Panel>

            <Panel title="核查项列表" description="点击可查看证据片段；教师可标记误判或确认。">
              {(detail.checkReport?.items || []).length > 0 ? (
                <div className="callout-stack">
                  {detail.checkReport.items.map((item) => {
                    const mark = item.teacherMark || "";
                    const isDismissed = mark === "误判";
                    const isConfirmed = mark === "确认问题";

                    return (
                      <div className={`callout-box ${isDismissed ? "check-item-dismissed" : ""} ${isConfirmed ? "check-item-confirmed" : ""}`} key={item.id}>
                        <div className="status-row">
                          <strong>{item.name}</strong>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {isDismissed ? (
                              <span className="status-chip status-neutral" style={{ background: "#f0f0f0", color: "#888" }}>已排除</span>
                            ) : isConfirmed ? (
                              <span className="status-chip status-orange">已确认</span>
                            ) : (
                              <span className={`status-chip status-${statusTone(item.riskLevel)}`}>{item.riskLevel}</span>
                            )}
                          </div>
                        </div>
                        <p className="footer-note">{item.category} · {item.conclusion}</p>
                        {isDismissed ? (
                          <p style={{ color: "#999", textDecoration: "line-through" }}>{item.evidence}</p>
                        ) : (
                          <p>{item.evidence}</p>
                        )}
                        <p className="footer-note">建议：{item.suggestion}</p>
                        {!isDismissed && !isConfirmed && user.role !== "student" ? (
                          <div className="toolbar">
                            <button className="ghost-button" type="button" onClick={() => handleMark(item.id, "确认问题")}>确认问题</button>
                            <button className="ghost-button danger-text" type="button" onClick={() => handleMark(item.id, "误判")}>标记误判</button>
                          </div>
                        ) : user.role !== "student" ? (
                          <div className="toolbar">
                            {isConfirmed ? (
                              <button className="ghost-button" type="button" onClick={() => handleMark(item.id, "")}>撤销确认</button>
                            ) : isDismissed ? (
                              <button className="ghost-button" type="button" onClick={() => handleMark(item.id, "")}>恢复该项</button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="input-like">暂无核查项，请先发起智能核查。</div>
              )}
            </Panel>
          </div>
        ) : null}

        {message ? <div className={message.includes("失败") ? "error-text" : "success-text"}>{message}</div> : null}
      </div>
    </LoadState>
  );
}
