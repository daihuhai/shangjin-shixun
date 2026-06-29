import { useState, useEffect, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import {
  getAdminSchoolOverview,
  getAdminCollegeRanking,
  getAdminCollegeDetail,
  getAdminClassDetail,
} from "../../services/appService";

const GRADE_COLORS = { A: "#10b981", "B+": "#2F6BFF", B: "#f59e0b", "C+": "#f97316", C: "#ef4444" };
const DIST_COLORS = ["#2F6BFF", "#5AA7FF", "#f59e0b", "#f97316", "#ef4444"];
const DIST_LABELS = ["优秀", "良好", "中等", "及格", "不及格"];

function GradeBadge({ label }) {
  const color = GRADE_COLORS[label] || "#94a3b8";
  return <span className="admin-grade-badge" style={{ background: color + "18", color }}>{label}</span>;
}

function RiskTag({ level }) {
  const map = { 高: { c: "#ef4444", b: "#fef2f2" }, 中: { c: "#f59e0b", b: "#fffbeb" }, 低: { c: "#10b981", b: "#f0fdf4" } };
  const s = map[level] || map["低"];
  return <span className="admin-risk-tag" style={{ color: s.c, background: s.b }}>{level}</span>;
}

function KpiCard({ label, value, unit, color, icon }) {
  return (
    <div className="admin-kpi-card">
      <div className="admin-kpi-top">
        <div className="admin-kpi-icon" style={{ background: color + "18", color }}>{icon}</div>
      </div>
      <div className="admin-kpi-value">{value}<span className="admin-kpi-unit">{unit}</span></div>
      <div className="admin-kpi-label">{label}</div>
    </div>
  );
}

const KPI_ICONS = {
  college: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>,
  class: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>,
  teacher: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>,
  student: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>,
  task: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  submission: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
  score: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  risk: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
};

function CollegeBarChart({ ranking, onSelect }) {
  const option = {
    tooltip: { trigger: "axis", backgroundColor: "rgba(15,23,42,0.9)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 } },
    grid: { left: 120, right: 30, top: 10, bottom: 20 },
    xAxis: { type: "value", max: 100, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#f1f5f9", type: "dashed" } }, axisLabel: { color: "#94a3b8", fontSize: 11 } },
    yAxis: { type: "category", data: (ranking || []).map(r => r.college).reverse(), axisLine: { lineStyle: { color: "#e2e8f0" } }, axisTick: { show: false }, axisLabel: { color: "#475569", fontSize: 12 } },
    series: [{
      type: "bar",
      data: (ranking || []).map(r => r.avgScore).reverse(),
      barWidth: 18,
      itemStyle: {
        borderRadius: [0, 6, 6, 0],
        color: (params) => {
          const v = params.value;
          if (v >= 85) return "#10b981";
          if (v >= 70) return "#2F6BFF";
          if (v >= 60) return "#f59e0b";
          return "#ef4444";
        },
      },
      label: { show: true, position: "right", formatter: "{c} 分", color: "#475569", fontSize: 11 },
    }],
  };
  return (
    <div className="admin-chart-card" onClick={(e) => {
      const chart = e.currentTarget.querySelector("canvas");
      if (chart) {
        const echartsInstance = chart.parentElement?.parentElement?.__echarts_instance__;
      }
    }}>
      <ReactECharts option={option} style={{ height: 320 }} onEvents={{ click: (params) => {
        if (params.name) {
          const item = ranking?.find(r => r.college === params.name);
          if (item) onSelect(item.college);
        }
      }} } />
    </div>
  );
}

function ScoreDonut({ dist, centerLabel, centerValue }) {
  const data = Object.entries(dist || {}).map(([label, value]) => ({ name: label, value }));
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const option = {
    tooltip: { trigger: "item", formatter: "{b}: {c}人 ({d}%)", backgroundColor: "rgba(15,23,42,0.9)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 } },
    series: [{
      type: "pie", radius: ["58%", "80%"], center: ["45%", "50%"],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 3 },
      label: { show: false }, labelLine: { show: false },
      data: data.filter(d => d.value > 0).map((d, i) => ({ ...d, itemStyle: { color: DIST_COLORS[i % 5] } })),
    }],
  };
  return (
    <div className="admin-donut-wrap">
      <ReactECharts option={option} style={{ height: 200 }} />
      <div className="admin-donut-center">
        <div className="admin-donut-value">{centerValue}</div>
        <div className="admin-donut-label">{centerLabel}</div>
      </div>
    </div>
  );
}

function TrendLineChart({ trends }) {
  const option = {
    tooltip: { trigger: "axis", backgroundColor: "rgba(15,23,42,0.9)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 } },
    grid: { left: 50, right: 20, top: 20, bottom: 50 },
    xAxis: { type: "category", data: (trends || []).map(t => t.taskName || ""), axisLine: { lineStyle: { color: "#e2e8f0" } }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 20, interval: 0 } },
    yAxis: { type: "value", min: 0, max: 100, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#f1f5f9", type: "dashed" } }, axisLabel: { color: "#94a3b8", fontSize: 11 } },
    series: [{
      type: "line", smooth: true, symbol: "circle", symbolSize: 8,
      lineStyle: { width: 3, color: "#2F6BFF" },
      itemStyle: { color: "#2F6BFF", borderColor: "#fff", borderWidth: 2 },
      areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(47,107,255,0.2)" }, { offset: 1, color: "rgba(47,107,255,0.01)" }] } },
      data: (trends || []).map(t => t.avgScore || 0),
    }],
  };
  return <ReactECharts option={option} style={{ height: 220 }} />;
}

export default function AdminDashboardPage() {
  const [level, setLevel] = useState("school"); // school | college | class
  const [schoolKpi, setSchoolKpi] = useState(null);
  const [collegeRanking, setCollegeRanking] = useState([]);
  const [selectedCollege, setSelectedCollege] = useState(null);
  const [collegeDetail, setCollegeDetail] = useState(null);
  const [selectedClass, setSelectedClass] = useState(null);
  const [classDetail, setClassDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  // L0 + L1 初始加载
  useEffect(() => {
    Promise.all([getAdminSchoolOverview(), getAdminCollegeRanking()])
      .then(([kpiRes, rankRes]) => {
        setSchoolKpi(kpiRes?.kpi || {});
        setCollegeRanking(rankRes?.ranking || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // L2 学院详情
  const drillToCollege = useCallback((collegeName) => {
    setSelectedCollege(collegeName);
    setLevel("college");
    setDetailLoading(true);
    getAdminCollegeDetail(collegeName)
      .then((res) => setCollegeDetail(res))
      .catch(() => setCollegeDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  // L3 班级详情
  const drillToClass = useCallback((className) => {
    setSelectedClass(className);
    setLevel("class");
    setDetailLoading(true);
    getAdminClassDetail(className)
      .then((res) => setClassDetail(res))
      .catch(() => setClassDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  const goSchool = () => { setLevel("school"); setSelectedCollege(null); setCollegeDetail(null); };
  const goCollege = () => { setLevel("college"); setSelectedClass(null); setClassDetail(null); };

  if (loading) {
    return (
      <div className="admin-dash-loading">
        <div className="admin-dash-spinner" />
        <div>加载管理员数据面板…</div>
      </div>
    );
  }

  const kpi = schoolKpi || {};
  const kpiCards = [
    { label: "学院总数", value: kpi.collegeCount || 0, unit: "个", color: "#2F6BFF", icon: KPI_ICONS.college },
    { label: "班级总数", value: kpi.classCount || 0, unit: "个", color: "#5AA7FF", icon: KPI_ICONS.class },
    { label: "任课教师", value: kpi.teacherCount || 0, unit: "人", color: "#10b981", icon: KPI_ICONS.teacher },
    { label: "学生总数", value: kpi.studentCount || 0, unit: "人", color: "#f59e0b", icon: KPI_ICONS.student },
    { label: "实训任务", value: kpi.taskCount || 0, unit: "个", color: "#8b5cf6", icon: KPI_ICONS.task },
    { label: "提交总数", value: kpi.submissionCount || 0, unit: "次", color: "#ec4899", icon: KPI_ICONS.submission },
    { label: "全校均分", value: kpi.avgScore || 0, unit: "分", color: "#06b6d4", icon: KPI_ICONS.score },
    { label: "高风险提交", value: kpi.highRiskCount || 0, unit: "个", color: "#ef4444", icon: KPI_ICONS.risk },
  ];

  return (
    <div className="admin-dashboard">
      {/* 面包屑导航 */}
      <div className="admin-breadcrumb">
        <span className={level === "school" ? "admin-crumb active" : "admin-crumb"} onClick={goSchool}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
          学校总览
        </span>
        {level !== "school" && (
          <>
            <span className="admin-crumb-sep">›</span>
            <span className={level === "college" ? "admin-crumb active" : "admin-crumb"} onClick={goCollege}>{selectedCollege}</span>
          </>
        )}
        {level === "class" && (
          <>
            <span className="admin-crumb-sep">›</span>
            <span className="admin-crumb active">{selectedClass}</span>
          </>
        )}
      </div>

      {/* KPI 顶栏 */}
      <div className="admin-kpi-row">
        {kpiCards.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      {/* L0 学校总览 + L1 学院排行 */}
      {level === "school" && (
        <div className="admin-level-school">
          <div className="admin-section-row">
            <div className="admin-chart-card admin-flex-2">
              <h3 className="admin-section-title">各学院平均分对比</h3>
              <CollegeBarChart ranking={collegeRanking} onSelect={drillToCollege} />
            </div>
            <div className="admin-chart-card admin-flex-1">
              <h3 className="admin-section-title">学院雷达对比</h3>
              <CollegeRadarChart ranking={collegeRanking} />
            </div>
          </div>

          <div className="admin-ranking-section">
            <h3 className="admin-section-title">学院排行榜</h3>
            <div className="admin-college-grid">
              {collegeRanking.map((c, i) => (
                <div key={c.college} className="admin-college-card" onClick={() => drillToCollege(c.college)}>
                  <div className="admin-college-rank" style={{
                    background: i === 0 ? "#fef3c7" : i === 1 ? "#f1f5f9" : i === 2 ? "#fef3c7" : "#f8fafc",
                    color: i === 0 ? "#f59e0b" : i === 1 ? "#64748b" : i === 2 ? "#f97316" : "#94a3b8",
                  }}>{i + 1}</div>
                  <div className="admin-college-body">
                    <div className="admin-college-header">
                      <span className="admin-college-name">{c.college}</span>
                      <GradeBadge label={c.gradeLabel} />
                    </div>
                    <div className="admin-college-meta">
                      <span>均分 <b>{c.avgScore}</b></span>
                      <span>学生 {c.studentCount}人</span>
                      <span>班级 {c.classCount}个</span>
                      <span>教师 {c.teacherCount}人</span>
                      <span>任务 {c.taskCount}个</span>
                      <span>完成率 {c.completionRate}%</span>
                    </div>
                  </div>
                  <div className="admin-college-arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                </div>
              ))}
              {collegeRanking.length === 0 && <div className="admin-empty">暂无学院数据</div>}
            </div>
          </div>
        </div>
      )}

      {/* L2 学院详情 */}
      {level === "college" && (
        <div className="admin-level-college">
          {detailLoading ? (
            <div className="admin-detail-loading"><div className="admin-dash-spinner" /><div>加载学院详情…</div></div>
          ) : collegeDetail ? (
            <>
              <div className="admin-sub-section">
                <h3 className="admin-section-title">班级表现排行</h3>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>排名</th><th>班级</th><th>均分</th><th>评级</th><th>学生数</th>
                        <th>任务数</th><th>完成率</th><th>不及格</th><th>成绩分布</th><th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(collegeDetail.classRanking || []).map((c, i) => (
                        <tr key={c.className} className="admin-table-row" onClick={() => drillToClass(c.className)}>
                          <td><span className="admin-rank-num" style={{ color: i < 3 ? "#f59e0b" : "#94a3b8" }}>{i + 1}</span></td>
                          <td className="admin-cell-name">{c.className}</td>
                          <td><b style={{ color: c.avgScore >= 85 ? "#10b981" : c.avgScore >= 60 ? "#2F6BFF" : "#ef4444" }}>{c.avgScore}</b></td>
                          <td><GradeBadge label={c.gradeLabel} /></td>
                          <td>{c.studentCount}</td>
                          <td>{c.taskCount}</td>
                          <td>
                            <div className="admin-progress-mini">
                              <div className="admin-progress-bar" style={{ width: `${Math.min(c.completionRate, 100)}%`, background: c.completionRate >= 80 ? "#10b981" : "#f59e0b" }} />
                              <span>{c.completionRate}%</span>
                            </div>
                          </td>
                          <td style={{ color: c.failCount > 0 ? "#ef4444" : "#94a3b8" }}>{c.failCount}</td>
                          <td>
                            <div className="admin-dist-bar">
                              {DIST_LABELS.map((label, j) => {
                                const v = c.scoreDist?.[label] || 0;
                                return v > 0 ? <div key={label} className="admin-dist-seg" style={{ width: `${v * 10}px`, background: DIST_COLORS[j] }} title={`${label}: ${v}`} /> : null;
                              })}
                            </div>
                          </td>
                          <td><span className="admin-drill-link">查看学生 ›</span></td>
                        </tr>
                      ))}
                      {(collegeDetail.classRanking || []).length === 0 && (
                        <tr><td colSpan="10" className="admin-empty">暂无班级数据</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="admin-sub-section">
                <h3 className="admin-section-title">任课教师表现排行</h3>
                <div className="admin-teacher-grid">
                  {(collegeDetail.teacherRanking || []).map((t, i) => (
                    <div key={t.teacherId} className="admin-teacher-card">
                      <div className="admin-teacher-header">
                        <div className="admin-teacher-avatar" style={{ background: `linear-gradient(135deg, ${DIST_COLORS[i % 5]}, ${DIST_COLORS[(i + 1) % 5]})` }}>
                          {t.teacherName?.charAt(0)}
                        </div>
                        <div className="admin-teacher-info">
                          <div className="admin-teacher-name">{t.teacherName}</div>
                          <div className="admin-teacher-meta">
                            <GradeBadge label={t.gradeLabel} />
                            <span>均分 {t.avgScore}</span>
                          </div>
                        </div>
                      </div>
                      <div className="admin-teacher-stats">
                        <div className="admin-teacher-stat"><span className="admin-stat-val">{t.courseCount}</span><span className="admin-stat-lbl">课程</span></div>
                        <div className="admin-teacher-stat"><span className="admin-stat-val">{t.classCount}</span><span className="admin-stat-lbl">班级</span></div>
                        <div className="admin-teacher-stat"><span className="admin-stat-val">{t.taskCount}</span><span className="admin-stat-lbl">任务</span></div>
                        <div className="admin-teacher-stat"><span className="admin-stat-val">{t.submissionCount}</span><span className="admin-stat-lbl">提交</span></div>
                        <div className="admin-teacher-stat"><span className="admin-stat-val">{t.gradingRate}%</span><span className="admin-stat-lbl">评分率</span></div>
                        <div className="admin-teacher-stat"><span className="admin-stat-val">{t.coverageRate}</span><span className="admin-stat-lbl">覆盖学生</span></div>
                      </div>
                    </div>
                  ))}
                  {(collegeDetail.teacherRanking || []).length === 0 && (
                    <div className="admin-empty">暂无教师数据</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="admin-empty">加载失败</div>
          )}
        </div>
      )}

      {/* L3 班级详情 */}
      {level === "class" && (
        <div className="admin-level-class">
          {detailLoading ? (
            <div className="admin-detail-loading"><div className="admin-dash-spinner" /><div>加载班级详情…</div></div>
          ) : classDetail ? (
            <>
              <div className="admin-section-row">
                <div className="admin-chart-card admin-flex-1">
                  <h3 className="admin-section-title">成绩分布</h3>
                  <div className="admin-chart-with-legend">
                    <ScoreDonut dist={classDetail.scoreDist} centerLabel="总人数" centerValue={classDetail.studentCount} />
                    <div className="admin-legend-list">
                      {DIST_LABELS.map((label, i) => {
                        const v = classDetail.scoreDist?.[label] || 0;
                        const pct = classDetail.studentCount > 0 ? Math.round(v / classDetail.studentCount * 100) : 0;
                        return (
                          <div key={label} className="admin-legend-row">
                            <span className="admin-legend-dot" style={{ background: DIST_COLORS[i] }} />
                            <span className="admin-legend-label">{label}</span>
                            <span className="admin-legend-count">{v}人</span>
                            <span className="admin-legend-pct">({pct}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="admin-chart-card admin-flex-2">
                  <h3 className="admin-section-title">成绩趋势</h3>
                  <TrendLineChart trends={classDetail.trends} />
                </div>
              </div>

              <div className="admin-sub-section">
                <h3 className="admin-section-title">学生成绩排行榜</h3>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>排名</th><th>姓名</th><th>学号</th><th>最佳成绩</th><th>平均成绩</th>
                        <th>评级</th><th>提交任务</th><th>完成率</th><th>风险等级</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(classDetail.studentRanking || []).map((s) => {
                        const medals = ["🥇", "🥈", "🥉"];
                        return (
                          <tr key={s.studentId}>
                            <td><span className="admin-rank-num">{medals[s.rank - 1] || s.rank}</span></td>
                            <td className="admin-cell-name">{s.name}</td>
                            <td className="admin-cell-num">{s.studentNumber || "--"}</td>
                            <td><b style={{ color: s.bestScore >= 85 ? "#10b981" : s.bestScore >= 60 ? "#2F6BFF" : "#ef4444" }}>{s.bestScore}</b></td>
                            <td>{s.avgScore || "--"}</td>
                            <td><GradeBadge label={s.gradeLabel} /></td>
                            <td>{s.submittedTasks}/{s.totalTasks}</td>
                            <td>
                              <div className="admin-progress-mini">
                                <div className="admin-progress-bar" style={{ width: `${Math.min(s.completionRate, 100)}%`, background: s.completionRate >= 80 ? "#10b981" : s.completionRate >= 50 ? "#f59e0b" : "#ef4444" }} />
                                <span>{s.completionRate}%</span>
                              </div>
                            </td>
                            <td><RiskTag level={s.riskLevel} /></td>
                          </tr>
                        );
                      })}
                      {(classDetail.studentRanking || []).length === 0 && (
                        <tr><td colSpan="9" className="admin-empty">暂无学生数据</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="admin-empty">加载失败</div>
          )}
        </div>
      )}
    </div>
  );
}

function CollegeRadarChart({ ranking }) {
  const top5 = (ranking || []).slice(0, 5);
  const option = {
    tooltip: { trigger: "item", backgroundColor: "rgba(15,23,42,0.9)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 } },
    radar: {
      indicator: [
        { name: "平均分", max: 100 },
        { name: "完成率", max: 100 },
        { name: "任务覆盖", max: 100 },
        { name: "低风险率", max: 100 },
      ],
      axisName: { color: "#475569", fontSize: 11 },
      splitLine: { lineStyle: { color: "#e2e8f0" } },
      splitArea: { areaStyle: { color: ["#f8fafc", "#fff"] } },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
    },
    series: [{
      type: "radar",
      data: top5.map((c, i) => ({
        value: [c.avgScore, c.completionRate, Math.min(c.taskCount * 20, 100), 100 - c.highRiskRate],
        name: c.college,
        itemStyle: { color: DIST_COLORS[i % 5] },
        areaStyle: { opacity: 0.1 },
        lineStyle: { width: 2 },
      })),
    }],
    legend: { bottom: 0, textStyle: { fontSize: 11, color: "#64748b" } },
  };
  return <ReactECharts option={option} style={{ height: 320 }} />;
}
