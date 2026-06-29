import { useState, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import { getDashboardOverview } from "../../services/appService";
import { useAuth } from "../../state/AuthContext";
import AdminDashboardPage from "./AdminDashboardPage";

const KPI_ICONS = {
  classes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg>
  ),
  students: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  ),
  submissions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
  ),
  avgScore: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  ),
};

function KPICard({ iconKey, label, value, unit, trend, color, up }) {
  return (
    <div className="kpi-card-new">
      <div className="kpi-top">
        <div className="kpi-icon-wrap" style={{ background: `linear-gradient(135deg, ${color}20, ${color}10)` }}>
          <div className="kpi-icon" style={{ color }}>{KPI_ICONS[iconKey]}</div>
        </div>
        <div className="kpi-trend" style={{ color: up ? "#10b981" : "#ef4444", background: up ? "#f0fdf4" : "#fef2f2" }}>
          {up ? "↑" : "↓"} {trend}
        </div>
      </div>
      <div className="kpi-value">{value}<span className="kpi-unit">{unit}</span></div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function ClassCard({ cls, active, onClick }) {
  return (
    <div className={`class-card-new ${active ? "class-card-active" : ""}`} onClick={onClick}>
      <div className="class-card-body">
        <div className="class-card-name">{cls.className}</div>
        <div className="class-card-count">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          学生：{cls.studentCount} 人
        </div>
        {cls.courseNames?.length > 0 && (
          <div className="class-card-tags">
            {cls.courseNames.map((c) => (
              <span key={c} className="class-tag">{c}</span>
            ))}
          </div>
        )}
      </div>
      {active && (
        <div className="class-card-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      )}
    </div>
  );
}

function MiniStatCard({ icon, label, value, sub, color }) {
  return (
    <div className="mini-stat-card">
      <div className="mini-stat-icon" style={{ background: color + "15", color }}>{icon}</div>
      <div className="mini-stat-content">
        <div className="mini-stat-value" style={{ color }}>{value}</div>
        <div className="mini-stat-label">{label}</div>
        {sub && <div className="mini-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function ScoreDonut({ data, centerLabel, centerValue, colorList }) {
  const total = data.reduce((s, d) => s + d.count, 0) || data.reduce((s, d) => s + d.value, 0) || 1;
  const colors = colorList || ["#2F6BFF", "#5AA7FF", "#f59e0b", "#f97316", "#ef4444"];
  const option = {
    tooltip: { trigger: "item", formatter: "{b}: {c}人 ({d}%)", backgroundColor: "rgba(15,23,42,0.9)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 } },
    series: [{
      type: "pie",
      radius: ["60%", "82%"],
      center: ["45%", "50%"],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 3 },
      label: { show: false },
      labelLine: { show: false },
      data: data.filter((d) => d.count > 0 || d.value > 0).map((d, i) => ({
        name: d.range || d.label,
        value: d.count || d.value,
        itemStyle: { color: colors[i % colors.length] },
      })),
    }],
  };
  return (
    <div className="donut-chart-wrap">
      <ReactECharts option={option} style={{ height: 220 }} />
      <div className="donut-center">
        <div className="donut-center-value">{centerValue}</div>
        <div className="donut-center-label">{centerLabel}</div>
      </div>
    </div>
  );
}

function TrendChart({ trends }) {
  const option = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15,23,42,0.9)",
      borderColor: "transparent",
      textStyle: { color: "#fff", fontSize: 12 },
      formatter: (params) => {
        const p = params[0];
        return `<div style="font-weight:600;margin-bottom:4px">${p.name}</div><div>平均分：<b>${p.value}</b> 分</div>`;
      }
    },
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: (trends || []).map((t, i) => `第${i + 1}周`),
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisTick: { show: false },
      axisLabel: { color: "#94a3b8", fontSize: 11, margin: 12 },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f1f5f9", type: "dashed" } },
      axisLabel: { color: "#94a3b8", fontSize: 11 },
    },
    series: [{
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 8,
      lineStyle: { width: 3, color: "#2F6BFF" },
      itemStyle: { color: "#2F6BFF", borderColor: "#fff", borderWidth: 2 },
      areaStyle: {
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(47,107,255,0.2)" },
            { offset: 1, color: "rgba(47,107,255,0.01)" },
          ],
        },
      },
      data: (trends || []).map((t) => Math.round(t.avg_score || 0)),
    }],
  };
  return <ReactECharts option={option} style={{ height: 220 }} />;
}

