import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import AuthShell, { AuthFieldIcon, EyeIcon, LockIcon, UserIcon, WechatIcon, WorkWechatIcon } from "./AuthShell";
import { get } from "../../api/client";

/** 关键词搜索下拉选择组件 — 支持从列表选择或自由输入 */
function SearchSelect({ options, value, onChange, placeholder }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  /** 确认当前输入值（用于列表选择、Enter键、失焦三种场景） */
  function confirmValue(val) {
    setQuery(val);
    onChange({ target: { value: val } });
    setOpen(false);
  }

  function handleSelect(item) {
    confirmValue(item);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmValue(query.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // 失焦时将当前输入内容同步到表单
  function handleBlur() {
    // 延迟关闭，让点击列表项的 mousedown 先执行
    setTimeout(() => {
      if (query.trim() && query !== value) {
        confirmValue(query.trim());
      }
      setOpen(false);
    }, 150);
  }

  // 点击外部关闭
  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        if (query.trim() && query !== value) {
          confirmValue(query.trim());
        }
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [query, value]);

  return (
    <div className="search-select-wrap" ref={wrapRef}>
      <AuthFieldIcon><UserIcon /></AuthFieldIcon>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      <span className="search-select-arrow">▾</span>
      {open && options.length > 0 && (
        <ul className="search-select-dropdown">
          {filtered.length > 0 ? (
            filtered.map((item) => (
              <li
                key={item}
                className={`search-select-item ${item === value ? "active" : ""}`}
                onClick={() => handleSelect(item)}
                onMouseDown={(e) => e.preventDefault()}
              >
                <span className="search-select-match">{item}</span>
              </li>
            ))
          ) : (
            query.trim() && (
              <li className="search-select-empty">
                无匹配项，按 Enter 确认自定义输入
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [classNames, setClassNames] = useState([]);
  const tabRefs = useRef([null, null]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "student",
    organization: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    get("/classes/names")
      .then((res) => setClassNames(Array.isArray(res) ? res : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // 注册页固定高亮第二个tab（注册账号），index=1
    const el = tabRefs.current[1];
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await register(form);
      setSuccess("注册成功，即将返回登录页…");
      window.setTimeout(() => navigate("/login"), 900);
    } catch (err) {
      setError(err.message || "注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="auth-tabs auth-tabs-dual">
        <button type="button" className="auth-tab" ref={(el) => { tabRefs.current[0] = el; }} onClick={() => navigate("/login")}>账号登录</button>
        <button type="button" className="auth-tab active" ref={(el) => { tabRefs.current[1] = el; }}>注册账号</button>
        <span className="auth-tab-indicator" style={{ left: indicator.left, width: indicator.width }} />
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-input-wrap">
          <AuthFieldIcon><UserIcon /></AuthFieldIcon>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="请输入姓名"
          />
        </div>

        <div className="auth-input-wrap">
          <AuthFieldIcon><UserIcon /></AuthFieldIcon>
          <input
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="请输入账号"
            autoComplete="username"
          />
        </div>

        <div className="auth-input-wrap">
          <AuthFieldIcon><LockIcon /></AuthFieldIcon>
          <input
            required
            type={showPassword ? "text" : "password"}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="请输入密码"
            autoComplete="new-password"
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

        <div className="auth-input-wrap">
          <AuthFieldIcon><UserIcon /></AuthFieldIcon>
          <select
            className="auth-select-as-input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="teacher">教师账号</option>
            <option value="student">学生账号</option>
            <option value="admin">管理员账号</option>
          </select>
        </div>

        <SearchSelect
          options={classNames}
          value={form.organization}
          onChange={(e) => setForm({ ...form, organization: e.target.value })}
          placeholder="院系 / 班级 / 部门"
        />

        {error ? <div className="auth-error">{error}</div> : null}
        {success ? <div className="auth-success">{success}</div> : null}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? "注册中..." : "注册账号"}
        </button>

        <Link to="/login" className="auth-register-btn">返回登录</Link>

        <div className="auth-divider"><span>其他登录方式</span></div>

        <div className="auth-social-row">
          <button className="auth-social-icon wechat" type="button" title="微信登录"><WechatIcon /></button>
          <button className="auth-social-icon work" type="button" title="企业微信登录"><WorkWechatIcon /></button>
        </div>
      </form>
    </AuthShell>
  );
}
