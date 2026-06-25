import { useState } from "react";
import { downloadFile } from "../../api/client";
import { useAsyncData } from "../../hooks/useAsyncData";
import { exportReport, getReportSummary, getStudentProfile } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import { useAuth } from "../../state/AuthContext";

const PIE_COLORS = ["#4A90D9", "#9B7EDE", "#4ECDC4", "#F5A623"];

function SimpleBarChart({ data = [] }) {
  const safeMax = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="chart-bars">
      {data.map((item) => (
        <div className="chart-column" key={item.label}>
          <span className="chart-value">{item.value}</span>
          <div className="chart-track">
            <div className="chart-fill" style={{ height: `${Math.max((item.value / safeMax) * 100, 8)}%` }} />
          </div>
          <span className="chart-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* 能力结构饼图（纯CSS+SVG实现，不依赖ECharts） */
function AbilityPie({ abilities = [], gradeLabel = "", gradeDesc = "" }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const total = abilities.reduce((s, a) => s + a.value, 0) || 1;
  const radius = 70;
  const cx = 80, cy = 80;

  // 维度说明
  const dimensionDescriptions = {
    "实践能力": "代码与参考文档的相似度，反映编程规范性和标准匹配度",
    "理论掌握": "代码正确性评分，反映语法准确性和逻辑正确性",
    "项目完成度": "功能点覆盖程度，反映作业完整性和需求满足度",
    "出勤与参与": "完成任务数占总任务数的比例，反映学习积极性"
  };

  const segments = abilities.map((a, i) => {
    const angle = (a.value / total) * 360;
    const startAngle = abilities.slice(0, i).reduce((sum, prev) => sum + (prev.value / total) * 360, 0) - 90;
    const endAngle = startAngle + angle;
    const largeArc = angle > 180 ? 1 : 0;
    
    // 计算扇区中心点
    const midRad = ((startAngle + angle / 2) * Math.PI) / 180;
    const midX = cx + (radius / 2) * Math.cos(midRad);
    const midY = cy + (radius / 2) * Math.sin(midRad);
    
    // 悬停时向外偏移
    const offset = hoveredIndex === i ? 8 : 0;
    const offsetX = offset * Math.cos(midRad);
    const offsetY = offset * Math.sin(midRad);
    
    const rad1 = (startAngle * Math.PI) / 180;
    const rad2 = (endAngle * Math.PI) / 180;
    const x1 = cx + offsetX + radius * Math.cos(rad1);
    const y1 = cy + offsetY + radius * Math.sin(rad1);
    const x2 = cx + offsetX + radius * Math.cos(rad2);
    const y2 = cy + offsetY + radius * Math.sin(rad2);
    const path = `M ${cx + offsetX} ${cy + offsetY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    
    return { 
      d: path, 
      color: PIE_COLORS[i % PIE_COLORS.length], 
      ...a,
      description: dimensionDescriptions[a.name] || "",
      midX,
      midY,
      offsetX,
      offsetY
    };
  });

  return (
    <div className="profile-pie-wrap">
      <svg width="200" height="200" viewBox="0 0 160 160" className="profile-pie-svg">
        {segments.map((seg, i) => (
          <path 
            key={i} 
            d={seg.d} 
            fill={seg.color} 
            opacity={hoveredIndex === null || hoveredIndex === i ? 0.9 : 0.4}
            style={{ 
              transition: "all 0.2s ease",
              cursor: "pointer",
              filter: hoveredIndex === i ? "brightness(1.1)" : "none",
              pointerEvents: "all"
            }}
            onMouseEnter={(e) => {
              e.stopPropagation();
              setHoveredIndex(i);
            }}
            onMouseLeave={(e) => {
              e.stopPropagation();
              setHoveredIndex(null);
            }}
          />
        ))}
        {/* 中心文字 */}
        <circle cx={cx} cy={cy} r="38" fill="#fff" />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="bold" fill="#333">{gradeLabel}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="#999">{gradeDesc}</text>
      </svg>
      
      {/* 悬停提示框 */}
      {hoveredIndex !== null && segments[hoveredIndex] && (
        <div className="pie-tooltip">
          <div className="pie-tooltip-header">
            <span className="pie-tooltip-dot" style={{ background: segments[hoveredIndex].color }} />
            <span className="pie-tooltip-name">{segments[hoveredIndex].name}</span>
            <span className="pie-tooltip-value">{segments[hoveredIndex].value}%</span>
          </div>
          <div className="pie-tooltip-desc">{segments[hoveredIndex].description}</div>
          <div className="pie-tooltip-rate">得分率：{segments[hoveredIndex].rate}%</div>
        </div>
      )}
      
      <div className="profile-legend">
        {abilities.map((a, i) => (
          <div 
            className="legend-item" 
            key={a.name}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{ cursor: "pointer" }}
          >
            <span className="legend-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="legend-name">{a.name}</span>
            <span className="legend-value">{a.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* 学生画像标签 */
function ProfileTags({ tags = {} }) {
  const tagConfig = [
    { key: "learnType", icon: "🎓", label: "学习类型", color: "#e8f0fe" },
    { key: "strength", icon: "⭐", label: "优势能力", color: "#e6f4ea" },
    { key: "weakness", icon: "⚠️", label: "薄弱环节", color: "#fef7e0" },
    { key: "trend", icon: "📈", label: "成长趋势", color: "#f3e8ff" },
    { key: "recommend", icon: "🎯", label: "推荐方向", color: "#e8f4fd" },
  ];

  return (
    <div className="profile-tags">
      {tagConfig.map((t) => (
        <div className="tag-card" key={t.key} style={{ background: t.color }}>
          <span className="tag-icon">{t.icon}</span>
          <div className="tag-body">
            <span className="tag-label">{t.label}</span>
            <span className="tag-value">{tags[t.key] || "--"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* 学习建议卡片 */
function SuggestionCard({ item }) {
  const typeIcons = { theory: "📘", practice: "🛠️", risk: "⚠️", career: "🎯" };
  return (
    <div className="suggest-card">
      <div className="suggest-header">
        <span className="suggest-icon">{typeIcons[item.type] || "💡"}</span>
        <span className="suggest-title">{item.title}</span>
      </div>
      <p className="suggest-summary">{item.summary}</p>
      <button className="suggest-action ghost-button" type="button">{item.action} →</button>
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const { data, loading, error } = useAsyncData(getReportSummary, []);
  const isStudent = user?.role === "student";
  const { data: profile, loading: profileLoading } = useAsyncData(getStudentProfile, [], isStudent);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState("");

  async function handleExport(format) {
    setExporting(format);
    setMessage("");
    try {
      const result = await exportReport(format);
      await downloadFile(`/reports/download/${result.filename}`, result.filename);
      setMessage(`已生成 ${format.toUpperCase()} 报表：${result.filename}`);
    } catch (err) {
      setMessage(err.message || "导出失败");
    } finally {
      setExporting("");
    }
  }

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel
          title="报表中心"
          description="统计实训评价结果，支持 Excel / PDF 导出与可视化图表。"
          actions={
            <div className="toolbar">
              <button className="primary-button" type="button" disabled={exporting === "excel"} onClick={() => handleExport("excel")}>
                {exporting === "excel" ? "生成中..." : "导出 Excel"}
              </button>
              <button className="ghost-button" type="button" disabled={exporting === "pdf"} onClick={() => handleExport("pdf")}>
                {exporting === "pdf" ? "生成中..." : "导出 PDF"}
              </button>
            </div>
          }
        >
          <div className="stats-grid">
            <div className="data-card"><span className="eyebrow">累计提交</span><strong>{data?.totalSubmissions ?? 0}</strong></div>
            <div className="data-card"><span className="eyebrow">平均分</span><strong>{data?.averageScore ?? "--"}</strong></div>
          </div>
        </Panel>

        <div className="split-layout">
          <Panel title="成绩分布" description="按分数段统计提交数量。">
            <SimpleBarChart data={data?.distribution || []} />
          </Panel>
          <Panel title="风险分布" description="核查风险等级占比。">
            <SimpleBarChart data={data?.riskStats || []} />
          </Panel>
        </div>

        {/* ===== 学生画像分析（仅学生端显示） ===== */}
        {user?.role === "student" && (
          <>
            <Panel title="学生画像分析" description="基于实训数据的AI智能分析。" badge="AI 智能分析">
              {profileLoading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
                  <div>正在生成学生画像...</div>
                </div>
              ) : profile && profile.totalSubmissions > 0 ? (
                <>
                  <div className="profile-layout">
                    <div className="profile-left">
                      <h4 className="profile-section-title">能力结构分布</h4>
                      <AbilityPie
                        abilities={profile.abilities}
                        gradeLabel={profile.gradeLabel}
                        gradeDesc={profile.gradeDesc}
                      />
                    </div>
                    <div className="profile-right">
                      <h4 className="profile-section-title">学生画像标签</h4>
                      <ProfileTags tags={profile.tags} />
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}></div>
                  <div>暂无画像数据</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>请先提交实训作业，系统将自动生成您的学习画像</div>
                </div>
              )}
            </Panel>

            {profile && profile.totalSubmissions > 0 && (
              <Panel
                title="学习建议"
                description={`基于当前数据，给出个性化提升建议。综合评级：${profile.gradeLabel || "--"}（${profile.gradeDesc || "--"}），共 ${profile.totalSubmissions ?? 0} 次提交。`}
                actions={
                  <button className="ghost-button" type="button" onClick={() => window.location.reload()}>
                     生成学习提升方案
                  </button>
                }
              >
                {profileLoading ? (
                  <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)" }}>
                    正在生成学习建议...
                  </div>
                ) : (
                  <div className="suggest-grid">
                    {(profile.suggestions || []).map((item, i) => (
                      <SuggestionCard key={i} item={item} />
                    ))}
                  </div>
                )}
              </Panel>
            )}
          </>
        )}

        <Panel title="最近导出记录" description="含快照编号，便于答辩演示追溯。">
          <Table
            columns={["类型", "格式", "文件名", "时间", "操作"]}
            rows={data?.recentExports || []}
            renderRow={(row) => (
              <tr key={row.id}>
                <td>{row.type}</td>
                <td>{row.format}</td>
                <td>{row.filename}</td>
                <td>{row.createdAt?.slice(0, 19).replace("T", " ")}</td>
                <td>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => downloadFile(`/reports/download/${row.filename}`, row.filename)}
                  >
                    下载
                  </button>
                </td>
              </tr>
            )}
          />
        </Panel>

        {message ? <div className="success-text">{message}</div> : null}
      </div>
    </LoadState>
  );
}
