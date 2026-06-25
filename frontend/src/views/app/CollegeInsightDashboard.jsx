import { useState, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts";
import { getCollegeProfile } from "../../services/appService";

const DONUT_COLORS = ["#4F7CFF", "#7B61FF", "#36D1DC", "#F5A623", "#22C55E"];

function CollegeDonutChart({ abilities = [], overallScore = 0, gradeLabel = "", gradeDesc = "" }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const size = 220;
  const cx = size / 2, cy = size / 2;
  const outerR = 92, innerR = 60;
  const total = abilities.reduce((s, a) => s + a.value, 0) || 1;

  const segments = abilities.map((a, i) => {
    const angle = (a.value / total) * 360;
    const startAngle = abilities.slice(0, i).reduce((sum, prev) => sum + (prev.value / total) * 360, 0) - 90;
    const endAngle = startAngle + angle;
    const largeArc = angle > 180 ? 1 : 0;
    const midRad = ((startAngle + angle / 2) * Math.PI) / 180;
    const offset = hoveredIndex === i ? 6 : 0;
    const ox = offset * Math.cos(midRad);
    const oy = offset * Math.sin(midRad);
    const rad1 = (startAngle * Math.PI) / 180;
    const rad2 = (endAngle * Math.PI) / 180;
    const x1o = cx + ox + outerR * Math.cos(rad1);
    const y1o = cy + oy + outerR * Math.sin(rad1);
    const x2o = cx + ox + outerR * Math.cos(rad2);
    const y2o = cy + oy + outerR * Math.sin(rad2);
    const x1i = cx + ox + innerR * Math.cos(rad2);
    const y1i = cy + oy + innerR * Math.sin(rad2);
    const x2i = cx + ox + innerR * Math.cos(rad1);
    const y2i = cy + oy + innerR * Math.sin(rad1);
    const d = `M ${x1o} ${y1o} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2i} ${y2i} Z`;
    return { d, color: DONUT_COLORS[i % DONUT_COLORS.length], ...a };
  });

  return (
    <div className="cid-donut-section">
      <div className="cid-donut-wrap">
        <div className="cid-donut-chart">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {segments.map((seg, i) => (
              <path
                key={i}
                d={seg.d}
                fill={seg.color}
                opacity={hoveredIndex === null || hoveredIndex === i ? 0.9 : 0.35}
                style={{ transition: "all 0.25s ease", cursor: "pointer" }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            ))}
            <circle cx={cx} cy={cy} r={innerR - 2} fill="#fff" />
            <text x={cx} y={cy - 8} textAnchor="middle" fontSize="28" fontWeight="bold" fill="#1d2736">
              {overallScore > 0 ? overallScore.toFixed(1) : "--"}
            </text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize="13" fill="#728096">
              {gradeLabel ? `${gradeLabel} · ${gradeDesc}` : "综合评分"}
            </text>
          </svg>
        </div>
        <div className="cid-donut-legend">
          {abilities.map((a, i) => (
            <div className="cid-legend-item" key={a.name}>
              <span className="cid-legend-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              <span className="cid-legend-name">{a.name}</span>
              <span className="cid-legend-value">{a.rate}分</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScoreDistChart({ data }) {
  const option = {
    tooltip: { trigger: "axis", formatter: (p) => `${p[0].name}分<br/>人数：${p[0].value} 人` },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: "category",
      data: (data || []).map((d) => d.range),
      axisLabel: { fontSize: 12, color: "#728096" },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { fontSize: 11, color: "#94a3b8" },
      splitLine: { lineStyle: { color: "#f1f5f9" } },
    },
    series: [{
      type: "bar",
      data: (data || []).map((d) => ({
        value: d.count,
        itemStyle: {
          color: d.range === "90-100" ? "#22c55e"
            : d.range === "80-89" ? "#4F7CFF"
            : d.range === "70-79" ? "#7B61FF"
            : d.range === "60-69" ? "#F5A623"
            : "#EF4444",
          borderRadius: [6, 6, 0, 0],
        },
      })),
      barWidth: "50%",
      label: { show: true, position: "top", fontSize: 12, color: "#64748b", fontWeight: 600 },
    }],
  };
  return <ReactECharts option={option} style={{ height: 240 }} />;
}

function ClassCompareChart({ data }) {
  const sorted = [...(data || [])].sort((a, b) => a.avgScore - b.avgScore);
  const colors = ["#4F7CFF", "#7B61FF", "#36D1DC", "#F5A623", "#22C55E", "#EF4444", "#ec4899", "#06b6d4"];
  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const item = sorted.find((s) => s.className === params[0].name);
        return `${params[0].name}<br/>均分：${params[0].value}分<br/>学生：${item?.studentCount || 0}人<br/>提交：${item?.submissionCount || 0}次`;
      },
    },
    grid: { left: 100, right: 50, top: 10, bottom: 20 },
    xAxis: {
      type: "value",
      min: 50, max: 100,
      axisLabel: { fontSize: 11, color: "#94a3b8" },
      splitLine: { lineStyle: { color: "#f1f5f9" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((d) => d.className),
      axisLabel: { fontSize: 13, fontWeight: 500, color: "#334155" },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [{
      type: "bar",
      data: sorted.map((d, i) => ({
        value: d.avgScore,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: colors[i % colors.length] + "88" },
            { offset: 1, color: colors[i % colors.length] },
          ]),
          borderRadius: [0, 8, 8, 0],
        },
      })),
      barWidth: "55%",
      label: {
        show: true,
        position: "right",
        fontSize: 13,
        fontWeight: 600,
        color: "#475569",
        formatter: "{c}分",
      },
    }],
  };
  return <ReactECharts option={option} style={{ height: Math.max(240, sorted.length * 42) }} />;
}

function TrendChart({ data }) {
  const option = {
    tooltip: { trigger: "axis" },
    legend: { data: ["平均分数", "提交次数"], top: 0, textStyle: { fontSize: 12, color: "#64748b" } },
    grid: { left: 50, right: 55, top: 40, bottom: 30 },
    xAxis: {
      type: "category",
      data: (data || []).map((d) => d.month),
      axisLabel: { fontSize: 12, color: "#728096" },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: [
      {
        type: "value",
        name: "分数",
        min: 50, max: 100,
        nameTextStyle: { fontSize: 11, color: "#94a3b8" },
        axisLabel: { fontSize: 11, color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
      },
      {
        type: "value",
        name: "提交",
        nameTextStyle: { fontSize: 11, color: "#94a3b8" },
        axisLabel: { fontSize: 11, color: "#94a3b8" },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "平均分数",
        type: "line",
        smooth: true,
        data: (data || []).map((d) => d.avgScore),
        lineStyle: { width: 3, color: "#4F7CFF" },
        itemStyle: { color: "#4F7CFF" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(79,124,255,0.25)" },
            { offset: 1, color: "rgba(79,124,255,0.02)" },
          ]),
        },
        symbol: "circle",
        symbolSize: 8,
      },
      {
        name: "提交次数",
        type: "bar",
        yAxisIndex: 1,
        data: (data || []).map((d) => d.submissions),
        itemStyle: { color: "rgba(123,97,255,0.2)", borderRadius: [4, 4, 0, 0] },
        barWidth: "30%",
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 280 }} />;
}

function RiskPieChart({ riskStats }) {
  const option = {
    tooltip: { trigger: "item", formatter: "{b}: {c}人 ({d}%)" },
    series: [{
      type: "pie",
      radius: ["55%", "80%"],
      center: ["50%", "50%"],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 3 },
      label: { show: true, formatter: "{b}\n{c}人", fontSize: 11, color: "#64748b" },
      labelLine: { length: 10, length2: 8 },
      data: (riskStats || []).map((r) => ({
        name: r.level,
        value: r.count,
        itemStyle: { color: r.color },
      })),
    }],
  };
  return <ReactECharts option={option} style={{ height: 220 }} />;
}

function MetricCard({ icon, label, value, unit, sub, color }) {
  return (
    <div className="cid-metric-card">
      <div className="cid-metric-icon" style={{ background: color + "15", color }}>{icon}</div>
      <div className="cid-metric-body">
        <div className="cid-metric-label">{label}</div>
        <div className="cid-metric-value-row">
          <span className="cid-metric-value">{value}</span>
          <span className="cid-metric-unit">{unit}</span>
        </div>
        {sub && <div className="cid-metric-sub">{sub}</div>}
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children, action }) {
  return (
    <div className="cid-panel">
      <div className="cid-panel-header">
        <div>
          <h3 className="cid-panel-title">{title}</h3>
          {subtitle && <span className="cid-panel-sub">{subtitle}</span>}
        </div>
        {action}
      </div>
      <div className="cid-panel-body">{children}</div>
    </div>
  );
}

export default function CollegeInsightDashboard({ collegeName, onClose, collegeList }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedCollege, setSelectedCollege] = useState(collegeName);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!selectedCollege) return;
    setLoading(true);
    setError("");
    getCollegeProfile(selectedCollege)
      .then(setData)
      .catch((err) => setError(err.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [selectedCollege]);

  const handleCollegeSwitch = (name) => {
    setSelectedCollege(name);
    setActiveTab("overview");
  };

  const tabs = [
    { key: "overview", label: "总览" },
    { key: "academics", label: "学业分析" },
    { key: "risk", label: "风险预警" },
    { key: "suggestions", label: "AI建议" },
  ];

  return (
    <div className="cid-overlay" onClick={onClose}>
      <div className="cid-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cid-modal-header">
          <div className="cid-header-left">
            <button className="cid-back-btn" onClick={onClose}>
              <span>‹</span> 返回
            </button>
            <div className="cid-header-divider" />
            <div className="cid-college-selector">
              {collegeList && collegeList.length > 1 ? (
                <select
                  className="cid-college-select"
                  value={selectedCollege || ""}
                  onChange={(e) => handleCollegeSwitch(e.target.value)}
                >
                  {collegeList.map((c) => (
                    <option key={c.name || c} value={c.name || c}>{c.name || c}</option>
                  ))}
                </select>
              ) : (
                <h2 className="cid-college-name">{data?.college || selectedCollege || "学院整体画像"}</h2>
              )}
              {data && (
                <span className="cid-grade-badge" style={{
                  background: data.overallScore >= 80 ? "#dcfce7" : data.overallScore >= 70 ? "#dbeafe" : data.overallScore >= 60 ? "#fef3c7" : "#fee2e2",
                  color: data.overallScore >= 80 ? "#166534" : data.overallScore >= 70 ? "#1e40af" : data.overallScore >= 60 ? "#92400e" : "#991b1b",
                }}>
                  {data.gradeLabel} · {data.gradeDesc}
                </span>
              )}
            </div>
          </div>
          <div className="cid-header-right">
            <span className="cid-update-time">
              {data?.updatedAt ? `数据更新：${data.updatedAt}` : ""}
            </span>
            <button className="cid-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {loading && (
          <div className="cid-loading">
            <div className="cid-loading-spinner" />
            <span>正在加载学院画像数据...</span>
          </div>
        )}

        {error && !loading && (
          <div className="cid-error">
            <span>⚠️</span>
            <p>{error}</p>
            <button onClick={() => handleCollegeSwitch(selectedCollege)}>重试</button>
          </div>
        )}

        {data && !loading && !error && (
          <div className="cid-modal-body">
            <div className="cid-tabs">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  className={`cid-tab ${activeTab === t.key ? "cid-tab-active" : ""}`}
                  onClick={() => setActiveTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === "overview" && (
              <div className="cid-tab-content">
                <div className="cid-metrics-grid">
                  <MetricCard icon="👨‍🎓" label="在校学生" value={data.overview.totalStudents} unit="人" sub={`${data.overview.totalClasses}个班级`} color="#4F7CFF" />
                  <MetricCard icon="👨‍🏫" label="任课教师" value={data.overview.totalTeachers} unit="人" sub={`生师比 ${Math.round(data.overview.totalStudents / Math.max(data.overview.totalTeachers, 1))}:1`} color="#7B61FF" />
                  <MetricCard icon="📚" label="开设课程" value={data.overview.totalCourses} unit="门" sub="本学期" color="#36D1DC" />
                  <MetricCard icon="📝" label="累计提交" value={data.overview.totalSubmissions} unit="次" sub="作业/实验报告" color="#F5A623" />
                  <MetricCard icon="📊" label="整体均分" value={data.overview.avgScore} unit="分" sub={data.gradeDesc} color="#22C55E" />
                  <MetricCard icon="⚠️" label="风险预警" value={data.riskStats.find(r => r.level === "高风险")?.count || 0} unit="人" sub={`占比${data.riskPercent}%`} color="#EF4444" />
                </div>

                <div className="cid-charts-row cid-charts-row-2col">
                  <Panel title="能力结构分布" subtitle="学院学生五大维度能力画像">
                    <CollegeDonutChart
                      abilities={data.abilities}
                      overallScore={data.overallScore}
                      gradeLabel={data.gradeLabel}
                      gradeDesc={data.gradeDesc}
                    />
                  </Panel>
                  <Panel title="成绩分布" subtitle="各分数段学生人数统计">
                    <ScoreDistChart data={data.scoreDistribution} />
                  </Panel>
                </div>

                <Panel title="近6个月学业趋势" subtitle="均分变化与提交量对比">
                  <TrendChart data={data.trendData} />
                </Panel>
              </div>
            )}

            {activeTab === "academics" && (
              <div className="cid-tab-content">
                <div className="cid-charts-row cid-charts-row-2col">
                  <Panel title="班级均分对比" subtitle={`共${data.classComparison.length}个教学班级`}>
                    <ClassCompareChart data={data.classComparison} />
                  </Panel>
                  <Panel title="成绩分布" subtitle="各分数段学生人数">
                    <ScoreDistChart data={data.scoreDistribution} />
                  </Panel>
                </div>
                <Panel title="班级详细数据" subtitle="各班级学业表现一览">
                  <div className="cid-class-table-wrap">
                    <table className="cid-class-table">
                      <thead>
                        <tr>
                          <th>班级名称</th>
                          <th>学生人数</th>
                          <th>提交次数</th>
                          <th>平均分数</th>
                          <th>等级</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...data.classComparison].sort((a, b) => b.avgScore - a.avgScore).map((cls, i) => {
                          const grade = cls.avgScore >= 80 ? { label: "优秀", color: "#16a34a", bg: "#dcfce7" }
                            : cls.avgScore >= 70 ? { label: "良好", color: "#2563eb", bg: "#dbeafe" }
                            : cls.avgScore >= 60 ? { label: "及格", color: "#d97706", bg: "#fef3c7" }
                            : { label: "待提升", color: "#dc2626", bg: "#fee2e2" };
                          return (
                            <tr key={cls.className}>
                              <td>
                                <span className="cid-class-rank">{i + 1}</span>
                                <span className="cid-class-name">{cls.className}</span>
                              </td>
                              <td>{cls.studentCount}人</td>
                              <td>{cls.submissionCount}次</td>
                              <td className="cid-class-score">{cls.avgScore}分</td>
                              <td>
                                <span className="cid-class-grade" style={{ background: grade.bg, color: grade.color }}>{grade.label}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>
            )}

            {activeTab === "risk" && (
              <div className="cid-tab-content">
                <div className="cid-charts-row cid-charts-row-2col">
                  <Panel title="风险等级分布" subtitle="按提交风险等级统计人数">
                    <RiskPieChart riskStats={data.riskStats} />
                  </Panel>
                  <Panel title="风险概览" subtitle="">
                    <div className="cid-risk-overview">
                      <div className="cid-risk-meter-wrap">
                        <div className="cid-risk-meter-label">整体风险等级</div>
                        <div className={`cid-risk-level-badge cid-risk-${data.overallRisk}`}>
                          {data.overallRisk === "低" ? "🟢" : data.overallRisk === "中" ? "🟡" : "🔴"} {data.overallRisk}风险
                        </div>
                        <div className="cid-risk-bar-outer">
                          <div className="cid-risk-bar-inner" style={{
                            width: `${data.riskPercent}%`,
                            background: data.overallRisk === "低"
                              ? "linear-gradient(90deg,#22c55e,#4ade80)"
                              : data.overallRisk === "中"
                              ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
                              : "linear-gradient(90deg,#ef4444,#f87171)",
                          }} />
                        </div>
                        <div className="cid-risk-bar-labels">
                          <span>安全</span><span>注意</span><span>危险</span>
                        </div>
                        <div className="cid-risk-desc">
                          {data.overallRisk === "低"
                            ? "学院整体风险水平较低，教学秩序稳定，建议继续保持关注。"
                            : data.overallRisk === "中"
                            ? "存在一定比例的风险学生，建议班主任加强关注，及时干预。"
                            : "高风险学生比例较高，建议启动预警机制，开展专项帮扶。"}
                        </div>
                      </div>
                    </div>
                  </Panel>
                </div>

                <Panel title="高风险学生名单" subtitle={`共${data.highRiskStudents.length}名学生需重点关注`} action={
                  <button className="cid-export-btn">导出名单</button>
                }>
                  <div className="cid-risk-student-list">
                    {data.highRiskStudents.map((s, i) => (
                      <div className="cid-risk-student-card" key={s.id || i}>
                        <div className="cid-risk-student-rank">{i + 1}</div>
                        <div className="cid-risk-student-avatar">{s.name?.[0] || "?"}</div>
                        <div className="cid-risk-student-info">
                          <div className="cid-risk-student-name">{s.name}</div>
                          <div className="cid-risk-student-meta">{s.studentId} · {s.className}</div>
                        </div>
                        <div className="cid-risk-student-score">
                          <div className="cid-risk-score-value">{s.avgScore}</div>
                          <div className="cid-risk-score-label">均分</div>
                        </div>
                        <div className="cid-risk-student-subs">
                          <div className="cid-risk-subs-value">{s.submissionCount}</div>
                          <div className="cid-risk-subs-label">提交</div>
                        </div>
                        <button className="cid-risk-action-btn">查看详情</button>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            )}

            {activeTab === "suggestions" && (
              <div className="cid-tab-content">
                <Panel title="AI智能建议" subtitle="基于学院整体数据生成的教学改进建议">
                  <div className="cid-suggestions-list">
                    {data.suggestions.map((s, i) => (
                      <div className="cid-suggestion-card" key={i}>
                        <div className="cid-suggestion-icon">{s.icon}</div>
                        <div className="cid-suggestion-body">
                          <p className="cid-suggestion-text">{s.text}</p>
                        </div>
                        <span className="cid-suggestion-tag" style={{
                          background: s.tag === "预警" ? "#fef2f2" : s.tag === "建议" ? "#eff6ff" : s.tag === "拓展" ? "#f5f3ff" : s.tag === "提升" ? "#fffbeb" : "#f0fdf4",
                          color: s.tag === "预警" ? "#991b1b" : s.tag === "建议" ? "#1e40af" : s.tag === "拓展" ? "#6d28d9" : s.tag === "提升" ? "#92400e" : "#166534",
                        }}>{s.tag}</span>
                      </div>
                    ))}
                  </div>
                </Panel>

                <div className="cid-charts-row cid-charts-row-2col">
                  <Panel title="能力维度得分率" subtitle="各维度百分制得分">
                    <div className="cid-ability-bars">
                      {data.abilities.map((a, i) => (
                        <div className="cid-ability-row" key={a.name}>
                          <div className="cid-ability-label">{a.name}</div>
                          <div className="cid-ability-track">
                            <div
                              className="cid-ability-fill"
                              style={{
                                width: `${a.rate}%`,
                                background: `linear-gradient(90deg, ${DONUT_COLORS[i % DONUT_COLORS.length]}, ${DONUT_COLORS[i % DONUT_COLORS.length]}cc)`,
                              }}
                            />
                          </div>
                          <div className="cid-ability-score">{a.rate}%</div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel title="关键洞察" subtitle="数据驱动的决策参考">
                    <div className="cid-insights-list">
                      <div className="cid-insight-item">
                        <span className="cid-insight-dot" style={{ background: "#22c55e" }} />
                        <span>实践能力为学院最强维度（{data.abilities[0]?.rate || 0}分），项目驱动教学成效显著</span>
                      </div>
                      <div className="cid-insight-item">
                        <span className="cid-insight-dot" style={{ background: "#4F7CFF" }} />
                        <span>{data.classComparison[0]?.className}班表现最优，建议总结其教学经验全院推广</span>
                      </div>
                      <div className="cid-insight-item">
                        <span className="cid-insight-dot" style={{ background: "#F5A623" }} />
                        <span>近6个月均分持续上升，教学质量改进措施初见成效</span>
                      </div>
                      <div className="cid-insight-item">
                        <span className="cid-insight-dot" style={{ background: "#EF4444" }} />
                        <span>低年级（24级）均分相对偏低，建议加强入学适应引导和基础辅导</span>
                      </div>
                      <div className="cid-insight-item">
                        <span className="cid-insight-dot" style={{ background: "#7B61FF" }} />
                        <span>80-89分数段学生最多（{data.scoreDistribution.find(d=>d.range==="80-89")?.count || 0}人），具备冲击优秀的潜力</span>
                      </div>
                    </div>
                  </Panel>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
