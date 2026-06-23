import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";

const quickMenu = [
  { label: "班级活动" },
  { label: "课件" },
  { label: "教案" },
  { label: "章节" },
  { label: "资料" },
  { label: "通知" },
  { label: "讨论" }
];

export default function ReviewPortalShell({ active, title, actions, children }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="review-portal-shell">
      <aside className="review-portal-sidebar">
        <button className="review-course-card" type="button" onClick={() => navigate("/tasks")}>
          <div className="review-course-cover">
            <span>课程门户</span>
            <small>链接</small>
          </div>
          <strong>{user.organization}</strong>
          <span>{user.name}</span>
        </button>

        <nav className="review-portal-nav">
          {quickMenu.map((item) => (
            <button className="review-nav-item muted" type="button" key={item.label}>
              <span className="review-nav-icon">{item.label.slice(0, 1)}</span>
              <span>{item.label}</span>
            </button>
          ))}

          <NavLink className={({ isActive }) => `review-nav-item ${active === "assignment" || isActive ? "active" : ""}`} to="/assignment-review">
            <span className="review-nav-icon">作</span>
            <span>作业</span>
          </NavLink>
          <NavLink className={({ isActive }) => `review-nav-item ${active === "exam" || isActive ? "active" : ""}`} to="/exam-review">
            <span className="review-nav-icon">考</span>
            <span>考试</span>
          </NavLink>
          <button className="review-nav-item muted" type="button">
            <span className="review-nav-icon">题</span>
            <span>题库</span>
          </button>
        </nav>
      </aside>

      <div className="review-portal-main">
        <header className="review-portal-topbar">
          <div className="review-portal-topbar-inner">
            <h1>{title}</h1>
            <div className="review-portal-actions">{actions}</div>
          </div>
        </header>
        <main className="review-portal-content">{children}</main>
      </div>
    </div>
  );
}
