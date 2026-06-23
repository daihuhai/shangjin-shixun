import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthShell, { AuthFieldIcon, LockIcon, UserIcon } from "./AuthShell";
import { post } from "../../api/client";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const tabRefs = useRef([null, null]);
  const wrapRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    // 找回密码是第二个tab，index=1；用文字实际渲染位置精确定位
    const el = tabRefs.current[1];
    const wrap = wrapRef.current;
    if (el && wrap) {
      const wrapRect = wrap.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const textRect = range.getBoundingClientRect();
      setIndicator({
        left: textRect.left - wrapRect.left,
        width: textRect.width,
      });
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.username.trim()) {
      setError("请输入账号");
      return;
    }
    if (!form.newPassword || form.newPassword.length < 4) {
      setError("新密码至少 4 个字符");
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);
    try {
      const msg = await post("/auth/reset-password", form);
      setSuccess(msg.message || "密码重置成功");
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err.message || "重置失败，请联系管理员");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="auth-tabs auth-tabs-dual" ref={wrapRef}>
        <Link to="/login" className="auth-tab" ref={(el) => { tabRefs.current[0] = el; }}>账号登录</Link>
        <span className="auth-tab active" ref={(el) => { tabRefs.current[1] = el; }}>找回密码</span>
        <span className="auth-tab-indicator" style={{ left: indicator.left, width: indicator.width }} />
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-input-wrap">
          <AuthFieldIcon><UserIcon /></AuthFieldIcon>
          <input
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="请输入您的账号"
            autoComplete="username"
          />
        </div>

        <div className="auth-input-wrap">
          <AuthFieldIcon><LockIcon /></AuthFieldIcon>
          <input
            required
            type="password"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            placeholder="设置新密码（至少4位）"
            autoComplete="new-password"
          />
        </div>

        <div className="auth-input-wrap">
          <AuthFieldIcon><LockIcon /></AuthFieldIcon>
          <input
            required
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            placeholder="确认新密码"
            autoComplete="new-password"
          />
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {success ? <div className="auth-success">{success}</div> : null}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? "提交中..." : "确认重置"}
        </button>

        <Link to="/login" className="auth-register-btn">返回登录</Link>

        <div className="auth-divider"><span>安全提示</span></div>

        <p style={{
          fontSize: 12,
          color: "#94a3b8",
          textAlign: "center",
          lineHeight: 1.6,
          margin: 0,
        }}>
          密码重置后旧密码将立即失效。如非本人操作，请联系系统管理员。
        </p>
      </form>
    </AuthShell>
  );
}
