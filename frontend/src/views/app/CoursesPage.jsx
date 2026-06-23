import { useState } from "react";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import {
  getCourses,
  createCourse,
  deleteCourse,
  getCourseClasses,
  addClassToCourse,
  removeClassFromCourse,
  getClassStudents
} from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";

const emptyForm = { name: "", description: "" };

export default function CoursesPage() {
  const { user } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, error, reload } = useAsyncData(getCourses, [], [reloadKey]);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const [activeCourseId, setActiveCourseId] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form. name.trim()) return;
    setMessage("");
    try {
      await createCourse(form);
      setShowCreate(false);
      setForm(emptyForm);
      setMessage("课程创建成功");
      reload();
    } catch (err) {
      setMessage(err.message || "创建失败");
    }
  }

  async function handleDelete(courseId, name) {
    if (!confirm(`确定要删除课程「${name}」吗？相关任务和班级关联也会被删除。`)) return;
    try {
      await deleteCourse(courseId);
      setMessage("课程已删除");
      reload();
    } catch (err) {
      setMessage(err.message || "删除失败");
    }
  }

  function refresh() {
    setReloadKey((k) => k + 1);
  }

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel
          title="课程管理"
          description="先创建课程，在课程中管理班级，然后在对应课程和班级下发布实训任务。"
          actions={
            <button className="primary-button" type="button" onClick={() => setShowCreate(true)}>新建课程</button>
          }
        >
          <Table
            columns={["课程名称", "描述", "关联班级", "任务数", "操作"]}
            rows={data || []}
            renderRow={(row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                </td>
                <td>{row.description || "--"}</td>
                <td>{row.classNames.length > 0 ? row.classNames.join("、") : <span style={{ color: "#999" }}>暂无班级</span>}</td>
                <td>{row.taskCount}</td>
                <td>
                  <div className="toolbar">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setActiveCourseId(activeCourseId === row.id ? null : row.id)}
                    >
                      {activeCourseId === row.id ? "收起" : "管理班级"}
                    </button>
                    <button
                      className="ghost-button danger-text"
                      type="button"
                      onClick={() => handleDelete(row.id, row.name)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            )}
            emptyText="暂无课程，请点击「新建课程」开始。"
          />
        </Panel>

        {/* 班级管理面板 */}
        {activeCourseId ? (
          <ClassManagementPanel
            courseId={activeCourseId}
            courseName={(data || []).find((c) => c.id === activeCourseId)?.name || ""}
            onRefresh={refresh}
            onClose={() => setActiveCourseId(null)}
          />
        ) : null}

        {/* 新建课程表单 */}
        {showCreate ? (
          <Panel title="新建课程">
            <form className="callout-stack" onSubmit={handleCreate}>
              <label className="form-field"><span>课程名称</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：Java Web 实训、数据库设计" /></label>
              <label className="form-field"><span>课程描述（可选）</span><textarea rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="简要说明课程内容..." /></label>
              <div className="toolbar">
                <button className="primary-button" type="submit">创建课程</button>
                <button className="ghost-button" type="button" onClick={() => setShowCreate(false)}>取消</button>
              </div>
            </form>
          </Panel>
        ) : null}

        {message ? <div className={message.includes("失败") ? "error-text" : "success-text"}>{message}</div> : null}
      </div>
    </LoadState>
  );
}

function ClassManagementPanel({ courseId, courseName, onRefresh, onClose }) {
  const { data: classes, loading, error, reload } = useAsyncData(() => getCourseClasses(courseId), [courseId]);
  const [newClassName, setNewClassName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [expandedClass, setExpandedClass] = useState(null);
  const [classStudents, setClassStudents] = useState({});
  const [loadingStudents, setLoadingStudents] = useState(false);

  async function handleAdd(e) {
    e.preventDefault();
    const name = newClassName.trim();
    if (!name) return;
    setFeedback("");
    try {
      await addClassToCourse(courseId, name);
      setNewClassName("");
      setFeedback("班级已添加");
      reload();
      onRefresh();
    } catch (err) {
      setFeedback(err.message || "添加失败");
    }
  }

  async function handleRemove(classId, name) {
    if (!confirm(`确定从本课程中移除班级「${name}」吗？`)) return;
    try {
      await removeClassFromCourse(courseId, classId);
      setFeedback("班级已移除");
      reload();
      onRefresh();
    } catch (err) {
      setFeedback(err.message || "移除失败");
    }
  }

  async function toggleStudents(className) {
    if (expandedClass === className) {
      setExpandedClass(null);
      return;
    }
    setExpandedClass(className);
    if (!classStudents[className]) {
      setLoadingStudents(true);
      try {
        const data = await getClassStudents(className, courseId);
        setClassStudents((prev) => ({ ...prev, [className]: data }));
      } catch {
        /* 静默 */
      }
      setLoadingStudents(false);
    }
  }

  return (
    <Panel title={`「${courseName}」的班级管理`} description="在此课程的班级中，学生可以看到并提交该课程下的作业。" onClose={onClose}>
      <div className="callout-stack">
        <form className="toolbar" onSubmit={handleAdd} style={{ alignItems: "flex-end", gap: "8px" }}>
          <input
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            placeholder="输入班级名称，如：软件2301"
            style={{ flex: 1 }}
          />
          <button className="primary-button" type="submit">添加班级</button>
        </form>

        {feedback ? <div className={feedback.includes("失败") ? "error-text" : "success-text"}>{feedback}</div> : null}

        {loading ? (
          <div className="input-like">加载中...</div>
        ) : classes && classes.length > 0 ? (
          <div className="class-list">
            {classes.map((cls) => {
              const isExpanded = expandedClass === cls.name;
              const students = classStudents[cls.name];
              return (
                <div key={cls.id} className="class-item">
                  <div className="class-item-row" onClick={() => toggleStudents(cls.name)}>
                    <span className={`class-toggle ${isExpanded ? "open" : ""}`}>▸</span>
                    <span className="class-name-label">{cls.name}</span>
                    <span className="class-student-count">{students ? `${students.length}人` : ""}</span>
                    <button
                      type="button"
                      className="ghost-button class-remove-btn"
                      onClick={(e) => { e.stopPropagation(); handleRemove(cls.id, cls.name); }}
                      title={`移除 ${cls.name}`}
                    >移除</button>
                  </div>
                  {isExpanded && (
                    <div className="class-students-table-wrap">
                      {loadingStudents || !students ? (
                        <div className="class-loading-tip">加载中...</div>
                      ) : students.length > 0 ? (
                        <table className="data-table">
                          <thead>
                            <tr><th>排名</th><th>姓名</th><th>学号</th><th>用户名</th><th>实训分数</th></tr>
                          </thead>
                          <tbody>
                            {students
                              .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                              .map((s) => (
                              <tr key={s.id}>
                                <td>
                                  {s.rank != null ? (
                                    <span className={`rank-badge rank-${s.rank <= 3 ? "top" : "normal"}`}>#{s.rank}</span>
                                  ) : "-"}
                                </td>
                                <td>{s.name || "-"}</td>
                                <td>{s.student_id || "-"}</td>
                                <td>{s.username}</td>
                                <td>
                                  {s.training_score != null ? (
                                    <span className={`score-badge score-${s.training_score >= 60 ? (s.training_score >= 80 ? "good" : "pass") : "fail"}`}>
                                      {s.training_score} 分
                                    </span>
                                  ) : <span className="no-score">暂无成绩</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="class-empty-tip">该班级暂无学生数据</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="input-like">该课程暂未添加班级，请在上方输入班级名称。</div>
        )}
      </div>
    </Panel>
  );
}
