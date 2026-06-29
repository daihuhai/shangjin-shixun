import { useState } from "react";
import { downloadFile, formatTime } from "../../api/client";
import { useAsyncData } from "../../hooks/useAsyncData";
import { exportReport, getReportSummary, getStudentProfile, getLearningPlan, exportLearningPlanPdf } from "../../services/appService";
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

/* 学习提升方案弹窗：8 大模块完整展示（学生端 / 管理员端共用，根据角色渲染不同模块） */
export function LearningPlanModal({ open, loading, plan, onClose, onDownload, downloading, role = "student" }) {
  if (!open) return null;
  const b = plan?.baseInfo || {};
  const c = plan?.currentAnalysis || {};
  const s = plan?.skillPortrait || {};
  const ta = plan?.teachingAnalysis || {};
  const tp = plan?.teachingPortrait || {};
  const g = plan?.goals || {};
  const a = plan?.actionPlan || {};
  const rc = plan?.riskControl || {};
  const ev = plan?.evaluation || {};
  const ai = plan?.aiSuggestions || {};
  const weeks = a.weeks || [];

  // 报告标题根据角色判断：教师 → 教师教学报告，学生 → 学生学习报告
  const isTeacher = role === "teacher";
  const reportTitle = isTeacher ? "📊 教师教学报告" : "📊 学生学习报告";
  const reportSubtitle = isTeacher
    ? "基于实训数据与 AI 分析生成的教师教学报告"
    : "基于实训数据与 AI 分析生成的学生学习报告";
  const loadingText = isTeacher ? "正在生成教师教学报告..." : "正在生成学习提升方案...";
  const loadingHint = isTeacher
    ? "AI 正在分析教学数据并生成个性化教学报告"
    : "AI 正在分析您的学习数据并生成个性化方案";

  return (
    <div className="lp-modal-overlay" onClick={onClose}>
      <div className="lp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lp-modal-header">
          <div>
            <h2 className="lp-modal-title">{reportTitle}</h2>
            <p className="lp-modal-subtitle">{reportSubtitle}</p>
          </div>
          <div className="lp-header-actions">
            <button
              className="lp-download-btn"
              type="button"
              disabled={loading || !plan || downloading}
              onClick={onDownload}
            >
              {downloading ? "生成中..." : "⬇ 下载 PDF"}
            </button>
            <button className="lp-close-btn" onClick={onClose} type="button">×</button>
          </div>
        </div>

        {loading ? (
          <div className="lp-loading">
            <div className="lp-loading-icon">⏳</div>
            <div>{loadingText}</div>
            <div className="lp-loading-hint">{loadingHint}</div>
          </div>
        ) : plan ? (
          <div className="lp-content">
            {isTeacher ? (
              <>
                {/* ===== 教师教学报告 8 大模块 ===== */}
                {/* 一、教师基础信息 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">1</span> 教师基础信息</h3>
                  <div className="lp-info-grid">
                    <div className="lp-info-item"><span className="lp-info-label">教师姓名</span><span className="lp-info-value">{b.teacherName || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">工号</span><span className="lp-info-value">{b.teacherId || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">学院</span><span className="lp-info-value">{b.college || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">教学阶段</span><span className="lp-info-value">{b.teachingStage || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">创建课程</span><span className="lp-info-value">{b.courseCount ?? 0} 门</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">创建任务</span><span className="lp-info-value">{b.taskCount ?? 0} 个</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">覆盖学生</span><span className="lp-info-value">{b.studentCount ?? 0} 人</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">教学评级</span><span className="lp-info-value lp-grade">{b.gradeLabel}（{b.gradeDesc}）</span></div>
                  </div>
                </section>

                {/* 二、教学现状分析 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">2</span> 教学现状分析</h3>
                  <div className="lp-sub-title">教学能力分析</div>
                  <div className="lp-skill-bars">
                    <SkillBar label="任务设计力" value={ta.taskDesign} />
                    <SkillBar label="评分效率" value={ta.gradingEfficiency} />
                    <SkillBar label="学生覆盖度" value={ta.studentCoverage} />
                    <SkillBar label="反馈深度" value={ta.feedbackDepth} />
                  </div>
                  <div className="lp-sub-title">教学数据统计</div>
                  <div className="lp-info-grid">
                    <div className="lp-info-item"><span className="lp-info-label">学生提交总数</span><span className="lp-info-value">{ta.totalSubmissions ?? 0} 份</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">已评分数</span><span className="lp-info-value">{ta.scoredCount ?? 0} 份</span></div>
                  </div>
                  <div className="lp-sub-title">当前主要问题</div>
                  <ul className="lp-list">
                    {(ta.mainIssues || []).map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                  <div className="lp-risk-box">
                    <span className="lp-risk-label">风险判断：</span>
                    <span className={`lp-risk-tag lp-risk-${ta.riskLevel}`}>{ta.riskLevel}风险</span>
                    <span className="lp-risk-reason">{ta.riskReason}</span>
                  </div>
                </section>

                {/* 三、教学能力画像 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">3</span> 教学能力画像</h3>
                  <div className="lp-ability-grid">
                    {(tp.dimensions || []).map((d, i) => (
                      <div className="lp-ability-item" key={i}>
                        <div className="lp-ability-name">{d.name}</div>
                        <div className="lp-ability-pct">{d.percent}%</div>
                        <div className="lp-ability-rate">得分率 {d.rate}%</div>
                      </div>
                    ))}
                  </div>
                  <div className="lp-ability-summary">
                    <span>综合评级：<strong>{tp.gradeLabel}</strong></span>
                    <span>教学类型：{tp.teachingType}</span>
                    <span>优势：{tp.strength}</span>
                    <span>薄弱：{tp.weakness}</span>
                    <span>趋势：{tp.trend}</span>
                  </div>
                </section>

                {/* 四、教学改进目标 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">4</span> 教学改进目标</h3>
                  <div className="lp-goal-row">
                    <div className="lp-goal-block">
                      <div className="lp-goal-label">📅 短期目标（1-2 周）</div>
                      <ul className="lp-list">{(g.short || []).map((x, i) => <li key={i}>• {x}</li>)}</ul>
                    </div>
                    <div className="lp-goal-block">
                      <div className="lp-goal-label">📆 中期目标（1-2 月）</div>
                      <ul className="lp-list">{(g.mid || []).map((x, i) => <li key={i}>• {x}</li>)}</ul>
                    </div>
                  </div>
                  <div className="lp-goal-long">
                    <span className="lp-goal-label">🎯 长期目标（学期/阶段）</span>
                    <span className="lp-goal-long-text">{g.long || "--"}</span>
                  </div>
                </section>

                {/* 五、教学改进计划 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">5</span> 教学改进计划</h3>
                  <div className="lp-weeks">
                    {weeks.map((w, i) => (
                      <div className="lp-week-card" key={i}>
                        <div className="lp-week-header">Week {w.week}</div>
                        <div className="lp-week-row"><span className="lp-week-key">教学内容优化</span><span>{w.content}</span></div>
                        <div className="lp-week-row"><span className="lp-week-key">任务设计改进</span><span>{w.task}</span></div>
                        <div className="lp-week-row"><span className="lp-week-key">评价方式调整</span><span>{w.submit}</span></div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 六、教学风险提醒 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">6</span> 教学风险提醒</h3>
                  <div className="lp-sub-title">当前风险点</div>
                  <ul className="lp-list">{(rc.riskPoints || []).map((p, i) => <li key={i}>⚠️ {p}</li>)}</ul>
                  <div className="lp-sub-title">建议干预措施</div>
                  <ul className="lp-list">{(rc.interventions || []).map((p, i) => <li key={i}>✅ {p}</li>)}</ul>
                </section>

                {/* 七、教学质量评估机制 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">7</span> 教学质量评估机制</h3>
                  <div className="lp-eval-grid">
                    <div className="lp-eval-item"><span className="lp-eval-label">评估周期</span><span>{ev.cycle || "--"}</span></div>
                    <div className="lp-eval-item"><span className="lp-eval-label">评估指标</span><span>{(ev.metrics || []).join("、") || "--"}</span></div>
                    <div className="lp-eval-item"><span className="lp-eval-label">达标标准</span><span>{ev.standard || "--"}</span></div>
                  </div>
                </section>

                {/* 八、AI 教学建议 */}
                <section className="lp-section lp-ai-section">
                  <h3 className="lp-section-title"><span className="lp-badge lp-badge-ai">8</span> AI 教学建议</h3>
                  <div className="lp-ai-grid">
                    <div className="lp-ai-item"><span className="lp-ai-key">教学发展方向</span><span className="lp-ai-val">{ai.direction || "--"}</span></div>
                    <div className="lp-ai-item"><span className="lp-ai-key">教学提升路径</span><span className="lp-ai-val">{ai.path || "--"}</span></div>
                    <div className="lp-ai-item"><span className="lp-ai-key">适合教学方向</span><span className="lp-ai-val">{(ai.positions || []).join("、") || "--"}</span></div>
                  </div>
                  <div className="lp-sub-title">个性化教学建议</div>
                  <ul className="lp-list lp-ai-tips">{(ai.tips || []).map((t, i) => <li key={i}>💡 {t}</li>)}</ul>
                </section>
              </>
            ) : (
              <>
                {/* ===== 学生学习报告 8 大模块 ===== */}
                {/* 一、基础信息 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">1</span> 基础信息</h3>
                  <div className="lp-info-grid">
                    <div className="lp-info-item"><span className="lp-info-label">学生姓名</span><span className="lp-info-value">{b.studentName || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">学号</span><span className="lp-info-value">{b.studentId || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">学院</span><span className="lp-info-value">{b.college || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">班级</span><span className="lp-info-value">{b.className || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">当前阶段</span><span className="lp-info-value">{b.stage || "--"}</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">综合评分</span><span className="lp-info-value lp-score">{b.avgScore ?? "--"} 分</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">综合评级</span><span className="lp-info-value lp-grade">{b.gradeLabel}（{b.gradeDesc}）</span></div>
                    <div className="lp-info-item"><span className="lp-info-label">风险等级</span><span className={`lp-info-value lp-risk lp-risk-${c.riskLevel}`}>{c.riskLevel || "--"}</span></div>
                  </div>
                </section>

                {/* 二、现状诊断 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">2</span> 现状诊断</h3>
                  <div className="lp-sub-title">学习能力分析</div>
                  <div className="lp-skill-bars">
                    <SkillBar label="理论掌握" value={c.theory} />
                    <SkillBar label="实践能力" value={c.practice} />
                    <SkillBar label="项目完成度" value={c.project} />
                    <SkillBar label="学习主动性" value={c.attendance} />
                  </div>
                  <div className="lp-sub-title">当前主要问题</div>
                  <ul className="lp-list">
                    {(c.mainProblems || []).map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                  <div className="lp-risk-box">
                    <span className="lp-risk-label">风险判断：</span>
                    <span className={`lp-risk-tag lp-risk-${c.riskLevel}`}>{c.riskLevel}风险</span>
                    <span className="lp-risk-reason">{c.riskReason}</span>
                  </div>
                </section>

                {/* 三、能力结构画像 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">3</span> 能力结构画像</h3>
                  <div className="lp-ability-grid">
                    {(s.dimensions || []).map((d, i) => (
                      <div className="lp-ability-item" key={i}>
                        <div className="lp-ability-name">{d.name}</div>
                        <div className="lp-ability-pct">{d.percent}%</div>
                        <div className="lp-ability-rate">得分率 {d.rate}%</div>
                      </div>
                    ))}
                  </div>
                  <div className="lp-ability-summary">
                    <span>综合评级：<strong>{s.gradeLabel}</strong></span>
                    <span>学习类型：{s.learnType}</span>
                    <span>优势：{s.strength}</span>
                    <span>薄弱：{s.weakness}</span>
                    <span>趋势：{s.trend}</span>
                  </div>
                </section>

                {/* 四、学习目标设定 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">4</span> 学习目标设定</h3>
                  <div className="lp-goal-row">
                    <div className="lp-goal-block">
                      <div className="lp-goal-label">📅 短期目标（1-2 周）</div>
                      <ul className="lp-list">{(g.short || []).map((x, i) => <li key={i}>• {x}</li>)}</ul>
                    </div>
                    <div className="lp-goal-block">
                      <div className="lp-goal-label">📆 中期目标（1-2 月）</div>
                      <ul className="lp-list">{(g.mid || []).map((x, i) => <li key={i}>• {x}</li>)}</ul>
                    </div>
                  </div>
                  <div className="lp-goal-long">
                    <span className="lp-goal-label">🎯 长期目标（学期/阶段）</span>
                    <span className="lp-goal-long-text">{g.long || "--"}</span>
                  </div>
                </section>

                {/* 五、具体执行计划 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">5</span> 具体执行计划</h3>
                  <div className="lp-weeks">
                    {weeks.map((w, i) => (
                      <div className="lp-week-card" key={i}>
                        <div className="lp-week-header">Week {w.week}</div>
                        <div className="lp-week-row"><span className="lp-week-key">学习内容</span><span>{w.content}</span></div>
                        <div className="lp-week-row"><span className="lp-week-key">实践任务</span><span>{w.task}</span></div>
                        <div className="lp-week-row"><span className="lp-week-key">提交要求</span><span>{w.submit}</span></div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 六、风险提醒 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">6</span> 风险提醒</h3>
                  <div className="lp-sub-title">当前风险点</div>
                  <ul className="lp-list">{(rc.riskPoints || []).map((p, i) => <li key={i}>⚠️ {p}</li>)}</ul>
                  <div className="lp-sub-title">建议干预措施</div>
                  <ul className="lp-list">{(rc.interventions || []).map((p, i) => <li key={i}>✅ {p}</li>)}</ul>
                </section>

                {/* 七、阶段评估机制 */}
                <section className="lp-section">
                  <h3 className="lp-section-title"><span className="lp-badge">7</span> 阶段评估机制</h3>
                  <div className="lp-eval-grid">
                    <div className="lp-eval-item"><span className="lp-eval-label">评估周期</span><span>{ev.cycle || "--"}</span></div>
                    <div className="lp-eval-item"><span className="lp-eval-label">评估指标</span><span>{(ev.metrics || []).join("、") || "--"}</span></div>
                    <div className="lp-eval-item"><span className="lp-eval-label">达标标准</span><span>{ev.standard || "--"}</span></div>
                  </div>
                </section>

                {/* 八、AI 个性化建议 */}
                <section className="lp-section lp-ai-section">
                  <h3 className="lp-section-title"><span className="lp-badge lp-badge-ai">8</span> AI 个性化建议</h3>
                  <div className="lp-ai-grid">
                    <div className="lp-ai-item"><span className="lp-ai-key">推荐方向</span><span className="lp-ai-val">{ai.direction || "--"}</span></div>
                    <div className="lp-ai-item"><span className="lp-ai-key">提升路径</span><span className="lp-ai-val">{ai.path || "--"}</span></div>
                    <div className="lp-ai-item"><span className="lp-ai-key">适合岗位</span><span className="lp-ai-val">{(ai.positions || []).join("、") || "--"}</span></div>
                  </div>
                  <div className="lp-sub-title">个性化建议</div>
                  <ul className="lp-list lp-ai-tips">{(ai.tips || []).map((t, i) => <li key={i}>💡 {t}</li>)}</ul>
                </section>
              </>
            )}
          </div>
        ) : (
          <div className="lp-empty">暂无方案数据</div>
        )}
      </div>
    </div>
  );
}

