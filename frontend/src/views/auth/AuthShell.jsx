import { PLATFORM_NAME } from "../../config/brand";
import "./auth.css";

function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="3" fill="white" fillOpacity="0.95" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="#2563eb" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6.5A2.5 2.5 0 016.5 4H20v16H6.5A2.5 2.5 0 014 17.5v-11z" />
      <path d="M6.5 4A2.5 2.5 0 004 6.5V20" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19V5M4 19h16" strokeLinecap="round" />
      <path d="M8 15V11M12 15V8M16 15v-5" strokeLinecap="round" />
    </svg>
  );
}

function ShieldFeatureIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l7 3v6c0 4.418-3.134 7.5-7 9-3.866-1.5-7-4.582-7-9V6l7-3z" />
    </svg>
  );
}

function AuthVisual() {
  return (
    <div className="auth-hero-visual" aria-hidden="true">
      <div className="auth-hero-glow" />
      <div className="auth-hero-orbit" />
      <div className="auth-hero-platform" />
      <div className="auth-hero-user">
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="9" r="4" fill="white" />
          <path d="M6 20c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="auth-hero-chart">
        <div className="auth-hero-chart-bar a" />
        <div className="auth-hero-chart-bar b" />
        <div className="auth-hero-chart-bar c" />
      </div>
      <div className="auth-hero-arrow" />
    </div>
  );
}

const features = [
  { tone: "blue", Icon: BookIcon, title: "智能评估", desc: "多维度尚进大模型评分" },
  { tone: "green", Icon: ChartIcon, title: "数据分析", desc: "可视化学习报告" },
  { tone: "purple", Icon: ShieldFeatureIcon, title: "安全可靠", desc: "多重保障体系" },
];

const stats = [
  { value: "10W+", label: "注册用户" },
  { value: "500+", label: "合作院校" },
  { value: "1000W+", label: "实训数据" },
  { value: "98.6%", label: "用户满意度" },
];



export default function AuthShell({ children, footerExtra }) {
  return (
    <div className="auth-page">
      <div className="auth-page-grid-texture" aria-hidden="true" />
      <div className="auth-container">
        <header className="auth-container-head">
          <div className="auth-brand-mark">
            <div className="auth-logo"><LogoIcon /></div>
            <strong className="auth-brand-name">{PLATFORM_NAME}</strong>
            <span className="auth-brand-divider" aria-hidden="true" />
            <span className="auth-brand-slogan">智能实训 · 高效学习 · 成就未来</span>
          </div>
          <a className="auth-back-link" href="/">← 返回官网</a>
        </header>

        <div className="auth-container-body">
          <section className="auth-showcase">
            <div className="auth-showcase-intro">
              <span className="auth-tag">智能 · 高效 · 专业</span>
              <h1 className="auth-hero-title">{PLATFORM_NAME}</h1>
              <p className="auth-hero-subtitle">覆盖实训全流程，智能评估与数据分析，助力教学相长</p>
            </div>

            <div className="auth-features">
              {features.map(({ tone, Icon, title, desc }) => (
                <div className="auth-feature-card" key={title}>
                  <span className={`auth-feature-icon-box tone-${tone}`}><Icon /></span>
                  <div>
                    <strong>{title}</strong>
                    <span>{desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="auth-showcase-visual">
              <AuthVisual />
            </div>

            <div className="auth-stats-bar">
              {stats.map((item) => (
                <div className="auth-stat-item" key={item.label}>
                  <span className="auth-stat-value">{item.value}</span>
                  <span className="auth-stat-label">{item.label}</span>
                </div>
              ))}
            </div>
          </section>

          <aside className="auth-login-panel">
            <div className="auth-login-card">{children}</div>
          </aside>
        </div>

        <footer className="auth-container-foot">
          <div className="auth-foot-links-row">
            <a href="/">技术支持</a>
            <a href="/">帮助中心</a>
            <a href="/">意见反馈</a>
          </div>
          <div className="auth-foot-right">
            {footerExtra}
            <p className="auth-copyright">© 2026 尚进实训平台 · 版权所有 · 京ICP备XXXXXXXX号</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function AuthFieldIcon({ children }) {
  return <span className="auth-input-icon">{children}</span>;
}

export function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.866 3.134-7 7-7s7 3.134 7 7" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 118 0v3" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l7 3v6c0 4.418-3.134 7.5-7 9-3.866-1.5-7-4.582-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EyeIcon({ open }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3l18 18M10.6 10.6A3 3 0 0012 15a3 3 0 002.4-4.4" />
      <path d="M6.7 6.7C4.6 8.2 3 10 2 12s3.5 7 10 7c1.8 0 3.4-.4 4.8-1.1M17.3 17.3C19.4 15.8 21 14 22 12s-3.5-7-10-7c-1.8 0-3.4.4-4.8 1.1" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3" strokeLinecap="round" />
      <path d="M16 5h4V1M4 19h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WechatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.5 4C4.9 4 2 6.4 2 9.3c0 1.6.9 3 2.3 4l-.6 2.2 2.5-.9c.9.3 1.9.4 2.9.4.1 0 .2 0 .3-.1-.2-.6-.3-1.2-.3-1.9 0-3.4 3.2-6.2 7.2-6.2.3 0 .7 0 1 .1C16.4 5.5 12.7 4 8.5 4zm-2.4 4.1c-.6 0-1.1-.5-1.1-1.1s.5-1.1 1.1-1.1 1.1.5 1.1 1.1-.5 1.1-1.1 1.1zm4.8 0c-.6 0-1.1-.5-1.1-1.1s.5-1.1 1.1-1.1 1.1.5 1.1 1.1-.5 1.1-1.1 1.1z" />
      <path d="M22 14.8c0-2.5-2.4-4.5-5.4-4.5S11.2 12.3 11.2 14.8s2.4 4.5 5.4 4.5c.7 0 1.3-.1 1.9-.3l1.8.7-.4-1.6c1-.8 1.6-1.9 1.6-3.3zm-7.1-1.1c-.4 0-.8-.3-.8-.8s.3-.8.8-.8.8.3.8.8-.4.8-.8.8zm3.4 0c-.4 0-.8-.3-.8-.8s.3-.8.8-.8.8.3.8.8-.4.8-.8.8z" />
    </svg>
  );
}

export function WorkWechatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.5 2 2 5.8 2 10.5c0 2.4 1.2 4.6 3.2 6.1L4.5 20l3.8-1.2c1.2.3 2.5.5 3.7.5 5.5 0 10-3.8 10-8.5S17.5 2 12 2zm-3.2 8.4c-.7 0-1.2-.5-1.2-1.2s.5-1.2 1.2-1.2 1.2.5 1.2 1.2-.5 1.2-1.2 1.2zm6.4 0c-.7 0-1.2-.5-1.2-1.2s.5-1.2 1.2-1.2 1.2.5 1.2 1.2-.5 1.2-1.2 1.2z" />
    </svg>
  );
}
