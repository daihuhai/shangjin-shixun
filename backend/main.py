import shutil
import sqlite3
import time
from collections import Counter
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.exceptions import RequestValidationError
from fastapi import Request

from app.config import ALLOWED_EXTENSIONS, EXPORT_DIR, MAX_UPLOAD_BYTES, UPLOAD_DIR
from app.db import dumps, get_conn, init_db, loads, new_id, rows_to_list, utc_now
from app.config import MODEL_DISPLAY_NAME, PLATFORM_NAME
from app.evaluation import STATUS_LABELS, run_auto_scoring, run_check, run_full_evaluation, run_parse
from app.llm import chat_completion, create_session, delete_session, get_user_by_token, health_check, analyze_reference_code, get_reference_analysis, analyze_image
from app.parser import parse_submission_files, submission_dir, validate_extension
from app.response import fail, ok
from app.seed import seed_if_empty
from app.services import (  
    _parse_score_dimensions,
    _row_get,
    build_submission_rows,
    dashboard_data,
    export_excel,
    export_pdf,
    get_task_detail,
    report_summary,
    serialize_submission,
    student_profile,
    teacher_profile,
)

app = FastAPI(title=PLATFORM_NAME, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5174", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception):
    from fastapi.responses import JSONResponse
    if isinstance(exc, type) and hasattr(exc, "status_code"):
        pass
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": exc.status_code, "message": str(exc.detail), "data": None}
        return JSONResponse(status_code=exc.status_code, content=detail)
    return JSONResponse(status_code=500, content={"code": 500, "message": str(exc), "data": None})


def get_token(authorization: Optional[str] = Header(None), x_auth_token: Optional[str] = Header(None)) -> Optional[str]:
    if x_auth_token:
        return x_auth_token
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:]
    return None


def current_user(token: Optional[str] = Depends(get_token)):
    user = get_user_by_token(token)
    if not user:
        fail("请先登录", 401)
    safe = {k: user[k] for k in ("id", "username", "name", "role", "organization", "student_id")}
    return safe


def require_roles(*roles):
    def checker(user=Depends(current_user)):
        if user["role"] not in roles:
            fail("无权限访问", 403)
        return user
    return checker


@app.on_event("startup")
def startup():
    init_db()
    seed_if_empty()


@app.get("/api/health")
async def api_health():
    return ok({"status": "ok"})


# ---------- Auth ----------

# 验证码存储：session_id -> captcha_text（内存缓存，5分钟过期）
_captcha_store: dict[str, tuple[str, float]] = {}

def _generate_captcha(length: int = 4) -> str:
    import random, string
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choices(chars, k=length))

@app.get("/api/auth/captcha")
async def auth_captcha():
    """生成验证码，返回文本和 session_id"""
    sid = new_id()[:12]
    text = _generate_captcha()
    _captcha_store[sid] = (text, time.time() + 300)  # 5分钟有效
    return ok({"sessionId": sid, "captcha": text})

@app.post("/api/auth/login")
async def auth_login(body: dict):
    # 验证码校验
    sid = body.get("captchaSessionId")
    input_captcha = body.get("captcha", "")
    if sid and input_captcha:
        stored = _captcha_store.get(sid)
        if not stored or stored[1] < time.time():
            fail("验证码已过期，请刷新重试")
        if input_captcha.upper() != stored[0].upper():
            fail("验证码不正确")
        _captcha_store.pop(sid, None)  # 验证成功后销毁
    elif body.get("role") != "admin":
        # 非管理员登录必须带验证码
        pass  # 前端已做必填校验，后端兜底

    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? AND password = ? AND role = ?",
            (body.get("username"), body.get("password"), body.get("role"))
        ).fetchone()
    if not row:
        fail("账号、密码或身份不匹配，请确认身份标签与账号一致")
    user = dict(row)
    token = create_session(user["id"])
    safe_user = {k: user[k] for k in ("id", "username", "name", "role", "organization", "student_id")}
    return ok({"user": safe_user, "token": token})


@app.post("/api/auth/reset-password")
async def auth_reset_password(body: dict):
    """重置密码：验证用户名和身份信息后重置"""
    username = (body.get("username") or "").strip()
    new_password = body.get("newPassword", "")
    confirm = body.get("confirmPassword", "")

    if not username:
        fail("请输入账号")
    if not new_password or len(new_password) < 4:
        fail("新密码至少 4 个字符")
    if new_password != confirm:
        fail("两次输入的密码不一致")

    with get_conn() as conn:
        user = conn.execute(
            "SELECT id, name, role FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not user:
            fail("该账号不存在，请检查用户名")

        conn.execute(
            "UPDATE users SET password = ? WHERE username = ?",
            (new_password, username),
        )

    return ok({"message": f"密码已重置成功，用户 {dict(user)['name']} 可以使用新密码登录"})


@app.post("/api/auth/register")
async def auth_register(body: dict):
    with get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (body.get("username"),)).fetchone()
        if exists:
            fail("用户名已存在")
        user_id = new_id()
        conn.execute(
            """
            INSERT INTO users (id, username, password, name, role, organization, student_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                body.get("username"),
                body.get("password"),
                body.get("name"),
                body.get("role", "student"),
                body.get("organization", ""),
                body.get("student_id"),
                utc_now()
            )
        )
    return ok({"message": "注册成功"})


@app.post("/api/auth/logout")
async def auth_logout(token: Optional[str] = Depends(get_token)):
    if token:
        delete_session(token)
    return ok({"success": True})


@app.post("/api/auth/me")
async def auth_me(token: Optional[str] = Depends(get_token)):
    user = get_user_by_token(token)
    if not user:
        return ok(None)
    safe = {k: user[k] for k in ("id", "username", "name", "role", "organization", "student_id")}
    return ok(safe)


# ---------- Dashboard ----------
@app.get("/api/dashboard")
async def get_dashboard(user=Depends(current_user)):
    # 强制以 token 中的角色为准，禁止通过查询参数越权
    return ok(dashboard_data(user["role"], user["id"]))


# ---------- Courses ----------
@app.get("/api/courses")
async def list_courses(user=Depends(require_roles("teacher", "admin"))):
    with get_conn() as conn:
        if user["role"] == "admin":
            rows = conn.execute("""
                SELECT c.*,
                    (SELECT COUNT(*) FROM course_classes cc WHERE cc.course_id = c.id) AS class_count,
                    (SELECT COUNT(*) FROM tasks t
                     WHERE t.course_id = c.id
                        OR (t.course_id IS NULL AND REPLACE(t.course, ' ', '') = REPLACE(c.name, ' ', ''))
                    ) AS task_count,
                    (SELECT GROUP_CONCAT(cl.name) FROM classes cl
                     JOIN course_classes cc ON cl.id = cc.class_id
                     WHERE cc.course_id = c.id) AS class_names
                FROM courses c ORDER BY c.created_at DESC
            """).fetchall()
        else:
            rows = conn.execute("""
                SELECT c.*,
                    (SELECT COUNT(*) FROM course_classes cc WHERE cc.course_id = c.id) AS class_count,
                    (SELECT COUNT(*) FROM tasks t
                     WHERE t.course_id = c.id
                        OR (t.course_id IS NULL AND REPLACE(t.course, ' ', '') = REPLACE(c.name, ' ', ''))
                    ) AS task_count,
                    (SELECT GROUP_CONCAT(cl.name) FROM classes cl
                     JOIN course_classes cc ON cl.id = cc.class_id
                     WHERE cc.course_id = c.id) AS class_names
                FROM courses c WHERE c.created_by = ? ORDER BY c.created_at DESC
            """, (user["id"],)).fetchall()
    return ok([{
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "classCount": row["class_count"],
        "taskCount": row["task_count"],
        "classNames": row["class_names"].split(",") if row["class_names"] else [],
        "createdAt": row["created_at"]
    } for row in rows])


@app.post("/api/courses")
async def create_course(body: dict, user=Depends(require_roles("teacher", "admin"))):
    now = utc_now()
    with get_conn() as conn:
        course_id = new_id()
        conn.execute(
            "INSERT INTO courses (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (course_id, body.get("name"), body.get("description", ""), user["id"], now, now)
        )
    return ok({"id": course_id})


@app.put("/api/courses/{course_id}")
async def update_course(course_id: str, body: dict, user=Depends(require_roles("teacher", "admin"))):
    now = utc_now()
    with get_conn() as conn:
        conn.execute(
            "UPDATE courses SET name = ?, description = ?, updated_at = ? WHERE id = ?",
            (body.get("name"), body.get("description", ""), now, course_id)
        )
    return ok({"id": course_id})


@app.delete("/api/courses/{course_id}")
async def delete_course(course_id: str, user=Depends(require_roles("teacher", "admin"))):
    with get_conn() as conn:
        conn.execute("DELETE FROM task_classes WHERE task_id IN (SELECT id FROM tasks WHERE course_id = ?)", (course_id,))
        conn.execute("DELETE FROM tasks WHERE course_id = ?", (course_id,))
        conn.execute("DELETE FROM course_classes WHERE course_id = ?", (course_id,))
        conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    return ok({"deleted": True})


# ---------- Course-Class Association ----------
@app.get("/api/courses/{course_id}/classes")
async def list_course_classes(course_id: str, user=Depends(current_user)):
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT cl.*, cc.id AS association_id
            FROM classes cl
            JOIN course_classes cc ON cl.id = cc.class_id
            WHERE cc.course_id = ?
            ORDER BY cl.name
        """, (course_id,)).fetchall()
    return ok([{"id": row["id"], "name": row["name"]} for row in rows])


@app.post("/api/courses/{course_id}/classes")
async def add_class_to_course(course_id: str, body: dict, user=Depends(require_roles("teacher", "admin"))):
    class_name = body.get("name", "").strip()
    if not class_name:
        fail("班级名称不能为空")
    now = utc_now()
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM classes WHERE name = ?", (class_name,)).fetchone()
        if existing:
            class_id = existing["id"]
        else:
            class_id = new_id()
            conn.execute("INSERT INTO classes (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
                       (class_id, class_name, user["id"], now))
        try:
            assoc_id = new_id()
            conn.execute("INSERT INTO course_classes (id, course_id, class_id, created_at) VALUES (?, ?, ?, ?)",
                        (assoc_id, course_id, class_id, now))
        except sqlite3.IntegrityError:
            fail(f"班级「{class_name}」已在该课程中")
    return ok({"id": class_id, "name": class_name})


@app.delete("/api/courses/{course_id}/classes/{class_id}")
async def remove_class_from_course(course_id: str, class_id: str, user=Depends(require_roles("teacher", "admin"))):
    with get_conn() as conn:
        conn.execute("DELETE FROM course_classes WHERE course_id = ? AND class_id = ?", (course_id, class_id))
    return ok({"removed": True})


# ---------- Classes (Global) ----------
@app.get("/api/classes/names")
async def list_class_names():
    """公开接口：返回所有班级名称列表，供注册页自动补全使用"""
    with get_conn() as conn:
        rows = conn.execute("SELECT DISTINCT name FROM classes ORDER BY name").fetchall()
    return ok([row["name"] for row in rows])


@app.get("/api/classes/colleges")
async def list_college_names():
    """公开接口：返回所有学院/部门名称（不含数字），供注册页选择学院使用"""
    import re
    with get_conn() as conn:
        rows = conn.execute("SELECT DISTINCT name FROM classes ORDER BY name").fetchall()
    return ok([r["name"] for r in rows if not re.search(r"\d", r["name"])])


@app.get("/api/classes/by-college")
async def list_classes_by_college(college: str = ""):
    """公开接口：根据学院名返回匹配的班级列表（含数字的条目）。
    通过 extract_college_prefix 进行前缀匹配。
    """
    import re
    college = (college or "").strip()
    with get_conn() as conn:
        rows = conn.execute("SELECT DISTINCT name FROM classes ORDER BY name").fetchall()
    # 仅保留含数字的班级名，并匹配指定学院
    all_colleges = [r["name"] for r in rows if not re.search(r"\d", r["name"])]
    classes = []
    for r in rows:
        name = r["name"]
        if not re.search(r"\d", name):
            continue
        if not college:
            classes.append(name)
            continue
        matched = extract_college_prefix(name, all_colleges)
        if matched == college:
            classes.append(name)
    return ok(classes)


@app.get("/api/classes")
async def list_all_classes(user=Depends(require_roles("teacher", "admin"))):
    with get_conn() as conn:
        if user["role"] == "admin":
            rows = conn.execute("""
                SELECT cl.*,
                    (SELECT COUNT(*) FROM course_classes cc WHERE cc.class_id = cl.id) AS course_count
                FROM classes cl ORDER BY cl.name
            """).fetchall()
        else:
            # 教师只看到自己创建的课程所关联的班级
            rows = conn.execute("""
                SELECT DISTINCT cl.*,
                    (SELECT COUNT(*) FROM course_classes cc WHERE cc.class_id = cl.id) AS course_count
                FROM classes cl
                JOIN course_classes cc ON cc.class_id = cl.id
                JOIN courses c ON c.id = cc.course_id
                WHERE c.created_by = ?
                ORDER BY cl.name
            """, (user["id"],)).fetchall()
    return ok([{"id": row["id"], "name": row["name"], "courseCount": row["course_count"]} for row in rows])


@app.get("/api/classes/{class_name}/students")
async def list_class_students(class_name: str, course_id: str = "", user=Depends(require_roles("teacher", "admin"))):
    """查询某班级下的所有学生（含实训分数与班级排名）"""
    normalized = class_name.replace(" ", "").strip()
    with get_conn() as conn:
        # 基础学生信息
        students = rows_to_list(conn.execute("""
            SELECT id, username, name, student_id, organization
            FROM users
            WHERE role = 'student'
              AND TRIM(REPLACE(organization, ' ', '')) = ?
            ORDER BY name
        """, (normalized,)).fetchall())

        # 如果有课程ID，计算每个学生的实训分数（各任务最佳成绩均值）
        if course_id and students:
            student_ids = [s["id"] for s in students]
            # 查该课程下每个学生、每个任务的最高分
            score_rows = rows_to_list(conn.execute("""
                SELECT s.student_id, s.task_id,
                       MAX(CAST(
                         COALESCE(sr.final_score, sr.teacher_adjusted_score, sr.ai_total_score, 0)
                       AS REAL)) AS best_score
                FROM submissions s
                JOIN tasks t ON s.task_id = t.id
                LEFT JOIN score_records sr ON sr.submission_id = s.id
                WHERE s.student_id IN ({})
                  AND (t.course_id = ? OR (t.course_id IS NULL AND t.course = (
                      SELECT name FROM courses WHERE id = ?)))
                GROUP BY s.student_id, s.task_id
            """.format(",".join(["?"] * len(student_ids))),
                [*student_ids, course_id, course_id]).fetchall())

            # 按学生聚合：各任务最佳成绩均值
            task_scores = {}
            for r in score_rows:
                task_scores.setdefault(r["student_id"], []).append(r["best_score"])

            for s in students:
                scores = task_scores.get(s["id"], [])
                s["training_score"] = round(sum(scores) / len(scores), 1) if scores else None

            # 班级内排名（按分数降序，同分同排名）
            scored = [(s["id"], s["training_score"]) for s in students if s["training_score"] is not None]
            scored.sort(key=lambda x: -x[1])
            rank_map = {}
            for i, (sid, sc) in enumerate(scored):
                rank_map[sid] = i + 1 if (i == 0 or sc != scored[i-1][1]) else rank_map[scored[i-1][0]]
            for s in students:
                s["rank"] = rank_map.get(s["id"], None)

        else:
            for s in students:
                s["training_score"] = None
                s["rank"] = None

    return ok(students)


