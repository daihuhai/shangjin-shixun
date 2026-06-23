import { useState, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import { getDashboardOverview } from "../../services/appService";
import { useAuth } from "../../state/AuthContext";

/* ---------- 统计卡片 ---------- */
function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
    </div>
  );
}

/* ---------- 分数分布柱状图 ---------- */
function ScoreDistChart({ data }) {
  const option = {
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: "category",
      data: (data || []).map((d) => d.range),
      axisLabel: { fontSize: 12 },
    },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      {
        type: "bar",
        data: (data || []).map((d) => ({
          value: d.count,
          itemStyle: {
            color:
              d.range === "90-100"
                ? "#22c55e"
                : d.range === "80-89"
                ? "#3b82f6"
                : d.range === "70-79"
                ? "#f59e0b"
                : d.range === "60-69"
                ? "#f97316"
                : "#ef4444",
            borderRadius: [4, 4, 0, 0],
          },
        })),
        barWidth: "45%",
        label: { show: true, position: "top", fontSize: 12 },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 240 }} />;
}

/* ---------- 班级均分趋势折线图 ---------- */
function ClassTrendChart({ trends }) {
  const taskMap = {};
  (trends || []).forEach((r) => {
    if (!taskMap[r.task_id]) taskMap[r.task_id] = { name: r.task_name, classes: {} };
    if (r.class_name) taskMap[r.task_id].classes[r.class_name] = Number(r.avg_score) || 0;
  });
  const taskIds = Object.keys(taskMap);
  const allClasses = new Set();
  Object.values(taskMap).forEach((t) => Object.keys(t.classes).forEach((c) => allClasses.add(c)));
  const classArr = Array.from(allClasses);
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  const option = {
    tooltip: { trigger: "axis" },
    legend: { data: classArr, top: 0, textStyle: { fontSize: 12 } },
    grid: { left: 55, right: 20, top: 35, bottom: 30 },
    xAxis: {
      type: "category",
      data: taskIds.map((id) =>
        taskMap[id].name.length > 10 ? taskMap[id].name.slice(0, 10) + "…" : taskMap[id].name
      ),
      axisLabel: { fontSize: 11, rotate: taskIds.length > 3 ? 20 : 0 },
    },
    yAxis: { type: "value", min: 0, max: 100, name: "分数" },
    series: classArr.map((cls, i) => ({
      name: cls,
      type: "line",
      smooth: true,
      data: taskIds.map((id) => taskMap[id].classes[cls] ?? null),
      lineStyle: { width: 2.5, color: colors[i % colors.length] },
      itemStyle: { color: colors[i % colors.length] },
      symbol: "circle",
      symbolSize: 6,
    })),
  };
  return <ReactECharts option={option} style={{ height: 280 }} />;
}

