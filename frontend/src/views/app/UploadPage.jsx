import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getTasks, uploadSubmission } from "../../services/appService";
import { MODEL_NAME } from "../../config/brand";
import { LoadState } from "../../ui/LoadState";
import { Panel } from "../../ui/PageBlocks";

export default function UploadPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const { data: tasks, loading, error } = useAsyncData(getTasks, []);
  const [taskId, setTaskId] = useState(searchParams.get("taskId") || "");
  const [remark, setRemark] = useState("");
  const [files, setFiles] = useState([]);
  const [textContent, setTextContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const dropZoneRef = useRef(null);
  const fileInputRef = useRef(null);

  const selectedTask = (tasks || []).find((task) => task.id === taskId);

  // 将文本内容转为虚拟文件对象
  function textToFile(content) {
    const blob = new Blob([content], { type: "text/plain" });
    return new File([blob], "文本内容.txt", { type: "text/plain" });
  }

  // 合并文件列表（真实文件 + 文本虚拟文件）
  function getAllFiles() {
    const all = [...files];
    const trimmed = textContent.trim();
    if (trimmed) {
      all.push(textToFile(trimmed));
    }
    return all;
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!taskId) {
      setMessage("请选择任务");
      return;
    }
    const allFiles = getAllFiles();
    if (allFiles.length === 0) {
      setMessage("请上传文件或输入文本内容");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await uploadSubmission(taskId, allFiles, remark);
      setMessage(result.message || `提交成功（版本 v${result.version}），${MODEL_NAME} 正在评价，请稍后在「我的成绩」查看。`);
      setFiles([]);
      setTextContent("");
      setRemark("");
    } catch (err) {
      setMessage(err.message || "上传失败");
    } finally {
      setBusy(false);
    }
  }

  // 拖拽处理
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length > 0) {
      setFiles((prev) => [...prev, ...dropped]);
    }
  }

  // 粘贴处理（支持文件和截图）
  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const pastedFiles = [];
    items.forEach((item) => {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    });
    if (pastedFiles.length > 0) {
      e.preventDefault();
      setFiles((prev) => [...prev, ...pastedFiles]);
    }
  }

  useEffect(() => {
    const preset = searchParams.get("taskId");
    if (preset) setTaskId(preset);
  }, [searchParams]);

  if (user.role !== "student") {
    return <div className="input-like">成果上传页面仅对学生开放，教师请在任务详情中查看提交。</div>;
  }

  const allFiles = getAllFiles();

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel title="实训成果上传" description={`支持直接输入代码/文字、上传文件、粘贴截图或拖拽文件，提交后由 ${MODEL_NAME} 自动解析、核查与评分。`}>
          <form className="callout-stack" onSubmit={handleUpload}>
            <label className="form-field">
              <span>选择任务</span>
              <select required value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">请选择实训任务</option>
                {(tasks || []).map((task) => (
                  <option key={task.id} value={task.id}>{task.title} · {task.course}</option>
                ))}
              </select>
            </label>

            {selectedTask?.scoring_criteria ? (
              <div className="callout-box">
                <strong>本任务评分标准</strong>
                <p>{selectedTask.scoring_criteria}</p>
              </div>
            ) : null}

            {/* 拖拽 / 粘贴 / 点击 上传区域 */}
            <div
              ref={dropZoneRef}
              className={`upload-dropzone ${dragOver ? "drag-over" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={handlePaste}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.md,.pdf,.doc,.docx,.zip,.java,.py,.js,.sql,.png,.jpg,.jpeg,.ppt,.pptx"
                onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
                style={{ display: "none" }}
              />
              <div className="dropzone-hint" onClick={() => fileInputRef.current?.click()}>
                <span className="dropzone-icon">&#128193;</span>
                <p>拖拽文件到此处，或 <strong>点击选择文件</strong></p>
                <p className="dropzone-sub">也支持 Ctrl+V 粘贴文件 / 截图</p>
              </div>
            </div>

            {/* 已选文件列表 */}
            {(files.length > 0 || textContent.trim()) && (
              <div className="upload-list">
                {files.map((file) => (
                  <div className="upload-item" key={`${file.name}-${file.lastModified}-${file.size}`}>
                    <span className="upload-item-name">{file.name}</span>
                    <span className="upload-item-size">{(file.size / 1024).toFixed(1)} KB</span>
                    <button className="upload-remove" type="button" onClick={() => setFiles((prev) => prev.filter((f) => f !== file))}>×</button>
                  </div>
                ))}
                {textContent.trim() ? (
                  <div className="upload-item upload-text-item">
                    <span className="upload-item-name">文本内容.txt</span>
                    <span className="upload-item-size">{new Blob([textContent]).size} B</span>
                    <button className="upload-remove" type="button" onClick={() => setTextContent("")}>×</button>
                  </div>
                ) : null}
              </div>
            )}

            {/* 文本输入区域 */}
            <label className="form-field">
              <span>或直接输入代码 / 文字内容</span>
              <textarea
                rows={8}
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="在此粘贴或输入代码、答案、文档等内容...&#10;&#10;支持 Python / Java / JavaScript / SQL 等任意代码，也可输入纯文本说明。"
                style={{ fontFamily: "monospace", fontSize: "13px", lineHeight: "1.6", resize: "vertical" }}
              />
            </label>

            <label className="form-field">
              <span>提交备注</span>
              <textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="可说明本次提交的重点或待教师关注的问题" />
            </label>

            <button className="primary-button" type="submit" disabled={busy || allFiles.length === 0}>
              {busy ? "提交中..." : `提交成果${allFiles.length > 0 ? `（${allFiles.length} 项）` : ""}`}
            </button>
          </form>
        </Panel>

        {message ? <div className={message.includes("成功") ? "success-text" : "error-text"}>{message}</div> : null}
      </div>

      <style>{`
        .upload-dropzone {
          border: 2px dashed #d1d5db;
          border-radius: 10px;
          padding: 32px 16px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: #fafafa;
        }
        .upload-dropzone:hover { border-color: #6366f1; background: #f5f3ff; }
        .upload-dropzone.drag-over { border-color: #4f46e5; background: #ede9fe; transform: scale(1.01); }
        .dropzone-hint { user-select: none; }
        .dropzone-icon { font-size: 36px; display: block; margin-bottom: 8px; }
        .dropzone-hint p { color: #6b7280; font-size: 14px; margin: 4px 0; }
        .dropzone-sub { color: #9ca3af !important; font-size: 12px !important; }
        .upload-list { display: flex; flex-direction: column; gap: 6px; }
        .upload-item {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; background: #f9fafb; border-radius: 6px;
          border: 1px solid #e5e7eb; font-size: 13px;
        }
        .upload-text-item { background: #fffbeb; border-color: #fde68a; }
        .upload-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
        .upload-item-size { color: #9ca3af; font-size: 12px; white-space: nowrap; }
        .upload-remove {
          background: none; border: none; cursor: pointer;
          color: #9ca3af; font-size: 18px; line-height: 1; padding: 0 4px;
        }
        .upload-remove:hover { color: #dc2626; }
      `}</style>
    </LoadState>
  );
}