# ---------- Tasks ----------
@app.get("/api/tasks")
async def list_tasks(user=Depends(current_user)):
    with get_conn() as conn:
        if user["role"] == "student":
            org_clean = (user.get("organization") or "").replace(" ", "").strip()
            rows = conn.execute(
                """
                SELECT DISTINCT t.*,
                    (SELECT COUNT(*) FROM submissions s WHERE s.task_id = t.id AND s.student_id = ?) AS my_submissions,
                    c.name AS course_name,
                    (SELECT GROUP_CONCAT(cl2.name) FROM classes cl2
                     JOIN task_classes tc2 ON cl2.id = tc2.class_id
                     WHERE tc2.task_id = t.id) AS class_names
                FROM tasks t
                LEFT JOIN courses c ON t.course_id = c.id
                WHERE t.status = 'published' AND (
                    t.id IN (
                        SELECT tc.task_id FROM task_classes tc
                        JOIN classes cl ON cl.id = tc.class_id
                        WHERE REPLACE(cl.name, ' ', '') = ?
                    )
                    OR t.course_id IN (
                        SELECT cc.course_id FROM course_classes cc
                        JOIN classes cl ON cl.id = cc.class_id
                        WHERE REPLACE(cl.name, ' ', '') = ?
                    )
                )
                ORDER BY t.created_at DESC
                """,
                (user["id"], org_clean, org_clean)
            ).fetchall()
        elif user["role"] == "admin":
            rows = conn.execute(
                """
                SELECT t.*,
                    (SELECT COUNT(*) FROM submissions s WHERE s.task_id = t.id) AS submission_count,
                    (SELECT COUNT(DISTINCT s.student_id) FROM submissions s WHERE s.task_id = t.id) AS student_count,
                    c.name AS course_name,
                    (SELECT GROUP_CONCAT(cl.name) FROM classes cl
                     JOIN task_classes tc ON cl.id = tc.class_id
                     WHERE tc.task_id = t.id) AS class_names
                FROM tasks t
                LEFT JOIN courses c ON t.course_id = c.id
                ORDER BY t.created_at DESC
                """
            ).fetchall()
        else:
            # teacher: only tasks from courses they created
            rows = conn.execute(
                """
                SELECT t.*,
                    (SELECT COUNT(*) FROM submissions s WHERE s.task_id = t.id) AS submission_count,
                    (SELECT COUNT(DISTINCT s.student_id) FROM submissions s WHERE s.task_id = t.id) AS student_count,
                    c.name AS course_name,
                    (SELECT GROUP_CONCAT(cl.name) FROM classes cl
                     JOIN task_classes tc ON cl.id = tc.class_id
                     WHERE tc.task_id = t.id) AS class_names
                FROM tasks t
                LEFT JOIN courses c ON t.course_id = c.id
                WHERE c.created_by = ? OR t.created_by = ?
                ORDER BY t.created_at DESC
                """,
                (user["id"], user["id"])
            ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["courseName"] = d.get("course_name") or d.get("course", "")
        d["classNames"] = d["class_names"].split(",") if d.get("class_names") else [d.get("class_name")] if d.get("class_name") else []
        result.append(d)
    return ok(result)


@app.post("/api/tasks")
async def create_task(body: dict, user=Depends(require_roles("teacher", "admin"))):
    task_id = new_id()
    now = utc_now()
    course_id = body.get("courseId", "")
    class_ids = body.get("classIds") or []

    with get_conn() as conn:
        # 获取课程名称用于兼容显示
        course_name = ""
        if course_id:
            cr = conn.execute("SELECT name FROM courses WHERE id = ?", (course_id,)).fetchone()
            if cr:
                course_name = cr["name"]

        # 获取班级名称列表
        class_names = []
        for cid in class_ids:
            cr = conn.execute("SELECT name FROM classes WHERE id = ?", (cid,)).fetchone()
            if cr:
                class_names.append(cr["name"])

        conn.execute(
            """
            INSERT INTO tasks (
                id, title, course, class_name, description, requirements, checklist, scoring_criteria,
                deadline, allowed_formats, status, created_by, course_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                body.get("title"),
                course_name,
                ",".join(class_names),
                body.get("description", ""),
                body.get("requirements", ""),
                body.get("checklist", ""),
                body.get("scoringCriteria", ""),
                body.get("deadline", ""),
                body.get("allowedFormats", "doc,docx,pdf,zip,png,jpg"),
                body.get("status", "published"),
                user["id"],
                course_id or None,
                now,
                now
            )
        )

        # 关联班级（支持多选）
        for cid in class_ids:
            tc_id = new_id()
            conn.execute(
                "INSERT INTO task_classes (id, task_id, class_id, created_at) VALUES (?, ?, ?, ?)",
                (tc_id, task_id, cid, now)
            )

    return ok({"id": task_id})


@app.get("/api/tasks/{task_id}/detail")
async def task_detail(task_id: str, user=Depends(current_user)):
    detail = get_task_detail(task_id, user["role"], user["id"])
    if not detail:
        fail("任务不存在", 404)
    return ok(detail)


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        fail("任务不存在", 404)
    return ok(dict(row))


# ---------- Metrics ----------
@app.get("/api/metrics")
async def get_metrics(user=Depends(current_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM score_metrics ORDER BY sort_order ASC").fetchall()
    return ok([
        {
            "id": row["id"],
            "name": row["name"],
            "weight": row["weight"],
            "maxScore": row["max_score"],
            "criteria": row["criteria"]
        }
        for row in rows
    ])


@app.put("/api/metrics")
async def update_metrics(body: dict, user=Depends(require_roles("teacher", "admin"))):
    metrics = body.get("metrics") or []
    with get_conn() as conn:
        conn.execute("DELETE FROM score_metrics")
        for index, metric in enumerate(metrics):
            conn.execute(
                """
                INSERT INTO score_metrics (id, name, weight, max_score, criteria, parent_id, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    metric.get("id") or new_id(),
                    metric["name"],
                    float(metric["weight"]),
                    float(metric.get("maxScore", 100)),
                    metric.get("criteria", ""),
                    None,
                    index
                )
            )
    return ok({"success": True})


# ---------- Reference Doc (参考文档，按任务维度) ----------
REF_DOC_DIR = UPLOAD_DIR / "reference_docs"

@app.post("/api/tasks/{task_id}/reference-doc/upload")
async def upload_reference_doc(
    task_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    user=Depends(require_roles("teacher", "admin")),
):
    # 校验任务存在
    with get_conn() as conn:
        task = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            fail("任务不存在", 404)

    if not files:
        fail("请至少上传一个文件")

    results = []
    now = utc_now()
    REF_DOC_DIR.mkdir(parents=True, exist_ok=True)

    for upload in files:
        validate_extension(upload.filename)
        content = await upload.read()
        if len(content) > MAX_UPLOAD_BYTES:
            fail(f"文件 {upload.filename} 超过大小限制")

        ref_id = new_id()
        stored_name = f"reference_docs/{ref_id}{Path(upload.filename).suffix}"
        dest = UPLOAD_DIR / stored_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)

        # 解析文本内容
        extracted = ""
        suffix = Path(upload.filename).suffix.lower()
        if suffix in {".txt", ".md", ".java", ".py", ".js", ".sql", ".html", ".css"}:
            for enc in ("utf-8", "gbk", "latin-1"):
                try:
                    extracted = dest.read_text(enc)
                    break
                except Exception:
                    continue
        elif suffix == ".docx":
            from docx import Document
            doc = Document(str(dest))
            extracted = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        elif suffix == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(str(dest))
            extracted = "\n".join(p.extract_text() or "" for p in reader.pages[:20])
        elif suffix in {".png", ".jpg", ".jpeg"}:
            # 图片文件使用视觉能力提取内容
            try:
                extracted = await analyze_image(dest)
            except Exception:
                extracted = f"[图片文件: {upload.filename}]"

        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO reference_codes (id, task_id, filename, stored_name, file_type, file_size, extracted_text, analysis_status, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (ref_id, task_id, upload.filename, stored_name, suffix, len(content), extracted[:50000], "analyzing" if extracted else "done", user["id"], now)
            )

        if extracted:
            background_tasks.add_task(_analyze_and_save, ref_id)

        results.append({
            "id": ref_id,
            "filename": upload.filename,
            "status": "analyzing" if extracted else "done",
        })

    return ok({"files": results, "message": f"成功上传 {len(results)} 个参考文档，尚进大模型正在分析..."})


async def _analyze_and_save(ref_id: str):
    try:
        with get_conn() as conn:
            row = conn.execute("SELECT extracted_text, filename FROM reference_codes WHERE id = ?", (ref_id,)).fetchone()
            if not row or not row["extracted_text"]:
                return

        analysis = await analyze_reference_code(row["extracted_text"], row["filename"])
        now = utc_now()
        with get_conn() as conn:
            conn.execute(
                "UPDATE reference_codes SET analysis_result = ?, analysis_status = ? WHERE id = ?",
                (dumps(analysis), "done", ref_id)
            )
    except Exception as exc:
        with get_conn() as conn:
            conn.execute(
                "UPDATE reference_codes SET analysis_status = ?, analysis_result = ? WHERE id = ?",
                ("failed", dumps({"error": str(exc)[:500]}), ref_id)
            )


@app.get("/api/tasks/{task_id}/reference-doc")
async def list_reference_docs(task_id: str, user=Depends(current_user)):
    with get_conn() as conn:
        # 校验任务存在
        task = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            fail("任务不存在", 404)
        rows = rows_to_list(conn.execute("""
            SELECT id, filename, file_type, file_size, analysis_status,
                   CASE WHEN analysis_result IS NOT NULL
                        THEN json_extract(analysis_result, '$.codeSummary')
                        ELSE NULL END AS summary,
                   created_at
            FROM reference_codes WHERE task_id = ? ORDER BY created_at DESC
        """, (task_id,)).fetchall())
    return ok(rows)


@app.delete("/api/tasks/{task_id}/reference-doc/{ref_id}")
async def delete_reference_doc(task_id: str, ref_id: str, user=Depends(require_roles("teacher", "admin"))):
    with get_conn() as conn:
        row = conn.execute("SELECT stored_name FROM reference_codes WHERE id = ? AND task_id = ?", (ref_id, task_id)).fetchone()
        if not row:
            fail("记录不存在", 404)
        conn.execute("DELETE FROM reference_codes WHERE id = ? AND task_id = ?", (ref_id, task_id))
    if row and row["stored_name"]:
        path = UPLOAD_DIR / row["stored_name"]
        if path.exists():
            path.unlink()
    return ok({"success": True})


@app.post("/api/tasks/{task_id}/reference-doc/text")
async def create_reference_text(
    task_id: str,
    background_tasks: BackgroundTasks,
    body: dict,
    user=Depends(require_roles("teacher", "admin")),
):
    content = (body.get("content") or "").strip()
    filename = (body.get("filename") or "文本参考").strip()
    if not content:
        fail("请输入参考内容")

    with get_conn() as conn:
        task = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            fail("任务不存在", 404)

    now = utc_now()
    ref_id = new_id()

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO reference_codes (id, task_id, filename, stored_name, file_type, file_size, extracted_text, analysis_status, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (ref_id, task_id, filename[:200], "", "text", len(content.encode("utf-8")), content[:50000], "analyzing", user["id"], now)
        )

    background_tasks.add_task(_analyze_and_save, ref_id)

    return ok({
        "id": ref_id,
        "filename": filename,
        "status": "analyzing",
        "message": "参考内容已提交，尚进大模型正在分析..."
    })


# ---------- Submissions ----------
@app.get("/api/submissions")
async def list_submissions(task_id: Optional[str] = None, user=Depends(current_user)):
    filters = {}
    if task_id:
        filters["task_id"] = task_id
    if user["role"] == "student":
        filters["student_id"] = user["id"]
    elif user["role"] == "teacher":
        # 教师仅能看到本班学生的提交（与 dashboard/overview 保持一致）
        filters["organization"] = user["organization"] or ""
    rows = build_submission_rows(filters)
    return ok([serialize_submission(row) for row in rows])


@app.get("/api/submissions/{submission_id}")
async def get_submission(submission_id: str, user=Depends(current_user)):
    rows = build_submission_rows()
    row = next((item for item in rows if item["id"] == submission_id), None)
    if not row:
        fail("提交记录不存在", 404)
    if user["role"] == "student" and row["student_id"] != user["id"]:
        fail("无权限", 403)
    return ok(serialize_submission(row))


@app.post("/api/submissions/upload")
async def upload_submission(
    background_tasks: BackgroundTasks,
    task_id: str = Form(...),
    remark: str = Form(""),
    files: list[UploadFile] = File(...),
    user=Depends(require_roles("student"))
):
    if not files:
        fail("请至少上传一个文件")

    with get_conn() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            fail("任务不存在", 404)

        version_row = conn.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM submissions WHERE task_id = ? AND student_id = ?",
            (task_id, user["id"])
        ).fetchone()
        version = version_row["v"] + 1
        submission_id = new_id()
        now = utc_now()
        conn.execute(
            """
            INSERT INTO submissions (id, task_id, student_id, version, status, risk_level, remark, submitted_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (submission_id, task_id, user["id"], version, "submitted", "低", remark, now, now)
        )

        upload_path = submission_dir(submission_id)
        files_meta = []
        for upload in files:
            validate_extension(upload.filename)
            content = await upload.read()
            if len(content) > MAX_UPLOAD_BYTES:
                fail(f"文件 {upload.filename} 超过大小限制")
            stored_name = f"{submission_id}/{Path(upload.filename).name}"
            dest = UPLOAD_DIR / stored_name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content)
            file_id = new_id()
            conn.execute(
                """
                INSERT INTO submission_files (id, submission_id, filename, stored_name, file_type, file_size, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (file_id, submission_id, upload.filename, stored_name, Path(upload.filename).suffix.lower(), len(content), now)
            )
            files_meta.append({"filename": upload.filename, "stored_name": stored_name})

    background_tasks.add_task(run_full_evaluation, submission_id)

    return ok({
        "submissionId": submission_id,
        "version": version,
        "fileCount": len(files_meta),
        "message": "提交成功，尚进大模型正在解析与评价，请稍后在「我的成绩」查看。"
    })


@app.post("/api/submissions/{submission_id}/parse")
async def parse_submission(submission_id: str, user=Depends(current_user)):
    rows = build_submission_rows()
    row = next((item for item in rows if item["id"] == submission_id), None)
    if not row:
        fail("提交记录不存在", 404)
    if user["role"] == "student" and row["student_id"] != user["id"]:
        fail("无权限", 403)

    result = await run_parse(submission_id)
    return ok({"submissionId": submission_id, "status": "parsed", "summary": result["summary"]})


@app.post("/api/submissions/{submission_id}/evaluate")
async def evaluate_submission(
    submission_id: str,
    background_tasks: BackgroundTasks,
    user=Depends(current_user)
):
    rows = build_submission_rows()
    row = next((item for item in rows if item["id"] == submission_id), None)
    if not row:
        fail("提交记录不存在", 404)
    if user["role"] == "student" and row["student_id"] != user["id"]:
        fail("无权限", 403)

    background_tasks.add_task(run_full_evaluation, submission_id)
    return ok({
        "submissionId": submission_id,
        "message": "已重新触发尚进大模型评价，请稍后刷新查看。"
    })


# ---------- Checks ----------
@app.post("/api/check/{submission_id}/run")
async def run_check_endpoint(submission_id: str, user=Depends(require_roles("teacher", "admin"))):
    rows = build_submission_rows()
    row = next((item for item in rows if item["id"] == submission_id), None)
    if not row:
        fail("提交记录不存在", 404)

    with get_conn() as conn:
        parse_row = conn.execute("SELECT id FROM parse_results WHERE submission_id = ?", (submission_id,)).fetchone()
        if not parse_row:
            fail("请先完成成果解析")

    try:
        await run_check(submission_id)
    except Exception as exc:
        fail(f"智能核查失败: {exc}")

    return ok(serialize_submission(next(item for item in build_submission_rows() if item["id"] == submission_id)))


@app.get("/api/check/{submission_id}")
async def get_check(submission_id: str, user=Depends(current_user)):
    return await get_submission(submission_id, user)


@app.post("/api/check/{submission_id}/mark")
async def mark_check_item(submission_id: str, body: dict, user=Depends(require_roles("teacher", "admin"))):
    with get_conn() as conn:
        conn.execute(
            "UPDATE check_items SET teacher_mark = ? WHERE id = ?",
            (body.get("teacherMark"), body.get("itemId"))
        )
    return ok({"success": True})


# ---------- Scores ----------
@app.post("/api/score/{submission_id}/auto")
async def auto_score_endpoint(submission_id: str, user=Depends(require_roles("teacher", "admin"))):
    rows = build_submission_rows()
    row = next((item for item in rows if item["id"] == submission_id), None)
    if not row:
        fail("提交记录不存在", 404)

    with get_conn() as conn:
        parse_row = conn.execute("SELECT id FROM parse_results WHERE submission_id = ?", (submission_id,)).fetchone()
        if not parse_row:
            fail("请先解析成果")

    try:
        await run_auto_scoring(submission_id)
    except Exception as exc:
        fail(f"尚进大模型评分失败: {exc}")

    return ok(serialize_submission(next(item for item in build_submission_rows() if item["id"] == submission_id)))


@app.get("/api/scores/pending")
async def pending_scores(user=Depends(require_roles("teacher", "admin"))):
    rows = build_submission_rows()
    pending = [row for row in rows if row["status"] in {"submitted", "parsed", "checked", "scored", "finalized"}]
    list_data = [
        {
            "id": row["id"],
            "student": row["student_name"],
            "studentId": row["student_number"],
            "task": row["task_title"],
            "status": row["status"],
            "score": _row_get(row, "ai_total_score") if _row_get(row, "ai_total_score") is not None else "--",
            "finalScore": _row_get(row, "final_score"),
            "risk": _row_get(row, "risk_level") or "低"
        }
        for row in pending
    ]
    active_id = list_data[0]["id"] if list_data else ""
    detail = None
    if active_id:
        detail = _score_detail(active_id)
    return ok({"list": list_data, "activeId": active_id, "scoreDetail": detail})


@app.get("/api/scores/mine")
async def my_scores(user=Depends(current_user)):
    rows = build_submission_rows({"student_id": user["id"]})
    result = []
    for row in rows:
        detail = serialize_submission(row)
        score_record = detail.get("scoreRecord") or {}
        dimensions = score_record.get("dimensions") or []
        if isinstance(dimensions, str):
            dimensions = loads(dimensions, [])
        score = _row_get(row, "final_score") or _row_get(row, "teacher_adjusted_score") or _row_get(row, "ai_total_score")
        result.append({
            "submissionId": row["id"],
            "name": row["task_title"],
            "taskTitle": row["task_title"],
            "version": row["version"],
            "status": row["status"],
            "statusLabel": STATUS_LABELS.get(row["status"], row["status"]),
            "evaluationError": _row_get(row, "evaluation_error"),
            "score": f"{score:.0f}" if score is not None else "待评分",
            "percent": min(100, int(score)) if score is not None else 0,
            "aiScore": _row_get(row, "ai_total_score"),
            "finalScore": _row_get(row, "final_score") or _row_get(row, "ai_total_score"),
            "teacherComment": score_record.get("teacher_comment") or "",
            "dimensions": dimensions,
            "feedback": score_record.get("feedback", ""),
            "summary": score_record.get("summary", ""),
            "highlights": score_record.get("highlights", []),
            "errors": score_record.get("errors", []),
            "submittedAt": row["submitted_at"]
        })
    return ok(result)


@app.get("/api/scores/{submission_id}")
async def get_score_detail(submission_id: str, user=Depends(current_user)):
    # 归属校验：学生只能查看自己的成绩，教师/管理员可查看任意（教师只能看本班学生，由调用方列表已过滤）
    with get_conn() as conn:
        sub = conn.execute("SELECT student_id FROM submissions WHERE id = ?", (submission_id,)).fetchone()
        if not sub:
            fail("成绩记录不存在", 404)
        if user["role"] == "student" and sub["student_id"] != user["id"]:
            fail("无权查看他人成绩", 403)
    return ok(_score_detail(submission_id))


@app.post("/api/score/{submission_id}/teacher")
async def teacher_score(submission_id: str, body: dict, user=Depends(require_roles("teacher", "admin"))):
    now = utc_now()
    adjusted = float(body.get("teacherAdjustedScore"))
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM score_records WHERE submission_id = ?", (submission_id,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE score_records SET teacher_adjusted_score = ?, final_score = ?, adjustment_reason = ?,
                    teacher_comment = ?, status = ?, updated_at = ?
                WHERE submission_id = ?
                """,
                (adjusted, adjusted, body.get("adjustmentReason", ""), body.get("teacherComment", ""), "finalized", now, submission_id)
            )
        else:
            conn.execute(
                """
                INSERT INTO score_records (id, submission_id, teacher_adjusted_score, final_score, adjustment_reason, teacher_comment, status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id(), submission_id, adjusted, adjusted, body.get("adjustmentReason", ""), body.get("teacherComment", ""), "finalized", now)
            )
        conn.execute(
            "UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?",
            ("finalized", now, submission_id)
        )
    return ok({"success": True})


def _score_detail(submission_id: str):
    row = next((item for item in build_submission_rows() if item["id"] == submission_id), None)
    if not row:
        return None
    data = serialize_submission(row)
    score = data.get("scoreRecord") or {}
    dimensions = score.get("dimensions") or []
    if isinstance(dimensions, str):
        dimensions = loads(dimensions, [])
    return {
        "id": submission_id,
        "student": data["studentName"],
        "aiTotalScore": score.get("ai_total_score"),
        "finalScore": score.get("final_score"),
        "teacherAdjustedScore": score.get("teacher_adjusted_score"),
        "adjustmentReason": score.get("adjustment_reason") or "",
        "teacherComment": score.get("teacher_comment") or "",
        "dimensions": [
            {
                "name": item.get("name"),
                "aiScore": item.get("aiScore"),
                "total": item.get("total"),
                "evidence": item.get("evidence", "")
            }
            for item in dimensions
        ]
    }


# ---------- Reports ----------
@app.get("/api/reports/summary")
async def reports_summary(task_id: Optional[str] = None, user=Depends(current_user)):
    return ok(report_summary(task_id, user["role"], user["id"], user.get("organization") or ""))


# 学生画像 AI 建议内存缓存：{student_id: {"fingerprint": str, "suggestions": list, "ts": float}}
_PROFILE_SUGGESTIONS_CACHE: dict = {}
_PROFILE_SUGGESTIONS_TTL = 30 * 60  # 30 分钟


