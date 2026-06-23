import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import {
  createCourseActivity,
  createCourseAssignment,
  createCourseExam,
  getCourseWorkspace
} from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import { hardNavigate } from "../../utils/navigation";
import {
  buildAssignmentReviewDetail,
  buildAssignmentReviewSummaries,
  buildExamReviewDetail,
  buildExamReviewSummaries
} from "./reviewPortalData";
import { statusTone } from "./shared";

const teacherSections = ["课程门户", "课程管理", "活动", "作业系统", "考试系统", "通知", "资料"];
const studentSections = ["课程门户", "任务", "章节", "讨论", "作业", "考试", "资料", "学习记录"];

const activityTypes = ["签到", "选人", "随堂练习", "主题讨论", "抢答", "问卷", "分组任务", "投票"];
const examAntiCheatOptions = ["随机题序", "切屏预警", "人脸识别", "摄像头监考"];

const emptyAssignmentForm = {
  title: "",
  due: "",
  attempts: "1 次",
  review: "待提交",
  publishMode: "manual",
  publishAt: ""
};

const emptyExamForm = {
  title: "",
  duration: "",
  antiCheat: examAntiCheatOptions[0],
  publishMode: "manual",
  publishAt: ""
};

const emptyActivityForm = {
  title: "",
  type: activityTypes[0],
  status: "未开始",
  result: "等待学生参与"
};

export default function CourseWorkspacePage() {
  const { user } = useAuth();
  const { courseId } = useParams();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, error } = useAsyncData(
    () => getCourseWorkspace(user.role, courseId || ""),
    [user.role, courseId, reloadKey]
  );

  function backToCourses() {
    hardNavigate("tasks");
  }

  function reload() {
    setReloadKey((value) => value + 1);
  }

  return (
    <LoadState loading={loading} error={error}>
      <div className="course-page-shell">
        {user.role === "teacher" ? (
          <TeacherCourseWorkspace detail={data?.detail} onBack={backToCourses} onReload={reload} />
        ) : (
          <StudentCourseWorkspace detail={data?.detail} onBack={backToCourses} />
        )}
      </div>
    </LoadState>
  );
}

