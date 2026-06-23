import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import AuthShell, {
  AuthFieldIcon,
  EyeIcon,
  LockIcon,
  RefreshIcon,
  ShieldIcon,
  UserIcon,
  WechatIcon,
  WorkWechatIcon,
} from "./AuthShell";
import { get } from "../../api/client";

const demoAccounts = {
  teacher: { username: "teacher", password: "teacher123" },
  student: { username: "student", password: "student123" },
  admin: { username: "admin", password: "admin123" },
};

const tabs = [
  { id: "password", label: "账号登录" },
  { id: "sms", label: "手机号登录" },
];

function randomCaptcha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function buildForm(role) {
  const account = demoAccounts[role] || demoAccounts.student;
  return {
    username: account.username,
    password: account.password,
    role,
    phone: "",
    code: "",
    captchaInput: "",
    remember: true,
  };
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("password");
  const [showPassword, setShowPassword] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [captchaSessionId, setCaptchaSessionId] = useState("");
  const [form, setForm] = useState(() => buildForm("teacher"));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const tabRefs = useRef([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const redirectPath = location.state?.from || "/";
  const activeTabIndex = tabs.findIndex((item) => item.id === mode);

  function updateIndicator(index = activeTabIndex) {
    const el = tabRefs.current[index];
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }

  useEffect(() => {
    updateIndicator(activeTabIndex);
    const onResize = () => updateIndicator(activeTabIndex);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeTabIndex]);

  function handleTabChange(tabId, index) {
    setMode(tabId);
    setError("");
    requestAnimationFrame(() => updateIndicator(index));
  }

  function handleRoleChange(role) {
    setForm(buildForm(role));
    setError("");
  }

  function fillDemoAccount(role) {
    setForm((prev) => ({ ...buildForm(role), remember: prev.remember }));
    setError("");
  }

  // 从服务端获取验证码
  async function fetchCaptcha() {
    try {
      const data = await get("/auth/captcha");
      setCaptcha(data.captcha || "");
      setCaptchaSessionId(data.sessionId || "");
      setForm((prev) => ({ ...prev, captchaInput: "" }));
    } catch {
      // 降级：使用前端本地生成
      setCaptcha(randomCaptcha());
      setCaptchaSessionId("");
    }
  }

  function refreshCaptcha() {
    fetchCaptcha();
  }

  // 页面加载时获取验证码
  useEffect(() => {
    fetchCaptcha();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    // 密码登录模式：验证码必填且必须正确
    if (mode === "password") {
      if (!form.captchaInput || form.captchaInput.trim() === "") {
        setError("请输入验证码");
        return;
      }
      if (form.captchaInput.toUpperCase() !== captcha) {
        setError("验证码不正确");
        refreshCaptcha();
        return;
      }
    }

    setLoading(true);
    try {
      await login({
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        captcha: form.captchaInput,
        captchaSessionId: captchaSessionId,
      });
      navigate(redirectPath, { replace: true });
    } catch (err) {
      setError(err.message || "登录失败");
      fetchCaptcha(); // 登录失败刷新验证码
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      footerExtra={
        <div className="auth-foot-demo">
          <span className="auth-foot-demo-label">演示：</span>
          <button type="button" onClick={() => fillDemoAccount("teacher")}>教师</button>
          <button type="button" onClick={() => fillDemoAccount("student")}>学生</button>
          <button type="button" onClick={() => fillDemoAccount("admin")}>管理员</button>
        </div>
      }
    >
      <div className="auth-tabs auth-tabs-dual">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            type="button"
            ref={(el) => { tabRefs.current[index] = el; }}
            className={`auth-tab ${mode === item.id ? "active" : ""}`}
            onClick={() => handleTabChange(item.id, index)}
          >
            {item.label}
          </button>
        ))}
        <span className="auth-tab-indicator" style={{ left: indicator.left, width: indicator.width }} />
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === "password" ? (
          <>
            <div className="auth-input-wrap">
              <AuthFieldIcon><UserIcon /></AuthFieldIcon>
              <select
                className="auth-select-as-input"
                value={form.role}
                onChange={(event) => handleRoleChange(event.target.value)}
              >
                <option value="teacher">教师账号</option>
                <option value="student">学生账号</option>
                <option value="admin">管理员账号</option>
              </select>
            </div>

            <div className="auth-input-wrap">
              <AuthFieldIcon><UserIcon /></AuthFieldIcon>
              <input
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
                placeholder="请输入账号"
                autoComplete="username"
              />
            </div>

            <div className="auth-input-wrap">
              <AuthFieldIcon><LockIcon /></AuthFieldIcon>
              <input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
              <button
                className="auth-input-action"
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>

            <div className="auth-captcha-row">
              <div className="auth-input-wrap">
                <AuthFieldIcon><ShieldIcon /></AuthFieldIcon>
                <input
                  value={form.captchaInput}
                  onChange={(event) => setForm({ ...form, captchaInput: event.target.value.toUpperCase() })}
                  placeholder="请输入验证码"
                  maxLength={4}
                />
              </div>
              <div className="auth-captcha-box">
                <span>{captcha}</span>
                <button className="auth-captcha-refresh" type="button" onClick={refreshCaptcha} aria-label="刷新验证码">
                  <RefreshIcon />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="auth-input-wrap">
              <AuthFieldIcon><UserIcon /></AuthFieldIcon>
              <input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="请输入手机号"
              />
            </div>
            <div className="auth-captcha-row">
              <div className="auth-input-wrap">
                <AuthFieldIcon><ShieldIcon /></AuthFieldIcon>
                <input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  placeholder="请输入短信验证码"
                />
              </div>
              <button className="auth-sms-btn" type="button">获取验证码</button>
            </div>
          </>
        )}

        <div className="auth-options-row">
          <label className="auth-checkbox">
            <input
              type="checkbox"
              checked={form.remember}
              onChange={(event) => setForm({ ...form, remember: event.target.checked })}
            />
            <span>记住我</span>
          </label>
          <Link to="/forgot-password" className="auth-forgot">忘记密码？</Link>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}

        <button className="auth-submit" type="submit" disabled={loading || mode === "sms"}>
          {loading ? "登录中..." : "登录"}
        </button>

        <div className="auth-register-block">
          <span className="auth-register-hint">没有账号？</span>
          <Link to="/register" className="auth-register-btn">立即注册</Link>
        </div>

        <div className="auth-divider"><span>其他登录方式</span></div>

        <div className="auth-social-row">
          <button className="auth-social-icon wechat" type="button" title="微信登录"><WechatIcon /></button>
          <button className="auth-social-icon work" type="button" title="企业微信登录"><WorkWechatIcon /></button>
        </div>
      </form>
    </AuthShell>
  );
}
