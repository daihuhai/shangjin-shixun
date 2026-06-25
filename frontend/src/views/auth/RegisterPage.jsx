import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import AuthShell, { AuthFieldIcon, EyeIcon, LockIcon, UserIcon, WechatIcon, WorkWechatIcon } from "./AuthShell";
import { get } from "../../api/client";

/** 关键词搜索下拉选择组件 — 支持从列表选择或自由输入 */
function SearchSelect({ options, value, onChange, placeholder, disabled = false }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // 外部 value 变化时同步内部输入（如切换角色清空）
  useEffect(() => {
    setQuery(value || "");
  }, [value]);

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
        disabled={disabled}
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
  const [collegeNames, setCollegeNames] = useState([]);
  const [classOptions, setClassOptions] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const tabRefs = useRef([null, null]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "student",
    college: "",
    organization: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  // 加载学院列表
  useEffect(() => {
    get("/classes/colleges")
      .then((res) => setCollegeNames(Array.isArray(res) ? res : []))
      .catch(() => {});
  }, []);

  // 学生角色：选择学院后联动加载该学院下的班级
  useEffect(() => {
    if (form.role === "student" && form.college) {
      setLoadingClasses(true);
      setClassOptions([]);
      const college = form.college;
      get(`/classes/by-college?college=${encodeURIComponent(college)}`)
        .then((res) => setClassOptions(Array.isArray(res) ? res : []))
        .catch(() => setClassOptions([]))
        .finally(() => setLoadingClasses(false));
    } else {
      setClassOptions([]);
    }
  }, [form.role, form.college]);

  useEffect(() => {
    // 注册页固定高亮第二个tab（注册账号），index=1
    const el = tabRefs.current[1];
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, []);

  // 切换角色时重置学院与班级选择
  function handleRoleChange(e) {
    const role = e.target.value;
    setForm((prev) => ({ ...prev, role, college: "", organization: "" }));
  }

  // 选择学院
  function handleCollegeChange(e) {
    const college = e.target.value;
    setForm((prev) => ({ ...prev, college, organization: "" }));
  }

  // 选择班级（学生）/学院（教师、管理员）
  function handleOrganizationChange(e) {
    setForm((prev) => ({ ...prev, organization: e.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    // 校验：学生需选择班级，教师/管理员需选择学院
    if (form.role === "student") {
      if (!form.college) {
        setError("请先选择所属学院");
        return;
      }
      if (!form.organization) {
        setError("请选择所在班级");
        return;
      }
    } else {
      if (!form.college) {
        setError(form.role === "teacher" ? "请选择所属学院" : "请选择所属部门/学院");
        return;
      }
    }

    setLoading(true);
    try {
      // 教师/管理员的 organization 即为学院；学生的 organization 为班级
      const payload = {
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
        organization: form.role === "student" ? form.organization : form.college,
      };
      await register(payload);
      setSuccess("注册成功，即将返回登录页…");
      window.setTimeout(() => navigate("/login"), 900);
    } catch (err) {
      setError(err.message || "注册失败");
    } finally {
      setLoading(false);
    }
  }

  const isStudent = form.role === "student";

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
            onChange={handleRoleChange}
          >
            <option value="student">学生账号</option>
            <option value="teacher">教师账号</option>
            <option value="admin">管理员账号</option>
          </select>
        </div>

        {/* 学院选择：所有角色都需要选择学院/部门 */}
        <SearchSelect
          options={collegeNames}
          value={form.college}
          onChange={handleCollegeChange}
          placeholder={isStudent ? "请选择所属学院" : form.role === "teacher" ? "请选择所属学院" : "请选择所属部门/学院"}
        />

        {/* 班级选择：仅学生需要，联动学院 */}
        {isStudent ? (
          <SearchSelect
            options={classOptions}
            value={form.organization}
            onChange={handleOrganizationChange}
            placeholder={loadingClasses ? "正在加载班级…" : (form.college ? "请选择所在班级" : "请先选择学院")}
            disabled={!form.college || loadingClasses}
          />
        ) : null}

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