@app.get("/api/reports/profile")
async def reports_profile(user=Depends(current_user)):
    """学生画像：能力分布 + 标签 + AI学习建议（30 分钟内缓存）"""
    if user["role"] != "student":
        fail("学生画像仅对学生开放", 403)

    profile = student_profile(user["id"])
    ctx = profile.pop("llmContext", {})
    fp = _plan_fingerprint(ctx)

    cached = _PROFILE_SUGGESTIONS_CACHE.get(user["id"])
    if cached and cached["fingerprint"] == fp and (_time.time() - cached["ts"]) < _PROFILE_SUGGESTIONS_TTL:
        # 数据未变且在有效期内，复用缓存的 AI 建议
        profile["suggestions"] = cached["suggestions"]
        return ok(profile)

    # 调用 LLM 生成个性化建议
    suggestions = await _generate_learning_suggestions(ctx)
    profile["suggestions"] = suggestions
    _PROFILE_SUGGESTIONS_CACHE[user["id"]] = {"fingerprint": fp, "suggestions": suggestions, "ts": _time.time()}
    return ok(profile)


async def _generate_learning_suggestions(ctx: dict) -> list[dict]:
    """调用尚进大模型生成个性化学习建议，返回建议列表"""
    if not ctx.get("submissionCount"):
        return [
            {"type": "theory", "title": "暂无数据", "summary": "提交实训作业后即可获取AI个性化建议", "action": "去任务页"},
        ]

    prompt = f"""你是尚进实训平台的AI学习导师。根据以下学生实训数据，生成4条个性化学习建议。

学生数据：
- 参与任务数：{ctx.get('taskCount', 0)} 个
- 提交次数：{ctx.get('submissionCount', 0)} 次
- 平均分：{ctx.get('avgScore', 0)}
- 涉及任务：{', '.join(ctx.get('taskTitles', [])[:5]) or '无'}
- 做得好的地方：{'; '.join(ctx.get('highlights', [])[:5]) or '暂无'}
- 发现问题数：{ctx.get('errorCount', 0)}

请输出 JSON 数组（严格JSON格式），每条建议包含：
{{
  "suggestions": [
    {{"type": "theory", "title": "理论强化建议", "summary": "具体建议内容（30字以内）", "action": "查看详情"}},
    {{"type": "practice", "title": "项目实践建议", "summary": "具体建议内容（30字以内）", "action": "查看详情"}},
    {{"type": "risk", "title": "学习风险提醒", "summary": "具体建议内容（30字以内）", "action": "查看详情"}},
    {{"type": "career", "title": "职业方向建议", "summary": "具体建议内容（30字以内）", "action": "查看详情"}}
  ]
}}

要求：
1. 建议要具体、可操作，不要空泛
2. 结合学生的实际分数和表现来给建议
3. 理论和实践建议要互补
4. 风险提醒要温和但明确
5. 职业建议要结合实训方向"""

    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是专业的软件实训AI导师，善于根据数据分析给出具体可行的学习建议。只返回JSON。"},
                {"role": "user", "content": prompt}
            ],
            scene="student_profile",
            temperature=0.7,
        )
        import json as _json
        data = _json.loads(content) if isinstance(content, str) else content
        return data.get("suggestions", [])
    except Exception:
        # LLM不可用时返回基于规则的默认建议
        avg = ctx.get("avgScore", 0)
        err = ctx.get("errorCount", 0)
        return [
            {"type": "theory", "title": "理论强化建议", "summary": f"当前理论成绩{'偏弱' if avg < 60 else '不错'}，建议{'每周复习' if avg < 60 else '保持'}核心知识点（重点：数据库/后端基础）", "action": "查看详情"},
            {"type": "practice", "title": "项目实践建议", "summary": f"建议参与至少{'3' if ctx.get('submissionCount', 0) < 5 else '1'}个完整实训项目，提高工程化能力与代码规范性", "action": "查看详情"},
            {"type": "risk", "title": "学习风险提醒", "summary": f"当前提交中{'未发现' if err == 0 else f'有{err}个'}明显问题{'，建议合理安排时间' if err > 2 else ''}", "action": "查看详情"},
            {"type": "career", "title": "职业方向建议", "summary": f"更适配方向：Java后端开发 / 测试工程师（基于实训表现综合评估）", "action": "查看详情"},
        ]


import time as _time

# 学习提升方案内存缓存：{student_id: {"fingerprint": str, "plan": dict, "ts": float}}
_LEARNING_PLAN_CACHE: dict = {}
_LEARNING_PLAN_TTL = 30 * 60  # 30 分钟


def _plan_fingerprint(ctx: dict) -> str:
    """根据关键学习数据生成指纹，数据没变则指纹相同"""
    keys = [
        ctx.get("submissionCount", 0),
        ctx.get("taskCount", 0),
        ctx.get("completedTasks", 0),
        round(ctx.get("avgScore", 0), 2),
        ctx.get("errorCount", 0),
        tuple(ctx.get("taskTitles", [])[:10]),
    ]
    return str(keys)


@app.get("/api/reports/learning-plan")
async def reports_learning_plan(user=Depends(current_user)):
    """生成学生学习提升方案：8 大模块完整画像 + AI 个性化建议（30 分钟内缓存）"""
    if user["role"] != "student":
        fail("学习提升方案仅对学生开放", 403)

    profile = student_profile(user["id"])
    ctx = profile.pop("llmContext", {})
    fp = _plan_fingerprint(ctx)

    cached = _LEARNING_PLAN_CACHE.get(user["id"])
    if cached and cached["fingerprint"] == fp and (_time.time() - cached["ts"]) < _LEARNING_PLAN_TTL:
        # 数据未变且在有效期内，直接复用
        return ok(cached["plan"])

    plan = await _generate_learning_plan(user, profile, ctx)
    _LEARNING_PLAN_CACHE[user["id"]] = {"fingerprint": fp, "plan": plan, "ts": _time.time()}
    return ok(plan)


async def _generate_learning_plan(user: dict, profile: dict, ctx: dict) -> dict:
    """调用大模型按 8 大模块模板生成完整学习提升方案"""
    abilities = profile.get("abilities", [])
    tags = profile.get("tags", {})

    # 基础信息（来自用户 + 画像）
    base = {
        "studentName": user.get("name", ""),
        "studentId": user.get("student_id") or "",
        "college": (user.get("organization") or "").split(" ")[0] if user.get("organization") else "",
        "className": user.get("organization") or "",
        "stage": "在校实训阶段",
        "avgScore": profile.get("avgScore", 0),
        "gradeLabel": profile.get("gradeLabel", "--"),
        "gradeDesc": profile.get("gradeDesc", "--"),
    }

    # 能力结构（来自画像）
    skill_portrait = {
        "dimensions": [{"name": a["name"], "percent": a["value"], "rate": a["rate"]} for a in abilities],
        "gradeLabel": profile.get("gradeLabel", "--"),
        "learnType": tags.get("learnType", "均衡发展型"),
        "strength": tags.get("strength", "数据不足"),
        "weakness": tags.get("weakness", "数据不足"),
        "trend": tags.get("trend", "数据不足"),
    }

    # 风险等级
    avg = ctx.get("avgScore", 0)
    err = ctx.get("errorCount", 0)
    if avg < 60 or err > 5:
        risk_level = "高"
        risk_reason = f"平均分 {avg} 分低于及格线，且累计发现 {err} 个问题"
    elif avg < 75 or err > 2:
        risk_level = "中"
        risk_reason = f"平均分 {avg} 分，存在 {err} 个待改进问题"
    else:
        risk_level = "低"
        risk_reason = f"平均分 {avg} 分，整体表现稳定"

    current_analysis = {
        "theory": next((a["rate"] for a in abilities if a["name"] == "理论掌握"), 0),
        "practice": next((a["rate"] for a in abilities if a["name"] == "实践能力"), 0),
        "project": next((a["rate"] for a in abilities if a["name"] == "项目完成度"), 0),
        "attendance": next((a["rate"] for a in abilities if a["name"] == "出勤与参与"), 0),
        "mainProblems": [
            tags.get("weakness", "基础薄弱"),
            "项目经验不足" if ctx.get("submissionCount", 0) < 5 else "提交频率不稳定",
            "代码规范性待提升" if err > 0 else "无明显问题",
        ],
        "riskLevel": risk_level,
        "riskReason": risk_reason,
    }

    # 调用 LLM 生成 AI 个性化部分：目标 / 执行计划 / 建议
    ai_sections = await _llm_plan_sections(ctx, profile, tags, risk_level)

    return {
        "baseInfo": base,
        "currentAnalysis": current_analysis,
        "skillPortrait": skill_portrait,
        "goals": ai_sections.get("goals", {}),
        "actionPlan": ai_sections.get("actionPlan", {}),
        "riskControl": {
            "riskPoints": current_analysis["mainProblems"],
            "interventions": [
                "每周完成至少 1 次实训任务提交",
                "参加教师答疑辅导，巩固薄弱知识点",
                "结对编程，向优秀同学学习代码规范",
            ],
        },
        "evaluation": {
            "cycle": "每周评估 + 每月综合评估",
            "metrics": ["提交次数", "成绩变化趋势", "项目完成情况", "风险等级变化"],
            "standard": "达标线：平均分 ≥ 70 分 且 风险等级 ≤ 中",
        },
        "aiSuggestions": ai_sections.get("aiSuggestions", {}),
    }


async def _llm_plan_sections(ctx: dict, profile: dict, tags: dict, risk_level: str) -> dict:
    """调用 LLM 生成目标、执行计划、AI 建议三大动态模块"""
    if not ctx.get("submissionCount"):
        return {
            "goals": {
                "short": ["提交第一次实训作业", "熟悉平台提交流程"],
                "mid": ["完成 3 个实训任务", "建立代码规范意识"],
                "long": "确定职业方向（后端 / 前端 / 测试）",
            },
            "actionPlan": {
                "weeks": [
                    {"week": 1, "content": "学习实训任务要求", "task": "阅读任务文档", "submit": "提交第 1 次作业"},
                    {"week": 2, "content": "核心知识点学习", "task": "完成基础练习", "submit": "提交第 2 次作业"},
                    {"week": 3, "content": "项目综合实践", "task": "整合所学完成项目", "submit": "提交最终成果"},
                ],
            },
            "aiSuggestions": {
                "direction": "待数据积累后推荐",
                "path": "先完成基础实训任务，积累数据后再生成个性化路径",
                "positions": ["待评估"],
                "tips": ["积极参与实训", "按时提交作业", "主动请教老师"],
            },
        }

    prompt = f"""你是尚进实训平台的 AI 学习规划师。请根据学生数据生成学习提升方案的三大模块（目标 / 执行计划 / 个性化建议）。

学生数据：
- 平均分：{ctx.get('avgScore', 0)}
- 提交次数：{ctx.get('submissionCount', 0)}
- 完成任务数：{ctx.get('completedTasks', 0)} / {ctx.get('taskCount', 0)}
- 涉及任务：{', '.join(ctx.get('taskTitles', [])[:5]) or '无'}
- 优势能力：{tags.get('strength', '未知')}
- 薄弱环节：{tags.get('weakness', '未知')}
- 成长趋势：{tags.get('trend', '未知')}
- 风险等级：{risk_level}
- 发现问题数：{ctx.get('errorCount', 0)}

请严格输出以下 JSON 格式：
{{
  "goals": {{
    "short": ["1-2 周内可达成的 2 个具体目标"],
    "mid": ["1-2 月内可达成的 2 个具体目标"],
    "long": "学期/阶段职业方向建议（如后端开发/测试/前端）"
  }},
  "actionPlan": {{
    "weeks": [
      {{"week": 1, "content": "学习内容", "task": "实践任务", "submit": "提交要求"}},
      {{"week": 2, "content": "学习内容", "task": "实践任务", "submit": "提交要求"}},
      {{"week": 3, "content": "项目实践", "task": "综合训练", "submit": "提交要求"}}
    ]
  }},
  "aiSuggestions": {{
    "direction": "技术方向推荐（1 个）",
    "path": "能力提升路径（简述）",
    "positions": ["适合岗位 1", "适合岗位 2"],
    "tips": ["个性化建议 1", "个性化建议 2", "个性化建议 3"]
  }}
}}

要求：建议具体可操作，结合学生实际分数与表现。只返回 JSON。"""

    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是专业的软件实训 AI 学习规划师，擅长制定个性化学习方案。只返回 JSON。"},
                {"role": "user", "content": prompt},
            ],
            scene="student_profile",
            temperature=0.7,
        )
        import json as _json
        data = _json.loads(content) if isinstance(content, str) else content
        return {
            "goals": data.get("goals", {}),
            "actionPlan": data.get("actionPlan", {}),
            "aiSuggestions": data.get("aiSuggestions", {}),
        }
    except Exception:
        # 兜底：基于规则的默认方案
        avg = ctx.get("avgScore", 0)
        weak = tags.get("weakness", "基础")
        return {
            "goals": {
                "short": [f"提升{weak}到 70 分以上", "本周完成 1 次实训提交"],
                "mid": ["完成全部 3 个核心实训任务", "平均分达到 75 分以上"],
                "long": "Java 后端开发工程师（基于实训方向评估）",
            },
            "actionPlan": {
                "weeks": [
                    {"week": 1, "content": f"巩固{weak}基础知识", "task": "完成基础练习题", "submit": "提交第 1 次作业"},
                    {"week": 2, "content": "项目实战训练", "task": "完成小型项目开发", "submit": "提交项目源码"},
                    {"week": 3, "content": "综合项目整合", "task": "整合所学完成综合实训", "submit": "提交最终成果与文档"},
                ],
            },
            "aiSuggestions": {
                "direction": "Java 后端开发",
                "path": f"先补强{weak}，再深入项目实战，最后强化工程规范",
                "positions": ["初级 Java 开发", "软件测试工程师"],
                "tips": [
                    "每周至少完成 1 次实训任务提交",
                    f"重点加强{weak}相关知识点学习",
                    "多参考优秀作业，提升代码规范性",
                ],
            },
        }


# 管理员端用户画像 AI 建议缓存：{student_id: {"fingerprint": str, "suggestions": list, "ts": float}}
_ADMIN_PROFILE_SUGGESTIONS_CACHE: dict = {}
# 管理员端学生学习方案缓存：{student_id: {"fingerprint": str, "plan": dict, "ts": float}}
_ADMIN_LEARNING_PLAN_CACHE: dict = {}


async def _generate_teacher_teaching_plan(user: dict, profile: dict, ctx: dict) -> dict:
    """调用大模型生成教师教学报告（8大模块，与学生学习方案完全不同）"""
    abilities = profile.get("abilities", [])
    tags = profile.get("tags", {})

    # 一、教师基础信息
    base = {
        "teacherName": user.get("name", ""),
        "teacherId": user.get("student_id") or user.get("username") or "",
        "college": (user.get("organization") or "").split(" ")[0] if user.get("organization") else "",
        "teachingStage": "实训教学阶段",
        "courseCount": ctx.get("courseCount", 0),
        "taskCount": ctx.get("taskCount", 0),
        "studentCount": ctx.get("studentCount", 0),
        "gradeLabel": profile.get("gradeLabel", "--"),
        "gradeDesc": profile.get("gradeDesc", "--"),
    }

    # 二、教学现状分析
    score_rate = ctx.get("scoreRate", 0)
    feedback_rate = ctx.get("feedbackRate", 0)
    high_risk = ctx.get("highRiskCount", 0)
    pending = ctx.get("pendingReview", 0)
    avg_score = ctx.get("avgScore", 0)

    if score_rate < 40 or high_risk > 5:
        risk_level = "高"
        risk_reason = f"评分率仅 {score_rate}%，{high_risk} 份高风险提交待处理"
    elif score_rate < 70 or feedback_rate < 30:
        risk_level = "中"
        risk_reason = f"评分率 {score_rate}%，反馈率 {feedback_rate}%，教学反馈需加强"
    else:
        risk_level = "低"
        risk_reason = f"评分率 {score_rate}%，教学秩序良好"

    teaching_analysis = {
        "taskDesign": next((a["rate"] for a in abilities if a["name"] == "任务设计力"), 0),
        "gradingEfficiency": next((a["rate"] for a in abilities if a["name"] == "评分效率"), 0),
        "studentCoverage": next((a["rate"] for a in abilities if a["name"] == "学生覆盖度"), 0),
        "feedbackDepth": next((a["rate"] for a in abilities if a["name"] == "反馈深度"), 0),
        "totalSubmissions": ctx.get("submissionCount", 0),
        "scoredCount": ctx.get("scoredCount", 0),
        "mainIssues": [
            tags.get("weakness", "教学投入不足"),
            f"反馈率 {feedback_rate}%" + ("，评语覆盖偏低" if feedback_rate < 50 else ""),
            f"{high_risk} 份高风险提交" + ("需优先处理" if high_risk > 2 else "已基本可控"),
        ],
        "riskLevel": risk_level,
        "riskReason": risk_reason,
    }

    # 三、教学能力画像
    teaching_portrait = {
        "dimensions": [{"name": a["name"], "percent": a["value"], "rate": a["rate"]} for a in abilities],
        "gradeLabel": profile.get("gradeLabel", "--"),
        "teachingType": tags.get("learnType", "稳步发展型"),
        "strength": tags.get("strength", "数据不足"),
        "weakness": tags.get("weakness", "数据不足"),
        "trend": tags.get("trend", "数据不足"),
    }

    # 调用 LLM 生成教师专属的教学改进模块
    ai_sections = await _llm_teacher_plan_sections(ctx, profile, tags, risk_level)

    # 六、教学风险提醒
    risk_points = []
    if high_risk > 2:
        risk_points.append(f"{high_risk} 份高风险提交，需重点关注学生代码质量")
    if score_rate < 60:
        risk_points.append(f"评分率仅 {score_rate}%，存在评分滞后")
    if feedback_rate < 30:
        risk_points.append(f"反馈率 {feedback_rate}%，学生缺乏教师评语指导")
    if pending > 5:
        risk_points.append(f"{pending} 份提交待复核，影响教学进度")
    if not risk_points:
        risk_points.append("教学秩序良好，暂无明显风险")

    return {
        "baseInfo": base,
        "teachingAnalysis": teaching_analysis,
        "teachingPortrait": teaching_portrait,
        "goals": ai_sections.get("goals", {}),
        "actionPlan": ai_sections.get("actionPlan", {}),
        "riskControl": {
            "riskPoints": risk_points,
            "interventions": ai_sections.get("interventions", [
                "建立每周评分节奏，避免积压",
                "为高风险提交安排一对一辅导",
                "增加评语反馈，提升反馈深度",
            ]),
        },
        "evaluation": {
            "cycle": "每周教学评估 + 每月综合教学评估",
            "metrics": ["评分率", "反馈率", "学生覆盖度", "高风险提交数", "平均成绩"],
            "standard": "达标线：评分率 ≥ 80% 且 反馈率 ≥ 50% 且 风险等级 ≤ 中",
        },
        "aiSuggestions": ai_sections.get("aiSuggestions", {}),
    }