function RecentTaskRow({ task, index }) {
  const idxColors = ["#2F6BFF", "#5AA7FF", "#2F6BFF", "#94a3b8", "#94a3b8"];
  const idxBg = idxColors[index] + "20";
  return (
    <div className="recent-task-row">
      <div className="recent-task-idx" style={{ background: idxBg, color: idxColors[index] }}>{index + 1}</div>
      <div className="recent-task-main">
        <div className="recent-task-title">{task.title}</div>
        <div className="recent-task-meta">
          <span className="recent-task-course">{task.course}</span>
          {task.deadline && <span className="recent-task-deadline">截止：{task.deadline?.slice(0, 10)}</span>}
        </div>
      </div>
      <div className="recent-task-progress-col">
        <div className="recent-task-sub-text">已提交 {task.submitted}/{task.total}</div>
        <div className="recent-task-bar-wrap">
          <div className="recent-task-bar" style={{ width: `${task.progress}%` }} />
        </div>
      </div>
      <div className="recent-task-percent">{task.progress}%</div>
    </div>
  );
}

function RankRow({ student, rank }) {
  const medals = ["🥇", "🥈", "🥉"];
  const bgColors = ["#fef3c7", "#f1f5f9", "#fef3c7", "#f8fafc", "#f8fafc"];
  return (
    <div className="rank-row" style={{ background: bgColors[rank] || "#f8fafc" }}>
      <div className="rank-num">{medals[rank] || <span>{rank + 1}</span>}</div>
      <div className="rank-name">{student.name || "未知"}</div>
      <div className="rank-score">{student.bestScore}<span className="rank-score-unit">分</span></div>
    </div>
  );
}

