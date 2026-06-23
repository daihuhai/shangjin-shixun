import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { downloadFile } from "../../api/client";
import {
  exportReport,
  getReferenceDocs,
  getTaskDetail,
  getTeacherScores,
  markCheckItem,
  parseSubmission,
  retryEvaluation,
  runAutoScore,
  runCheck,
  saveTeacherScore,
  uploadReferenceDoc,
  deleteReferenceDoc,
  createReferenceText,
} from "../../services/appService";
import { MODEL_NAME } from "../../config/brand";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import CodePreview from "../../ui/CodePreview";
import { statusLabel, statusTone } from "./shared";

const TEACHER_TABS = [
  { id: "overview", label: "任务概览" },
  { id: "submissions", label: "提交管理" },
  { id: "checks", label: "智能核查" },
  { id: "scores", label: "评分复核" },
  { id: "export", label: "导出报表" },
];

const STUDENT_TABS = [
  { id: "overview", label: "任务说明" },
  { id: "submissions", label: "我的提交" },
  { id: "checks", label: "核查反馈" },
];

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
    return <div className="input-like">{MODEL_NAME} 正在评价中，通常 30 秒～2 分钟，请稍后刷新。</div>;
  }

  if (detail.status === "evaluation_failed") {
    return (
      <div className="callout-box">
        <strong>评价失败</strong>
        <p>{detail.evaluationError || `${MODEL_NAME} 调用失败，请点击下方按钮重试。`}</p>
      </div>
    );
  }

  if (role === "student") {
    return <div className="input-like">等待 {MODEL_NAME} 完成评价，请稍后在「我的成绩」查看。</div>;
  }

  return null;
}

const STATUS_MAP = {
  analyzing: "分析中...",
  done: "分析完成",
  failed: "分析失败",
  pending: "待处理",
};