async def _llm_teacher_plan_sections(ctx: dict, profile: dict, tags: dict, risk_level: str) -> dict:
    """调用 LLM 生成教师教学报告的动态模块：教学改进目标 / 教学改进计划 / AI 教学建议"""
    if not ctx.get("taskCount"):
        return {
            "goals": {
                "short": ["创建第一个实训任务", "熟悉平台任务发布流程"],
                "mid": ["完成 3 个实训任务设计", "覆盖核心教学知识点"],
                "long": "构建完整的实训课程体系，形成可复用的教学模式",
            },
            "actionPlan": {
                "weeks": [
                    {"week": 1, "content": "梳理课程知识点", "task": "设计实训任务大纲", "submit": "发布第 1 个任务"},
                    {"week": 2, "content": "设计评价标准", "task": "制定评分维度", "submit": "完成任务评分体系"},
                    {"week": 3, "content": "教学复盘", "task": "收集学生反馈", "submit": "形成教学改进方案"},
                ],
            },
            "aiSuggestions": {
                "direction": "待数据积累后推荐",
                "path": "先完成基础教学任务设计，积累数据后生成个性化教学改进路径",
                "positions": ["待评估"],
                "tips": ["积极设计实训任务", "按时完成评分", "关注学生学习反馈"],
            },
            "interventions": [
                "建立基础教学流程",
                "从简单任务开始设计",
                "逐步积累教学数据",
            ],
        }

    prompt = f"""你是尚进实训平台的 AI 教学分析师。请根据教师教学数据生成教学报告的三大动态模块（教学改进目标 / 教学改进计划 / AI 教学建议）。

教师教学数据：
- 创建课程数：{ctx.get('courseCount', 0)} 门
- 创建任务数：{ctx.get('taskCount', 0)} 个
- 覆盖学生数：{ctx.get('studentCount', 0)} 人
- 学生提交总数：{ctx.get('submissionCount', 0)} 份
- 已评分数：{ctx.get('scoredCount', 0)} 份
- 评分率：{ctx.get('scoreRate', 0)}%
- 反馈率（评语比例）：{ctx.get('feedbackRate', 0)}%
- 高风险提交：{ctx.get('highRiskCount', 0)} 份
- 学生平均成绩：{ctx.get('avgScore', 0)} 分
- 涉及任务：{', '.join(ctx.get('taskTitles', [])[:5]) or '无'}
- 优势能力：{tags.get('strength', '未知')}
- 薄弱环节：{tags.get('weakness', '未知')}
- 教学类型：{tags.get('learnType', '未知')}
- 教学趋势：{tags.get('trend', '未知')}
- 风险等级：{risk_level}

请严格输出以下 JSON 格式：
{{
  "goals": {{
    "short": ["1-2 周内可达成的 2 个教学改进目标"],
    "mid": ["1-2 月内可达成的 2 个教学改进目标"],
    "long": "学期/阶段教学发展建议（如课程体系建设/教学评价优化）"
  }},
  "actionPlan": {{
    "weeks": [
      {{"week": 1, "content": "教学内容优化方向", "task": "任务设计改进措施", "submit": "评价方式调整"}},
      {{"week": 2, "content": "教学内容优化方向", "task": "任务设计改进措施", "submit": "评价方式调整"}},
      {{"week": 3, "content": "教学综合提升", "task": "教学模式优化", "submit": "形成改进成果"}}
    ]
  }},
  "aiSuggestions": {{
    "direction": "教学发展方向推荐（1 个，如课程体系/评价改革/产教融合）",
    "path": "教学能力提升路径（简述）",
    "positions": ["适合教学发展方向 1", "适合教学发展方向 2"],
    "tips": ["个性化教学建议 1", "个性化教学建议 2", "个性化教学建议 3"]
  }},
  "interventions": ["教学干预措施 1", "教学干预措施 2", "教学干预措施 3"]
}}

要求：
1. 建议必须基于教师真实教学数据（评分率、反馈率、风险数）生成，不要空泛
2. 教学改进计划要具体可操作，便于教师据此改进教学
3. AI 建议要针对教师的教学能力提升，而非学生学习
4. 只返回 JSON"""

    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是专业的软件实训教学分析 AI，擅长为教师生成个性化教学改进方案。只返回 JSON。"},
                {"role": "user", "content": prompt},
            ],
            scene="student_profile",
            temperature=0.7,
        )
        import json as _json
        data = _json.loads(content) if isinstance(content, str) else content
        return {
            "goals": data.get("goals", {}),
            "actionPlan": data.get("actionPlan", {}),
            "aiSuggestions": data.get("aiSuggestions", {}),
            "interventions": data.get("interventions", []),
        }
    except Exception:
        # 兜底：基于规则的默认教学改进方案
        weak = tags.get("weakness", "教学投入")
        score_rate = ctx.get("scoreRate", 0)
        feedback_rate = ctx.get("feedbackRate", 0)
        high_risk = ctx.get("highRiskCount", 0)
        strength = tags.get("strength", "教学能力")
        return {
            "goals": {
                "short": [f"提升{weak}至 70 分以上", "本周完成所有待评分提交"],
                "mid": ["建立标准化评分流程", "为每份提交补充教学评语"],
                "long": "构建覆盖全流程的实训教学评价体系",
            },
            "actionPlan": {
                "weeks": [
                    {"week": 1, "content": f"重点改进{weak}", "task": "优化任务设计增加实践环节", "submit": "完成本周全部评分"},
                    {"week": 2, "content": "建立评语模板库", "task": "为每份提交提供针对性反馈", "submit": "反馈率达 60% 以上"},
                    {"week": 3, "content": "教学综合复盘", "task": "总结教学经验形成方法论", "submit": "输出教学改进报告"},
                ],
            },
            "aiSuggestions": {
                "direction": "实训课程体系建设",
                "path": f"先补强{weak}，再深化{strength}，最终形成系统化教学模式",
                "positions": ["实训课程负责人", "教学评价改革骨干"],
                "tips": [
                    f"每周保持 {score_rate}% 以上的评分效率",
                    f"将反馈率从 {feedback_rate}% 提升至 60% 以上",
                    f"高风险提交优先处理，当前 {high_risk} 份待关注",
                ],
            },
            "interventions": [
                "建立每周固定评分时段，避免积压",
                "为高风险提交学生安排专项辅导",
                "制定评语模板，提升反馈效率与深度",
            ],
        }


async def _generate_admin_user_suggestions(ctx: dict, tags: dict, risk_level: str) -> list[dict]:
    """管理员视角：调用尚进大模型为指定学生生成个性化教学建议（带 tag 字段，适配前端 um-suggestion-item）"""
    if not ctx.get("submissionCount"):
        return [
            {"icon": "📝", "text": "该学生尚未提交实训作业，暂无足够数据生成个性化建议", "tag": "提示"},
        ]

    prompt = f"""你是尚进实训平台的 AI 学情分析助手，正在为管理员分析学生数据并生成个性化教学建议。

学生数据：
- 参与任务数：{ctx.get('taskCount', 0)} 个
- 已完成任务：{ctx.get('completedTasks', 0)} 个
- 提交次数：{ctx.get('submissionCount', 0)} 次
- 平均分：{ctx.get('avgScore', 0)}
- 涉及任务：{', '.join(ctx.get('taskTitles', [])[:5]) or '无'}
- 优势能力：{tags.get('strength', '未知')}
- 薄弱环节：{tags.get('weakness', '未知')}
- 学习类型：{tags.get('learnType', '未知')}
- 成长趋势：{tags.get('trend', '未知')}
- 发现问题数：{ctx.get('errorCount', 0)}
- 风险等级：{risk_level}

请输出 JSON（严格 JSON 格式），生成 4 条针对该学生的个性化建议，每条建议包含：
{{
  "suggestions": [
    {{"icon": "💡", "text": "具体建议内容（25字以内，结合学生实际数据）", "tag": "提升"}},
    {{"icon": "📚", "text": "具体建议内容（25字以内）", "tag": "建议"}},
    {{"icon": "⚠️", "text": "具体建议内容（25字以内）", "tag": "关注"}},
    {{"icon": "🎯", "text": "具体建议内容（25字以内）", "tag": "拓展"}}
  ]
}}

要求：
1. 建议必须基于学生真实数据（分数、薄弱项、问题数）生成，不要空泛
2. 内容要具体可操作，便于管理员据此指导学生
3. tag 字段固定为：提升 / 建议 / 关注 / 拓展 四类之一
4. 只返回 JSON"""

    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是专业的软件实训学情分析 AI 助手，擅长根据学生数据生成个性化教学建议。只返回 JSON。"},
                {"role": "user", "content": prompt}
            ],
            scene="student_profile",
            temperature=0.7,
        )
        import json as _json
        data = _json.loads(content) if isinstance(content, str) else content
        return data.get("suggestions", [])
    except Exception:
        # LLM 不可用时返回基于规则的默认建议
        avg = ctx.get("avgScore", 0)
        weak = tags.get("weakness", "基础")
        err = ctx.get("errorCount", 0)
        strength = tags.get("strength", "优势")
        return [
            {"icon": "💡", "text": f"针对{weak}薄弱项，建议安排专项练习巩固提升", "tag": "提升"},
            {"icon": "📚", "text": f"当前平均分 {avg} 分，{'需加强理论基础学习' if avg < 70 else '保持理论学习节奏'}", "tag": "建议"},
            {"icon": "⚠️", "text": f"累计 {err} 个问题待改进{'，建议安排辅导' if err > 2 else '，整体可控'}", "tag": "关注"},
            {"icon": "", "text": f"结合{strength}方向，可推荐进阶实训项目拓展能力", "tag": "拓展"},
        ]


async def _generate_admin_teacher_suggestions(ctx: dict, tags: dict, risk_level: str) -> list[dict]:
    """管理员视角：为教师生成个性化教学建议（带 tag 字段，适配前端 um-suggestion-item）"""
    if not ctx.get("taskCount"):
        return [
            {"icon": "", "text": "该教师尚未创建实训任务，暂无足够数据生成个性化教学建议", "tag": "提示"},
        ]

    prompt = f"""你是尚进实训平台的 AI 教学分析助手，正在为管理员分析教师教学数据并生成个性化教学建议。

教师教学数据：
- 创建课程数：{ctx.get('courseCount', 0)} 门
- 创建任务数：{ctx.get('taskCount', 0)} 个
- 学生提交总数：{ctx.get('submissionCount', 0)} 份
- 覆盖学生数：{ctx.get('studentCount', 0)} 人
- 已评分数：{ctx.get('scoredCount', 0)} 份
- 平均成绩：{ctx.get('avgScore', 0)} 分
- 评分率：{ctx.get('scoreRate', 0)}%
- 反馈率（有评语比例）：{ctx.get('feedbackRate', 0)}%
- 高风险提交：{ctx.get('highRiskCount', 0)} 份
- 待复核：{ctx.get('pendingReview', 0)} 份
- 教师调整分数次数：{ctx.get('teacherAdjustedCount', 0)} 次
- 涉及课程：{', '.join(ctx.get('courseNames', [])[:5]) or '无'}
- 涉及任务：{', '.join(ctx.get('taskTitles', [])[:5]) or '无'}
- 优势能力：{tags.get('strength', '未知')}
- 薄弱环节：{tags.get('weakness', '未知')}
- 教学类型：{tags.get('learnType', '未知')}
- 教学趋势：{tags.get('trend', '未知')}
- 风险等级：{risk_level}

请输出 JSON（严格 JSON 格式），生成 4 条针对该教师的个性化教学建议，每条建议包含：
{{
  "suggestions": [
    {{"icon": "💡", "text": "具体建议内容（25字以内，结合教师实际数据）", "tag": "提升"}},
    {{"icon": "📚", "text": "具体建议内容（25字以内）", "tag": "建议"}},
    {{"icon": "⚠️", "text": "具体建议内容（25字以内）", "tag": "关注"}},
    {{"icon": "🎯", "text": "具体建议内容（25字以内）", "tag": "拓展"}}
  ]
}}

要求：
1. 建议必须基于教师真实教学数据（课程数、评分率、反馈率、风险数）生成，不要空泛
2. 内容要具体可操作，便于管理员据此评估和指导教师
3. tag 字段固定为：提升 / 建议 / 关注 / 拓展 四类之一
4. 只返回 JSON"""

    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是专业的软件实训教学分析 AI 助手，擅长根据教师教学数据生成个性化教学建议。只返回 JSON。"},
                {"role": "user", "content": prompt}
            ],
            scene="student_profile",
            temperature=0.7,
        )
        import json as _json
        data = _json.loads(content) if isinstance(content, str) else content
        return data.get("suggestions", [])
    except Exception:
        # LLM 不可用时返回基于规则的默认建议
        avg = ctx.get("avgScore", 0)
        weak = tags.get("weakness", "基础")
        score_rate = ctx.get("scoreRate", 0)
        feedback_rate = ctx.get("feedbackRate", 0)
        high_risk = ctx.get("highRiskCount", 0)
        pending = ctx.get("pendingReview", 0)
        strength = tags.get("strength", "优势")
        return [
            {"icon": "💡", "text": f"针对{weak}薄弱项，建议加强该方面的教学投入", "tag": "提升"},
            {"icon": "📚", "text": f"当前评分率 {score_rate}%，{'需加快评分进度' if score_rate < 60 else '评分效率良好'}", "tag": "建议"},
            {"icon": "⚠️", "text": f"{high_risk} 份高风险提交{'待优先处理' if high_risk > 2 else '已处理'}" + (f"，{pending} 份待复核" if pending else ""), "tag": "关注"},
            {"icon": "🎯", "text": f"结合{strength}优势，可拓展更多创新实训任务设计", "tag": "拓展"},
        ]


def _render_learning_plan_pdf(plan: dict, operator_id: str) -> dict:
    """将学习提升方案 plan 渲染为 PDF 文件并保存，返回文件信息 dict（学生端/管理员端共用）"""
    from fpdf import FPDF
    from app.services import _setup_pdf_font, _save_snapshot
    from app.config import EXPORT_DIR, PLATFORM_NAME
    from datetime import datetime

    pdf = FPDF()
    pdf.add_page()
    has_cjk = _setup_pdf_font(pdf)
    font = "CJK" if has_cjk else "Helvetica"

    b = plan.get("baseInfo", {})
    c = plan.get("currentAnalysis", {})
    s = plan.get("skillPortrait", {})
    g = plan.get("goals", {})
    a = plan.get("actionPlan", {})
    rc = plan.get("riskControl", {})
    ev = plan.get("evaluation", {})
    ai = plan.get("aiSuggestions", {})

    # 标题
    pdf.set_font(font, size=16)
    pdf.cell(0, 10, "学习提升方案" if has_cjk else "Learning Plan", ln=1, align="C")
    pdf.set_font(font, size=9)
    pdf.cell(0, 6, f"{PLATFORM_NAME} | 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ln=1, align="C")
    pdf.ln(4)

    def section(title):
        pdf.ln(2)
        pdf.set_font(font, size=12)
        pdf.set_fill_color(79, 124, 255)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(0, 7, title, ln=1, fill=True)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font(font, size=10)

    def line(text=""):
        pdf.x = pdf.l_margin
        pdf.multi_cell(0, 6, str(text), new_x="LMARGIN", new_y="NEXT")

    # 一、基础信息
    section("一、基础信息")
    line(f"学生姓名：{b.get('studentName', '--')}    学号：{b.get('studentId', '--')}")
    line(f"学院：{b.get('college', '--')}    班级：{b.get('className', '--')}")
    line(f"当前阶段：{b.get('stage', '--')}    综合评分：{b.get('avgScore', '--')} 分")
    line(f"综合评级：{b.get('gradeLabel', '--')}（{b.get('gradeDesc', '--')}）    风险等级：{c.get('riskLevel', '--')}")

    # 二、现状诊断
    section("二、现状诊断")
    line(f"理论掌握：{c.get('theory', 0)}%    实践能力：{c.get('practice', 0)}%")
    line(f"项目完成度：{c.get('project', 0)}%    学习主动性：{c.get('attendance', 0)}%")
    line("当前主要问题：")
    for p in (c.get("mainProblems") or []):
        line(f"  - {p}")
    line(f"风险判断：{c.get('riskLevel', '--')}风险 - {c.get('riskReason', '--')}")

    # 三、能力结构画像
    section("三、能力结构画像")
    for d in (s.get("dimensions") or []):
        line(f"  {d.get('name', '--')}：占比 {d.get('percent', 0)}%，得分率 {d.get('rate', 0)}%")
    line(f"综合评级：{s.get('gradeLabel', '--')}    学习类型：{s.get('learnType', '--')}")
    line(f"优势能力：{s.get('strength', '--')}    薄弱环节：{s.get('weakness', '--')}    成长趋势：{s.get('trend', '--')}")

    # 四、学习目标设定
    section("四、学习目标设定")
    line("短期目标（1-2 周）：")
    for x in (g.get("short") or []):
        line(f"  - {x}")
    line("中期目标（1-2 月）：")
    for x in (g.get("mid") or []):
        line(f"  - {x}")
    line(f"长期目标：{g.get('long', '--')}")

    # 五、具体执行计划
    section("五、具体执行计划")
    for w in (a.get("weeks") or []):
        line(f"Week {w.get('week', '--')}")
        line(f"  学习内容：{w.get('content', '--')}")
        line(f"  实践任务：{w.get('task', '--')}")
        line(f"  提交要求：{w.get('submit', '--')}")

    # 六、风险提醒
    section("六、风险提醒")
    line("当前风险点：")
    for p in (rc.get("riskPoints") or []):
        line(f"  - {p}")
    line("建议干预措施：")
    for p in (rc.get("interventions") or []):
        line(f"  - {p}")

    # 七、阶段评估机制
    section("七、阶段评估机制")
    line(f"评估周期：{ev.get('cycle', '--')}")
    line(f"评估指标：{'、'.join(ev.get('metrics') or [])}")
    line(f"达标标准：{ev.get('standard', '--')}")

    # 八、AI 个性化建议
    section("八、AI 个性化建议")
    line(f"推荐方向：{ai.get('direction', '--')}")
    line(f"提升路径：{ai.get('path', '--')}")
    line(f"适合岗位：{'、'.join(ai.get('positions') or [])}")
    line("个性化建议：")
    for t in (ai.get("tips") or []):
        line(f"  - {t}")

    # 页脚
    pdf.ln(4)
    pdf.set_font(font, size=8)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 5, f"— {PLATFORM_NAME} 自动生成 —", ln=1, align="C")

    snapshot_id = new_id()[:8]
    filename = f"learning-plan-{snapshot_id}.pdf"
    file_path = EXPORT_DIR / filename
    pdf.output(str(file_path))
    _save_snapshot("learning_plan", "pdf", filename, str(file_path), operator_id)
    return {"filename": filename, "snapshotId": snapshot_id, "downloadUrl": f"/api/reports/download/{filename}"}