function TeacherCourseWorkspace({ detail, onBack, onReload }) {
  const [activeSection, setActiveSection] = useState("课程管理");
  const [panel, setPanel] = useState("");
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignmentForm);
  const [examForm, setExamForm] = useState(emptyExamForm);
  const [activityForm, setActivityForm] = useState(emptyActivityForm);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setActiveSection("课程管理");
    setPanel("");
    setFeedback("");
  }, [detail?.id]);

  const quickActions = useMemo(
    () => [
      { label: "新建活动", section: "活动", panel: "activity" },
      { label: "新建作业", section: "作业系统", panel: "assignment" },
      { label: "新建考试", section: "考试系统", panel: "exam" }
    ],
    []
  );

  if (!detail) return null;

  async function handleCreateAssignment(event) {
    event.preventDefault();
    if (!assignmentForm.title || !assignmentForm.due) {
      setFeedback("请先填写作业名称和截止时间。");
      return;
    }

    setSubmitting(true);
    setFeedback("");
    try {
      await createCourseAssignment(detail.id, assignmentForm);
      setAssignmentForm(emptyAssignmentForm);
      setPanel("");
      setActiveSection("作业系统");
      setFeedback("作业已新建。");
      onReload();
    } catch (err) {
      setFeedback(err.message || "新建作业失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateExam(event) {
    event.preventDefault();
    if (!examForm.title || !examForm.duration) {
      setFeedback("请先填写考试名称和考试时长。");
      return;
    }

    setSubmitting(true);
    setFeedback("");
    try {
      await createCourseExam(detail.id, examForm);
      setExamForm(emptyExamForm);
      setPanel("");
      setActiveSection("考试系统");
      setFeedback("考试已新建。");
      onReload();
    } catch (err) {
      setFeedback(err.message || "新建考试失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateActivity(event) {
    event.preventDefault();
    if (!activityForm.title || !activityForm.type) {
      setFeedback("请先填写活动名称并选择活动类型。");
      return;
    }

    setSubmitting(true);
    setFeedback("");
    try {
      await createCourseActivity(detail.id, activityForm);
      setActivityForm(emptyActivityForm);
      setPanel("");
      setActiveSection("活动");
      setFeedback("活动已新建。");
      onReload();
    } catch (err) {
      setFeedback(err.message || "新建活动失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="course-workspace">
      <aside className="course-subnav">
        <div className="course-subnav-top">
          <button className="ghost-button course-back-button" type="button" onClick={onBack}>返回课程列表</button>
        </div>
        <div className={`course-subnav-cover tone-${detail.id.endsWith("1") ? "blue" : "purple"}`}>
          <strong>{detail.name}</strong>
          <span>{detail.className}</span>
        </div>
        <div className="course-subnav-list">
          {teacherSections.map((item) => (
            <button
              key={item}
              type="button"
              className={`course-subnav-item ${activeSection === item ? "active" : ""}`}
              onClick={() => setActiveSection(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </aside>

      <div className="course-workspace-main">
        <header className="course-page-header">
          <div>
            <p className="eyebrow">课程管理</p>
            <h1>{detail.name}</h1>
          </div>
        </header>

        {feedback ? <div className={feedback.includes("失败") || feedback.includes("请先") ? "error-text" : "success-text"}>{feedback}</div> : null}

        <TeacherSectionContent
          detail={detail}
          activeSection={activeSection}
          quickActions={quickActions}
          onOpenPanel={(nextPanel, nextSection) => {
            setPanel(nextPanel);
            if (nextSection) {
              setActiveSection(nextSection);
            }
          }}
        />
      </div>

      {panel === "assignment" ? (
        <CreationModal title="新建作业" onClose={() => setPanel("")}>
          <form className="login-form" onSubmit={handleCreateAssignment}>
            <Field label="作业名称">
              <input value={assignmentForm.title} onChange={(e) => setAssignmentForm((v) => ({ ...v, title: e.target.value }))} placeholder="例如：第 3 章接口设计作业" />
            </Field>
            <Field label="截止时间">
              <input type="datetime-local" value={assignmentForm.due} onChange={(e) => setAssignmentForm((v) => ({ ...v, due: e.target.value }))} />
            </Field>
            <Field label="提交次数">
              <select value={assignmentForm.attempts} onChange={(e) => setAssignmentForm((v) => ({ ...v, attempts: e.target.value }))}>
                <option value="1 次">1 次</option>
                <option value="2 次">2 次</option>
                <option value="不限">不限</option>
              </select>
            </Field>
            <Field label="发布状态">
              <select value={assignmentForm.publishMode} onChange={(e) => setAssignmentForm((v) => ({ ...v, publishMode: e.target.value }))}>
                <option value="manual">点击发布</option>
                <option value="scheduled">预约发布时间</option>
              </select>
            </Field>
            {assignmentForm.publishMode === "scheduled" ? (
              <Field label="发布时间">
                <input type="datetime-local" value={assignmentForm.publishAt} onChange={(e) => setAssignmentForm((v) => ({ ...v, publishAt: e.target.value }))} />
              </Field>
            ) : null}
            <div className="course-page-actions">
              <button className="ghost-button" type="button" onClick={() => setPanel("")}>取消</button>
              <button className="primary-button" type="submit" disabled={submitting}>保存作业</button>
            </div>
          </form>
        </CreationModal>
      ) : null}

      {panel === "exam" ? (
        <CreationModal title="新建考试" onClose={() => setPanel("")}>
          <form className="login-form" onSubmit={handleCreateExam}>
            <Field label="考试名称">
              <input value={examForm.title} onChange={(e) => setExamForm((v) => ({ ...v, title: e.target.value }))} placeholder="例如：期中实训测验" />
            </Field>
            <Field label="考试时长">
              <input value={examForm.duration} onChange={(e) => setExamForm((v) => ({ ...v, duration: e.target.value }))} placeholder="例如：90 分钟" />
            </Field>
            <Field label="防作弊">
              <select value={examForm.antiCheat} onChange={(e) => setExamForm((v) => ({ ...v, antiCheat: e.target.value }))}>
                {examAntiCheatOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="发布状态">
              <select value={examForm.publishMode} onChange={(e) => setExamForm((v) => ({ ...v, publishMode: e.target.value }))}>
                <option value="manual">点击发布</option>
                <option value="scheduled">预约发布时间</option>
              </select>
            </Field>
            {examForm.publishMode === "scheduled" ? (
              <Field label="发布时间">
                <input type="datetime-local" value={examForm.publishAt} onChange={(e) => setExamForm((v) => ({ ...v, publishAt: e.target.value }))} />
              </Field>
            ) : null}
            <div className="course-page-actions">
              <button className="ghost-button" type="button" onClick={() => setPanel("")}>取消</button>
              <button className="primary-button" type="submit" disabled={submitting}>保存考试</button>
            </div>
          </form>
        </CreationModal>
      ) : null}

      {panel === "activity" ? (
        <CreationModal title="新建活动" onClose={() => setPanel("")}>
          <form className="login-form" onSubmit={handleCreateActivity}>
            <Field label="活动名称">
              <input value={activityForm.title} onChange={(e) => setActivityForm((v) => ({ ...v, title: e.target.value }))} placeholder="例如：第 4 周签到" />
            </Field>
            <Field label="活动类型">
              <select value={activityForm.type} onChange={(e) => setActivityForm((v) => ({ ...v, type: e.target.value }))}>
                {activityTypes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="活动状态">
              <select value={activityForm.status} onChange={(e) => setActivityForm((v) => ({ ...v, status: e.target.value }))}>
                <option value="未开始">未开始</option>
                <option value="进行中">进行中</option>
                <option value="已结束">已结束</option>
              </select>
            </Field>
            <Field label="结果说明">
              <input value={activityForm.result} onChange={(e) => setActivityForm((v) => ({ ...v, result: e.target.value }))} placeholder="例如：等待学生参与" />
            </Field>
            <div className="course-page-actions">
              <button className="ghost-button" type="button" onClick={() => setPanel("")}>取消</button>
              <button className="primary-button" type="submit" disabled={submitting}>保存活动</button>
            </div>
          </form>
        </CreationModal>
      ) : null}
    </div>
  );
}

function TeacherSectionContent({ detail, activeSection, quickActions, onOpenPanel }) {
  const assignmentRows = useMemo(() => buildAssignmentReviewSummaries(detail ? [detail] : []), [detail]);
  const examRows = useMemo(() => buildExamReviewSummaries(detail ? [detail] : []), [detail]);
  const [activeAssignmentId, setActiveAssignmentId] = useState("");
  const [activeExamId, setActiveExamId] = useState("");

  useEffect(() => {
    if (!assignmentRows.length) {
      setActiveAssignmentId("");
      return;
    }
    if (!assignmentRows.some((item) => item.id === activeAssignmentId)) {
      setActiveAssignmentId(assignmentRows[0].id);
    }
  }, [assignmentRows, activeAssignmentId]);

  useEffect(() => {
    if (!examRows.length) {
      setActiveExamId("");
      return;
    }
    if (!examRows.some((item) => item.id === activeExamId)) {
      setActiveExamId(examRows[0].id);
    }
  }, [examRows, activeExamId]);

  const activeAssignmentDetail = useMemo(
    () => buildAssignmentReviewDetail(detail ? [detail] : [], activeAssignmentId),
    [detail, activeAssignmentId]
  );
  const activeExamDetail = useMemo(
    () => buildExamReviewDetail(detail ? [detail] : [], activeExamId),
    [detail, activeExamId]
  );

  if (activeSection === "课程门户" || activeSection === "课程管理") {
    return (
      <div className="content-stack">
        <Panel title="课程总览" description="当前课程的班级、进度、活动和任务都可以从这里进入。">
          <div className="stats-grid compact-stats">
            <div className="data-card"><span className="eyebrow">课程进度</span><strong>{detail.progress}%</strong><span className="delta">{detail.status}</span></div>
            <div className="data-card"><span className="eyebrow">班级人数</span><strong>{detail.classMembers?.length || 0}</strong><span className="delta">{detail.className}</span></div>
            <div className="data-card"><span className="eyebrow">通知数量</span><strong>{detail.notifications?.length || 0}</strong><span className="delta">课程通知</span></div>
          </div>
        </Panel>
        <div className="split-layout">
          <Panel title="快捷新建" description="作业、考试和活动都可以直接新建。">
            <div className="mini-grid">
              {quickActions.map((item) => (
                <button key={item.label} type="button" className="mini-stat" onClick={() => onOpenPanel(item.panel, item.section)}>
                  <span>{item.label}</span>
                  <strong>进入</strong>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="待处理事项" description="展示当前批阅、监考和通知状态。">
            <div className="callout-stack">
              <div className="callout-box">
                <strong>作业批阅</strong>
                <p>{detail.grading?.current?.student || "暂无"} · {detail.grading?.current?.title || "暂无待批阅作业"}</p>
              </div>
              <div className="callout-box">
                <strong>考试监考</strong>
                <p>{detail.exams?.[0]?.title || "暂无考试"} · {detail.proctoring?.[0]?.state || "无监考状态"}</p>
              </div>
              <div className="callout-box">
                <strong>课程通知</strong>
                <p>{detail.notifications?.[0]?.title || "暂无通知"}</p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  if (activeSection === "活动") {
    return (
      <Panel
        title="活动"
        description="课堂活动已经支持新建，创建后会直接出现在下方列表。"
        actions={<button className="primary-button" type="button" onClick={() => onOpenPanel("activity")}>新建活动</button>}
      >
        <ActivityTable rows={detail.activities || []} />
      </Panel>
    );
  }

  if (activeSection === "作业系统") {
    return (
      <div className="content-stack">
        <Panel
          title="作业系统"
          description="列表选择某个作业后，下方会直接展示该作业的批阅详情、附件与评分维度。"
          actions={<button className="primary-button" type="button" onClick={() => onOpenPanel("assignment")}>新建作业</button>}
        >
          <AssignmentTable rows={assignmentRows} activeId={activeAssignmentId} onRowClick={(row) => setActiveAssignmentId(row.id)} />
        </Panel>
        <Panel title="批阅面板" description="把原来的独立作业详情功能直接放回课程页。">
          {activeAssignmentDetail ? (
            <EmbeddedAssignmentReview detail={activeAssignmentDetail} />
          ) : (
            <div className="input-like">暂无可用作业详情。</div>
          )}
        </Panel>
      </div>
    );
  }

  if (activeSection === "考试系统") {
    return (
      <div className="content-stack">
        <Panel
          title="考试系统"
          description="列表选择某张试卷后，下方会直接展示题目结构、答案开关和监考预警信息。"
          actions={<button className="primary-button" type="button" onClick={() => onOpenPanel("exam")}>新建考试</button>}
        >
          <ExamTable rows={examRows} activeId={activeExamId} onRowClick={(row) => setActiveExamId(row.id)} />
        </Panel>
        <Panel title="试卷详情" description="把原来的独立考试详情功能直接放回课程页。">
          {activeExamDetail ? (
            <EmbeddedExamReview detail={activeExamDetail} />
          ) : (
            <div className="input-like">暂无可用考试详情。</div>
          )}
        </Panel>
      </div>
    );
  }

  if (activeSection === "通知") {
    return (
      <Panel title="通知" description="课程通知和发布状态。">
        <Table
          columns={["通知", "对象", "状态"]}
          rows={detail.notifications || []}
          renderRow={(row) => (
            <tr key={row.title}>
              <td>{row.title}</td>
              <td>{row.audience}</td>
              <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
            </tr>
          )}
        />
      </Panel>
    );
  }

  return (
    <Panel title="资料" description="查看课程资料和访问权限。">
      <Table
        columns={["资料", "类型", "权限", "状态"]}
        rows={detail.materials || []}
        renderRow={(row) => (
          <tr key={row.name}>
            <td>{row.name}</td>
            <td>{row.type}</td>
            <td>{row.access}</td>
            <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
          </tr>
        )}
      />
    </Panel>
  );
}

function StudentCourseWorkspace({ detail, onBack }) {
  const [activeSection, setActiveSection] = useState("任务");

  useEffect(() => {
    setActiveSection("任务");
  }, [detail?.id]);

  if (!detail) return null;

  return (
    <div className="course-workspace">
      <aside className="course-subnav">
        <div className="course-subnav-top">
          <button className="ghost-button course-back-button" type="button" onClick={onBack}>返回课程列表</button>
        </div>
        <div className={`course-subnav-cover tone-${detail.id.endsWith("1") ? "blue" : "purple"}`}>
          <strong>{detail.name}</strong>
          <span>{detail.teacher}</span>
        </div>
        <div className="course-subnav-list">
          {studentSections.map((item) => (
            <button
              key={item}
              type="button"
              className={`course-subnav-item ${activeSection === item ? "active" : ""}`}
              onClick={() => setActiveSection(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </aside>

      <div className="course-workspace-main">
        <header className="course-page-header">
          <div>
            <p className="eyebrow">课程学习</p>
            <h1>{detail.name}</h1>
          </div>
        </header>
        <StudentSectionContent detail={detail} activeSection={activeSection} />
      </div>
    </div>
  );
}

function StudentSectionContent({ detail, activeSection }) {
  if (activeSection === "课程门户") {
    return (
      <Panel title="课程门户" description="查看课程进度、通知和当前学习状态。">
        <div className="stats-grid compact-stats">
          <div className="data-card"><span className="eyebrow">学习进度</span><strong>{detail.progress}%</strong><span className="delta">{detail.status}</span></div>
          <div className="data-card"><span className="eyebrow">作业数量</span><strong>{detail.tasks?.assignments?.length || 0}</strong><span className="delta">当前任务</span></div>
          <div className="data-card"><span className="eyebrow">课程通知</span><strong>{detail.notices?.length || 0}</strong><span className="delta">最新消息</span></div>
        </div>
      </Panel>
    );
  }

  if (activeSection === "任务" || activeSection === "作业" || activeSection === "考试") {
    return (
      <Panel title="任务" description="集中查看作业、考试和签到任务。">
        <div className="content-stack">
          <TaskTableBlock title="作业列表" columns={["作业", "状态", "截止时间"]} rows={detail.tasks?.assignments || []} />
          <TaskTableBlock title="考试列表" columns={["考试", "状态", "开考时间"]} rows={detail.tasks?.exams || []} />
          <TaskTableBlock title="签到列表" columns={["签到", "状态", "时间"]} rows={detail.tasks?.signins || []} />
        </div>
      </Panel>
    );
  }

  if (activeSection === "章节") {
    return (
      <Panel title="章节" description="查看章节目录和任务点。">
        <div className="chapter-layout">
          <div className="chapter-tree">
            {(detail.chapters || []).map((chapter) => (
              <div className="chapter-node" key={chapter.title}>
                <div className="status-row">
                  <strong>{chapter.title}</strong>
                  <span className={`status-chip status-${statusTone(chapter.status)}`}>{chapter.status}</span>
                </div>
                {(chapter.taskPoints || []).map((point) => (
                  <span className="chapter-child" key={point}>{point}</span>
                ))}
              </div>
            ))}
          </div>
          <div className="callout-stack">
            <div className="callout-box">
              <strong>{detail.currentTaskPoint?.title}</strong>
              <p>{detail.currentTaskPoint?.note}</p>
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  if (activeSection === "讨论") {
    return (
      <Panel title="讨论" description="查看课程讨论主题和回复情况。">
        <Table
          columns={["主题", "状态", "回复数"]}
          rows={detail.discussion || []}
          renderRow={(row) => (
            <tr key={row.topic}>
              <td>{row.topic}</td>
              <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
              <td>{row.replies}</td>
            </tr>
          )}
        />
      </Panel>
    );
  }

  if (activeSection === "资料") {
    return (
      <Panel title="资料" description="查看课程资料。">
        <Table
          columns={["资料", "类型", "访问方式"]}
          rows={detail.materials || []}
          renderRow={(row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.type}</td>
              <td>{row.access}</td>
            </tr>
          )}
        />
      </Panel>
    );
  }

  return (
    <Panel title="学习记录" description="查看课程笔记和学习进展。">
      <div className="score-stack">
        {(detail.notes || []).map((note) => (
          <div className="score-box" key={note.title}>
            <div className="status-row">
              <span>{note.title}</span>
              <span>{note.updatedAt}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AssignmentTable({ rows, activeId, onRowClick }) {
  return (
    <Table
      columns={["作业", "截止时间", "提交次数", "批阅情况", "状态"]}
      rows={rows}
      renderRow={(row) => (
        <tr key={row.id} className={row.id === activeId ? "row-active" : ""} onClick={() => onRowClick?.(row)}>
          <td>{row.title}</td>
          <td>{row.due}</td>
          <td>{row.attempts}</td>
          <td>{row.pendingCount} 待批阅 / {row.unsubmittedCount} 未提交</td>
          <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
        </tr>
      )}
    />
  );
}

function ExamTable({ rows, activeId, onRowClick }) {
  return (
    <Table
      columns={["考试", "时长", "防作弊", "状态"]}
      rows={rows}
      renderRow={(row) => (
        <tr key={row.id} className={row.id === activeId ? "row-active" : ""} onClick={() => onRowClick?.(row)}>
          <td>{row.title}</td>
          <td>{row.duration}</td>
          <td>{row.antiCheat}</td>
          <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
        </tr>
      )}
    />
  );
}

function EmbeddedAssignmentReview({ detail }) {
  return (
    <div className="course-inline-review">
      <div className="review-detail-page course-inline-review-layout">
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
    </div>
  );
}

function EmbeddedExamReview({ detail }) {
  const [showAnswer, setShowAnswer] = useState(false);

  return (
    <div className="course-inline-review">
      <div className="review-detail-page course-inline-review-layout">
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
              <p>总题量 {detail.totalCount}，总分值 {detail.totalScore} · 已交 {detail.submittedCount} · 未交 {detail.unsubmittedCount}</p>
            </div>
            <label className="review-answer-toggle">
              <input checked={showAnswer} onChange={() => setShowAnswer((value) => !value)} type="checkbox" />
              <span>显示答案</span>
            </label>
          </div>

          <div className="review-detail-section">
            <h3>监考与复核提示</h3>
            <div className="review-check-grid">
              <div className="review-content-card">
                <strong>当前预警</strong>
                <p>{detail.warning}</p>
              </div>
              <div className="review-content-card">
                <strong>教师建议</strong>
                <p>{detail.reviewerNote}</p>
              </div>
            </div>
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
    </div>
  );
}

function ActivityTable({ rows }) {
  return (
    <Table
      columns={["活动", "类型", "状态", "结果"]}
      rows={rows}
      renderRow={(row) => (
        <tr key={row.title}>
          <td>{row.title}</td>
          <td>{row.type}</td>
          <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
          <td>{row.result}</td>
        </tr>
      )}
    />
  );
}

function TaskTableBlock({ title, columns, rows }) {
  return (
    <div className="task-section">
      <strong>{title}</strong>
      <Table
        columns={columns}
        rows={rows}
        renderRow={(row) => (
          <tr key={row.title}>
            <td>{row.title}</td>
            <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
            <td>{row.due}</td>
          </tr>
        )}
      />
    </div>
  );
}

function CreationModal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="course-modal" onClick={(event) => event.stopPropagation()}>
        <div className="course-modal-header">
          <h3>{title}</h3>
          <button className="modal-close" type="button" onClick={onClose}>×</button>
        </div>
        <div className="course-form-grid">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