function ReferenceDocPanel({ taskId, user }) {
  const [refDocs, setRefDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submittingText, setSubmittingText] = useState(false);
  const [message, setMessage] = useState("");
  const [textContent, setTextContent] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const isTeacher = user.role !== "student";

  useEffect(() => {
    loadRefDocs();
  }, [taskId]);

  // 轮询分析中的文件
  useEffect(() => {
    const analyzing = refDocs.some((r) => r.analysis_status === "analyzing");
    if (!analyzing) return;
    const timer = setInterval(loadRefDocs, 5000);
    return () => clearInterval(timer);
  }, [refDocs]);

  async function loadRefDocs() {
    try {
      const list = await getReferenceDocs(taskId);
      setRefDocs(list || []);
    } catch {}
  }

  async function doFileUpload(files) {
    if (!files.length) return;
    setUploading(true);
    setMessage("");
    try {
      await uploadReferenceDoc(taskId, files);
      setMessage("参考文档上传成功，尚进大模型正在自动分析...");
      loadRefDocs();
    } catch (err) {
      setMessage(err.message || "上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleFileUpload(event) {
    doFileUpload(Array.from(event.target.files || []));
  }

  // 拖拽处理
  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); setDragOver(true); }
  function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); setDragOver(false); }
  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    doFileUpload(Array.from(e.dataTransfer.files || []));
  }
  // 粘贴处理
  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const pastedFiles = [];
    items.forEach((item) => { if (item.kind === "file") { const f = item.getAsFile(); if (f) pastedFiles.push(f); } });
    if (pastedFiles.length > 0) { e.preventDefault(); doFileUpload(pastedFiles); }
  }

  async function handleTextSubmit(event) {
    event.preventDefault();
    const text = textContent.trim();
    if (!text) return;
    setSubmittingText(true);
    setMessage("");
    try {
      await createReferenceText(taskId, text, "文本参考");
      setTextContent("");
      setMessage("参考内容已提交，尚进大模型正在自动分析...");
      loadRefDocs();
    } catch (err) {
      setMessage(err.message || "提交失败");
    } finally {
      setSubmittingText(false);
    }
  }

  async function handleDelete(refId) {
    try {
      await deleteReferenceDoc(taskId, refId);
      setRefDocs((prev) => prev.filter((r) => r.id !== refId));
    } catch (err) {
      setMessage(err.message || "删除失败");
    }
  }

  return (
    <div className="ref-doc-section">
      {isTeacher && (
        <>
          {/* 拖拽 / 粘贴 / 点击 上传区域 */}
          <div
            ref={dropZoneRef}
            className={`ref-dropzone ${dragOver ? "drag-over" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handlePaste}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".py,.java,.js,.txt,.md,.html,.css,.sql,.docx,.pdf,.zip,.png,.jpg,.jpeg"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            <div className="dropzone-hint" onClick={() => !uploading && fileInputRef.current?.click()}>
              <span className="dropzone-icon">&#128194;</span>
              <p>拖拽文件到此处，或 <strong>点击选择文件</strong></p>
              <p className="dropzone-sub">支持 Ctrl+V 粘贴文件 / 截图 · 多文件 · 单个不超过 50MB</p>
            </div>
          </div>

          {/* 文本输入 */}
          <form className="ref-doc-text-form" onSubmit={handleTextSubmit}>
            <label className="form-field">
              <span>或直接输入参考内容（代码/答案/要求等）</span>
              <textarea
                rows={6}
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="在此粘贴或输入参考代码、标准答案、评分要点等内容..."
                disabled={submittingText}
              />
            </label>
            <button className="primary-button" type="submit" disabled={submittingText || !textContent.trim()}>
              {submittingText ? "提交中..." : "提交参考内容"}
            </button>
          </form>
        </>
      )}

      {refDocs.length > 0 && (
        <div className="ref-doc-list">
          <table className="data-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>大小</th>
                <th>分析状态</th>
                <th>分析摘要</th>
                {isTeacher ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {refDocs.map((rd) => (
                <tr key={rd.id}>
                  <td>{rd.filename}</td>
                  <td>{rd.file_size ? `${(rd.file_size / 1024).toFixed(1)} KB` : "-"}</td>
                  <td>
                    <span className={`status-chip status-${rd.analysis_status === "done" ? "success" : rd.analysis_status === "failed" ? "danger" : "warning"}`}>
                      {STATUS_MAP[rd.analysis_status] || rd.analysis_status}
                    </span>
                  </td>
                  <td className="ref-summary-cell" title={rd.summary || ""}>{rd.summary || "-"}</td>
                  {isTeacher ? (
                    <td>
                      <button className="text-button danger" type="button" onClick={() => handleDelete(rd.id)}>
                        删除
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {refDocs.length === 0 && (
        <div className="ref-empty">
          {isTeacher
            ? "暂未添加参考文档，上传文件或输入文本内容后可提升本任务 尚进大模型评分准确性。"
            : "教师暂未提供参考文档。"}
        </div>
      )}

      {message ? <div className={message.includes("失败") ? "error-text top-gap" : "success-text top-gap"}>{message}</div> : null}

      <style>{`
        .ref-doc-section { display: flex; flex-direction: column; gap: 16px; }
        .ref-dropzone {
          border: 2px dashed #d1d5db; border-radius: 10px; padding: 24px 16px;
          text-align: center; cursor: pointer; transition: all 0.2s; background: #fafafa;
        }
        .ref-dropzone:hover { border-color: #6366f1; background: #f5f3ff; }
        .ref-dropzone.drag-over { border-color: #4f46e5; background: #ede9fe; transform: scale(1.01); }
        .ref-doc-hint { color: #6b7280; font-size: 13px; }
        .dropzone-hint { user-select: none; }
        .dropzone-icon { font-size: 32px; display: block; margin-bottom: 6px; }
        .dropzone-hint p { color: #6b7280; font-size: 14px; margin: 4px 0; }
        .dropzone-sub { color: #9ca3af !important; font-size: 12px !important; }
        .ref-doc-text-form { display: flex; flex-direction: column; gap: 10px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; }
        .ref-doc-text-form textarea { resize: vertical; min-height: 120px; font-family: monospace; font-size: 13px; line-height: 1.6; }
        .ref-doc-list { overflow-x: auto; }
        .ref-doc-list table { width: 100%; border-collapse: collapse; }
        .ref-doc-list th, .ref-doc-list td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
        .ref-doc-list th { background: #f9fafb; font-weight: 600; color: #374151; }
        .ref-summary-cell { max-width: 400px; color: #4b5563; font-size: 13px; line-height: 1.5; word-break: break-word; }
        .ref-empty { color: #9ca3af; text-align: center; padding: 24px; background: #f9fafb; border-radius: 8px; font-size: 14px; }
        .text-button { background: none; border: none; cursor: pointer; font-size: 13px; padding: 4px 8px; border-radius: 4px; color: #2563eb; }
        .text-button.danger { color: #dc2626; }
        .text-button:hover { background: #f3f4f6; }
      `}</style>
    </div>
  );
}

function SubmissionDetailPanel({ detail, user, busy, message, onAction }) {
  if (!detail) {
    return <div className="input-like">请选择一条提交记录查看详情。</div>;
  }

  const extractedText = detail.parseResult?.extracted_text || "";

  return (
    <div className="callout-stack">
      <div className="mini-grid">
        <div className="mini-stat"><span>提交人</span><strong>{detail.studentName}</strong></div>
        <div className="mini-stat"><span>学号</span><strong>{detail.studentNumber}</strong></div>
        <div className="mini-stat"><span>版本</span><strong>v{detail.version}</strong></div>
        <div className="mini-stat"><span>状态</span><strong>{statusLabel(detail.status)}</strong></div>
        <div className="mini-stat"><span>提交时间</span><strong>{detail.submittedAt?.slice(0, 19).replace("T", " ")}</strong></div>
        <div className="mini-stat"><span>风险</span><strong>{detail.riskLevel}</strong></div>
      </div>

      <div>
        <strong>提交文件</strong>
        {(detail.files || []).length > 0 ? (
          (detail.files || []).map((file) => (
            <p key={file.id} className="footer-note">{file.filename} · {file.file_type} · {(file.file_size / 1024).toFixed(1)} KB</p>
          ))
        ) : (
          <p className="footer-note">暂无文件记录</p>
        )}
      </div>

      {detail.remark ? (
        <div className="callout-box">
          <strong>学生备注</strong>
          <p>{detail.remark}</p>
        </div>
      ) : null}

      {detail.parseResult ? (
        <div className="callout-box">
          <strong>解析摘要</strong>
          <p>{detail.parseResult.summary || "暂无摘要"}</p>
        </div>
      ) : null}

      {extractedText ? (
        <div>
          <strong>提交内容摘录</strong>
          <div style={{ marginTop: "8px" }}>
            <CodePreview code={extractedText.slice(0, 8000)} maxHeight="480px" />
            {extractedText.length > 8000 && (
              <p className="footer-note" style={{ marginTop: "6px" }}>…内容过长，已截断显示</p>
            )}
          </div>
        </div>
      ) : null}

      {renderStatusMessage(detail, user.role)}

      {user.role !== "student" ? (
        <div className="toolbar">
          <button className="ghost-button" type="button" disabled={busy === "retry"} onClick={() => onAction("retry", detail.id)}>
            {busy === "retry" ? "触发中..." : "重新评价"}
          </button>
          <button className="ghost-button" type="button" disabled={busy === "parse"} onClick={() => onAction("parse", detail.id)}>
            {busy === "parse" ? "解析中..." : "重新解析"}
          </button>
          <button className="ghost-button" type="button" disabled={busy === "check"} onClick={() => onAction("check", detail.id)}>
            {busy === "check" ? "核查中..." : "智能核查"}
          </button>
          <button className="primary-button" type="button" disabled={busy === "score"} onClick={() => onAction("score", detail.id)}>
            {busy === "score" ? "评分中..." : "尚进大模型评分"}
          </button>
        </div>
      ) : (
        <div className="toolbar">
          {(detail.status === "parsed" || detail.status === "evaluation_failed") ? (
            <button className="ghost-button" type="button" disabled={busy === "retry"} onClick={() => onAction("retry", detail.id)}>
              {busy === "retry" ? "触发中..." : "重新发起评价"}
            </button>
          ) : null}
          <Link className="primary-button" to={`/upload?taskId=${detail.taskId}`}>继续上传</Link>
        </div>
      )}

      {message ? <div className={message.includes("失败") ? "error-text" : "success-text"}>{message}</div> : null}
    </div>
  );
}

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const tab = searchParams.get("tab") || "overview";
  const loader = () => getTaskDetail(taskId);
  const { data, loading, error, reload } = useAsyncData(loader, [taskId]);
  const [activeSubmissionId, setActiveSubmissionId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [scoreForm, setScoreForm] = useState({ teacherAdjustedScore: "", adjustmentReason: "", teacherComment: "" });
  const [savingScore, setSavingScore] = useState(false);

  const tabs = user.role === "student" ? STUDENT_TABS : TEACHER_TABS;
  const submissions = data?.submissions || [];
  const activeSubmission = useMemo(
    () => submissions.find((item) => item.id === activeSubmissionId) || submissions[0] || null,
    [submissions, activeSubmissionId],
  );

  const scoreLoader = user.role === "teacher" && tab === "scores" && activeSubmission?.id
    ? () => getTeacherScores(activeSubmission.id)
    : null;
  const { data: scoreData, reload: reloadScores } = useAsyncData(
    scoreLoader || (async () => null),
    [user.role, tab, activeSubmission?.id],
  );

  useEffect(() => {
    if (submissions.length > 0 && !activeSubmissionId) {
      setActiveSubmissionId(submissions[0].id);
    }
  }, [submissions, activeSubmissionId]);

  useEffect(() => {
    if (scoreData?.scoreDetail) {
      setScoreForm({
        teacherAdjustedScore: String(scoreData.scoreDetail.teacherAdjustedScore || scoreData.scoreDetail.aiTotalScore || ""),
        adjustmentReason: scoreData.scoreDetail.adjustmentReason || "",
        teacherComment: scoreData.scoreDetail.teacherComment || "",
      });
    }
  }, [scoreData]);

  function setTab(nextTab) {
    setSearchParams({ tab: nextTab });
  }

  async function handleSubmissionAction(action, id) {
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
        setMessage("已重新触发评价，请稍后刷新。");
        reload();
        return;
      }
      setMessage("操作完成");
    } catch (err) {
      setMessage(err.message || "操作失败");
    } finally {
      setBusy("");
    }
  }

  async function handleMarkCheck(itemId, teacherMark) {
    if (!activeSubmission) return;
    await markCheckItem(activeSubmission.id, itemId, teacherMark);
    reload();
    setMessage("已更新教师标记");
  }

  async function handleSaveScore(event) {
    event.preventDefault();
    if (!scoreData?.scoreDetail) return;
    setSavingScore(true);
    setMessage("");
    try {
      await saveTeacherScore({
        id: scoreData.scoreDetail.id,
        teacherAdjustedScore: Number(scoreForm.teacherAdjustedScore),
        adjustmentReason: scoreForm.adjustmentReason,
        teacherComment: scoreForm.teacherComment,
      });
      setMessage("教师评分已保存");
      reload();
      reloadScores();
    } catch (err) {
      setMessage(err.message || "保存失败");
    } finally {
      setSavingScore(false);
    }
  }

  async function handleExport(format) {
    setExporting(format);
    setExportMessage("");
    try {
      const result = await exportReport(format, "task", taskId);
      await downloadFile(`/reports/download/${result.filename}`, result.filename);
      setExportMessage(`已生成 ${format.toUpperCase()} 报表：${result.filename}`);
    } catch (err) {
      setExportMessage(err.message || "导出失败");
    } finally {
      setExporting("");
    }
  }

  const task = data?.task;
  const stats = data?.stats;

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel
          title={task?.title || "任务详情"}
          description={task ? `${task.course} · ${task.class_name || "全部班级"}` : "加载任务信息中…"}
          actions={
            <Link className="ghost-button" to="/tasks">← 返回任务列表</Link>
          }
        >
          <div className="toolbar">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "review-chip primary" : "review-chip"}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Panel>

        {tab === "overview" && task ? (
          <>
            <div className="stats-grid">
              <div className="data-card"><span className="eyebrow">提交份数</span><strong>{stats?.submissionCount ?? 0}</strong></div>
              <div className="data-card"><span className="eyebrow">提交人数</span><strong>{stats?.studentCount ?? 0}</strong></div>
              <div className="data-card"><span className="eyebrow">待核查</span><strong>{stats?.pendingCheck ?? 0}</strong></div>
              <div className="data-card"><span className="eyebrow">待评分</span><strong>{stats?.pendingScore ?? 0}</strong></div>
              <div className="data-card"><span className="eyebrow">高风险</span><strong>{stats?.highRisk ?? 0}</strong></div>
              <div className="data-card"><span className="eyebrow">平均分</span><strong>{stats?.averageScore ?? "--"}</strong></div>
            </div>

            <div className="split-layout">
              <Panel title="任务说明" description="任务要求与提交规范。">
                <p>{task.description || "暂无说明"}</p>
                {task.requirements ? (
                  <>
                    <strong className="top-gap">提交要求</strong>
                    <p>{task.requirements}</p>
                  </>
                ) : null}
                <p className="footer-note top-gap">截止时间：{task.deadline ? task.deadline.replace("T", " ") : "未设置"}</p>
                <p className="footer-note">允许格式：{task.allowed_formats}</p>
                {user.role === "student" ? (
                  <Link className="primary-button top-gap" to={`/upload?taskId=${task.id}`}>上传成果</Link>
                ) : null}
              </Panel>

              <Panel title="评分标准" description={`${MODEL_NAME} 与教师复核均参考以下标准。`}>
                <p>{task.scoring_criteria || "教师尚未填写评分标准"}</p>
                {task.checklist ? (
                  <>
                    <strong className="top-gap">核查清单</strong>
                    <p>{task.checklist}</p>
                  </>
                ) : null}
              </Panel>
            </div>

            <Panel
              title="参考文档"
              description="上传本任务的参考文档/标准答案，尚进大模型将自动分析文档内容与教学意图，结合评价指标权重为本任务的学生作业给出更精准的评分。每个任务的参考文档独立管理。"
            >
              <ReferenceDocPanel taskId={taskId} user={user} />
            </Panel>

            {user.role !== "student" ? (
              <Panel title="提交人概览" description="本任务下已提交的学生名单。">
                <Table
                  columns={["姓名", "学号", "班级", "提交次数", "最近状态", "最近分数", "操作"]}
                  rows={data?.submitters || []}
                  renderRow={(row) => (
                    <tr key={row.studentId}>
                      <td>{row.studentName}</td>
                      <td>{row.studentNumber}</td>
                      <td>{row.organization}</td>
                      <td>{row.submissionCount}</td>
                      <td><span className={`status-chip status-${statusTone(statusLabel(row.latestStatus))}`}>{statusLabel(row.latestStatus)}</span></td>
                      <td>{row.latestScore ?? "--"}</td>
                      <td>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => {
                            setActiveSubmissionId(row.latestSubmissionId);
                            setTab("submissions");
                          }}
                        >
                          查看提交
                        </button>
                      </td>
                    </tr>
                  )}
                />
              </Panel>
            ) : null}
          </>
        ) : null}

        {tab === "submissions" ? (
          <div className="split-layout teacher-score-layout">
            <Panel title={user.role === "student" ? "我的提交记录" : "本任务提交列表"} description="按任务维度查看，不再与其他任务混在一起。">
              <Table
                columns={["学生", "版本", "状态", "风险", "分数", "提交时间"]}
                rows={submissions}
                renderRow={(row) => (
                  <tr
                    key={row.id}
                    className={row.id === activeSubmission?.id ? "row-active" : ""}
                    onClick={() => setActiveSubmissionId(row.id)}
                  >
                    <td>{row.studentName}<div className="table-subtext">{row.studentNumber}</div></td>
                    <td>v{row.version}</td>
                    <td><span className={`status-chip status-${statusTone(statusLabel(row.status))}`}>{statusLabel(row.status)}</span></td>
                    <td><span className={`status-chip status-${statusTone(row.riskLevel)}`}>{row.riskLevel}</span></td>
                    <td>{row.finalScore ?? row.aiTotalScore ?? "--"}</td>
                    <td>{row.submittedAt?.slice(0, 19).replace("T", " ")}</td>
                  </tr>
                )}
              />
            </Panel>

            <Panel title="提交详情" description="文件、解析摘要与具体内容摘录。">
              <SubmissionDetailPanel
                detail={activeSubmission}
                user={user}
                busy={busy}
                message={message}
                onAction={handleSubmissionAction}
              />
            </Panel>
          </div>
        ) : null}

        {tab === "checks" ? (
          <div className="split-layout">
            <Panel title="核查对象" description="仅显示本任务下的提交。">
              <Table
                columns={["学生", "版本", "状态", "风险", "结论"]}
                rows={submissions}
                renderRow={(row) => (
                  <tr
                    key={row.id}
                    className={row.id === activeSubmission?.id ? "row-active" : ""}
                    onClick={() => setActiveSubmissionId(row.id)}
                  >
                    <td>{row.studentName}</td>
                    <td>v{row.version}</td>
                    <td><span className={`status-chip status-${statusTone(statusLabel(row.status))}`}>{statusLabel(row.status)}</span></td>
                    <td><span className={`status-chip status-${statusTone(row.riskLevel)}`}>{row.riskLevel}</span></td>
                    <td>{row.checkReport?.overall_conclusion || "未核查"}</td>
                  </tr>
                )}
              />
            </Panel>

            <Panel title="核查详情" description="证据片段与修复建议。">
              {activeSubmission ? (
                <div className="callout-stack">
                  <div className="mini-grid">
                    <div className="mini-stat"><span>提交人</span><strong>{activeSubmission.studentName}</strong></div>
                    <div className="mini-stat"><span>高风险项</span><strong>{(activeSubmission.checkReport?.items || []).filter((i) => i.riskLevel === "高" && i.teacherMark !== "误判").length}</strong></div>
                  </div>
                  <p>{activeSubmission.checkReport?.overall_conclusion || "尚未执行核查"}</p>
                  {user.role !== "student" ? (
                    <button className="primary-button top-gap" type="button" disabled={busy === "check"} onClick={() => handleSubmissionAction("check", activeSubmission.id)}>
                      {busy === "check" ? "核查中..." : "发起智能核查"}
                    </button>
                  ) : null}
                  {(activeSubmission.checkReport?.items || []).length > 0 ? (
                    activeSubmission.checkReport.items.map((item) => {
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
                              <button className="ghost-button" type="button" onClick={() => handleMarkCheck(item.id, "确认问题")}>确认问题</button>
                              <button className="ghost-button danger-text" type="button" onClick={() => handleMarkCheck(item.id, "误判")}>标记误判</button>
                            </div>
                          ) : user.role !== "student" ? (
                            <div className="toolbar">
                              {isConfirmed ? (
                                <button className="ghost-button" type="button" onClick={() => handleMarkCheck(item.id, "")}>撤销确认</button>
                              ) : isDismissed ? (
                                <button className="ghost-button" type="button" onClick={() => handleMarkCheck(item.id, "")}>恢复该项</button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="input-like top-gap">暂无核查项，请先发起智能核查。</div>
                  )}
                </div>
              ) : (
                <div className="input-like">本任务暂无提交。</div>
              )}
              {message ? <div className="success-text top-gap">{message}</div> : null}
            </Panel>
          </div>
        ) : null}

        {tab === "scores" && user.role !== "student" ? (
          <div className="split-layout teacher-score-layout">
            <Panel title="待复核提交" description="本任务范围内的评分复核。">
              <Table
                columns={["学生", "版本", "尚进大模型分", "状态", "操作"]}
                rows={submissions}
                renderRow={(row) => (
                  <tr
                    key={row.id}
                    className={row.id === activeSubmission?.id ? "row-active" : ""}
                    onClick={() => setActiveSubmissionId(row.id)}
                  >
                    <td>{row.studentName}</td>
                    <td>v{row.version}</td>
                    <td>{row.aiTotalScore ?? "--"}</td>
                    <td><span className={`status-chip status-${statusTone(statusLabel(row.status))}`}>{statusLabel(row.status)}</span></td>
                    <td>{row.finalScore ?? "待复核"}</td>
                  </tr>
                )}
              />
            </Panel>

            <Panel title="教师复核" description="调整分数并填写评语。">
              {scoreData?.scoreDetail ? (
                <form className="callout-stack" onSubmit={handleSaveScore}>
                  <div className="mini-grid">
                    <div className="mini-stat"><span>尚进大模型总分</span><strong>{scoreData.scoreDetail.aiTotalScore ?? "--"}</strong></div>
                    <div className="mini-stat"><span>当前最终分</span><strong>{scoreData.scoreDetail.finalScore ?? "未定稿"}</strong></div>
                  </div>
                  <label className="form-field">
                    <span>教师调整分</span>
                    <input required type="number" min="0" max="100" value={scoreForm.teacherAdjustedScore} onChange={(e) => setScoreForm({ ...scoreForm, teacherAdjustedScore: e.target.value })} />
                  </label>
                  <label className="form-field">
                    <span>调整原因</span>
                    <input value={scoreForm.adjustmentReason} onChange={(e) => setScoreForm({ ...scoreForm, adjustmentReason: e.target.value })} />
                  </label>
                  <label className="form-field">
                    <span>教师评语</span>
                    <textarea rows="3" value={scoreForm.teacherComment} onChange={(e) => setScoreForm({ ...scoreForm, teacherComment: e.target.value })} />
                  </label>
                  <button className="primary-button" type="submit" disabled={savingScore}>{savingScore ? "保存中..." : "保存复核结果"}</button>
                </form>
              ) : (
                <div className="input-like">请选择一条已有评分的提交记录。</div>
              )}
              {message ? <div className="success-text top-gap">{message}</div> : null}
            </Panel>
          </div>
        ) : null}

        {tab === "export" && user.role !== "student" ? (
          <Panel title="导出本任务报表" description="仅导出当前任务的提交与评分数据。">
            <div className="toolbar">
              <button className="primary-button" type="button" disabled={exporting === "excel"} onClick={() => handleExport("excel")}>
                {exporting === "excel" ? "生成中..." : "导出 Excel"}
              </button>
              <button className="ghost-button" type="button" disabled={exporting === "pdf"} onClick={() => handleExport("pdf")}>
                {exporting === "pdf" ? "生成中..." : "导出 PDF"}
              </button>
            </div>
            {exportMessage ? <div className="success-text top-gap">{exportMessage}</div> : null}
          </Panel>
        ) : null}
      </div>
    </LoadState>
  );
}