function SkillBar({ label, value }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  const color = pct >= 75 ? "#4ECDC4" : pct >= 60 ? "#F5A623" : "#FF6B6B";
  return (
    <div className="lp-skill-bar">
      <span className="lp-skill-name">{label}</span>
      <div className="lp-skill-track"><div className="lp-skill-fill" style={{ width: `${pct}%`, background: color }} /></div>
      <span className="lp-skill-val">{pct}%</span>
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
  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planDownloading, setPlanDownloading] = useState(false);

  async function handleGeneratePlan() {
    setPlanOpen(true);
    setPlanLoading(true);
    setPlan(null);
    try {
      const result = await getLearningPlan();
      setPlan(result);
    } catch (err) {
      setMessage(err.message || "生成学习方案失败");
      setPlanOpen(false);
    } finally {
      setPlanLoading(false);
    }
  }

  async function handleDownloadPlan() {
    setPlanDownloading(true);
    setMessage("");
    try {
      const result = await exportLearningPlanPdf();
      await downloadFile(`/reports/download/${result.filename}`, result.filename);
      setMessage(`已生成学习方案 PDF：${result.filename}`);
    } catch (err) {
      setMessage(err.message || "下载失败");
    } finally {
      setPlanDownloading(false);
    }
  }

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
                  <button className="ghost-button" type="button" onClick={handleGeneratePlan}>
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
                <td>{formatTime(row.createdAt)}</td>
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

      <LearningPlanModal
        open={planOpen}
        loading={planLoading}
        plan={plan}
        onClose={() => setPlanOpen(false)}
        onDownload={handleDownloadPlan}
        downloading={planDownloading}
      />
    </LoadState>
  );
}
