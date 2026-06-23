import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { createTask, getTasks, getCourses, getCourseClasses } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import { statusLabel, statusTone } from "./shared";

const emptyForm = {
  title: "",
  courseId: "",
  classIds: [],
  description: "",
  requirements: "",
  checklist: "",
  scoringCriteria: "",
  deadline: "",
  allowedFormats: "doc,docx,pdf,zip,png,jpg,java,py,js"
};

export default function TasksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: tasks, loading, error, reload } = useAsyncData(getTasks, []);
  const { data: courses } = useAsyncData(
    () => user.role !== "student" ? getCourses() : Promise.resolve([]),
    [user.role]
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const [courseClasses, setCourseClasses] = useState([]);

  // 当选择的课程变化时，加载该课程的班级列表
  useEffect(() => {
    if (form.courseId) {
      getCourseClasses(form.courseId)
        .then((data) => setCourseClasses(data || []))
        .catch(() => setCourseClasses([]));
    } else {
      setCourseClasses([]);
    }
  }, [form.courseId]);

  function openTask(row) {
    navigate(`/tasks/${row.id}`);
  }

  async function handleCreate(event) {
    event.preventDefault();
    setMessage("");
    try {
      await createTask(form);
      setShowForm(false);
      setForm(emptyForm);
      setCourseClasses([]);
      setMessage("任务发布成功");
      reload();
    } catch (err) {
      setMessage(err.message || "创建失败");
    }
  }

  function toggleClass(classId) {
    setForm((prev) => ({
      ...prev,
      classIds: prev.classIds.includes(classId)
        ? prev.classIds.filter((id) => id !== classId)
        : [...prev.classIds, classId]
    }));
  }

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel
          title={user.role === "student" ? "我的实训任务" : "实训任务管理"}
          description={
            user.role === "student"
              ? "点击任务进入详情，查看提交、核查反馈与评分标准。"
              : "请先在「课程管理」中创建课程和班级，再在此处发布任务。"
          }
          actions={
            user.role !== "student" ? (
              <button className="primary-button" type="button" onClick={() => setShowForm(true)}>新建任务</button>
            ) : null
          }
        >
          <Table
            columns={user.role === "student"
              ? ["任务", "课程", "班级", "截止时间", "评分标准"]
              : ["任务", "课程", "班级", "截止时间", "状态", "提交人数", "提交份数"]
            }
            rows={tasks || []}
            renderRow={(row) => (
              <tr key={row.id} className="row-clickable" onClick={() => openTask(row)}>
                <td>
                  <strong>{row.title}</strong>
                  <div className="table-subtext">{row.description?.slice(0, 60)}</div>
                </td>
                <td>{row.courseName || row.course || "--"}</td>
                <td>{Array.isArray(row.classNames) ? row.classNames.join("、") : (row.class_name || "--")}</td>
                {user.role !== "student" ? (
                  <>
                    <td>{row.deadline ? row.deadline.replace("T", " ") : "--"}</td>
                    <td><span className={`status-chip status-${statusTone(row.status)}`}>{statusLabel(row.status)}</span></td>
                    <td>{row.student_count ?? 0}</td>
                    <td>{row.submission_count ?? 0}</td>
                  </>
                ) : (
                  <>
                    <td>{row.deadline ? row.deadline.replace("T", " ") : "--"}</td>
                    <td><div className="table-subtext">{row.scoring_criteria || "教师尚未填写评分标准"}</div></td>
                  </>
                )}
              </tr>
            )}
          />
        </Panel>

        {/* 新建任务表单 */}
        {showForm ? (
          <Panel title="新建实训任务" description="选择课程和班级后，填写任务详情。">
            <form className="callout-stack" onSubmit={handleCreate}>
              <label className="form-field"><span>任务名称</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：Java Web 实训阶段成果提交" /></label>

              {/* 课程下拉选择 */}
              <label className="form-field">
                <span>所属课程 *</span>
                {(courses && courses.length > 0) ? (
                  <select required value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value, classIds: [] })}>
                    <option value="">-- 请选择课程 --</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ padding: "8px 12px", background: "#fff3cd", borderRadius: "6px", color: "#856404", fontSize: "13px" }}>
                    暂无课程。请先前往「课程管理」创建课程并添加班级后再发布任务。
                  </div>
                )}
              </label>

              {/* 班级多选 */}
              {form.courseId && courseClasses.length > 0 ? (
                <label className="form-field">
                  <span>发布班级 *（可多选）</span>
                  <div className="class-multi-select">
                    {courseClasses.map((cls) => (
                      <label key={cls.id} className={`class-checkbox ${form.classIds.includes(cls.id) ? "checked" : ""}`}>
                        <input type="checkbox" checked={form.classIds.includes(cls.id)} onChange={() => toggleClass(cls.id)} />
                        <span>{cls.name}</span>
                      </label>
                    ))}
                  </div>
                  {!form.classIds.length && <small style={{ color: "#e74c3c" }}>请至少选择一个班级</small>}
                </label>
              ) : form.courseId ? (
                <label className="form-field">
                  <span>发布班级</span>
                  <div style={{ padding: "8px 12px", background: "#f8f9fa", borderRadius: "6px", color: "#666", fontSize: "13px" }}>
                    该课程暂无班级。请在「课程管理」中为该课程添加班级。
                  </div>
                </label>
              ) : null}

              <label className="form-field"><span>任务说明</span><textarea rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label className="form-field"><span>提交要求</span><textarea rows="3" value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} /></label>
              <label className="form-field"><span>核查清单（| 分隔）</span><input value={form.checklist} onChange={(e) => setForm({ ...form, checklist: e.target.value })} /></label>
              <label className="form-field">
                <span>评分标准（必填）</span>
                <textarea
                  required
                  rows="4"
                  value={form.scoringCriteria}
                  onChange={(e) => setForm({ ...form, scoringCriteria: e.target.value })}
                  placeholder="例如：代码质量 25 分、文档规范性 20 分、功能实现度 35 分、过程表现 20 分，并说明各维度具体要求。"
                />
              </label>
              <label className="form-field"><span>截止时间</span><input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>
              <div className="toolbar">
                <button className="primary-button" type="submit" disabled={form.courseId && !form.classIds.length}>发布任务</button>
                <button className="ghost-button" type="button" onClick={() => { setShowForm(false); setForm(emptyForm); setCourseClasses([]); }}>取消</button>
              </div>
            </form>
          </Panel>
        ) : null}

        {message ? <div className={message.includes("失败") || message.includes("请先") ? "error-text" : "success-text"}>{message}</div> : null}
      </div>
    </LoadState>
  );
}