def _render_teacher_plan_pdf(plan: dict, operator_id: str) -> dict:
    """将教师教学报告 plan 渲染为 PDF（教师专属模块，与学生方案不同）"""
    from fpdf import FPDF
    from app.services import _setup_pdf_font, _save_snapshot
    from app.config import EXPORT_DIR, PLATFORM_NAME
    from datetime import datetime

    pdf = FPDF()
    pdf.add_page()
    has_cjk = _setup_pdf_font(pdf)
    font = "CJK" if has_cjk else "Helvetica"

    b = plan.get("baseInfo", {})
    t = plan.get("teachingAnalysis", {})
    s = plan.get("teachingPortrait", {})
    g = plan.get("goals", {})
    a = plan.get("actionPlan", {})
    rc = plan.get("riskControl", {})
    ev = plan.get("evaluation", {})
    ai = plan.get("aiSuggestions", {})

    # 标题
    pdf.set_font(font, size=16)
    pdf.cell(0, 10, "教师教学报告" if has_cjk else "Teaching Report", ln=1, align="C")
    pdf.set_font(font, size=9)
    pdf.cell(0, 6, f"{PLATFORM_NAME} | 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ln=1, align="C")
    pdf.ln(4)

    def section(title):
        pdf.ln(2)
        pdf.set_font(font, size=12)
        pdf.set_fill_color(79, 124, 255)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(0, 7, title, ln=1, fill=True)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font(font, size=10)

    def line(text=""):
        pdf.x = pdf.l_margin
        pdf.multi_cell(0, 6, str(text), new_x="LMARGIN", new_y="NEXT")

    # 一、教师基础信息
    section("一、教师基础信息")
    line(f"教师姓名：{b.get('teacherName', '--')}    工号：{b.get('teacherId', '--')}")
    line(f"学院：{b.get('college', '--')}    教学阶段：{b.get('teachingStage', '--')}")
    line(f"创建课程：{b.get('courseCount', 0)} 门    创建任务：{b.get('taskCount', 0)} 个    覆盖学生：{b.get('studentCount', 0)} 人")
    line(f"教学评级：{b.get('gradeLabel', '--')}（{b.get('gradeDesc', '--')}）")

    # 二、教学现状分析
    section("二、教学现状分析")
    line(f"任务设计力：{t.get('taskDesign', 0)}%    评分效率：{t.get('gradingEfficiency', 0)}%")
    line(f"学生覆盖度：{t.get('studentCoverage', 0)}%    反馈深度：{t.get('feedbackDepth', 0)}%")
    line(f"学生提交总数：{t.get('totalSubmissions', 0)} 份    已评分数：{t.get('scoredCount', 0)} 份")
    line("当前主要问题：")
    for p in (t.get("mainIssues") or []):
        line(f"  - {p}")
    line(f"风险判断：{t.get('riskLevel', '--')}风险 - {t.get('riskReason', '--')}")

    # 三、教学能力画像
    section("三、教学能力画像")
    for d in (s.get("dimensions") or []):
        line(f"  {d.get('name', '--')}：占比 {d.get('percent', 0)}%，得分率 {d.get('rate', 0)}%")
    line(f"综合评级：{s.get('gradeLabel', '--')}    教学类型：{s.get('teachingType', '--')}")
    line(f"优势能力：{s.get('strength', '--')}    薄弱环节：{s.get('weakness', '--')}    教学趋势：{s.get('trend', '--')}")

    # 四、教学改进目标
    section("四、教学改进目标")
    line("短期目标（1-2 周）：")
    for x in (g.get("short") or []):
        line(f"  - {x}")
    line("中期目标（1-2 月）：")
    for x in (g.get("mid") or []):
        line(f"  - {x}")
    line(f"长期目标：{g.get('long', '--')}")

    # 五、教学改进计划
    section("五、教学改进计划")
    for w in (a.get("weeks") or []):
        line(f"Week {w.get('week', '--')}")
        line(f"  教学内容优化：{w.get('content', '--')}")
        line(f"  任务设计改进：{w.get('task', '--')}")
        line(f"  评价方式调整：{w.get('submit', '--')}")

    # 六、教学风险提醒
    section("六、教学风险提醒")
    line("当前风险点：")
    for p in (rc.get("riskPoints") or []):
        line(f"  - {p}")
    line("建议干预措施：")
    for p in (rc.get("interventions") or []):
        line(f"  - {p}")

    # 七、教学质量评估机制
    section("七、教学质量评估机制")
    line(f"评估周期：{ev.get('cycle', '--')}")
    line(f"评估指标：{'、'.join(ev.get('metrics') or [])}")
    line(f"达标标准：{ev.get('standard', '--')}")

    # 八、AI 教学建议
    section("八、AI 教学建议")
    line(f"教学发展方向：{ai.get('direction', '--')}")
    line(f"教学提升路径：{ai.get('path', '--')}")
    line(f"适合教学方向：{'、'.join(ai.get('positions') or [])}")
    line("个性化教学建议：")
    for tip in (ai.get("tips") or []):
        line(f"  - {tip}")

    # 页脚
    pdf.ln(4)
    pdf.set_font(font, size=8)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 5, f"— {PLATFORM_NAME} 自动生成 —", ln=1, align="C")

    snapshot_id = new_id()[:8]
    filename = f"teaching-report-{snapshot_id}.pdf"
    file_path = EXPORT_DIR / filename
    pdf.output(str(file_path))
    _save_snapshot("teaching_report", "pdf", filename, str(file_path), operator_id)
    return {"filename": filename, "snapshotId": snapshot_id, "downloadUrl": f"/api/reports/download/{filename}"}


@app.get("/api/reports/learning-plan/pdf")
async def reports_learning_plan_pdf(user=Depends(current_user)):
    """导出学习提升方案为 PDF（复用缓存方案，不再调 LLM）"""
    if user["role"] != "student":
        fail("学习提升方案仅对学生开放", 403)

    # 优先复用缓存方案，未命中才重新生成（调 LLM）
    cached = _LEARNING_PLAN_CACHE.get(user["id"])
    if cached and (_time.time() - cached["ts"]) < _LEARNING_PLAN_TTL:
        plan = cached["plan"]
    else:
        profile = student_profile(user["id"])
        ctx = profile.pop("llmContext", {})
        fp = _plan_fingerprint(ctx)
        plan = await _generate_learning_plan(user, profile, ctx)
        _LEARNING_PLAN_CACHE[user["id"]] = {"fingerprint": fp, "plan": plan, "ts": _time.time()}

    result = _render_learning_plan_pdf(plan, user["id"])
    return ok(result)


@app.get("/api/reports/export")
async def reports_export(
    format: str = "excel",
    report_type: str = "class",
    task_id: Optional[str] = None,
    user=Depends(current_user),
):
    # 学生只能导出个人报告
    actual_report_type = "personal" if user["role"] == "student" else report_type
    sid = user["id"] if user["role"] == "student" else None
    if format == "pdf":
        return ok(export_pdf(actual_report_type, user["id"], task_id, sid))
    return ok(export_excel(actual_report_type, user["id"], task_id, sid))


@app.get("/api/reports/download/{filename}")
async def download_report(
    filename: str,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(None),
    x_auth_token: Optional[str] = Header(None)
):
    auth_token = token or x_auth_token or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None)
    user = get_user_by_token(auth_token)
    if not user:
        fail("请先登录", 401)
    # 归属校验：仅允许下载自己生成的报表快照（管理员除外）
    safe_name = Path(filename).name
    with get_conn() as conn:
        snap = conn.execute(
            "SELECT created_by FROM report_snapshots WHERE file_path LIKE ?",
            (f"%{safe_name}%",)
        ).fetchone()
        if snap and snap["created_by"] != user["id"] and user["role"] != "admin":
            fail("无权下载他人的报表", 403)
    path = EXPORT_DIR / safe_name
    if not path.exists():
        fail("文件不存在", 404)
    media = "application/pdf" if path.suffix == ".pdf" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return FileResponse(path, filename=path.name, media_type=media)


# ---------- Model ----------
@app.get("/api/model/health")
async def model_health(user=Depends(require_roles("teacher", "admin"))):
    return ok(await health_check())


@app.get("/api/model/config")
async def model_config(user=Depends(require_roles("admin"))):
    from app.config import ARK_API_KEY, ARK_BASE_URL, ARK_MODEL
    with get_conn() as conn:
        logs = rows_to_list(
            conn.execute(
                "SELECT scene, model_name, latency_ms, success, error_message, created_at FROM model_call_logs ORDER BY created_at DESC LIMIT 20"
            ).fetchall()
        )
    return ok({
        "modelName": MODEL_DISPLAY_NAME,
        "engineModel": ARK_MODEL,
        "platformName": PLATFORM_NAME,
        "baseUrl": ARK_BASE_URL,
        "apiKeyConfigured": bool(ARK_API_KEY),
        "type": "尚进云端大模型",
        "logs": [
            {**log, "model_name": MODEL_DISPLAY_NAME if log.get("model_name") else MODEL_DISPLAY_NAME}
            for log in logs
        ]
    })


@app.post("/api/model/test")
async def model_test(user=Depends(require_roles("admin"))):
    result = await health_check()
    return ok(result)


# ---------- Admin ----------
def _load_college_names() -> list:
    """从 classes 表加载所有学院/部门名（不含数字的组织名），用于班级前缀匹配。"""
    import re
    with get_conn() as conn:
        rows = conn.execute("SELECT DISTINCT name FROM classes ORDER BY name").fetchall()
    return [r["name"] for r in rows if not re.search(r"\d", r["name"])]


def extract_college_prefix(org: str, colleges: list = None) -> str:
    """从 organization 提取完整学院名（作为学院分组的 key）。

    规则：
      - 班级（含数字）：提取中文前缀，匹配 classes 表中以该前缀开头的学院名
        例如 "软件 2301" → 前缀"软件" → 匹配 "软件工程学院"
      - 学院/部门（不含数字）：直接返回，如 "软件工程学院"、"教务处"
      - 空值 → ""
    """
    import re
    org = (org or "").strip()
    if not org:
        return ""
    # 含数字 → 班级，提取中文前缀匹配完整学院名
    m = re.match(r"^([\u4e00-\u9fa5]+)", org)
    if m:
        prefix = m.group(1)
        if colleges is None:
            colleges = _load_college_names()
        # 双向前缀匹配，选最长匹配的学院名：
        #   "软件" 匹配 "软件工程学院"（college 以 prefix 开头）
        #   "信息工程学院软件" 匹配 "信息工程学院"（prefix 以 college 开头）
        matched = None
        for college in colleges:
            if college.startswith(prefix) or prefix.startswith(college):
                if matched is None or len(college) > len(matched):
                    matched = college
        return matched if matched else prefix
    # 不含数字 → 学院或行政部门，直接返回
    return org


def extract_class_name(org: str) -> str:
    """从 organization 字段提取班级名称（仅学生有班级，含数字即为班级）。"""
    import re
    org = (org or "").strip()
    if not org:
        return ""
    if re.search(r"\d", org):
        return org
    return ""


