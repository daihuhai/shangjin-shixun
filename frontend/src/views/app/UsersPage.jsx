import { useState, useMemo, useEffect } from "react";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getUserAdminData, getUserProfile, createUser, getCollegeNames, getClassesByCollege, getUserLearningPlan, exportUserLearningPlanPdf } from "../../services/appService";
import { downloadFile } from "../../api/client";
import { LoadState } from "../../ui/LoadState";
import CollegeInsightDashboard from "./CollegeInsightDashboard";
import { LearningPlanModal } from "./ReportsPage";

/* ===== 颜色常量 ===== */
const DONUT_COLORS = ["#4F7CFF", "#7B61FF", "#36D1DC", "#F5A623", "#22C55E"];
const STATUS_MAP = {
  "正常": { color: "#22C55E", bg: "#f0fdf4", text: "#166534" },
  "风险": { color: "#F59E0B", bg: "#fffbeb", text: "#92400e" },
  "异常": { color: "#EF4444", bg: "#fef2f2", text: "#991b1b" },
};

/* ===== 左侧：纯组织树（学院 → 班级），不混入人员 ===== */
function CollegeTree({ tree, selectedNode, onSelect, onViewCollegeProfile }) {
  // 学院展开状态：undefined 或 true 视为展开
  const [expanded, setExpanded] = useState({});

  const toggleExpand = (name) => {
    setExpanded((prev) => {
      const isOpen = prev[name] !== false;
      return { ...prev, [name]: !isOpen };
    });
  };

  // 点击学院：选中该学院（联动中间列表）并切换展开
  const handleCollegeClick = (name) => {
    onSelect({ type: "college", name });
    toggleExpand(name);
  };

  // 点击班级：选中该班级（中间列表过滤为该班级用户）
  const handleClassClick = (className) => {
    onSelect({ type: "class", name: className });
  };

  const isCollegeActive = (name) => selectedNode?.type === "college" && selectedNode?.name === name;
  const isClassActive = (name) => selectedNode?.type === "class" && selectedNode?.name === name;

  const activeCollegeName = selectedNode?.type === "college" ? selectedNode.name : tree[0]?.name;

  return (
    <div className="um-college-panel">
      <div className="um-panel-header">
        <span className="um-panel-title">组织架构</span>
        <span className="um-panel-count">{tree.length} 个学院</span>
      </div>
      <div className="um-tree-list">
        {tree.map((college) => {
          const isExpanded = expanded[college.name] !== false;
          return (
            <div key={college.name}>
              {/* 一级：学院 */}
              <div
                className={`um-tree-item ${isCollegeActive(college.name) ? "um-tree-active" : ""}`}
                onClick={() => handleCollegeClick(college.name)}
                title="点击选中/展开"
              >
                <span className="um-tree-icon um-tree-toggle">{isExpanded ? "▾" : "▸"}</span>
                <span className="um-tree-name">{college.name}</span>
                <span className="um-tree-badge">{college.totalCount}</span>
              </div>
              {isExpanded && (
                <div className="um-tree-children">
                  <div className="um-tree-class-list">
                    {college.classes?.length > 0 ? (
                      college.classes.map((cls) => (
                        <div
                          key={cls.name}
                          className={`um-tree-class-item ${isClassActive(cls.name) ? "um-tree-class-active" : ""}`}
                          onClick={() => handleClassClick(cls.name)}
                          title="点击选中该班级"
                        >
                          <span className="um-tree-class-name">{cls.name}</span>
                          <span className="um-tree-child-count">{cls.studentCount}</span>
                        </div>
                      ))
                    ) : (
                      <div className="um-tree-student-empty">暂无班级</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="um-tree-footer" onClick={() => onViewCollegeProfile && onViewCollegeProfile(activeCollegeName)}>
        <span>📊</span>
        <span>查看学院整体画像</span>
        <span>›</span>
      </div>
    </div>
  );
}

/* ===== 中间：用户列表（受组织节点 + 角色双条件过滤）===== */
function UserList({ users, roleTab, onRoleChange, selectedNode, searchQuery, onSearch, onUserSelect, selectedUserId, onAddUser }) {
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    let list = users.filter((u) => u.roleKey === roleTab);
    // 组织维度过滤：学院节点按 college，班级节点按 className
    if (selectedNode) {
      if (selectedNode.type === "college") {
        list = list.filter((u) => u.college === selectedNode.name);
      } else if (selectedNode.type === "class") {
        list = list.filter((u) => u.className === selectedNode.name);
      }
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (u) => u.name.toLowerCase().includes(q) || u.studentId.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, roleTab, selectedNode, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageData = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [roleTab, selectedNode, searchQuery]);

  const tabs = [
    { key: "student", label: "学生" },
    { key: "teacher", label: "教师" },
    { key: "admin", label: "管理员" },
  ];

  return (
    <div className="um-user-panel">
      {/* Tab 切换 */}
      <div className="um-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`um-tab ${roleTab === t.key ? "um-tab-active" : ""}`}
            onClick={() => onRoleChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 搜索 + 筛选 + 添加按钮 */}
      <div className="um-toolbar">
        <div className="um-search-box">
          <span className="um-search-icon">🔍</span>
          <input
            type="text"
            placeholder="请输入姓名 / 学号"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            className="um-search-input"
          />
        </div>
        <div className="um-filters">
          <select className="um-filter-select">
            <option>全部年级</option>
            <option>2022级</option>
            <option>2023级</option>
            <option>2024级</option>
          </select>
          <select className="um-filter-select">
            <option>全部状态</option>
            <option>正常</option>
            <option>风险</option>
            <option>异常</option>
          </select>
        </div>
        <button className="um-add-btn" onClick={onAddUser}>+ 添加用户</button>
      </div>

      {/* 表格 */}
      <div className="um-table-wrap">
        <table className="um-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>学号/工号</th>
              <th>专业班级</th>
              <th>年级</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((u) => {
              const st = STATUS_MAP[u.status] || STATUS_MAP["正常"];
              const initial = u.name ? u.name[0] : "?";
              return (
                <tr
                  key={u.id}
                  className={`um-table-row ${selectedUserId === u.id ? "um-table-row-active" : ""}`}
                  onClick={() => onUserSelect(u)}
                >
                  <td>
                    <div className="um-user-cell">
                      <div className="um-avatar" style={{ background: `linear-gradient(135deg, #4F7CFF, #7B61FF)` }}>
                        {initial}
                      </div>
                      <span className="um-user-name">{u.name}</span>
                    </div>
                  </td>
                  <td>{u.studentId}</td>
                  <td>{u.className || u.organization}</td>
                  <td>{u.grade || "--"}</td>
                  <td>
                    <span className="um-status-tag" style={{ background: st.bg, color: st.text, borderColor: st.color + "33" }}>
                      {u.status}
                    </span>
                  </td>
                  <td>
                    <button className="um-view-btn" onClick={(e) => { e.stopPropagation(); onUserSelect(u); }}>
                      查看
                    </button>
                  </td>
                </tr>
              );
            })}
            {pageData.length === 0 && (
              <tr>
                <td colSpan={6} className="um-empty-cell">暂无数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页器 */}
      <div className="um-pagination">
        <span className="um-page-info">共 {filtered.length} 条</span>
        <select className="um-page-size">
          <option>10条/页</option>
          <option>20条/页</option>
          <option>50条/页</option>
        </select>
        <div className="um-page-btns">
          <button className="um-page-btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let p;
            if (totalPages <= 7) p = i + 1;
            else if (safePage <= 4) p = i + 1;
            else if (safePage >= totalPages - 3) p = totalPages - 6 + i;
            else p = safePage - 3 + i;
            return (
              <button
                key={p}
                className={`um-page-btn ${safePage === p ? "um-page-btn-active" : ""}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            );
          })}
          {totalPages > 7 && <span className="um-page-ellipsis">...</span>}
          <button className="um-page-btn" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>›</button>
        </div>
      </div>
    </div>
  );
}

/* ===== 右侧：用户画像面板 ===== */
function UserProfilePanel({ profile, loading, onClose, onReportClick }) {
  const [activeTab, setActiveTab] = useState("basic");
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  if (!profile && !loading) {
    return (
      <div className="um-profile-panel">
        <div className="um-profile-empty">
          <div className="um-profile-empty-icon">👤</div>
          <div className="um-profile-empty-text">点击用户查看详情</div>
          <div className="um-profile-empty-sub">选择左侧列表中的用户，查看其学习画像</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="um-profile-panel">
        <div className="um-skeleton-avatar" />
        <div className="um-skeleton-line" style={{ width: "60%" }} />
        <div className="um-skeleton-line" style={{ width: "40%" }} />
        <div className="um-skeleton-chart" />
        <div className="um-skeleton-grid">
          <div className="um-skeleton-card" />
          <div className="um-skeleton-card" />
          <div className="um-skeleton-card" />
          <div className="um-skeleton-card" />
        </div>
      </div>
    );
  }

  const { user, abilities, overallScore, gradeLabel, gradeDesc, metrics, riskLevel, riskPercent, riskDesc, suggestions } = profile;
  const isTeacher = user?.role === "教师";
  // 从能力维度提取真实得分率
  const simRate = abilities?.find(a => a.name === "实践能力")?.rate ?? 0;
  const corRate = abilities?.find(a => a.name === "理论掌握")?.rate ?? 0;
  const visibleSuggestions = showAllSuggestions ? (suggestions || []) : (suggestions || []).slice(0, 3);
  const hasMore = (suggestions || []).length > 3;
  const tabs = [
    { key: "basic", label: "基础信息" },
    { key: "behavior", label: "行为分析" },
    { key: "ai", label: "AI建议" },
  ];

  return (
    <div className="um-profile-panel">
      {/* 关闭按钮 */}
      <button className="um-profile-close" onClick={onClose}>✕</button>

      {/* 顶部用户信息卡 */}
      <div className="um-profile-header">
        <div className="um-profile-avatar" style={{ background: "linear-gradient(135deg, #4F7CFF, #7B61FF)" }}>
          {user?.name?.[0] || "?"}
        </div>
        <div className="um-profile-info">
          <div className="um-profile-name-row">
            <span className="um-profile-name">{user?.name || ""}</span>
            <span className="um-profile-status" style={{ background: STATUS_MAP[user?.status]?.bg || "#f0fdf4", color: STATUS_MAP[user?.status]?.text || "#166534" }}>
              {user?.status || "正常"}
            </span>
          </div>
          <div className="um-profile-id">学号：{user?.studentId || ""}</div>
          <div className="um-profile-org">{user?.college || ""} · {user?.organization?.split(" ")?.[1] || ""}</div>
          <div className="um-profile-date">入学时间：{user?.createdAt?.slice(0, 10) || "--"}</div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="um-profile-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`um-profile-tab ${activeTab === t.key ? "um-profile-tab-active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 能力结构环形图 */}
      <div className="um-donut-section">
        <h4 className="um-section-title">能力结构分布</h4>
        <div className="um-donut-wrap">
          <DonutChart abilities={abilities} overallScore={overallScore} gradeLabel={gradeLabel} gradeDesc={gradeDesc} />
          <div className="um-donut-legend">
            {abilities.map((a, i) => (
              <div className="um-legend-item" key={a.name}>
                <span className="um-legend-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <span className="um-legend-name">{a.name}</span>
                <span className="um-legend-value">{a.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 关键指标 */}
      <div className="um-metrics-section">
        <h4 className="um-section-title">关键指标</h4>
        <div className="um-metrics-grid">
          {isTeacher ? (
            <>
              <MetricCard label="创建课程" value={metrics?.courseCount ?? 0} unit="门" sub={`综合评级 ${gradeLabel || "--"}`} />
              <MetricCard label="创建任务" value={metrics?.taskCount ?? 0} unit="个" sub={`覆盖 ${metrics?.studentCount ?? 0} 名学生`} />
              <MetricCard label="学生提交" value={metrics?.submissionCount ?? 0} unit="份" sub={`已评分 ${Math.round((metrics?.submissionCount ?? 0) * (metrics?.scoreRate ?? 0) / 100)} 份`} />
              <MetricCard label="评分率" value={metrics?.scoreRate ?? 0} unit="%" sub={`反馈率 ${metrics?.feedbackRate ?? 0}%`} />
              <MetricCard label="高风险提交" value={metrics?.highRiskCount ?? 0} unit="份" sub={`待复核 ${metrics?.pendingReview ?? 0} 份`} />
              <MetricCard label="平均成绩" value={metrics?.avgScore ?? 0} unit="分" sub="学生整体表现" />
            </>
          ) : (
            <>
              <MetricCard label="平均成绩" value={metrics?.avgScore ?? 0} unit="分" sub={`综合评级 ${gradeLabel || "--"}`} />
              <MetricCard label="累计提交" value={metrics?.submissionCount ?? 0} unit="次" sub={`已完成 ${metrics?.completedTasks ?? 0} 个任务`} />
              <MetricCard label="项目完成" value={metrics?.completedTasks ?? 0} unit="个" sub={`完成率 ${(metrics?.totalTasks ?? 0) > 0 ? Math.min(100, Math.round((metrics?.completedTasks ?? 0) / metrics.totalTasks * 100)) : 0}%`} />
              <MetricCard label="出勤率" value={metrics?.attendanceRate ?? 0} unit="%" sub={`课程共 ${metrics?.totalTasks ?? 0} 个任务`} />
              <MetricCard label="实践能力" value={simRate} unit="%" sub="代码规范性得分率" />
              <MetricCard label="理论掌握" value={corRate} unit="%" sub="逻辑正确性得分率" />
            </>
          )}
        </div>
      </div>

      {/* 风险评估 */}
      <div className="um-risk-section">
        <div className="um-risk-header">
          <h4 className="um-section-title" style={{ marginBottom: 0 }}>{isTeacher ? "教学风险评估" : "学习风险评估"}</h4>
          <span className="um-risk-badge" style={{
            background: riskLevel === "低" ? "#f0fdf4" : riskLevel === "中" ? "#fffbeb" : "#fef2f2",
            color: riskLevel === "低" ? "#166534" : riskLevel === "中" ? "#92400e" : "#991b1b",
          }}>
            {riskLevel === "低" ? "🟢" : riskLevel === "中" ? "🟡" : "🔴"} {riskLevel}风险
          </span>
        </div>
        <div className="um-risk-bar-wrap">
          <div className="um-risk-bar">
            <div className="um-risk-bar-fill" style={{ width: `${riskPercent}%` }} />
          </div>
          <div className="um-risk-labels">
            <span>低风险</span>
            <span>中风险</span>
            <span>高风险</span>
          </div>
        </div>
        <p className="um-risk-desc">{riskDesc}</p>
      </div>

      {/* 个性化建议 */}
      <div className="um-suggestions-section">
        <div className="um-suggestions-header">
          <h4 className="um-section-title" style={{ marginBottom: 0 }}>个性化建议</h4>
          {hasMore ? (
            <button
              type="button"
              className="um-suggestions-more"
              onClick={() => setShowAllSuggestions(!showAllSuggestions)}
            >
              {showAllSuggestions ? "收起建议 ›" : "更多建议 ›"}
            </button>
          ) : null}
        </div>
        <div className="um-suggestions-list">
          {visibleSuggestions?.map((s, i) => (
            <div className="um-suggestion-item" key={i}>
              <span className="um-suggestion-icon">{s.icon || "💡"}</span>
              <span className="um-suggestion-text">{s.text}</span>
              <span className="um-suggestion-tag" style={{
                background: s.tag === "提升" ? "#eff4ff" : s.tag === "建议" ? "#f0fdf4" : s.tag === "关注" ? "#fffbeb" : "#f5f3ff",
                color: s.tag === "提升" ? "#2f64ff" : s.tag === "建议" ? "#166534" : s.tag === "关注" ? "#92400e" : "#6d28d9",
              }}>
                {s.tag}
              </span>
            </div>
          ))}
          {(!suggestions || suggestions.length === 0) && (
            <div className="um-suggestion-item" style={{ color: "#999", justifyContent: "center" }}>暂无 AI 建议</div>
          )}
        </div>
      </div>

      {/* 底部按钮 */}
      <button type="button" className="um-profile-report-btn" onClick={onReportClick}>查看完整报告</button>
    </div>
  );
}

/* ===== 环形图组件 ===== */
function DonutChart({ abilities = [], overallScore = 0, gradeLabel = "", gradeDesc = "" }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const size = 180;
  const cx = size / 2, cy = size / 2;
  const outerR = 75, innerR = 48;
  const total = abilities.reduce((s, a) => s + a.value, 0) || 1;

  const segments = abilities.map((a, i) => {
    const angle = (a.value / total) * 360;
    const startAngle = abilities.slice(0, i).reduce((sum, prev) => sum + (prev.value / total) * 360, 0) - 90;
    const endAngle = startAngle + angle;
    const largeArc = angle > 180 ? 1 : 0;

    const midRad = ((startAngle + angle / 2) * Math.PI) / 180;
    const offset = hoveredIndex === i ? 5 : 0;
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
    <div className="um-donut-chart">
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
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#1d2736">
          {overallScore > 0 ? overallScore.toFixed(1) : "--"}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="12" fill="#728096">
          {gradeLabel ? `${gradeLabel} · ${gradeDesc}` : "综合评分"}
        </text>
      </svg>
    </div>
  );
}

/* ===== 指标卡片 ===== */
function MetricCard({ label, value, unit, sub }) {
  return (
    <div className="um-metric-card">
      <div className="um-metric-label">{label}</div>
      <div className="um-metric-value">
        {value}<span className="um-metric-unit">{unit}</span>
      </div>
      <div className="um-metric-sub">{sub}</div>
    </div>
  );
}

/* ===== 添加用户弹窗 ===== */
function AddUserModal({ onClose, onCreated }) {
  const [collegeNames, setCollegeNames] = useState([]);
  const [classOptions, setClassOptions] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "student",
    college: "",
    organization: "",
  });

  useEffect(() => {
    getCollegeNames()
      .then((res) => setCollegeNames(Array.isArray(res) ? res : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (form.role === "student" && form.college) {
      setLoadingClasses(true);
      setClassOptions([]);
      const college = form.college;
      getClassesByCollege(college)
        .then((res) => setClassOptions(Array.isArray(res) ? res : []))
        .catch(() => setClassOptions([]))
        .finally(() => setLoadingClasses(false));
    } else {
      setClassOptions([]);
    }
  }, [form.role, form.college]);

  function handleRoleChange(e) {
    const role = e.target.value;
    setForm((prev) => ({ ...prev, role, college: "", organization: "" }));
  }

  function handleCollegeChange(e) {
    const college = e.target.value;
    setForm((prev) => ({ ...prev, college, organization: "" }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (form.role === "student") {
      if (!form.college) { setError("请先选择所属学院"); return; }
      if (!form.organization) { setError("请选择所在班级"); return; }
    } else {
      if (!form.college) { setError(form.role === "teacher" ? "请选择所属学院" : "请选择所属部门/学院"); return; }
    }
    setSubmitting(true);
    try {
      await createUser({
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
        organization: form.role === "student" ? form.organization : form.college,
      });
      onCreated();
    } catch (err) {
      setError(err.message || "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  const isStudent = form.role === "student";

  return (
    <div className="um-modal-overlay" onClick={onClose}>
      <div className="um-modal" onClick={(e) => e.stopPropagation()}>
        <div className="um-modal-header">
          <h3>添加用户</h3>
          <button className="um-modal-close" onClick={onClose}>✕</button>
        </div>
        <form className="um-modal-form" onSubmit={handleSubmit}>
          <label className="um-modal-field">
            <span>姓名 *</span>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="请输入姓名" />
          </label>
          <label className="um-modal-field">
            <span>账号 *</span>
            <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="请输入登录账号" />
          </label>
          <label className="um-modal-field">
            <span>密码 *</span>
            <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="请输入初始密码" />
          </label>
          <label className="um-modal-field">
            <span>角色 *</span>
            <select value={form.role} onChange={handleRoleChange}>
              <option value="student">学生</option>
              <option value="teacher">教师</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <label className="um-modal-field">
            <span>{isStudent ? "所属学院 *" : form.role === "teacher" ? "所属学院 *" : "所属部门/学院 *"}</span>
            <select value={form.college} onChange={handleCollegeChange}>
              <option value="">-- 请选择 --</option>
              {collegeNames.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          {isStudent ? (
            <label className="um-modal-field">
              <span>所在班级 *</span>
              <select value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} disabled={!form.college || loadingClasses}>
                <option value="">{loadingClasses ? "加载中…" : (form.college ? "请选择班级" : "请先选择学院")}</option>
                {classOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          ) : null}
          {error ? <div className="um-modal-error">{error}</div> : null}
          <div className="um-modal-actions">
            <button className="um-modal-submit" type="submit" disabled={submitting}>
              {submitting ? "创建中..." : "确认添加"}
            </button>
            <button className="um-modal-cancel" type="button" onClick={onClose}>取消</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===== 主页面 ===== */
export default function UsersPage() {
  const { data, loading, error, reload } = useAsyncData(getUserAdminData, []);
  const [selectedNode, setSelectedNode] = useState(null);
  const [roleTab, setRoleTab] = useState("student");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [dashboardCollege, setDashboardCollege] = useState(null);
  // 学习提升方案弹窗（管理员为指定学生生成）
  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planDownloading, setPlanDownloading] = useState(false);
  const [planMessage, setPlanMessage] = useState("");

  // 默认选中第一个学院
  useEffect(() => {
    if (data?.organizationTree?.length > 0 && !selectedNode) {
      setSelectedNode({ type: "college", name: data.organizationTree[0].name });
    }
  }, [data]);

  // 点击用户时加载画像
  const handleUserSelect = async (user) => {
    setSelectedUser(user);
    setProfileData(null);
    setProfileLoading(true);
    try {
      const result = await getUserProfile(user.id);
      setProfileData(result);
    } catch {
      setProfileData(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleViewCollegeProfile = (collegeName) => {
    setDashboardCollege(collegeName);
  };

  // 查看完整报告：调管理员接口为该学生生成学习提升方案（复用 LearningPlanModal）
  async function handleViewReport() {
    if (!selectedUser) return;
    setPlanOpen(true);
    setPlanLoading(true);
    setPlan(null);
    setPlanMessage("");
    try {
      const result = await getUserLearningPlan(selectedUser.id);
      setPlan(result);
    } catch (err) {
      setPlanMessage(err.message || "生成学习方案失败");
      setPlanOpen(false);
    } finally {
      setPlanLoading(false);
    }
  }

  // 下载该学生的学习提升方案 PDF（复用缓存，不调 LLM）
  async function handleDownloadPlan() {
    if (!selectedUser) return;
    setPlanDownloading(true);
    setPlanMessage("");
    try {
      const result = await exportUserLearningPlanPdf(selectedUser.id);
      await downloadFile(`/reports/download/${result.filename}`, result.filename);
      setPlanMessage(`已生成 PDF：${result.filename}`);
    } catch (err) {
      setPlanMessage(err.message || "下载失败");
    } finally {
      setPlanDownloading(false);
    }
  }

  const allUsers = useMemo(() => {
    if (!data) return [];
    return [...(data.students || []), ...(data.teachers || []), ...(data.admins || [])];
  }, [data]);

  const stats = data?.stats || { totalStudents: 0, totalTeachers: 0, totalAdmins: 0 };

  return (
    <LoadState loading={loading} error={error}>
      <div className="um-layout">
        {/* 左侧：学院树 */}
        <div className="um-left-panel">
          <CollegeTree
            tree={data?.organizationTree || []}
            selectedNode={selectedNode}
            onSelect={setSelectedNode}
            onViewCollegeProfile={handleViewCollegeProfile}
          />
          {/* 数据统计卡片 */}
          <div className="um-stats-card">
            <div className="um-stats-title">数据统计</div>
            <div className="um-stats-subtitle">平台用户总览</div>
            <div className="um-stats-illustration">
              <span style={{ fontSize: 48 }}>📊</span>
            </div>
            <div className="um-stats-row">
              <div className="um-stat-item">
                <div className="um-stat-label">学生</div>
                <div className="um-stat-value">{stats.totalStudents}</div>
              </div>
              <div className="um-stat-item">
                <div className="um-stat-label">教师</div>
                <div className="um-stat-value">{stats.totalTeachers}</div>
              </div>
              <div className="um-stat-item">
                <div className="um-stat-label">管理员</div>
                <div className="um-stat-value">{stats.totalAdmins}</div>
              </div>
            </div>
            <div className="um-stats-date">数据截至：{new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        {/* 中间：用户列表 */}
        <div className="um-center-panel">
          <UserList
            users={allUsers}
            roleTab={roleTab}
            onRoleChange={setRoleTab}
            selectedNode={selectedNode}
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            onUserSelect={handleUserSelect}
            selectedUserId={selectedUser?.id}
            onAddUser={() => setShowAddUser(true)}
          />
        </div>

        {/* 右侧：用户画像 */}
        <div className="um-right-panel">
          <UserProfilePanel
            profile={profileData}
            loading={profileLoading}
            onClose={() => { setSelectedUser(null); setProfileData(null); }}
            onReportClick={handleViewReport}
          />
        </div>
      </div>
      {showAddUser ? (
        <AddUserModal
          onClose={() => setShowAddUser(false)}
          onCreated={() => {
            setShowAddUser(false);
            reload();
          }}
        />
      ) : null}
      {dashboardCollege ? (
        <CollegeInsightDashboard
          collegeName={dashboardCollege}
          collegeList={data?.organizationTree || []}
          onClose={() => setDashboardCollege(null)}
        />
      ) : null}
      <LearningPlanModal
        open={planOpen}
        loading={planLoading}
        plan={plan}
        onClose={() => setPlanOpen(false)}
        onDownload={handleDownloadPlan}
        downloading={planDownloading}
        role={selectedUser?.roleKey === "teacher" ? "teacher" : "student"}
      />
      {planMessage ? (
        <div className="um-plan-toast" style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "rgba(30,41,59,0.92)", color: "#fff", padding: "10px 20px",
          borderRadius: 8, fontSize: 13, zIndex: 9999, boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
        }}>{planMessage}</div>
      ) : null}
    </LoadState>
  );
}
