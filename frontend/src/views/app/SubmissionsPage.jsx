import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getSubmission, getSubmissions, parseSubmission, retryEvaluation, runAutoScore, runCheck } from "../../services/appService";
import { formatTime } from "../../api/client";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import { statusLabel, statusTone } from "./shared";

function renderStatusMessage(detail, role) {
  if (detail.finalScore != null || detail.aiTotalScore != null) {
    return (
      <div className="callout-box">
        <strong>成绩</strong>
        <p>尚进大模型评分：{detail.aiTotalScore ?? "--"} · 最终成绩：{detail.finalScore ?? detail.aiTotalScore ?? "待教师复核"}</p>
        {detail.scoreRecord?.teacher_comment ? <p className="footer-note">教师评语：{detail.scoreRecord.teacher_comment}</p> : null}
      </div>
    );
  }

  if (detail.status === "evaluating") {
    return <div className="input-like">尚进大模型正在评价中，通常 30 秒～2 分钟，请稍后刷新。</div>;
  }

  if (detail.status === "evaluation_failed") {
    return (
      <div className="callout-box">
        <strong>评价失败</strong>
        <p>{detail.evaluationError || "尚进大模型调用失败，请点击下方按钮重试。"}</p>
      </div>
    );
  }

  if (detail.status === "parsed" && role === "student") {
    return <div className="input-like">成果已解析，但尚未完成评分。如长时间无结果，请联系教师重新发起评价。</div>;
  }

  if (role === "student") {
    return <div className="input-like">等待尚进大模型完成评价，请稍后在「我的成绩」查看。</div>;
  }

  return null;
}

export default function SubmissionsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsyncData(getSubmissions, []);
  const [activeId, setActiveId] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function openDetail(id) {
    setActiveId(id);
    setMessage("");
    const result = await getSubmission(id);
    setDetail(result);
  }

  async function handleAction(action, id) {
    setBusy(action);
    setMessage("");
    try {
      if (action === "parse") {
        await parseSubmission(id);
      } else if (action === "check") {
        await runCheck(id);
      } else if (action === "score") {
        await runAutoScore(id);
      } else if (action === "retry") {
        await retryEvaluation(id);
        setMessage("已重新触发尚进大模型评价，请稍后刷新。");
        reload();
        return;
      }
      await openDetail(id);
      setMessage("操作完成");
    } catch (err) {
      setMessage(err.message || "操作失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <LoadState loading={loading} error={error}>
      <div className="split-layout teacher-score-layout">
        <Panel title={user.role === "student" ? "我的提交" : "提交管理"} description="查看解析、核查与评分状态，教师可在此发起处理。">
          <Table
            columns={["学生", "任务", "版本", "状态", "风险", "分数"]}
            rows={data || []}
            renderRow={(row) => (
              <tr key={row.id} className={row.id === activeId ? "row-active" : ""} onClick={() => openDetail(row.id)}>
                <td>{row.studentName}<div className="table-subtext">{row.studentNumber}</div></td>
                <td>{row.taskTitle}</td>
                <td>v{row.version}</td>
                <td><span className={`status-chip status-${statusTone(statusLabel(row.status))}`}>{statusLabel(row.status)}</span></td>
                <td><span className={`status-chip status-${statusTone(row.riskLevel)}`}>{row.riskLevel}</span></td>
                <td>{row.finalScore ?? row.aiTotalScore ?? "--"}</td>
              </tr>
            )}
          />
        </Panel>

        <Panel title="提交详情" description="文件列表、解析摘要与后续操作入口。">
          {detail ? (
            <div className="callout-stack">
              <div className="mini-grid">
                <div className="mini-stat"><span>任务</span><strong>{detail.taskTitle}</strong></div>
                <div className="mini-stat"><span>状态</span><strong>{statusLabel(detail.status)}</strong></div>
                <div className="mini-stat"><span>提交时间</span><strong>{formatTime(detail.submittedAt)}</strong></div>
              </div>

              <div>
                <strong>文件列表</strong>
                {(detail.files || []).map((file) => (
                  <p key={file.id} className="footer-note">{file.filename} · {file.file_type}</p>
                ))}
              </div>

              {detail.parseResult ? (
                <div className="callout-box">
                  <strong>解析摘要</strong>
                  <p>{detail.parseResult.summary}</p>
                </div>
              ) : null}

              {renderStatusMessage(detail, user.role)}

              {user.role !== "student" ? (
                <div className="toolbar">
                  <button className="ghost-button" type="button" disabled={busy === "retry"} onClick={() => handleAction("retry", detail.id)}>
                    {busy === "retry" ? "触发中..." : "重新评价"}
                  </button>
                  <button className="ghost-button" type="button" disabled={busy === "parse"} onClick={() => handleAction("parse", detail.id)}>
                    {busy === "parse" ? "解析中..." : "重新解析"}
                  </button>
                  <button className="ghost-button" type="button" disabled={busy === "check"} onClick={() => handleAction("check", detail.id)}>
                    {busy === "check" ? "核查中..." : "智能核查"}
                  </button>
                  <button className="primary-button" type="button" disabled={busy === "score"} onClick={() => handleAction("score", detail.id)}>
                    {busy === "score" ? "评分中..." : "尚进大模型评分"}
                  </button>
                  <Link className="ghost-button" to="/checks">查看核查</Link>
                  <Link className="ghost-button" to="/scores">进入评分</Link>
                </div>
              ) : (
                <div className="toolbar">
                  {(detail.status === "parsed" || detail.status === "evaluation_failed") ? (
                    <button className="ghost-button" type="button" disabled={busy === "retry"} onClick={() => handleAction("retry", detail.id)}>
                      {busy === "retry" ? "触发中..." : "重新发起评价"}
                    </button>
                  ) : null}
                  <Link className="ghost-button" to="/checks">查看核查反馈</Link>
                  <Link className="ghost-button" to="/scores">查看我的成绩</Link>
                </div>
              )}
            </div>
          ) : (
            <div className="input-like">请选择一条提交记录。</div>
          )}
          {message ? <div className={message.includes("失败") ? "error-text top-gap" : "success-text top-gap"}>{message}</div> : null}
        </Panel>
      </div>
    </LoadState>
  );
}