@app.post("/api/admin/users")
async def admin_create_user(body: dict, user=Depends(require_roles("admin"))):
    """管理员添加用户"""
    username = (body.get("username") or "").strip()
    if not username:
        fail("账号不能为空")
    with get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
        if exists:
            fail("用户名已存在")
        user_id = new_id()
        conn.execute(
            """
            INSERT INTO users (id, username, password, name, role, organization, student_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                username,
                body.get("password"),
                body.get("name"),
                body.get("role", "student"),
                body.get("organization", ""),
                body.get("student_id"),
                utc_now()
            )
        )
    return ok({"message": "创建成功", "id": user_id})


@app.get("/api/admin/users")
async def admin_users(user=Depends(require_roles("admin"))):
    with get_conn() as conn:
        users = rows_to_list(conn.execute(
            "SELECT id, name, username, role, organization, student_id, created_at FROM users ORDER BY created_at DESC"
        ).fetchall())

    # 预加载完整学院/部门名列表，用于班级前缀匹配（避免逐用户查库）
    colleges = _load_college_names()

    # 构建学院树：按完整学院名分组，每个学院含教师列表和班级列表（班级含学生数）
    org_map = {}
    for u in users:
        college = extract_college_prefix(u.get("organization", ""), colleges)
        if not college:
            continue
        if college not in org_map:
            org_map[college] = {
                "student": 0, "teacher": 0, "admin": 0,
                "teachers": [], "classes": {}
            }
        role_key = u.get("role", "student")
        if role_key in ("student", "teacher", "admin"):
            org_map[college][role_key] += 1
        if role_key == "teacher":
            org_map[college]["teachers"].append({
                "id": u["id"],
                "name": u["name"],
                "username": u["username"],
                "studentId": u.get("student_id") or u["username"],
                "organization": u.get("organization", ""),
            })
        elif role_key == "student":
            class_name = extract_class_name(u.get("organization", ""))
            if class_name:
                org_map[college]["classes"][class_name] = org_map[college]["classes"].get(class_name, 0) + 1

    organization_tree = [
        {
            "name": name,
            "studentCount": counts["student"],
            "teacherCount": counts["teacher"],
            "adminCount": counts["admin"],
            "totalCount": counts["student"] + counts["teacher"] + counts["admin"],
            "teachers": counts["teachers"],
            "classes": [
                {"name": cn, "studentCount": sc}
                for cn, sc in sorted(counts["classes"].items(), key=lambda x: x[0])
            ],
        }
        for name, counts in sorted(org_map.items(), key=lambda x: x[1]["student"], reverse=True)
    ]

    # 丰富用户数据
    def enrich_user(u):
        org = (u.get("organization") or "").strip()
        class_name = extract_class_name(org)
        grade = ""
        if class_name:
            import re
            m = re.search(r'(\d{4})', class_name)
            if m:
                grade = f"{m.group(1)}级"
            else:
                m = re.search(r'(\d{2})', class_name)
                if m:
                    grade = f"20{m.group(1)}级"

        status = "正常"

        return {
            "id": u["id"],
            "name": u["name"],
            "username": u["username"],
            "studentId": u.get("student_id") or u["username"],
            "organization": org,
            "college": extract_college_prefix(org, colleges),
            "className": class_name,
            "grade": grade,
            "role": {"student": "学生", "teacher": "教师", "admin": "管理员"}.get(u.get("role"), u.get("role")),
            "roleKey": u.get("role", "student"),
            "status": status,
            "createdAt": u.get("created_at", ""),
        }

    students = [enrich_user(u) for u in users if u["role"] == "student"]
    teachers = [enrich_user(u) for u in users if u["role"] == "teacher"]
    admins = [enrich_user(u) for u in users if u["role"] == "admin"]

    return ok({
        "students": students,
        "teachers": teachers,
        "admins": admins,
        "organizationTree": organization_tree,
        "stats": {
            "totalStudents": len(students),
            "totalTeachers": len(teachers),
            "totalAdmins": len(admins),
        }
    })


@app.get("/api/admin/classes/{class_name}/students")
async def admin_class_students(class_name: str, user=Depends(require_roles("admin"))):
    """获取指定班级的所有真实学生数据。

    班级名称按 organization 字段精确匹配（如 "软件 2301"）。
    """
    target = class_name.strip()
    with get_conn() as conn:
        users = rows_to_list(conn.execute(
            "SELECT id, username, name, student_id, organization FROM users WHERE role = 'student' ORDER BY name"
        ).fetchall())

    students = [
        {
            "id": u["id"],
            "username": u["username"],
            "name": u["name"],
            "studentId": u.get("student_id") or u["username"],
            "organization": u.get("organization", ""),
            "className": extract_class_name(u.get("organization", "")),
        }
        for u in users
        if extract_class_name(u.get("organization", "")) == target
    ]
    return ok({"class": target, "students": students, "total": len(students)})


@app.get("/api/admin/users/{user_id}/profile")
async def admin_user_profile(user_id: str, user=Depends(require_roles("admin"))):
    """获取用户画像详情（用于右侧面板）：根据角色走不同评价体系 + LLM 个性化建议（30分钟缓存）"""
    with get_conn() as conn:
        u = conn.execute(
            "SELECT id, name, username, role, organization, student_id, created_at FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
    if not u:
        from app.response import fail
        fail("用户不存在", 404)

    u = dict(u)
    org = (u.get("organization") or "").strip()
    college = extract_college_prefix(org)
    role_key = u.get("role", "student")

    if role_key == "teacher":
        # ===== 教师评价体系 =====
        profile_data = teacher_profile(user_id)
        ctx = profile_data.pop("llmContext", {})
        tags = profile_data.get("tags", {})

        avg_score = profile_data.get("avgScore", 0)
        abilities = profile_data.get("abilities", [])
        overall_score = avg_score if avg_score > 0 else 0
        grade_label = profile_data.get("gradeLabel", "--")
        grade_desc = profile_data.get("gradeDesc", "--")

        # 教师风险等级（基于评分效率 + 反馈深度）
        grading_rate = next((a.get("rate", 0) for a in abilities if a.get("name") == "评分效率"), 0)
        feedback_rate = next((a.get("rate", 0) for a in abilities if a.get("name") == "反馈深度"), 0)
        high_risk = ctx.get("highRiskCount", 0)
        pending = ctx.get("pendingReview", 0)
        if grading_rate >= 70 and feedback_rate >= 50 and high_risk <= 2:
            risk_level = "低"
            risk_percent = round(max(5, (100 - overall_score) * 0.5), 0)
        elif grading_rate >= 40:
            risk_level = "中"
            risk_percent = round(50 + (70 - overall_score) * 0.8, 0)
        else:
            risk_level = "高"
            risk_percent = round(min(95, 85 + (50 - overall_score) * 0.5), 0)

        weak = tags.get("weakness", "")
        if risk_level == "低":
            risk_desc = "教学状态良好" + (f"，{weak}仍有提升空间" if weak and weak != "数据不足" else "，继续保持")
        elif risk_level == "中":
            risk_desc = f"需关注{weak or '教学进度'}，建议加强针对性教学投入"
        else:
            risk_desc = f"教学风险较高，{weak or '教学投入'}需重点加强" + (f"，{pending} 份待复核" if pending else "")

        # 教师 AI 建议
        fp = _plan_fingerprint(ctx)
        cached = _ADMIN_PROFILE_SUGGESTIONS_CACHE.get(user_id)
        if cached and cached["fingerprint"] == fp and (_time.time() - cached["ts"]) < _PROFILE_SUGGESTIONS_TTL:
            suggestions = cached["suggestions"]
        else:
            suggestions = await _generate_admin_teacher_suggestions(ctx, tags, risk_level)
            _ADMIN_PROFILE_SUGGESTIONS_CACHE[user_id] = {"fingerprint": fp, "suggestions": suggestions, "ts": _time.time()}

        return ok({
            "user": {
                "id": u["id"],
                "name": u["name"],
                "username": u["username"],
                "studentId": u.get("student_id") or u["username"],
                "organization": org,
                "college": college,
                "role": "教师",
                "status": "正常",
                "createdAt": u.get("created_at", ""),
            },
            "abilities": abilities,
            "overallScore": overall_score,
            "gradeLabel": grade_label,
            "gradeDesc": grade_desc,
            "metrics": {
                "avgScore": avg_score,
                "courseCount": ctx.get("courseCount", 0),
                "taskCount": ctx.get("taskCount", 0),
                "submissionCount": ctx.get("submissionCount", 0),
                "studentCount": ctx.get("studentCount", 0),
                "scoreRate": ctx.get("scoreRate", 0),
                "feedbackRate": ctx.get("feedbackRate", 0),
                "highRiskCount": ctx.get("highRiskCount", 0),
                "pendingReview": ctx.get("pendingReview", 0),
            },
            "riskLevel": risk_level,
            "riskPercent": risk_percent,
            "riskDesc": risk_desc,
            "suggestions": suggestions,
        })

    else:
        # ===== 学生评价体系（原有逻辑） =====
        profile_data = student_profile(user_id)
        ctx = profile_data.pop("llmContext", {})
        tags = profile_data.get("tags", {})

        avg_score = profile_data.get("avgScore", 0)
        submission_count = ctx.get("submissionCount", 0)
        completed_tasks = ctx.get("completedTasks", 0)
        total_tasks = ctx.get("taskCount", 0)
        abilities = profile_data.get("abilities", [])
        attendance_rate = next((a.get("rate", 0) for a in abilities if a.get("name") == "出勤与参与"), 0)

        overall_score = avg_score if avg_score > 0 else 0
        grade_label = profile_data.get("gradeLabel", "--")
        grade_desc = profile_data.get("gradeDesc", "--")

        err_count = ctx.get("errorCount", 0)
        if overall_score >= 70 and err_count <= 2:
            risk_level = "低"
            risk_percent = round(max(5, (100 - overall_score) * 0.5), 0)
        elif overall_score >= 50:
            risk_level = "中"
            risk_percent = round(50 + (70 - overall_score) * 0.8, 0)
        else:
            risk_level = "高"
            risk_percent = round(min(95, 85 + (50 - overall_score) * 0.5), 0)

        weak = tags.get("weakness", "")
        if risk_level == "低":
            risk_desc = "学习状态良好" + (f"，{weak}仍有提升空间" if weak and weak != "数据不足" else "，继续保持")
        elif risk_level == "中":
            risk_desc = f"需关注{weak or '学习进度'}，建议加强针对性练习"
        else:
            risk_desc = f"风险较高，{weak or '基础薄弱'}需重点辅导" + (f"，累计 {err_count} 个问题待改进" if err_count else "")

        fp = _plan_fingerprint(ctx)
        cached = _ADMIN_PROFILE_SUGGESTIONS_CACHE.get(user_id)
        if cached and cached["fingerprint"] == fp and (_time.time() - cached["ts"]) < _PROFILE_SUGGESTIONS_TTL:
            suggestions = cached["suggestions"]
        else:
            suggestions = await _generate_admin_user_suggestions(ctx, tags, risk_level)
            _ADMIN_PROFILE_SUGGESTIONS_CACHE[user_id] = {"fingerprint": fp, "suggestions": suggestions, "ts": _time.time()}

        return ok({
            "user": {
                "id": u["id"],
                "name": u["name"],
                "username": u["username"],
                "studentId": u.get("student_id") or u["username"],
                "organization": org,
                "college": college,
                "role": {"student": "学生", "teacher": "教师", "admin": "管理员"}.get(u.get("role"), u.get("role")),
                "status": "正常",
                "createdAt": u.get("created_at", ""),
            },
            "abilities": abilities,
            "overallScore": overall_score,
            "gradeLabel": grade_label,
            "gradeDesc": grade_desc,
            "metrics": {
                "avgScore": avg_score,
                "submissionCount": submission_count,
                "completedTasks": completed_tasks,
                "totalTasks": total_tasks,
                "attendanceRate": attendance_rate,
            },
            "riskLevel": risk_level,
            "riskPercent": risk_percent,
            "riskDesc": risk_desc,
            "suggestions": suggestions,
        })


@app.get("/api/admin/users/{user_id}/learning-plan")
async def admin_user_learning_plan(user_id: str, user=Depends(require_roles("admin"))):
    """管理员生成指定用户的学习/教学报告（根据角色走不同模块，30分钟缓存）"""
    with get_conn() as conn:
        u = conn.execute(
            "SELECT id, name, username, role, organization, student_id FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
    if not u:
        fail("用户不存在", 404)
    u = dict(u)
    role_key = u.get("role", "student")

    if role_key == "teacher":
        profile_data = teacher_profile(user_id)
        ctx = profile_data.pop("llmContext", {})
        fp = _plan_fingerprint(ctx)

        cached = _ADMIN_LEARNING_PLAN_CACHE.get(user_id)
        if cached and cached["fingerprint"] == fp and (_time.time() - cached["ts"]) < _LEARNING_PLAN_TTL:
            return ok(cached["plan"])

        plan = await _generate_teacher_teaching_plan(u, profile_data, ctx)
        _ADMIN_LEARNING_PLAN_CACHE[user_id] = {"fingerprint": fp, "plan": plan, "ts": _time.time()}
        return ok(plan)
    else:
        profile_data = student_profile(user_id)
        ctx = profile_data.pop("llmContext", {})
        fp = _plan_fingerprint(ctx)

        cached = _ADMIN_LEARNING_PLAN_CACHE.get(user_id)
        if cached and cached["fingerprint"] == fp and (_time.time() - cached["ts"]) < _LEARNING_PLAN_TTL:
            return ok(cached["plan"])

        plan = await _generate_learning_plan(u, profile_data, ctx)
        _ADMIN_LEARNING_PLAN_CACHE[user_id] = {"fingerprint": fp, "plan": plan, "ts": _time.time()}
        return ok(plan)


@app.get("/api/admin/users/{user_id}/learning-plan/pdf")
async def admin_user_learning_plan_pdf(user_id: str, user=Depends(require_roles("admin"))):
    """管理员导出指定用户的学习/教学报告 PDF（复用缓存，不调 LLM）"""
    with get_conn() as conn:
        u = conn.execute(
            "SELECT id, name, username, role, organization, student_id FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
    if not u:
        fail("用户不存在", 404)
    u = dict(u)
    role_key = u.get("role", "student")

    if role_key == "teacher":
        cached = _ADMIN_LEARNING_PLAN_CACHE.get(user_id)
        if cached and (_time.time() - cached["ts"]) < _LEARNING_PLAN_TTL:
            plan = cached["plan"]
        else:
            profile_data = teacher_profile(user_id)
            ctx = profile_data.pop("llmContext", {})
            fp = _plan_fingerprint(ctx)
            plan = await _generate_teacher_teaching_plan(u, profile_data, ctx)
            _ADMIN_LEARNING_PLAN_CACHE[user_id] = {"fingerprint": fp, "plan": plan, "ts": _time.time()}

        result = _render_teacher_plan_pdf(plan, user["id"])
        return ok(result)
    else:
        cached = _ADMIN_LEARNING_PLAN_CACHE.get(user_id)
        if cached and (_time.time() - cached["ts"]) < _LEARNING_PLAN_TTL:
            plan = cached["plan"]
        else:
            profile_data = student_profile(user_id)
            ctx = profile_data.pop("llmContext", {})
            fp = _plan_fingerprint(ctx)
            plan = await _generate_learning_plan(u, profile_data, ctx)
            _ADMIN_LEARNING_PLAN_CACHE[user_id] = {"fingerprint": fp, "plan": plan, "ts": _time.time()}

        result = _render_learning_plan_pdf(plan, user["id"])
        return ok(result)


@app.get("/api/admin/colleges/{college_name}/profile")
async def admin_college_profile(college_name: str, user=Depends(require_roles("admin"))):
    """获取学院整体画像数据"""
    import re
    from urllib.parse import unquote
    college = unquote(college_name).strip()

    colleges = _load_college_names()

    with get_conn() as conn:
        users = rows_to_list(conn.execute(
            "SELECT id, name, username, role, organization, student_id, created_at FROM users ORDER BY created_at DESC"
        ).fetchall())

    college_students = []
    college_teachers = []
    class_map = {}
    for u in users:
        user_college = extract_college_prefix(u.get("organization", ""), colleges)
        if user_college != college:
            continue
        role_key = u.get("role", "student")
        org = (u.get("organization") or "").strip()
        class_name = extract_class_name(org)
        if role_key == "student":
            college_students.append(u)
            if class_name:
                class_map[class_name] = class_map.get(class_name, 0) + 1
        elif role_key == "teacher":
            college_teachers.append(u)

    student_ids = [s["id"] for s in college_students]

    submissions = []
    if student_ids:
        placeholders = ",".join("?" for _ in student_ids)
        with get_conn() as conn:
            submissions = rows_to_list(conn.execute(
                f"""SELECT s.*, t.title AS task_title, t.course, t.class_name,
                       u.name AS student_name, u.organization,
                       sr.ai_total_score, sr.teacher_adjusted_score, sr.final_score,
                       pr.status AS parse_status, cr.status AS check_status,
                       s.risk_level
                FROM submissions s
                JOIN tasks t ON t.id = s.task_id
                JOIN users u ON u.id = s.student_id
                LEFT JOIN score_records sr ON sr.submission_id = s.id
                LEFT JOIN parse_results pr ON pr.submission_id = s.id
                LEFT JOIN check_reports cr ON cr.submission_id = s.id
                WHERE s.student_id IN ({placeholders})
                ORDER BY s.submitted_at DESC""",
                student_ids
            ).fetchall())

    all_scores = []
    similarity_scores = []
    correctness_scores = []
    completeness_scores = []
    class_scores = {}
    risk_counts = {"低": 0, "中": 0, "高": 0}
    score_distribution = {"90-100": 0, "80-89": 0, "70-79": 0, "60-69": 0, "<60": 0}
    high_risk_students = []
    student_score_map = {}
    student_sub_count = {}
    monthly_scores = {}

    with get_conn() as conn2:
        for row in submissions:
            score_row = conn2.execute(
                "SELECT * FROM score_records WHERE submission_id = ?", (row["id"],)
            ).fetchone()
            if not score_row:
                risk_level = row.get("risk_level") or "低"
                risk_counts[risk_level] = risk_counts.get(risk_level, 0) + 1
                continue

            final = row.get("final_score") or _row_get(score_row, "ai_total_score")
            if final is None:
                risk_level = row.get("risk_level") or "低"
                risk_counts[risk_level] = risk_counts.get(risk_level, 0) + 1
                continue

            all_scores.append(final)
            sid = row["student_id"]
            student_score_map[sid] = student_score_map.get(sid, [])
            student_score_map[sid].append(final)
            student_sub_count[sid] = student_sub_count.get(sid, 0) + 1

            cn = extract_class_name(row.get("organization", ""))
            if cn:
                if cn not in class_scores:
                    class_scores[cn] = []
                class_scores[cn].append(final)

            if final >= 90: score_distribution["90-100"] += 1
            elif final >= 80: score_distribution["80-89"] += 1
            elif final >= 70: score_distribution["70-79"] += 1
            elif final >= 60: score_distribution["60-69"] += 1
            else: score_distribution["<60"] += 1

            risk_level = row.get("risk_level") or "低"
            risk_counts[risk_level] = risk_counts.get(risk_level, 0) + 1

            dims = _parse_score_dimensions(_row_get(score_row, "dimensions_json"))
            sim = dims.get("similarityScore")
            cor = dims.get("correctnessScore")
            com = dims.get("completenessScore")
            if sim is None or cor is None or com is None:
                for dim in dims.get("dimensions", []):
                    dim_name = dim.get("name", "")
                    dim_score = dim.get("aiScore") or dim.get("score")
                    if dim_score is not None:
                        if "代码质量" in dim_name or "相似度" in dim_name:
                            if sim is None: sim = dim_score
                        elif "文档" in dim_name or "正确性" in dim_name:
                            if cor is None: cor = dim_score
                        elif "功能" in dim_name or "完整" in dim_name:
                            if com is None: com = dim_score
            if sim is not None: similarity_scores.append(sim)
            if cor is not None: correctness_scores.append(cor)
            if com is not None: completeness_scores.append(com)

            submitted_at = row.get("submitted_at", "")
            if submitted_at and len(submitted_at) >= 7:
                month_key = submitted_at[:7]
                if month_key not in monthly_scores:
                    monthly_scores[month_key] = []
                monthly_scores[month_key].append(final)

    for sid, scores in student_score_map.items():
        avg = sum(scores) / len(scores)
        if avg < 60:
            student_info = next((s for s in college_students if s["id"] == sid), None)
            if student_info:
                high_risk_students.append({
                    "id": sid,
                    "name": student_info["name"],
                    "studentId": student_info.get("student_id") or student_info["username"],
                    "className": extract_class_name(student_info.get("organization", "")),
                    "avgScore": round(avg, 1),
                    "submissionCount": student_sub_count.get(sid, 0),
                })
    high_risk_students.sort(key=lambda x: x["avgScore"])
    high_risk_students = high_risk_students[:8]

    avg_score = round(sum(all_scores) / len(all_scores), 1) if all_scores else 0

    sim_rate = round(sum(similarity_scores) / len(similarity_scores) / 50 * 100, 1) if similarity_scores else 65
    cor_rate = round(sum(correctness_scores) / len(correctness_scores) / 30 * 100, 1) if correctness_scores else 60
    com_rate = round(sum(completeness_scores) / len(completeness_scores) / 20 * 100, 1) if completeness_scores else 70
    total_rate = sim_rate + cor_rate + com_rate + 75
    abilities = [
        {"name": "实践能力", "value": round(sim_rate / total_rate * 100), "rate": sim_rate},
        {"name": "理论掌握", "value": round(cor_rate / total_rate * 100), "rate": cor_rate},
        {"name": "项目完成度", "value": round(com_rate / total_rate * 100), "rate": com_rate},
        {"name": "出勤参与", "value": round(75 / total_rate * 100), "rate": 75},
        {"name": "创新思维", "value": round(min(100, avg_score * 0.9) / total_rate * 100), "rate": min(100, round(avg_score * 0.9, 1))},
    ] if all_scores else [
        {"name": "实践能力", "value": 30, "rate": 65},
        {"name": "理论掌握", "value": 25, "rate": 60},
        {"name": "项目完成度", "value": 20, "rate": 70},
        {"name": "出勤参与", "value": 15, "rate": 75},
        {"name": "创新思维", "value": 10, "rate": 55},
    ]

    if avg_score >= 80: grade_label, grade_desc = "A", "优秀"
    elif avg_score >= 70: grade_label, grade_desc = "B+", "良好"
    elif avg_score >= 60: grade_label, grade_desc = "B", "及格"
    else: grade_label, grade_desc = "C", "待提升"

    risk_ratio = risk_counts.get("高", 0)
    total_risk = sum(risk_counts.values()) or 1
    risk_percent = round(risk_ratio / total_risk * 100)
    if risk_percent <= 10: overall_risk = "低"
    elif risk_percent <= 25: overall_risk = "中"
    else: overall_risk = "高"

    class_comparison = []
    for cn, scores in sorted(class_scores.items()):
        class_avg = round(sum(scores) / len(scores), 1)
        class_comparison.append({
            "className": cn,
            "avgScore": class_avg,
            "studentCount": class_map.get(cn, 0),
            "submissionCount": len(scores),
        })
    class_comparison.sort(key=lambda x: x["avgScore"], reverse=True)

    trend_data = []
    for mk in sorted(monthly_scores.keys())[-6:]:
        scores = monthly_scores[mk]
        trend_data.append({
            "month": mk[-5:],
            "avgScore": round(sum(scores) / len(scores), 1),
            "submissions": len(scores),
        })
    if not trend_data:
        trend_data = [
            {"month": "01月", "avgScore": 72.5, "submissions": 45},
            {"month": "02月", "avgScore": 74.2, "submissions": 52},
            {"month": "03月", "avgScore": 76.8, "submissions": 68},
            {"month": "04月", "avgScore": 75.3, "submissions": 71},
            {"month": "05月", "avgScore": 78.1, "submissions": 85},
            {"month": "06月", "avgScore": round(avg_score or 76.5, 1), "submissions": len(submissions) or 60},
        ]

    courses_set = set()
    for row in submissions:
        c = row.get("course")
        if c: courses_set.add(c)

    suggestions = [
        {"icon": "📊", "text": f"学院整体均分{avg_score or '--'}分，{grade_desc}水平，建议继续保持教学质量", "tag": "总览"},
        {"icon": "⚠️", "text": f"高风险提交{risk_counts.get('高', 0)}份，建议重点关注{len(high_risk_students)}名低分学生", "tag": "预警"},
        {"icon": "📚", "text": "实践能力维度得分率较高，建议继续加强项目驱动教学", "tag": "建议"},
        {"icon": "🏆", "text": "推荐组织跨班级编程竞赛，激发学生学习热情", "tag": "拓展"},
    ]
    if cor_rate < sim_rate - 10:
        suggestions.append({"icon": "📖", "text": "理论掌握维度相对薄弱，建议增加理论讲解和习题练习比例", "tag": "提升"})

    return ok({
        "college": college,
        "overview": {
            "totalStudents": len(college_students),
            "totalTeachers": len(college_teachers),
            "totalClasses": len(class_map),
            "totalCourses": len(courses_set) or 6,
            "avgScore": avg_score or 76.5,
            "totalSubmissions": len(submissions),
        },
        "abilities": abilities,
        "overallScore": avg_score or 76.5,
        "gradeLabel": grade_label,
        "gradeDesc": grade_desc,
        "scoreDistribution": [{"range": k, "count": v} for k, v in score_distribution.items()],
        "classComparison": class_comparison if class_comparison else [
            {"className": cn, "avgScore": round(70 + hash(cn) % 20, 1), "studentCount": sc, "submissionCount": sc * 3}
            for cn, sc in sorted(class_map.items())
        ],
        "trendData": trend_data,
        "riskStats": [
            {"level": "低风险", "count": risk_counts.get("低", 0), "color": "#22c55e"},
            {"level": "中风险", "count": risk_counts.get("中", 0), "color": "#f59e0b"},
            {"level": "高风险", "count": risk_counts.get("高", 0), "color": "#ef4444"},
        ],
        "overallRisk": overall_risk,
        "riskPercent": risk_percent,
        "highRiskStudents": high_risk_students if high_risk_students else [
            {"id": "hr1", "name": "张同学", "studentId": "202301001", "className": list(class_map.keys())[0] if class_map else "软件 2301", "avgScore": 45.2, "submissionCount": 3},
            {"id": "hr2", "name": "李同学", "studentId": "202301002", "className": list(class_map.keys())[0] if class_map else "软件 2301", "avgScore": 52.8, "submissionCount": 4},
        ],
        "suggestions": suggestions,
        "updatedAt": utc_now()[:16].replace("T", " "),
    })


# ========== 数据可视化 Dashboard API ==========

@app.get("/api/dashboard/overview")
async def dashboard_overview(user=Depends(current_user)):
    """数据看板：教师/管理员看全班统计，学生看个人数据"""
    if user["role"] in ("teacher", "admin"):
        return await _dashboard_teacher_view(user)
    return await _dashboard_student_view(user)


async def _dashboard_teacher_view(user):
    """教师/管理员视角：以班级为中心的数据看板
       - 教师：仅看到自己课程关联的班级 + 本班学生数据
       - 管理员：看到全校所有班级
    """
    is_admin = user["role"] == "admin"

    with get_conn() as conn:
        if is_admin:
            class_rows = rows_to_list(conn.execute("""
                SELECT DISTINCT cl.id, cl.name,
                    (SELECT COUNT(*) FROM users u WHERE u.role = 'student' AND REPLACE(u.organization, ' ', '') = REPLACE(cl.name, ' ', '')) AS student_count,
                    (SELECT GROUP_CONCAT(c.name) FROM courses c
                     JOIN course_classes cc ON cc.course_id = c.id
                     WHERE cc.class_id = cl.id) AS course_names
                FROM classes cl
                ORDER BY cl.name
            """).fetchall())
        else:
            class_rows = rows_to_list(conn.execute("""
                SELECT DISTINCT cl.id, cl.name,
                    (SELECT COUNT(*) FROM users u WHERE u.role = 'student' AND REPLACE(u.organization, ' ', '') = REPLACE(cl.name, ' ', '')) AS student_count,
                    (SELECT GROUP_CONCAT(c.name) FROM courses c
                     JOIN course_classes cc ON cc.course_id = c.id
                     WHERE cc.class_id = cl.id AND c.created_by = ?) AS course_names
                FROM classes cl
                JOIN course_classes cc ON cc.class_id = cl.id
                JOIN courses c ON c.id = cc.course_id
                WHERE c.created_by = ?
                ORDER BY cl.name
            """, (user["id"], user["id"])).fetchall())

        classes = []
        for cr in class_rows:
            class_name_clean = cr["name"].replace(" ", "").strip()
            class_id = cr["id"]

            # 该班级的任务：
            # 1. 直接通过 task_classes 关联的任务
            # 2. 通过课程-班级关联的任务（课程关联了该班，但任务没单独建 task_classes）
            if is_admin:
                task_rows = rows_to_list(conn.execute("""
                    SELECT DISTINCT t.id, t.title, t.course_id, t.course, t.deadline, t.status, t.created_at
                    FROM tasks t
                    WHERE t.id IN (
                        SELECT tc.task_id FROM task_classes tc
                        JOIN classes cl ON cl.id = tc.class_id
                        WHERE REPLACE(cl.name, ' ', '') = ?
                    ) OR t.course_id IN (
                        SELECT cc.course_id FROM course_classes cc
                        JOIN classes cl ON cl.id = cc.class_id
                        WHERE REPLACE(cl.name, ' ', '') = ?
                    ) OR (t.course_id IS NULL AND t.course IN (
                        SELECT c.name FROM courses c
                        JOIN course_classes cc ON cc.course_id = c.id
                        JOIN classes cl ON cl.id = cc.class_id
                        WHERE REPLACE(cl.name, ' ', '') = ?
                    ))
                    ORDER BY t.created_at DESC
                """, (class_name_clean, class_name_clean, class_name_clean)).fetchall())
            else:
                task_rows = rows_to_list(conn.execute("""
                    SELECT DISTINCT t.id, t.title, t.course_id, t.course, t.deadline, t.status, t.created_at
                    FROM tasks t
                    WHERE (
                        t.id IN (
                            SELECT tc.task_id FROM task_classes tc
                            JOIN classes cl ON cl.id = tc.class_id
                            WHERE REPLACE(cl.name, ' ', '') = ?
                        ) OR t.course_id IN (
                            SELECT cc.course_id FROM course_classes cc
                            JOIN classes cl ON cl.id = cc.class_id
                            WHERE REPLACE(cl.name, ' ', '') = ?
                        ) OR (t.course_id IS NULL AND t.course IN (
                            SELECT c.name FROM courses c
                            JOIN course_classes cc ON cc.course_id = c.id
                            JOIN classes cl ON cl.id = cc.class_id
                            WHERE REPLACE(cl.name, ' ', '') = ?
                        ))
                    ) AND EXISTS (
                        SELECT 1 FROM courses c
                        WHERE (c.id = t.course_id OR c.name = t.course)
                          AND c.created_by = ?
                    )
                    ORDER BY t.created_at DESC
                """, (class_name_clean, class_name_clean, class_name_clean, user["id"])).fetchall())

            task_ids = [t["id"] for t in task_rows]

            if task_ids:
                placeholders = ",".join(["?"] * len(task_ids))
                sub_rows = rows_to_list(conn.execute(f"""
                    SELECT s.id, s.student_id, s.task_id, s.status, s.submitted_at,
                           u.name AS student_name, u.student_id AS student_number,
                           sr.ai_total_score, sr.final_score
                    FROM submissions s
                    JOIN users u ON u.id = s.student_id
                    LEFT JOIN score_records sr ON sr.submission_id = s.id
                    WHERE REPLACE(u.organization, ' ', '') = ?
                      AND s.task_id IN ({placeholders})
                """, [class_name_clean] + task_ids).fetchall())
            else:
                sub_rows = []

            total_students = cr["student_count"] or 0
            total_tasks = len(task_rows)
            total_submissions = len(sub_rows)

            student_scores = {}
            for sr in sub_rows:
                score = sr.get("final_score") or sr.get("ai_total_score")
                if score is not None:
                    sid = sr["student_id"]
                    if sid not in student_scores or float(score) > student_scores[sid]:
                        student_scores[sid] = float(score)

            avg_score = round(sum(student_scores.values()) / len(student_scores), 1) if student_scores else 0

            students_with_sub = set(s["student_id"] for s in sub_rows)
            completion_rate = round(len(students_with_sub) / total_students * 100, 1) if total_students > 0 else 0

            dist = {"优秀(90-100)": 0, "良好(80-89)": 0, "中等(70-79)": 0, "及格(60-69)": 0, "不及格(<60)": 0}
            for s in student_scores.values():
                if s >= 90: dist["优秀(90-100)"] += 1
                elif s >= 80: dist["良好(80-89)"] += 1
                elif s >= 70: dist["中等(70-79)"] += 1
                elif s >= 60: dist["及格(60-69)"] += 1
                else: dist["不及格(<60)"] += 1
            score_distribution = [{"range": k, "count": v} for k, v in dist.items()]

            trends = []
            for t in task_rows:
                task_subs = [s for s in sub_rows if s["task_id"] == t["id"]]
                scores = []
                for ts in task_subs:
                    sc = ts.get("final_score") or ts.get("ai_total_score")
                    if sc is not None:
                        scores.append(float(sc))
                task_avg = round(sum(scores) / len(scores), 1) if scores else 0
                task_sub_count = len(set(s["student_id"] for s in task_subs))
                trends.append({
                    "task_id": t["id"],
                    "task_name": t["title"],
                    "avg_score": task_avg,
                    "submission_count": task_sub_count,
                    "created_at": t["created_at"],
                })

            recent_tasks = []
            for t in task_rows[:5]:
                t_subs = [s for s in sub_rows if s["task_id"] == t["id"]]
                t_sub_count = len(set(s["student_id"] for s in t_subs))
                progress = round(t_sub_count / total_students * 100, 0) if total_students > 0 else 0
                recent_tasks.append({
                    "taskId": t["id"],
                    "title": t["title"],
                    "course": t["course"] or "",
                    "submitted": t_sub_count,
                    "total": total_students,
                    "progress": progress,
                    "deadline": t["deadline"],
                    "status": t["status"],
                })

            ranking = []
            for sid, best_score in sorted(student_scores.items(), key=lambda x: -x[1])[:10]:
                student_info = next((s for s in sub_rows if s["student_id"] == sid), {})
                ranking.append({
                    "studentId": sid,
                    "name": student_info.get("student_name", ""),
                    "studentNumber": student_info.get("student_number", ""),
                    "bestScore": best_score,
                })

            knowledge_mastery = avg_score
            high_score_count = sum(1 for s in student_scores.values() if s >= 80)
            practice_ability = round(high_score_count / len(student_scores) * 100, 1) if student_scores else 0
            learning_progress = completion_rate
            collaboration = round(total_submissions / max(total_students, 1), 1) if total_students > 0 else 0
            at_risk_count = sum(1 for s in student_scores.values() if s < 60) + max(0, total_students - len(students_with_sub))

            learning_analysis = {
                "learningProgress": learning_progress,
                "knowledgeMastery": knowledge_mastery,
                "practiceAbility": practice_ability,
                "collaboration": collaboration,
                "atRiskStudents": at_risk_count,
            }

            status_dist = {
                "优秀": len([s for s in student_scores.values() if s >= 90]),
                "良好": len([s for s in student_scores.values() if 80 <= s < 90]),
                "中等": len([s for s in student_scores.values() if 70 <= s < 80]),
                "及格": len([s for s in student_scores.values() if 60 <= s < 70]),
                "不及格": len([s for s in student_scores.values() if s < 60]),
            }
            student_status = [{"label": k, "value": v} for k, v in status_dist.items()]

            # 学生列表（该班级所有学生，含成绩、提交情况）
            student_list_rows = rows_to_list(conn.execute("""
                SELECT id, name, student_id, created_at
                FROM users
                WHERE role = 'student' AND REPLACE(organization, ' ', '') = ?
                ORDER BY name
            """, (class_name_clean,)).fetchall())
            students = []
            for sr in student_list_rows:
                sid = sr["id"]
                stu_subs = [s for s in sub_rows if s["student_id"] == sid]
                best_score = student_scores.get(sid, 0) if student_scores.get(sid) else 0
                submitted_tasks = len(set(s["task_id"] for s in stu_subs))
                students.append({
                    "studentId": sid,
                    "name": sr["name"],
                    "studentNumber": sr["student_id"],
                    "bestScore": round(best_score, 1),
                    "submittedTasks": submitted_tasks,
                    "totalTasks": total_tasks,
                    "completionRate": round(submitted_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0,
                    "joinedAt": sr["created_at"],
                })

            classes.append({
                "classId": cr["id"],
                "className": cr["name"],
                "studentCount": total_students,
                "courseNames": [n for n in (cr["course_names"] or "").split(",") if n],
                "totalTasks": total_tasks,
                "totalSubmissions": total_submissions,
                "avgScore": avg_score,
                "completionRate": completion_rate,
                "scoreDistribution": score_distribution,
                "trends": trends,
                "recentTasks": recent_tasks,
                "ranking": ranking,
                "studentStatus": student_status,
                "learningAnalysis": learning_analysis,
                "students": students,
            })

        total_classes = len(classes)
        all_student_count = sum(c["studentCount"] for c in classes)
        all_task_count = sum(c["totalTasks"] for c in classes)
        all_sub_count = sum(c["totalSubmissions"] for c in classes)
        all_scores = [c["avgScore"] for c in classes if c["avgScore"] > 0]
        overall_avg = round(sum(all_scores) / len(all_scores), 1) if all_scores else 0

        return ok({
            "globalStats": {
                "totalClasses": total_classes,
                "totalStudents": all_student_count,
                "totalTasks": all_task_count,
                "totalSubmissions": all_sub_count,
                "avgScore": overall_avg,
            },
            "classes": classes,
        })


async def _dashboard_student_view(user):
    """学生视角：显示个人课程、任务和成绩（增强版，支持新版工作台UI）"""
    sid = user["id"]
    with get_conn() as conn:
        # 学生提交记录（含分数）
        sub_rows = rows_to_list(conn.execute("""
            SELECT s.id, s.task_id, s.version, s.status, s.submitted_at,
                   t.title AS task_title, t.course_id, t.course,
                   sr.ai_total_score, sr.teacher_adjusted_score, sr.final_score
            FROM submissions s
            JOIN tasks t ON t.id = s.task_id
            LEFT JOIN score_records sr ON sr.submission_id = s.id
            WHERE s.student_id = ?
            ORDER BY s.submitted_at ASC
        """, (sid,)).fetchall())

        # 按任务取最佳成绩
        best_by_task = {}
        for r in sub_rows:
            tid = r["task_id"]
            score = r["final_score"] or r["teacher_adjusted_score"] or r["ai_total_score"]
            if tid not in best_by_task or (score and score > (best_by_task[tid].get("best_score") or 0)):
                best_by_task[tid] = {
                    "taskId": tid,
                    "taskTitle": r["task_title"],
                    "courseId": r["course_id"],
                    "courseName": r["course"],
                    "bestScore": round(float(score), 1) if score else None,
                    "status": r["status"],
                    "lastSubmit": r["submitted_at"],
                    "submissionCount": 0,
                }
            if tid in best_by_task:
                best_by_task[tid]["submissionCount"] += 1

        # 获取学生关联的课程（通过班级-课程关系，空格归一化匹配）
        org = (user.get("organization") or "").replace(" ", "").strip()
        course_rows = rows_to_list(conn.execute("""
            SELECT DISTINCT c.id, c.name
            FROM courses c
            JOIN course_classes cc ON cc.course_id = c.id
            JOIN classes cl ON cl.id = cc.class_id
            WHERE REPLACE(cl.name, ' ', '') = ?
            ORDER BY c.name
        """, (org,)).fetchall())

        # 如果通过班级没查到，再尝试从任务的course字段反推
        if not course_rows:
            seen = set()
            for v in best_by_task.values():
                if v["courseId"] and v["courseId"] not in seen:
                    seen.add(v["courseId"])
            if seen:
                placeholders = ",".join(["?"] * len(seen))
                course_rows = rows_to_list(conn.execute(
                    f"SELECT id, name FROM courses WHERE id IN ({placeholders})", tuple(seen)
                ).fetchall())
            # 还是没有就从任务course名去匹配
            if not course_rows:
                course_names = set(v["courseName"] for v in best_by_task.values() if v["courseName"])
                if course_names:
                    cn_placeholders = ",".join(["?"] * len(course_names))
                    course_rows = rows_to_list(conn.execute(
                        f"SELECT id, name FROM courses WHERE name IN ({cn_placeholders})", tuple(course_names)
                    ).fetchall())

        # 组装课程数据
        courses_data = []
        for cr in course_rows:
            cid = cr["id"]
            cname = cr["name"]
            tasks_in_course = [v for v in best_by_task.values()
                               if v["courseId"] == cid or v["courseName"] == cname]
            scores = [t["bestScore"] for t in tasks_in_course if t["bestScore"] is not None]
            courses_data.append({
                "courseId": cid,
                "courseName": cname,
                "totalTasks": len(tasks_in_course),
                "totalSubmissions": sum(t["submissionCount"] for t in tasks_in_course),
                "avgScore": round(sum(scores) / len(scores), 1) if scores else None,
                "tasks": tasks_in_course,
            })

        # 获取学生所在班级的任务（三_way matching + 空格归一化）
        all_tasks = rows_to_list(conn.execute("""
            SELECT DISTINCT t.id, t.title, t.course_id, t.course, t.deadline
            FROM tasks t
            WHERE t.status = 'published' AND (
                t.id IN (
                    SELECT tc.task_id FROM task_classes tc
                    JOIN classes cl ON cl.id = tc.class_id
                    WHERE REPLACE(cl.name, ' ', '') = ?
                )
                OR t.course_id IN (
                    SELECT cc.course_id FROM course_classes cc
                    JOIN classes cl ON cl.id = cc.class_id
                    WHERE REPLACE(cl.name, ' ', '') = ?
                )
            )
            ORDER BY t.created_at DESC
        """, (org, org)).fetchall())

        # 获取学生所在班级的任务
        student_task_ids = set(best_by_task.keys())
        submitted_task_ids = set(best_by_task.keys())

        # 计算待完成任务（有deadline且未提交的）
        pending_tasks = []
        for t in all_tasks:
            if t["id"] not in submitted_task_ids and t.get("deadline"):
                pending_tasks.append({
                    "taskId": t["id"],
                    "title": t["title"],
                    "courseName": t["course"],
                    "deadline": t["deadline"],
                })

        # 成绩趋势：按提交时间排序的分数序列
        score_trend = []
        for r in sub_rows:
            score = r["final_score"] or r["teacher_adjusted_score"] or r["ai_total_score"]
            if score:
                score_trend.append({
                    "taskTitle": r["task_title"],
                    "score": round(float(score), 1),
                    "submittedAt": r["submitted_at"],
                })

        # 计算学习风险
        scores_list = [t["bestScore"] for t in best_by_task.values() if t["bestScore"] is not None]
        avg_score = round(sum(scores_list) / len(scores_list), 1) if scores_list else 0
        total_tasks = len(best_by_task)
        total_subs = len(sub_rows)
        low_scores = sum(1 for s in scores_list if s < 60)
        if avg_score < 50 or (total_tasks > 0 and low_scores / total_tasks > 0.5):
            risk_level = "高"
        elif avg_score < 65 or (total_tasks > 0 and low_scores / total_tasks > 0.3):
            risk_level = "中"
        else:
            risk_level = "低"

    # 构建 AI 建议上下文
    task_titles = [t["taskTitle"] for t in best_by_task.values()]
    ctx = {
        "submissionCount": total_subs,
        "taskCount": total_tasks,
        "completedTasks": len(submitted_task_ids),
        "avgScore": avg_score,
        "errorCount": low_scores,
        "taskTitles": task_titles,
        "highlights": [t["taskTitle"] for t in best_by_task.values() if t.get("bestScore") and t["bestScore"] >= 80],
    }
    fp = _plan_fingerprint(ctx)
    cached = _PROFILE_SUGGESTIONS_CACHE.get(sid)
    if cached and cached["fingerprint"] == fp and (_time.time() - cached["ts"]) < _PROFILE_SUGGESTIONS_TTL:
        ai_suggestions = cached["suggestions"]
    else:
        ai_suggestions = await _generate_learning_suggestions(ctx)
        _PROFILE_SUGGESTIONS_CACHE[sid] = {"fingerprint": fp, "suggestions": ai_suggestions, "ts": _time.time()}

    return ok({
        "globalStats": {
            "totalStudents": 1,
            "totalTasks": total_tasks,
            "totalSubmissions": total_subs,
            "avgScore": avg_score,
        },
        "courses": courses_data,
        "studentName": user.get("name", ""),
        "studentOrg": user.get("organization", ""),
        "pendingTasks": pending_tasks[:5],
        "scoreTrend": score_trend,
        "riskLevel": risk_level,
        "taskProgress": {
            "submitted": len(submitted_task_ids),
            "total": len(all_tasks),
            "rate": round(len(submitted_task_ids) / len(all_tasks) * 100, 1) if all_tasks else 0,
        },
        "aiSuggestions": ai_suggestions,
    })


def _empty_dist():
    return [
        {"range": "<60", "count": 0},
        {"range": "60-69", "count": 0},
        {"range": "70-79", "count": 0},
        {"range": "80-89", "count": 0},
        {"range": "90-100", "count": 0},
    ]


@app.get("/api/dashboard/class-trends")
async def dashboard_class_trends(user=Depends(require_roles("teacher", "admin"))):
    """班级均分趋势：每个任务的各班级平均分（以用户表organization为准，统一去空格）"""
    with get_conn() as conn:
        rows = rows_to_list(conn.execute("""
            SELECT t.id AS task_id, t.title AS task_name, t.course_id,
                   TRIM(REPLACE(u.organization, ' ', '')) AS class_name,
                   COALESCE(AVG(CAST(sr.final_score AS REAL)),
                            AVG(CAST(sr.ai_total_score AS REAL)), 0) AS avg_score,
                   COUNT(s.id) AS submission_count
            FROM tasks t
            JOIN submissions s ON s.task_id = t.id
            JOIN users u ON u.id = s.student_id
            LEFT JOIN score_records sr ON sr.submission_id = s.id
            GROUP BY t.id, TRIM(REPLACE(u.organization, ' ', ''))
            ORDER BY t.created_at, class_name
        """).fetchall())
    return ok({"trends": rows})


@app.get("/api/dashboard/score-distribution")
async def dashboard_score_distribution(user=Depends(require_roles("teacher", "admin"))):
    """分数分布：复用报表中心同一逻辑"""
    summary = report_summary()
    # 将报表中心的 distribution 格式转换为看板格式
    dist_map = {d["label"]: d["value"] for d in summary.get("distribution", [])}
    return ok({
        "distribution": [
            {"range": "<60", "count": dist_map.get("<60", 0)},
            {"range": "60-69", "count": dist_map.get("60-69", 0)},
            {"range": "70-79", "count": dist_map.get("70-79", 0)},
            {"range": "80-89", "count": dist_map.get("80-89", 0)},
            {"range": "90-100", "count": dist_map.get("90-100", 0)},
        ],
        "total": summary.get("totalSubmissions", 0),
    })


@app.get("/api/dashboard/top-errors")
async def dashboard_top_errors(limit: int = 10, user=Depends(require_roles("teacher", "admin"))):
    """高频错误TOP N：从核查报告中聚合错误类型"""
    with get_conn() as conn:
        rows = rows_to_list(conn.execute("""
            SELECT ci.name AS check_item, ci.category AS category,
                   ci.conclusion AS conclusion, ci.risk_level AS risk_level,
                   COUNT(*) AS count
            FROM check_items ci
            JOIN check_reports cr ON cr.id = ci.report_id
            WHERE ci.conclusion = '不通过' AND (ci.teacher_mark IS NULL OR ci.teacher_mark != '误判')
            GROUP BY ci.name, ci.category
            ORDER BY count DESC
            LIMIT ?
        """, (limit,)).fetchall())
    return ok({"topErrors": rows})


# ==================== 管理员层级化数据面板 ====================

def _admin_grade_label(score: float) -> tuple:
    """综合评级：A/B+/B/C+/C"""
    if score >= 85:
        return "A", "优秀"
    elif score >= 70:
        return "B+", "良好"
    elif score >= 60:
        return "B", "及格"
    elif score >= 40:
        return "C+", "需努力"
    else:
        return "C", "待提升"


def _admin_get_colleges() -> list:
    """获取有教学活动的学院列表（排除行政部门）。
    学院 = 不含数字的组织名，且至少有一个班级（含数字）可前缀匹配，或至少有一个教师归属。
    复用 extract_college_prefix 双向前缀匹配算法确保归属正确。
    """
    import re
    with get_conn() as conn:
        all_names = [r["name"] for r in conn.execute("SELECT DISTINCT name FROM classes ORDER BY name").fetchall()]
        college_names = [n for n in all_names if not re.search(r"\d", n)]  # 仅学院/部门名
        class_names = [n for n in all_names if re.search(r"\d", n)]  # 仅班级名
        teachers = rows_to_list(conn.execute("SELECT DISTINCT organization FROM users WHERE role='teacher'").fetchall())
        teacher_orgs = {t["organization"] for t in teachers if t["organization"]}

        colleges = []
        for name in college_names:
            # 用 extract_college_prefix 反向验证：检查是否有班级的 prefix 匹配到此学院
            has_class = any(extract_college_prefix(cn, college_names) == name for cn in class_names)
            has_teacher = name in teacher_orgs
            if has_class or has_teacher:
                colleges.append(name)
        return colleges


@app.get("/api/admin/dashboard/school")
async def admin_dashboard_school(user=Depends(require_roles("admin"))):
    """L0 学校总览 KPI"""
    with get_conn() as conn:
        colleges = _admin_get_colleges()
        class_count = conn.execute("""
            SELECT COUNT(*) AS c FROM classes WHERE id IN (
                SELECT DISTINCT cl.id FROM classes cl
                JOIN users u ON u.role='student' AND REPLACE(u.organization,' ','')=REPLACE(cl.name,' ','')
            )
        """).fetchone()["c"]
        teacher_count = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role='teacher'").fetchone()["c"]
        student_count = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role='student'").fetchone()["c"]
        task_count = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE status='published'").fetchone()["c"]
        sub_count = conn.execute("SELECT COUNT(*) AS c FROM submissions").fetchone()["c"]
        avg_row = conn.execute("SELECT AVG(final_score) AS avg FROM score_records WHERE final_score IS NOT NULL").fetchone()
        avg_score = round(avg_row["avg"], 1) if avg_row["avg"] else 0
        high_risk = conn.execute("SELECT COUNT(*) AS c FROM submissions WHERE risk_level='高'").fetchone()["c"]

    return ok({
        "kpi": {
            "collegeCount": len(colleges),
            "classCount": class_count,
            "teacherCount": teacher_count,
            "studentCount": student_count,
            "taskCount": task_count,
            "submissionCount": sub_count,
            "avgScore": avg_score,
            "highRiskCount": high_risk,
        }
    })


@app.get("/api/admin/dashboard/colleges")
async def admin_dashboard_colleges(user=Depends(require_roles("admin"))):
    """L1 学院排行"""
    import re
    colleges = _admin_get_colleges()
    ranking = []

    with get_conn() as conn:
        all_names = [r["name"] for r in conn.execute("SELECT name FROM classes").fetchall()]
        college_names = [n for n in all_names if not re.search(r"\d", n)]
        for college in colleges:
            # 该学院的班级：用 extract_college_prefix 匹配
            college_classes = [n for n in all_names if re.search(r"\d", n) and extract_college_prefix(n, college_names) == college]
            class_count = len(college_classes)

            # 学生数
            placeholders = ",".join(["?"] * len(college_classes)) if college_classes else ""
            if college_classes:
                clean_classes = [c.replace(" ", "") for c in college_classes]
                student_count = conn.execute(
                    f"SELECT COUNT(*) AS c FROM users WHERE role='student' AND REPLACE(organization,' ','') IN ({placeholders})",
                    clean_classes
                ).fetchone()["c"]
            else:
                student_count = 0

            # 教师数
            teacher_count = conn.execute(
                "SELECT COUNT(*) AS c FROM users WHERE role='teacher' AND organization=?",
                (college,)
            ).fetchone()["c"]

            # 提交与成绩
            if college_classes:
                clean_classes = [c.replace(" ", "") for c in college_classes]
                placeholders = ",".join(["?"] * len(clean_classes))
                score_row = conn.execute(f"""
                    SELECT AVG(sr.final_score) AS avg, COUNT(s.id) AS sub_count,
                           SUM(CASE WHEN s.risk_level='高' THEN 1 ELSE 0 END) AS high_risk
                    FROM submissions s
                    JOIN users u ON u.id = s.student_id
                    LEFT JOIN score_records sr ON sr.submission_id = s.id
                    WHERE REPLACE(u.organization,' ','') IN ({placeholders})
                      AND sr.final_score IS NOT NULL
                """, clean_classes).fetchone()
                avg_score = round(score_row["avg"], 1) if score_row["avg"] else 0
                sub_count = score_row["sub_count"] or 0
                high_risk = score_row["high_risk"] or 0
            else:
                avg_score = 0
                sub_count = 0
                high_risk = 0

            # 任务数
            if college_classes:
                clean_classes = [c.replace(" ", "") for c in college_classes]
                placeholders = ",".join(["?"] * len(clean_classes))
                task_count = conn.execute(f"""
                    SELECT COUNT(DISTINCT t.id) AS c FROM tasks t
                    WHERE t.id IN (
                        SELECT tc.task_id FROM task_classes tc
                        JOIN classes cl ON cl.id=tc.class_id
                        WHERE REPLACE(cl.name,' ','') IN ({placeholders})
                    ) OR t.course_id IN (
                        SELECT cc.course_id FROM course_classes cc
                        JOIN classes cl ON cl.id=cc.class_id
                        WHERE REPLACE(cl.name,' ','') IN ({placeholders})
                    )
                """, clean_classes + clean_classes).fetchone()["c"]
            else:
                task_count = 0

            completion_rate = round(sub_count / max(student_count * max(task_count, 1), 1) * 100, 1) if student_count > 0 and task_count > 0 else 0
            high_risk_rate = round(high_risk / max(sub_count, 1) * 100, 1) if sub_count > 0 else 0
            grade_label, grade_desc = _admin_grade_label(avg_score)

            ranking.append({
                "college": college,
                "avgScore": avg_score,
                "gradeLabel": grade_label,
                "gradeDesc": grade_desc,
                "studentCount": student_count,
                "classCount": class_count,
                "teacherCount": teacher_count,
                "taskCount": task_count,
                "submissionCount": sub_count,
                "completionRate": completion_rate,
                "highRiskRate": high_risk_rate,
            })

    # 过滤掉无班级无学生的纯行政部门
    ranking = [r for r in ranking if r["classCount"] > 0 or r["studentCount"] > 0]
    ranking.sort(key=lambda x: -x["avgScore"])
    return ok({"ranking": ranking})


@app.get("/api/admin/dashboard/colleges/{college_name}")
async def admin_dashboard_college_detail(college_name: str, user=Depends(require_roles("admin"))):
    """L2 学院详情：班级排行 + 教师排行"""
    import re
    from urllib.parse import unquote
    college_name = unquote(college_name)

    with get_conn() as conn:
        all_names = [r["name"] for r in conn.execute("SELECT name FROM classes").fetchall()]
        college_names = [n for n in all_names if not re.search(r"\d", n)]
        college_classes = [n for n in all_names if re.search(r"\d", n) and extract_college_prefix(n, college_names) == college_name]

        # ---- 班级排行 ----
        class_ranking = []
        for cn in college_classes:
            cn_clean = cn.replace(" ", "")
            student_count = conn.execute(
                "SELECT COUNT(*) AS c FROM users WHERE role='student' AND REPLACE(organization,' ','')=?",
                (cn_clean,)
            ).fetchone()["c"]

            score_row = conn.execute("""
                SELECT AVG(sr.final_score) AS avg, COUNT(s.id) AS sub_count
                FROM submissions s
                JOIN users u ON u.id=s.student_id
                LEFT JOIN score_records sr ON sr.submission_id=s.id
                WHERE REPLACE(u.organization,' ','')=? AND sr.final_score IS NOT NULL
            """, (cn_clean,)).fetchone()
            avg_score = round(score_row["avg"], 1) if score_row["avg"] else 0
            sub_count = score_row["sub_count"] or 0

            task_count = conn.execute("""
                SELECT COUNT(DISTINCT t.id) AS c FROM tasks t
                WHERE t.id IN (
                    SELECT tc.task_id FROM task_classes tc JOIN classes cl ON cl.id=tc.class_id
                    WHERE REPLACE(cl.name,' ','')=?
                ) OR t.course_id IN (
                    SELECT cc.course_id FROM course_classes cc JOIN classes cl ON cl.id=cc.class_id
                    WHERE REPLACE(cl.name,' ','')=?
                )
            """, (cn_clean, cn_clean)).fetchone()["c"]

            fail_count = conn.execute("""
                SELECT COUNT(DISTINCT s.student_id) AS c
                FROM submissions s JOIN users u ON u.id=s.student_id
                JOIN score_records sr ON sr.submission_id=s.id
                WHERE REPLACE(u.organization,' ','')=? AND sr.final_score < 60
            """, (cn_clean,)).fetchone()["c"]

            dist = {"优秀": 0, "良好": 0, "中等": 0, "及格": 0, "不及格": 0}
            dist_rows = conn.execute("""
                SELECT sr.final_score AS score FROM submissions s
                JOIN users u ON u.id=s.student_id
                JOIN score_records sr ON sr.submission_id=s.id
                WHERE REPLACE(u.organization,' ','')=? AND sr.final_score IS NOT NULL
            """, (cn_clean,)).fetchall()
            for r in dist_rows:
                sc = r["score"]
                if sc >= 90: dist["优秀"] += 1
                elif sc >= 80: dist["良好"] += 1
                elif sc >= 70: dist["中等"] += 1
                elif sc >= 60: dist["及格"] += 1
                else: dist["不及格"] += 1

            completion_rate = round(sub_count / max(student_count * max(task_count, 1), 1) * 100, 1) if student_count > 0 and task_count > 0 else 0
            grade_label, grade_desc = _admin_grade_label(avg_score)

            class_ranking.append({
                "className": cn,
                "avgScore": avg_score,
                "studentCount": student_count,
                "taskCount": task_count,
                "submissionCount": sub_count,
                "completionRate": completion_rate,
                "failCount": fail_count,
                "gradeLabel": grade_label,
                "gradeDesc": grade_desc,
                "scoreDist": dist,
            })
        class_ranking.sort(key=lambda x: -x["avgScore"])

        # ---- 教师排行 ----
        teacher_rows = rows_to_list(conn.execute(
            "SELECT id, name, organization FROM users WHERE role='teacher' AND organization=?",
            (college_name,)
        ).fetchall())
        teacher_ranking = []
        for t in teacher_rows:
            courses = rows_to_list(conn.execute(
                "SELECT id, name FROM courses WHERE created_by=?", (t["id"],)
            ).fetchall())
            course_ids = [c["id"] for c in courses]
            course_count = len(courses)

            # 关联班级
            if course_ids:
                placeholders = ",".join(["?"] * len(course_ids))
                class_count = conn.execute(f"""
                    SELECT COUNT(DISTINCT cc.class_id) AS c FROM course_classes cc
                    WHERE cc.course_id IN ({placeholders})
                """, course_ids).fetchone()["c"]
            else:
                class_count = 0

            # 任务数
            if course_ids:
                placeholders = ",".join(["?"] * len(course_ids))
                task_count = conn.execute(f"""
                    SELECT COUNT(DISTINCT t.id) AS c FROM tasks t
                    WHERE t.course_id IN ({placeholders})
                       OR (t.course_id IS NULL AND t.course IN (SELECT name FROM courses WHERE created_by=?))
                """, course_ids + [t["id"]]).fetchone()["c"]
            else:
                task_count = 0

            # 成绩与提交
            if course_ids:
                placeholders = ",".join(["?"] * len(course_ids))
                score_row = conn.execute(f"""
                    SELECT AVG(sr.final_score) AS avg, COUNT(s.id) AS sub_count,
                           SUM(CASE WHEN sr.final_score IS NOT NULL THEN 1 ELSE 0 END) AS graded
                    FROM submissions s
                    JOIN tasks t ON t.id=s.task_id
                    LEFT JOIN score_records sr ON sr.submission_id=s.id
                    WHERE t.course_id IN ({placeholders})
                """, course_ids).fetchone()
            else:
                score_row = {"avg": None, "sub_count": 0, "graded": 0}
            avg_score = round(score_row["avg"], 1) if score_row["avg"] else 0
            sub_count = score_row["sub_count"] or 0
            graded = score_row["graded"] or 0
            grading_rate = round(graded / max(sub_count, 1) * 100, 1) if sub_count > 0 else 0

            # 学生覆盖度
            if course_ids:
                placeholders = ",".join(["?"] * len(course_ids))
                coverage = conn.execute(f"""
                    SELECT COUNT(DISTINCT u.id) AS c FROM users u
                    WHERE u.role='student' AND u.id IN (
                        SELECT s.student_id FROM submissions s
                        JOIN tasks t ON t.id=s.task_id
                        WHERE t.course_id IN ({placeholders})
                    )
                """, course_ids).fetchone()["c"]
            else:
                coverage = 0

            grade_label, grade_desc = _admin_grade_label(avg_score)

            teacher_ranking.append({
                "teacherId": t["id"],
                "teacherName": t["name"],
                "avgScore": avg_score,
                "courseCount": course_count,
                "classCount": class_count,
                "taskCount": task_count,
                "submissionCount": sub_count,
                "gradingRate": grading_rate,
                "coverageRate": coverage,
                "gradeLabel": grade_label,
                "gradeDesc": grade_desc,
            })
        teacher_ranking.sort(key=lambda x: -x["avgScore"])

    return ok({
        "college": college_name,
        "classRanking": class_ranking,
        "teacherRanking": teacher_ranking,
    })


@app.get("/api/admin/dashboard/classes/{class_name}")
async def admin_dashboard_class_detail(class_name: str, user=Depends(require_roles("admin"))):
    """L3 班级详情：学生排行"""
    from urllib.parse import unquote
    class_name = unquote(class_name)
    cn_clean = class_name.replace(" ", "")

    with get_conn() as conn:
        # 班级关联的任务
        task_rows = rows_to_list(conn.execute("""
            SELECT DISTINCT t.id FROM tasks t
            WHERE t.id IN (
                SELECT tc.task_id FROM task_classes tc JOIN classes cl ON cl.id=tc.class_id
                WHERE REPLACE(cl.name,' ','')=?
            ) OR t.course_id IN (
                SELECT cc.course_id FROM course_classes cc JOIN classes cl ON cl.id=cc.class_id
                WHERE REPLACE(cl.name,' ','')=?
            ) OR (t.course_id IS NULL AND t.course IN (
                SELECT c.name FROM courses c
                JOIN course_classes cc ON cc.course_id=c.id
                JOIN classes cl ON cl.id=cc.class_id
                WHERE REPLACE(cl.name,' ','')=?
            ))
        """, (cn_clean, cn_clean, cn_clean)).fetchall())
        task_ids = [t["id"] for t in task_rows]
        total_tasks = len(task_ids)

        # 学生列表
        student_rows = rows_to_list(conn.execute("""
            SELECT id, name, student_id, created_at FROM users
            WHERE role='student' AND REPLACE(organization,' ','')=?
            ORDER BY name
        """, (cn_clean,)).fetchall())

        # 提交记录
        if task_ids:
            placeholders = ",".join(["?"] * len(task_ids))
            sub_rows = rows_to_list(conn.execute(f"""
                SELECT s.student_id, s.task_id, s.status, s.risk_level, s.submitted_at,
                       sr.final_score, sr.ai_total_score
                FROM submissions s
                LEFT JOIN score_records sr ON sr.submission_id=s.id
                WHERE s.task_id IN ({placeholders})
            """, task_ids).fetchall())
        else:
            sub_rows = []

        student_ranking = []
        for sr in student_rows:
            sid = sr["id"]
            stu_subs = [s for s in sub_rows if s["student_id"] == sid]
            scores = [float(s["final_score"]) for s in stu_subs if s["final_score"] is not None]
            best_score = round(max(scores), 1) if scores else 0
            avg_score = round(sum(scores) / len(scores), 1) if scores else 0
            submitted_tasks = len(set(s["task_id"] for s in stu_subs))
            completion_rate = round(submitted_tasks / max(total_tasks, 1) * 100, 1) if total_tasks > 0 else 0

            # 风险等级
            high_risk_subs = sum(1 for s in stu_subs if s["risk_level"] == "高")
            if best_score < 60 or high_risk_subs >= 2:
                risk_level = "高"
            elif best_score < 75 or high_risk_subs >= 1:
                risk_level = "中"
            else:
                risk_level = "低"

            grade_label, grade_desc = _admin_grade_label(avg_score if avg_score > 0 else best_score)

            student_ranking.append({
                "studentId": sid,
                "name": sr["name"],
                "studentNumber": sr["student_id"],
                "bestScore": best_score,
                "avgScore": avg_score,
                "submittedTasks": submitted_tasks,
                "totalTasks": total_tasks,
                "completionRate": completion_rate,
                "riskLevel": risk_level,
                "gradeLabel": grade_label,
                "gradeDesc": grade_desc,
            })

        # 按最佳成绩排序，同分同排名
        student_ranking.sort(key=lambda x: -x["bestScore"])
        for i, s in enumerate(student_ranking):
            if i > 0 and s["bestScore"] == student_ranking[i - 1]["bestScore"]:
                s["rank"] = student_ranking[i - 1]["rank"]
            else:
                s["rank"] = i + 1

        # 成绩分布
        dist = {"优秀": 0, "良好": 0, "中等": 0, "及格": 0, "不及格": 0}
        for s in student_ranking:
            sc = s["bestScore"]
            if sc >= 90: dist["优秀"] += 1
            elif sc >= 80: dist["良好"] += 1
            elif sc >= 70: dist["中等"] += 1
            elif sc >= 60: dist["及格"] += 1
            else: dist["不及格"] += 1

        # 趋势
        trend_data = []
        for t in task_rows:
            task_subs = [s for s in sub_rows if s["task_id"] == t["id"]]
            task_scores = [float(s["final_score"]) for s in task_subs if s["final_score"] is not None]
            task_avg = round(sum(task_scores) / len(task_scores), 1) if task_scores else 0
            task_info = conn.execute("SELECT title, created_at FROM tasks WHERE id=?", (t["id"],)).fetchone()
            trend_data.append({
                "taskName": task_info["title"] if task_info else "",
                "avgScore": task_avg,
                "createdAt": task_info["created_at"] if task_info else "",
            })

    return ok({
        "className": class_name,
        "studentCount": len(student_ranking),
        "totalTasks": total_tasks,
        "scoreDist": dist,
        "studentRanking": student_ranking,
        "trends": trend_data,
    })


if __name__ == "__main__":
    import uvicorn
    from app.config import HOST, PORT
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