function LegendRow({ color, label, count, percent }) {
  return (
    <div className="legend-row">
      <span className="legend-dot" style={{ background: color }} />
      <span className="legend-label">{label}</span>
      <span className="legend-count">{count}人</span>
      <span className="legend-percent">({percent}%)</span>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    getDashboardOverview()
      .then((d) => {
        setData(d);
        if (d?.classes?.length > 0) setSelectedClassId(d.classes[0].classId);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setActiveTab("overview");
  }, [selectedClassId]);

  if (loading) {
    return (
      <div className="dash-loading">
        <div className="dash-spinner" />
        <div>加载数据看板…</div>
      </div>
    );
  }

  if (user.role === "student") {
    return <StudentDashboard data={data} />;
  }

  if (user.role === "admin") {
    return <AdminDashboardPage />;
  }

  return <TeacherDashboard data={data} selectedClassId={selectedClassId} onClassSelect={setSelectedClassId} activeTab={activeTab} onTabChange={setActiveTab} user={user} />;
}

function TeacherDashboard({ data, selectedClassId, onClassSelect, activeTab, onTabChange, user }) {
  const g = data?.globalStats || {};
  const classes = data?.classes || [];
  const selectedClass = classes.find((c) => c.classId === selectedClassId) || classes[0];

  const today = new Date().toISOString().slice(0, 10);
  const semester = "2024-2025学年 第二学期";

  const kpiData = [
    { iconKey: "classes", label: "授课班级", value: g.totalClasses || 0, unit: "个", trend: "1", color: "#2F6BFF", up: true },
    { iconKey: "students", label: "学生总数", value: g.totalStudents || 0, unit: "人", trend: "12", color: "#10b981", up: true },
    { iconKey: "tasks", label: "任务总数", value: g.totalTasks || 0, unit: "个", trend: "4", color: "#f59e0b", up: true },
    { iconKey: "submissions", label: "提交次数", value: g.totalSubmissions || 0, unit: "次", trend: "28", color: "#8b5cf6", up: true },
    { iconKey: "avgScore", label: "班级平均分", value: g.avgScore || 0, unit: "分", trend: "6.3", color: "#ec4899", up: true },
  ];

  return (
    <div className="dashboard-new">
      <div className="kpi-row-new">
        {kpiData.map((k) => (
          <KPICard key={k.label} {...k} />
        ))}
      </div>

      <div className="dash-body-grid">
        <div className="class-list-panel">
          <div className="panel-header">
            <h3 className="panel-title">我的班级</h3>
            <button className="btn-add-class">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              添加班级
            </button>
          </div>
          <div className="class-list-scroll">
            {classes.length === 0 ? (
              <div className="empty-state">暂无授课班级</div>
            ) : (
              classes.map((cls) => (
                <ClassCard
                  key={cls.classId}
                  cls={cls}
                  active={cls.classId === selectedClass?.classId}
                  onClick={() => onClassSelect(cls.classId)}
                />
              ))
            )}
          </div>
        </div>

        <div className="class-detail-panel">
          {selectedClass ? (
            <ClassDetailPanel cls={selectedClass} activeTab={activeTab} onTabChange={onTabChange} />
          ) : (
            <div className="empty-detail">请选择一个班级查看详情</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClassDetailPanel({ cls, activeTab, onTabChange }) {
  const tabs = [
    { key: "overview", label: "班级概况" },
    { key: "score", label: "成绩统计" },
    { key: "task", label: "任务管理" },
    { key: "student", label: "学生管理" },
    { key: "analysis", label: "学习分析" },
  ];

  return (
    <div className="detail-panel-new">
      <div className="detail-header-new">
        <div className="detail-title-row">
          <h2 className="detail-class-name">{cls.className}</h2>
          {cls.courseNames?.[0] && (
            <span className="detail-course-badge">{cls.courseNames[0]}</span>
          )}
        </div>
        <div className="detail-header-actions">
          <button className="btn-class-settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            班级设置
          </button>
        </div>
      </div>

      <div className="detail-tabs-new">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`detail-tab-new ${activeTab === t.key ? "detail-tab-active" : ""}`}
            onClick={() => onTabChange(t.key)}
          >
            {t.label}
            {activeTab === t.key && <span className="tab-indicator" />}
          </button>
        ))}
      </div>

      <div className="detail-content-new">
        {activeTab === "overview" && <OverviewTab cls={cls} />}
        {activeTab === "score" && <ScoreTab cls={cls} />}
        {activeTab === "task" && <TaskTab cls={cls} />}
        {activeTab === "student" && <StudentTab cls={cls} />}
        {activeTab === "analysis" && <AnalysisTab cls={cls} />}
      </div>
    </div>
  );
}

function OverviewTab({ cls }) {
  const excellentRate = cls.studentCount > 0
    ? Math.round((cls.studentStatus?.find(s => s.label === "优秀")?.value || 0) / cls.studentCount * 100)
    : 0;

  const distColors = ["#2F6BFF", "#5AA7FF", "#f59e0b", "#f97316", "#ef4444"];
  const distLabels = ["优秀", "良好", "中等", "及格", "不及格"];
  const scoreDist = cls.scoreDistribution || [];
  const totalStu = cls.studentCount || 1;

  return (
    <div className="tab-content-new">
      <div className="section-block">
        <h4 className="section-title-new">班级整体情况</h4>
        <div className="mini-stats-grid">
          <MiniStatCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>}
            label="学生总数"
            value={cls.studentCount + " 人"}
            sub={`出勤率：${Math.round((totalStu > 0 ? 1 : 0) * 96)}%`}
            color="#2F6BFF"
          />
          <MiniStatCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
            label="平均成绩"
            value={cls.avgScore + " 分"}
            sub={`优秀率：${excellentRate}%`}
            color="#10b981"
          />
          <MiniStatCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            label="任务完成率"
            value={Math.round(cls.completionRate) + "%"}
            sub="较上月 ↑12%"
            color="#f59e0b"
          />
          <MiniStatCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>}
            label="提交总数"
            value={cls.totalSubmissions + " 次"}
            sub="较上月 ↑18次"
            color="#8b5cf6"
          />
        </div>
      </div>

      <div className="charts-row">
        <div className="chart-card">
          <h4 className="section-title-new">成绩分布</h4>
          <div className="chart-with-legend">
            <ScoreDonut data={scoreDist} centerLabel="平均分" centerValue={cls.avgScore} colorList={distColors} />
            <div className="chart-legend-list">
              {scoreDist.map((d, i) => {
                const pct = totalStu > 0 ? Math.round(d.count / totalStu * 100) : 0;
                return <LegendRow key={d.range} color={distColors[i % 5]} label={distLabels[i] || d.range} count={d.count} percent={pct} />;
              })}
            </div>
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-header-row">
            <h4 className="section-title-new">成绩趋势</h4>
            <div className="chart-period-select">
              近8周
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </div>
          <TrendChart trends={cls.trends} />
        </div>
      </div>

      <div className="bottom-row">
        <div className="bottom-card">
          <div className="bottom-card-header">
            <h4 className="section-title-new">最近任务</h4>
            <button className="btn-view-all">查看全部 ›</button>
          </div>
          <div className="recent-tasks-list">
            {(cls.recentTasks || []).slice(0, 5).map((t, i) => (
              <RecentTaskRow key={t.taskId} task={t} index={i} />
            ))}
            {(cls.recentTasks || []).length === 0 && <div className="empty-state-sm">暂无任务</div>}
          </div>
        </div>
        <div className="bottom-card">
          <div className="bottom-card-header">
            <h4 className="section-title-new">学生状态分布</h4>
          </div>
          <div className="status-donut-section">
            <ScoreDonut
              data={(cls.studentStatus || []).map(s => ({ range: s.label, count: s.value }))}
              centerLabel="总人数"
              centerValue={cls.studentCount}
              colorList={distColors}
            />
            <div className="chart-legend-list">
              {(cls.studentStatus || []).map((s, i) => {
                const pct = totalStu > 0 ? Math.round(s.value / totalStu * 100) : 0;
                return <LegendRow key={s.label} color={distColors[i % 5]} label={s.label} count={s.value} percent={pct} />;
              })}
            </div>
          </div>
        </div>
        <div className="bottom-card">
          <div className="bottom-card-header">
            <h4 className="section-title-new">成绩排行榜</h4>
            <button className="btn-view-all">查看全部 ›</button>
          </div>
          <div className="ranking-list">
            {(cls.ranking || []).slice(0, 5).map((s, i) => (
              <RankRow key={s.studentId} student={s} rank={i} />
            ))}
            {(cls.ranking || []).length === 0 && <div className="empty-state-sm">暂无成绩数据</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreTab({ cls }) {
  const distColors = ["#2F6BFF", "#5AA7FF", "#f59e0b", "#f97316", "#ef4444"];
  const totalStu = cls.studentCount || 1;
  return (
    <div className="tab-content-new">
      <div className="charts-row">
        <div className="chart-card">
          <h4 className="section-title-new">学生状态分布</h4>
          <div className="status-donut-section">
            <ScoreDonut
              data={(cls.studentStatus || []).map(s => ({ range: s.label, count: s.value }))}
              centerLabel="总人数"
              centerValue={cls.studentCount}
              colorList={distColors}
            />
            <div className="chart-legend-list">
              {(cls.studentStatus || []).map((s, i) => {
                const pct = totalStu > 0 ? Math.round(s.value / totalStu * 100) : 0;
                return <LegendRow key={s.label} color={distColors[i % 5]} label={s.label} count={s.value} percent={pct} />;
              })}
            </div>
          </div>
        </div>
        <div className="chart-card">
          <h4 className="section-title-new">成绩排行榜</h4>
          <div className="ranking-list ranking-full">
            {(cls.ranking || []).slice(0, 10).map((s, i) => <RankRow key={s.studentId} student={s} rank={i} />)}
            {(cls.ranking || []).length === 0 && <div className="empty-state-sm">暂无成绩数据</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskTab({ cls }) {
  return (
    <div className="tab-content-new">
      <div className="section-block">
        <h4 className="section-title-new">任务列表</h4>
        <div className="recent-tasks-list">
          {(cls.recentTasks || []).map((t, i) => <RecentTaskRow key={t.taskId} task={t} index={i} />)}
          {(cls.recentTasks || []).length === 0 && <div className="empty-state-sm">暂无任务</div>}
        </div>
      </div>
    </div>
  );
}

function StudentTab({ cls }) {
  const students = cls.students || [];
  const getLevel = (score) => {
    if (score >= 90) return { label: "优秀", color: "#10b981", bg: "#f0fdf4" };
    if (score >= 80) return { label: "良好", color: "#2F6BFF", bg: "#eff4ff" };
    if (score >= 70) return { label: "中等", color: "#f59e0b", bg: "#fffbeb" };
    if (score >= 60) return { label: "及格", color: "#f97316", bg: "#fff7ed" };
    return { label: "不及格", color: "#ef4444", bg: "#fef2f2" };
  };
  return (
    <div className="tab-content-new">
      <div className="section-block">
        <h4 className="section-title-new">学生列表（共 {students.length} 人）</h4>
        {students.length === 0 ? (
          <div className="empty-state-sm">暂无学生数据</div>
        ) : (
          <div className="student-table-wrap">
            <table className="student-table-new">
              <thead>
                <tr>
                  <th style={{ width: "8%" }}>序号</th>
                  <th style={{ width: "16%" }}>姓名</th>
                  <th style={{ width: "18%" }}>学号</th>
                  <th style={{ width: "14%", textAlign: "center" }}>最佳成绩</th>
                  <th style={{ width: "16%", textAlign: "center" }}>完成任务</th>
                  <th style={{ width: "18%", textAlign: "center" }}>完成率</th>
                  <th style={{ width: "10%", textAlign: "center" }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => {
                  const level = getLevel(s.bestScore);
                  return (
                    <tr key={s.studentId}>
                      <td className="td-idx">{i + 1}</td>
                      <td className="td-name">{s.name || "未知"}</td>
                      <td className="td-number">{s.studentNumber || "--"}</td>
                      <td className="td-score" style={{ color: level.color }}>{s.bestScore || 0} 分</td>
                      <td className="td-tasks">{s.submittedTasks} / {s.totalTasks}</td>
                      <td className="td-progress-cell">
                        <div className="stu-progress-wrap">
                          <div className="stu-progress-bar" style={{ width: `${s.completionRate || 0}%`, background: level.color }} />
                          <span className="stu-progress-text">{s.completionRate || 0}%</span>
                        </div>
                      </td>
                      <td className="td-status-cell">
                        <span className="stu-status-tag" style={{ color: level.color, background: level.bg }}>{level.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisTab({ cls }) {
  const la = cls.learningAnalysis || {};
  const items = [
    { label: "学习进度", value: Math.round(la.learningProgress || 0), unit: "%", color: "#2F6BFF", icon: "📈" },
    { label: "知识掌握度", value: Math.round(la.knowledgeMastery || 0), unit: "分", color: "#10b981", icon: "🧠" },
    { label: "实践能力", value: Math.round(la.practiceAbility || 0), unit: "%", color: "#f59e0b", icon: "💡" },
    { label: "协作能力", value: la.collaboration || 0, unit: "次/人", color: "#8b5cf6", icon: "🤝" },
    { label: "需重点关注", value: la.atRiskStudents || 0, unit: "人", color: "#ef4444", icon: "⚠️" },
  ];
  return (
    <div className="tab-content-new">
      <div className="section-block">
        <h4 className="section-title-new">学习分析指标</h4>
        <div className="analysis-grid">
          {items.map((item) => (
            <div key={item.label} className="analysis-card-new">
              <div className="analysis-card-icon" style={{ background: item.color + "15", color: item.color }}>{item.icon}</div>
              <div className="analysis-card-label">{item.label}</div>
              <div className="analysis-card-value" style={{ color: item.color }}>
                {item.value}<span className="analysis-unit">{item.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StudentDashboard({ data }) {
  const g = data?.globalStats || {};
  const name = data?.studentName || "同学";
  const org = data?.studentOrg || "";
  const pendingTasks = data?.pendingTasks || [];
  const scoreTrend = data?.scoreTrend || [];
  const riskLevel = data?.riskLevel || "低";
  const taskProgress = data?.taskProgress || { submitted: 0, total: 0, rate: 0 };
  const courses = data?.courses || [];
  const aiSuggestions = data?.aiSuggestions || [];

  const today = new Date();
  const dateStr = today.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  const recentScores = scoreTrend.slice(-6);

  const trendOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15,23,42,0.9)",
      borderColor: "transparent",
      textStyle: { color: "#fff", fontSize: 12 },
      formatter: (params) => {
        const p = params[0];
        return `<div style="font-weight:600;margin-bottom:4px">${p.name}</div><div>成绩：<b>${p.value}</b> 分</div>`;
      },
    },
    grid: { left: 36, right: 12, top: 12, bottom: 28 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: recentScores.map((_, i) => `第${i + 1}次`),
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisTick: { show: false },
      axisLabel: { color: "#94a3b8", fontSize: 10, margin: 8 },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f1f5f9", type: "dashed" } },
      axisLabel: { color: "#94a3b8", fontSize: 10 },
    },
    series: [{
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2.5, color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "#4F7DFF" }, { offset: 1, color: "#6A5CFF" }] } },
      itemStyle: { color: "#4F7DFF", borderColor: "#fff", borderWidth: 2 },
      areaStyle: {
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(79,125,255,0.15)" },
            { offset: 1, color: "rgba(106,92,255,0.02)" },
          ],
        },
      },
      data: recentScores.map((s) => s.score),
    }],
  };

  const getTrendLabel = () => {
    if (recentScores.length < 2) return "数据不足";
    const first = recentScores[0].score;
    const last = recentScores[recentScores.length - 1].score;
    const diff = last - first;
    if (diff > 5) return "稳步提升 ↑";
    if (diff > 0) return "缓慢提升 ↗";
    if (diff === 0) return "保持稳定 →";
    if (diff > -5) return "略有下降 ↘";
    return "需要关注 ↓";
  };

  const getTrendColor = () => {
    if (recentScores.length < 2) return "#94a3b8";
    const first = recentScores[0].score;
    const last = recentScores[recentScores.length - 1].score;
    const diff = last - first;
    if (diff > 0) return "#10b981";
    if (diff === 0) return "#f59e0b";
    return "#ef4444";
  };

  const riskColors = { "低": "#10b981", "中": "#f59e0b", "高": "#ef4444" };
  const riskBgColors = { "低": "#f0fdf4", "中": "#fffbeb", "高": "#fef2f2" };

  const getTaskProgress = (task) => {
    if (task.progress != null) return task.progress;
    return Math.floor(Math.random() * 60) + 20;
  };

  const getDefaultTaskIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
  );
  const getTaskIcon = (courseName) => {
    if (courseName && courseName.includes("Java")) {
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
    }
    if (courseName && courseName.includes("数据库")) {
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
    }
    return getDefaultTaskIcon();
  };

  return (
    <div className="sd-page">
      {/* 轻量欢迎区 */}
      <div className="sd-welcome">
        <div className="sd-welcome-text">
          <h2 className="sd-greeting">Hi，{name} <span className="sd-wave">👋</span></h2>
          <p className="sd-date">{dateStr}</p>
        </div>
        {pendingTasks.length > 0 && (
          <div className="sd-reminder-banner">
            <div className="sd-reminder-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div className="sd-reminder-body">
              <span className="sd-reminder-title">今天有 <b>{pendingTasks.length}</b> 个学习任务待完成</span>
              <span className="sd-reminder-sub">合理安排时间，高效完成学习目标</span>
            </div>
            <a href="/tasks" className="sd-reminder-link">
              查看全部
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>
            </a>
          </div>
        )}
      </div>

      {/* 主体布局：主工作区 + 右侧信息栏 */}
      <div className="sd-main-grid">
        {/* ========== 中间主工作区 ========== */}
        <div className="sd-col-main">

          {/* ① 动态任务流（核心） */}
          <div className="sd-card sd-taskflow-card">
            <div className="sd-card-header">
              <h3 className="sd-card-title">
                <span className="sd-title-icon">📋</span>
                学习任务流
              </h3>
              <span className="sd-task-count">{pendingTasks.length} 项待完成</span>
            </div>
            <div className={`sd-taskflow-list ${pendingTasks.length === 0 ? "sd-taskflow-empty" : ""} ${pendingTasks.length > 4 ? "sd-taskflow-scroll" : ""}`}>
              {pendingTasks.length === 0 ? (
                <div className="sd-taskflow-empty-state">
                  <div className="sd-taskflow-empty-icon"></div>
                  <div className="sd-taskflow-empty-text">暂无待完成任务，继续保持！</div>
                </div>
              ) : (
                pendingTasks.map((task) => {
                  const deadline = task.deadline ? task.deadline.slice(0, 10) : "";
                  const isUrgent = deadline && new Date(deadline) <= new Date(new Date().toDateString());
                  const progress = getTaskProgress(task);
                  return (
                    <div key={task.taskId} className={`sd-taskflow-item ${isUrgent ? "sd-taskflow-urgent" : ""}`}>
                      <div className="sd-taskflow-icon" style={{ background: isUrgent ? "#fef2f2" : "#eff4ff", color: isUrgent ? "#ef4444" : "#4F7DFF" }}>
                        {getTaskIcon(task.courseName)}
                      </div>
                      <div className="sd-taskflow-body">
                        <div className="sd-taskflow-title">{task.title}</div>
                        <div className="sd-taskflow-meta">
                          <span className="sd-taskflow-course">{task.courseName}</span>
                          <span className="sd-taskflow-deadline" style={{ color: isUrgent ? "#ef4444" : "#94a3b8" }}>
                            {isUrgent ? " 今天截止" : `截止：${deadline}`}
                          </span>
                        </div>
                      </div>
                      <div className="sd-taskflow-progress">
                        <div className="sd-taskflow-bar-wrap">
                          <div className="sd-taskflow-bar" style={{ width: `${progress}%`, background: isUrgent ? "linear-gradient(90deg, #f59e0b, #f97316)" : "linear-gradient(90deg, #4F7DFF, #6A5CFF)" }} />
                        </div>
                        <span className="sd-taskflow-pct">{progress}%</span>
                      </div>
                      <a href={`/tasks/${task.taskId}`} className="sd-taskflow-btn" style={{ background: isUrgent ? "linear-gradient(135deg, #f59e0b, #f97316)" : "linear-gradient(135deg, #4F7DFF, #6A5CFF)" }}>
                        {isUrgent ? "去完成" : "继续"}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10"><polyline points="9 18 15 12 9 6"/></svg>
                      </a>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ② 学习进度模块 */}
          <div className="sd-card sd-progress-card">
            <div className="sd-card-header">
              <h3 className="sd-card-title">
                <span className="sd-title-icon">📊</span>
                课程学习进度
              </h3>
            </div>
            {courses.length > 0 ? courses.map((course) => {
              const rate = course.totalTasks > 0 ? Math.round(course.totalSubmissions / (course.totalTasks * Math.max(1, g.totalStudents || 1)) * 100) : 0;
              const displayRate = taskProgress.rate > 0 ? taskProgress.rate : rate;
              return (
                <div key={course.courseId} className="sd-progress-item">
                  <div className="sd-progress-header">
                    <span className="sd-progress-name">{course.courseName}</span>
                    <span className="sd-progress-pct">{displayRate}%</span>
                  </div>
                  <div className="sd-progress-bar-bg">
                    <div className="sd-progress-bar-fill" style={{ width: `${displayRate}%` }} />
                  </div>
                  <div className="sd-progress-footer">
                    <span className="sd-progress-modules">已完成模块：{taskProgress.submitted}/{taskProgress.total}</span>
                  </div>
                </div>
              );
            }) : (
              <div className="sd-empty-tip">暂无课程数据</div>
            )}
          </div>

          {/* ③ 学习状态卡片（轻量浮动） */}
          <div className="sd-status-grid">
            <div className="sd-status-card">
              <div className="sd-status-icon" style={{ background: "#fff7ed", color: "#f59e0b" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </div>
              <div className="sd-status-body">
                <div className="sd-status-value" style={{ color: g.avgScore != null && g.avgScore < 60 ? "#f59e0b" : "#1d2736" }}>{g.avgScore != null ? g.avgScore : "--"}</div>
                <div className="sd-status-label">平均成绩</div>
              </div>
            </div>
            <div className="sd-status-card">
              <div className="sd-status-icon" style={{ background: "#f0fdf4", color: "#10b981" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              </div>
              <div className="sd-status-body">
                <div className="sd-status-value" style={{ color: "#10b981" }}>{g.totalSubmissions ?? 0}次</div>
                <div className="sd-status-label">提交次数</div>
              </div>
            </div>
            <div className="sd-status-card">
              <div className="sd-status-icon" style={{ background: "#eff4ff", color: "#4F7DFF" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
              </div>
              <div className="sd-status-body">
                <div className="sd-status-value" style={{ color: "#4F7DFF" }}>{courses.length}门</div>
                <div className="sd-status-label">课程数量</div>
              </div>
            </div>
            <div className="sd-status-card">
              <div className="sd-status-icon" style={{ background: riskBgColors[riskLevel], color: riskColors[riskLevel] }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div className="sd-status-body">
                <div className="sd-status-value" style={{ color: riskColors[riskLevel] }}>{riskLevel}</div>
                <div className="sd-status-label">学习风险</div>
              </div>
            </div>
          </div>
        </div>

        {/* ========== 右侧信息栏 ========== */}
        <div className="sd-col-side">

          {/* ① 今日提醒卡 */}
          <div className="sd-card sd-reminder-card">
            <div className="sd-card-header">
              <h3 className="sd-card-title">
                <span className="sd-title-icon">🔔</span>
                今日提醒
              </h3>
            </div>
            {pendingTasks.length > 0 ? (
              <div className="sd-reminder-content">
                <div className="sd-reminder-stat">
                  <span className="sd-reminder-stat-num" style={{ color: pendingTasks.length > 2 ? "#ef4444" : "#f59e0b" }}>{pendingTasks.length}</span>
                  <span className="sd-reminder-stat-text">个任务待完成</span>
                </div>
                <div className="sd-reminder-tip">
                  {pendingTasks.length > 2 ? "⚠️ 任务较多，建议优先处理紧急任务" : "💡 合理安排时间，保持学习节奏"}
                </div>
              </div>
            ) : (
              <div className="sd-reminder-content sd-reminder-done">
                <div className="sd-reminder-done-icon">✅</div>
                <div className="sd-reminder-done-text">今日任务已全部完成！</div>
              </div>
            )}
          </div>

          {/* ② AI 学习建议（聊天气泡 + 呼吸光） */}
          <div className="sd-card sd-ai-card">
            <div className="sd-card-header">
              <h3 className="sd-card-title">
                <span className="sd-title-icon">🤖</span>
                尚进大模型学习建议
              </h3>
              <span className="sd-ai-badge">AI</span>
            </div>
            <div className="sd-ai-content">
              {aiSuggestions.length === 0 ? (
                <div className="sd-ai-chat-bubble">
                  <div className="sd-ai-chat-avatar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M12 2a3 3 0 0 0-3 3v1H7a2 2 0 0 0-2 2v1a5 5 0 0 0 5 5h1v3a2 2 0 0 0 2 2 2 2 0 0 0 2-2v-3h1a5 5 0 0 0 5-5V8a2 2 0 0 0-2-2h-2V5a3 3 0 0 0-3-3z"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/></svg>
                  </div>
                  <div className="sd-ai-chat-text">
                    <p>提交实训作业后即可获取 AI 个性化学习建议</p>
                  </div>
                </div>
              ) : (
                <div className="sd-ai-chat-list">
                  {aiSuggestions.map((s, idx) => {
                    const typeIcons = { theory: "📚", practice: "️", risk: "⚠️", career: "🎯" };
                    const typeLabels = { theory: "理论强化", practice: "项目实践", risk: "风险提醒", career: "职业方向" };
                    return (
                      <div key={idx} className="sd-ai-chat-bubble">
                        <div className="sd-ai-chat-avatar">
                          <span>{typeIcons[s.type] || "💡"}</span>
                        </div>
                        <div className="sd-ai-chat-text">
                          <div className="sd-ai-chat-label">{s.title || typeLabels[s.type] || "学习建议"}</div>
                          <p>{s.summary}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ③ 成绩趋势 */}
          <div className="sd-card sd-trend-card">
            <div className="sd-card-header">
              <h3 className="sd-card-title">
                <span className="sd-title-icon"></span>
                成绩趋势
              </h3>
              <span className="sd-trend-label">近{recentScores.length}次</span>
            </div>
            {recentScores.length > 0 ? (
              <>
                <ReactECharts option={trendOption} style={{ height: 160 }} />
                <div className="sd-trend-status">
                  学习状态：<span className="sd-trend-status-text" style={{ color: getTrendColor() }}>{getTrendLabel()}</span>
                </div>
              </>
            ) : (
              <div className="sd-empty-chart">
                <span className="sd-empty-icon"></span>
                <span>暂无成绩数据</span>
              </div>
            )}
          </div>

          {/* ④ 快捷入口 */}
          <div className="sd-card sd-quick-card">
            <div className="sd-card-header">
              <h3 className="sd-card-title">
                <span className="sd-title-icon">⚡</span>
                快捷入口
              </h3>
            </div>
            <div className="sd-quick-list">
              <a href="/scores" className="sd-quick-item">
                <span className="sd-quick-icon" style={{ background: "#eff4ff", color: "#4F7DFF" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </span>
                <span className="sd-quick-label">我的成绩</span>
                <svg className="sd-quick-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>
              </a>
              <a href="/tasks" className="sd-quick-item">
                <span className="sd-quick-icon" style={{ background: "#f0fdf4", color: "#10b981" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                </span>
                <span className="sd-quick-label">提交记录</span>
                <svg className="sd-quick-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>
              </a>
              <a href="/reports" className="sd-quick-item">
                <span className="sd-quick-icon" style={{ background: "#faf5ff", color: "#8b5cf6" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </span>
                <span className="sd-quick-label">学习报告</span>
                <svg className="sd-quick-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
