import { MODEL_NAME, PLATFORM_NAME } from "../config/brand";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { roleLabels, roleNavigation, workspaceLabels } from "../config/navigation";
import { useAuth } from "../state/AuthContext";

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const currentNav = useMemo(() => roleNavigation[user.role] || [], [user.role]);
  const title = useMemo(() => {
    const item = currentNav.find((entry) => location.pathname.startsWith(entry.path));
    return item?.label || workspaceLabels[user.role];
  }, [currentNav, location.pathname, user.role]);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className={`workspace-shell role-${user.role}`}>
      <aside className="workspace-sidebar">
        <div className="brand-block compact">
          <div className="brand-mark">尚</div>
          <div>
            <h1>{PLATFORM_NAME}</h1>
            <p>{workspaceLabels[user.role]}</p>
          </div>
        </div>

        <div className="identity-card workspace-identity">
          <div className="workspace-identity-head">
            <div className="workspace-identity-avatar">{user.name.slice(0, 1)}</div>
            <div className="workspace-identity-copy">
              <strong>{user.name}</strong>
              <span>{roleLabels[user.role]}</span>
            </div>
          </div>
          <div className="workspace-identity-meta">
            <label>所属组织</label>
            <span>{user.organization}</span>
          </div>
        </div>

        <nav className="workspace-nav">
          {currentNav.map((item) => (
            <NavLink key={item.path} className={({ isActive }) => `nav-button ${isActive ? "active" : ""}`} to={item.path}>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="workspace-side-footer">
          <div className="status-chip status-info">{MODEL_NAME}</div>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar-inner">
            <div>
              <p className="eyebrow">{PLATFORM_NAME}</p>
              <h2>{title}</h2>
            </div>

            <div className="workspace-top-actions">
              <button className="primary-button" type="button" onClick={handleLogout}>退出登录</button>
              <div className="avatar-pill">{user.name.slice(0, 1)}</div>
            </div>
          </div>
        </header>

        <main className="workspace-content">
          <div className="workspace-content-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