/* ---------- 高频错误横向柱状图 ---------- */
function TopErrorsChart({ errors }) {
  const sorted = [...(errors || [])].sort((a, b) => b.count - a.count).slice(0, 8);
  const option = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 160, right: 40, top: 10, bottom: 20 },
    xAxis: { type: "value", minInterval: 1 },
    yAxis: {
      type: "category",
      data: sorted.reverse().map((e) =>
        e.check_item.length > 18 ? e.check_item.slice(0, 18) + "…" : e.check_item
      ),
      axisLabel: { fontSize: 11 },
      inverse: true,
    },
    series: [
      {
        type: "bar",
        data: sorted.reverse().map((e) => ({
          value: e.count,
          itemStyle: {
            color: e.risk_level === "高" ? "#ef4444" : e.risk_level === "中" ? "#f59e0b" : "#6b7280",
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barWidth: "60%",
        label: { show: true, position: "right", fontSize: 12 },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: Math.max(280, sorted.length * 36) }} />;
}

/* ---------- 班级学生分布横向柱状图 ---------- */
function ClassBreakdownChart({ data }) {
  const sorted = [...(data || [])].sort((a, b) => b.student_count - a.student_count);
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => `${params[0].name}<br/>学生人数：${params[0].value} 人`,
    },
    grid: { left: 100, right: 50, top: 15, bottom: 20 },
    xAxis: { type: "value", minInterval: 1, axisLabel: { fontSize: 12 } },
    yAxis: {
      type: "category",
      data: sorted.map((d) => d.class_name),
      axisLabel: { fontSize: 13, fontWeight: 500 },
      inverse: true,
    },
    series: [
      {
        type: "bar",
        data: sorted.map((d, i) => ({
          value: d.student_count,
          itemStyle: { color: colors[i % colors.length], borderRadius: [0, 6, 6, 0] },
        })),
        barWidth: "50%",
        label: {
          show: true,
          position: "right",
          fontSize: 13,
          fontWeight: 600,
          color: "#374151",
          formatter: "{c} 人",
        },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: Math.max(160, sorted.length * 44) }} />;
}

/* ---------- 单门课程的数据块 ---------- */
function CourseBlock({ course }) {
  const hasData = course.totalSubmissions > 0;

  return (
    <div className="course-block">
      {/* 课程标题 */}
      <div className="course-block-header">
        <h3 className="course-block-title">{course.courseName}</h3>
        <div className="course-block-stats">
          <StatCard label="实训任务" value={course.totalTasks + " 个"} color="#8b5cf6" />
          <StatCard label="提交记录" value={course.totalSubmissions + " 次"} color="#f59e0b" />
          <StatCard label="平均得分" value={course.avgScore + " 分"} color="#22c55e" />
        </div>
      </div>

      {!hasData ? (
        <EmptyTip text="该课程暂无提交数据" />
      ) : (
        <>
          {/* 上排：分数分布 + 高频错误 */}
          <div className="chart-grid-2col">
            <Panel title="分数分布" subtitle="各分数段人数统计">
              <ScoreDistChart data={course.scoreDistribution} />
            </Panel>
            <Panel title="高频错误 TOP 10" subtitle="学生作业中最常出现的问题">
              {course.topErrors?.length ? <TopErrorsChart errors={course.topErrors} /> : <EmptyTip />}
            </Panel>
          </div>

          {/* 中排：班级均分趋势 */}
          {course.trends?.length > 0 && (
            <Panel title="班级均分趋势" subtitle="各班级在不同任务中的平均得分变化">
              <ClassTrendChart trends={course.trends} />
            </Panel>
          )}

          {/* 下排：班级学生分布 */}
          {course.classBreakdown?.length > 0 && (
            <Panel title="班级学生分布" subtitle="该课程各班级参与情况">
              <ClassBreakdownChart data={course.classBreakdown} />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

/* ========== 主页面 ========== */
export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardOverview()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#999" }}>
        加载数据看板…
      </div>
    );

  if (!data?.courses?.length)
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#999" }}>
        暂无课程数据
      </div>
    );

  // 学生视角
  if (user.role === "student") {
    return <StudentDashboard data={data} />;
  }

  // 教师/管理员视角
  const g = data.globalStats || {};
  return (
    <div className="page-container">
      <h2 className="page-title">数据看板</h2>
      <p className="page-desc">
        实训教学质量数据总览，按课程分块展示。
      </p>

      {/* 全局概览统计 */}
      <div className="stat-cards-row">
        <StatCard label="学生总数" value={(g.totalStudents ?? 0) + " 人"} color="#3b82f6" />
        <StatCard label="课程总数" value={(data.courses?.length ?? 0) + " 门"} color="#8b5cf6" />
        <StatCard label="任务总数" value={(g.totalTasks ?? 0) + " 个"} color="#f59e0b" />
        <StatCard label="提交总数" value={(g.totalSubmissions ?? 0) + " 次"} color="#22c55e" />
        <StatCard label="全局均分" value={(g.avgScore ?? 0) + " 分"} color="#ec4899" />
      </div>

      {/* 按课程分块 */}
      {data.courses.map((course) => (
        <CourseBlock key={course.courseId} course={course} />
      ))}
    </div>
  );
}

/* ========== 学生工作台视图 ========== */
function StudentDashboard({ data }) {
  const g = data.globalStats || {};
  const name = data.studentName || "同学";

  return (
    <div className="page-container">
      <h2 className="page-title">工作台</h2>
      <p className="page-desc">欢迎回来，{name}！以下是你的学习概况。</p>

      {/* 个人统计 */}
      <div className="stat-cards-row">
        <StatCard label="我的任务" value={(g.totalTasks ?? 0) + " 个"} color="#3b82f6" />
        <StatCard label="提交次数" value={(g.totalSubmissions ?? 0) + " 次"} color="#22c55e" />
        <StatCard label="平均成绩" value={g.avgScore != null ? g.avgScore + " 分" : "--"} color="#8b5cf6" />
        <StatCard label="参与课程" value={(data.courses?.length ?? 0) + " 门"} color="#f59e0b" />
      </div>

      {/* 按课程展示任务和成绩 */}
      {data.courses.map((course) => (
        <div key={course.courseId} className="dash-panel" style={{ marginTop: 16 }}>
          <div className="dash-panel-header">
            <strong>{course.courseName}</strong>
            <span className="dash-panel-sub">
              {course.totalTasks}个任务 · {course.totalSubmissions}次提交
              {course.avgScore != null ? ` · 均分${course.avgScore}` : ""}
            </span>
          </div>
          <div className="dash-panel-body">
            {course.tasks && course.tasks.length > 0 ? (
              <table className="student-task-table">
                <thead>
                  <tr>
                    <th style={{ width: "35%" }}>任务名称</th>
                    <th style={{ width: "18%" }}>最佳成绩</th>
                    <th style={{ width: "15%", textAlign: "center" }}>提交次数</th>
                    <th style={{ width: "17%", textAlign: "center" }}>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {course.tasks.map((t) => (
                    <tr key={t.taskId}>
                      <td style={{ fontWeight: 500 }}>{t.taskTitle}</td>
                      <td>
                        {t.bestScore != null ? (
                          <span className={`score-badge score-${
                            t.bestScore >= 80 ? "good" : t.bestScore >= 60 ? "pass" : "fail"
                          }`}>{t.bestScore} 分</span>
                        ) : <span className="no-score">待评分</span>}
                      </td>
                      <td style={{ textAlign: "center" }}>{t.submissionCount} 次</td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`status-chip status-${
                          t.status === "finalized" ? "success" :
                          t.status === "checked" || t.status === "scored" ? "info" :
                          "default"
                        }`}>{t.status === "finalized" ? "已完成" : t.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="input-like">该课程暂无任务数据</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- 辅助组件 ---------- */
function Panel({ title, subtitle, children }) {
  return (
    <div className="dash-panel">
      <div className="dash-panel-header">
        <strong>{title}</strong>
        {subtitle && <span className="dash-panel-sub">{subtitle}</span>}
      </div>
      <div className="dash-panel-body">{children}</div>
    </div>
  );
}

function EmptyTip({ text }) {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "#aaa" }}>
      {text || "暂无数据"}
    </div>
  );
}
