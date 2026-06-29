import { MODEL_NAME, PLATFORM_NAME } from "../config/brand";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { roleLabels, roleNavigation, workspaceLabels } from "../config/navigation";
import { useAuth } from "../state/AuthContext";

const navIcons = {
  "/dashboard": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
  ),
  "/courses": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
  ),
  "/tasks": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
  ),
  "/reports": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
  ),
  "/metrics": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
  ),
  "/users": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  ),
  "/models": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
  ),
  "/submissions": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  ),
  "/scores": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  ),
  "/upload": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
  ),
  "/checks": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  ),
  "/logs": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
  ),
};

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [aiOpen, setAiOpen] = useState(false);

  const currentNav = useMemo(() => roleNavigation[user.role] || [], [user.role]);
  const title = useMemo(() => {
    const item = currentNav.find((entry) => location.pathname.startsWith(entry.path));
    return item?.label || workspaceLabels[user.role];
  }, [currentNav, location.pathname, user.role]);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const isDashboard = location.pathname.startsWith("/dashboard");

  return (
    <div className={`app-shell-new role-${user.role}`}>
      <aside className="app-sidebar-new">
        <div className="sidebar-gradient-bg" />
        <div className="sidebar-content">
          <div className="sidebar-brand">
            <div className="brand-logo-new">
              <div className="brand-logo-inner">尚</div>
            </div>
            <div className="brand-text">
              <h1>{PLATFORM_NAME}</h1>
              <p>{workspaceLabels[user.role]}</p>
            </div>
          </div>

          <div className="sidebar-user-card">
            <div className="user-avatar-ring">
              <div className="user-avatar">{user.name.slice(0, 1)}</div>
            </div>
            <div className="user-info">
              <div className="user-name">{user.name}</div>
              <div className="user-role">{roleLabels[user.role]}</div>
              <div className="user-org">{user.organization}</div>
            </div>
          </div>

          <nav className="sidebar-nav">
            {currentNav.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.path}
                  className={`sidebar-nav-item ${isActive ? "nav-active" : ""}`}
                  to={item.path}
                >
                  <span className="nav-icon">{navIcons[item.path]}</span>
                  <span className="nav-label">{item.label}</span>
                  {isActive && <span className="nav-indicator" />}
                </NavLink>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <button className="ai-entry-btn" onClick={() => setAiOpen(!aiOpen)}>
              <div className="ai-btn-glow" />
              <span className="ai-btn-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v1H7a2 2 0 0 0-2 2v1a5 5 0 0 0 5 5h1v3a2 2 0 0 0 2 2 2 2 0 0 0 2-2v-3h1a5 5 0 0 0 5-5V8a2 2 0 0 0-2-2h-2V5a3 3 0 0 0-3-3z"/>
                  <circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>
                </svg>
              </span>
              <span className="ai-btn-text">{MODEL_NAME}</span>
              <span className="ai-badge">AI</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main-new">
        <header className="app-topbar-new">
          <div className="topbar-left">
            <div className="topbar-eyebrow">{PLATFORM_NAME}</div>
            <h2 className="topbar-title">{title}</h2>
          </div>
          <div className="topbar-right">
            {isDashboard ? (
              <>
                <button className="btn-create-task">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  创建任务
                </button>
                <div className="semester-select">
                  <span>2024-2025学年 第二学期</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <div className="notif-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  <span className="notif-badge">12</span>
                </div>
                <div className="header-avatar">{user.name?.slice(0, 1)}</div>
              </>
            ) : (
              <>
                <button className="topbar-btn-logout" onClick={handleLogout}>退出登录</button>
                <div className="topbar-avatar">{user.name.slice(0, 1)}</div>
              </>
            )}
          </div>
        </header>
        <main className={`app-content-new ${isDashboard ? "app-content-dash" : "app-content-page"}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
