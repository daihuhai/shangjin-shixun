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
async def get_dashboard(role: str = "teacher", user=Depends(current_user)):
    return ok(dashboard_data(role or user["role"], user["id"]))


# ---------- Courses ----------
@app.get("/api/courses")
async def list_courses(user=Depends(require_roles("teacher", "admin"))):
    with get_conn() as conn:
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
        rows = conn.execute("""
            SELECT cl.*,
                (SELECT COUNT(*) FROM course_classes cc WHERE cc.class_id = cl.id) AS course_count
            FROM classes cl ORDER BY cl.name
        """).fetchall()
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
                JOIN task_classes tc ON tc.task_id = t.id
                JOIN classes cl ON cl.id = tc.class_id
                WHERE t.status = 'published' AND cl.name = ?
                ORDER BY t.created_at DESC
                """,
                (user["id"], user["organization"])
            ).fetchall()
        else:
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
    return ok(report_summary(task_id, user["role"], user["id"]))


@app.get("/api/reports/profile")
async def reports_profile(user=Depends(current_user)):
    """学生画像：能力分布 + 标签 + AI学习建议"""
    if user["role"] != "student":
        fail("学生画像仅对学生开放", 403)

    profile = student_profile(user["id"])
    ctx = profile.pop("llmContext", {})

    # 异步调用LLM生成个性化建议
    suggestions = await _generate_learning_suggestions(ctx)
    profile["suggestions"] = suggestions

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
    path = EXPORT_DIR / Path(filename).name
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
    """获取用户画像详情（用于右侧面板）"""
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

    # 获取该用户的评分数据
    submissions = build_submission_rows({"student_id": user_id})
    all_scores = []
    scored_task_ids = set()
    similarity_scores = []
    correctness_scores = []
    completeness_scores = []

    # 查询评分
    with get_conn() as conn2:
        for row in submissions:
            score_row = conn2.execute(
                "SELECT * FROM score_records WHERE submission_id = ?", (row["id"],)
            ).fetchone()
            if not score_row:
                continue
            final = row.get("final_score") or _row_get(score_row, "ai_total_score")
            if final is not None:
                all_scores.append(final)
                scored_task_ids.add(_row_get(row, "task_id"))

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

    avg_score = round(sum(all_scores) / len(all_scores), 1) if all_scores else 0
    submission_count = len(submissions)
    completed_tasks = len(scored_task_ids)

    # 能力维度
    sim_rate = round(sum(similarity_scores) / len(similarity_scores) / 50 * 100, 1) if similarity_scores else 0
    cor_rate = round(sum(correctness_scores) / len(correctness_scores) / 30 * 100, 1) if correctness_scores else 0
    com_rate = round(sum(completeness_scores) / len(completeness_scores) / 20 * 100, 1) if completeness_scores else 0

    # 获取课程总任务数
    total_tasks = 0
    if submissions:
        first_task_id = _row_get(submissions[0], "task_id")
        with get_conn() as conn3:
            task_info = conn3.execute("SELECT course_id, course FROM tasks WHERE id = ?", (first_task_id,)).fetchone()
            if task_info:
                cid = _row_get(task_info, "course_id")
                cname = _row_get(task_info, "course")
                if cid:
                    total_tasks = conn3.execute("SELECT COUNT(*) FROM tasks WHERE course_id = ?", (cid,)).fetchone()[0]
                elif cname:
                    total_tasks = conn3.execute("SELECT COUNT(*) FROM tasks WHERE REPLACE(course, ' ', '') = ?", (cname.replace(" ", ""),)).fetchone()[0]

    attendance_rate = min(100, round(completed_tasks / max(total_tasks, 1) * 100, 1)) if total_tasks > 0 else 0

    # 综合评分
    overall_score = avg_score if avg_score > 0 else 0
    if overall_score >= 85:
        grade_label, grade_desc = "A", "优秀"
    elif overall_score >= 70:
        grade_label, grade_desc = "B+", "良好"
    elif overall_score >= 60:
        grade_label, grade_desc = "B", "及格"
    elif overall_score >= 40:
        grade_label, grade_desc = "C+", "需努力"
    else:
        grade_label, grade_desc = "C", "待提升"

    # 风险等级
    if overall_score >= 70:
        risk_level = "低"
        risk_percent = 15
    elif overall_score >= 50:
        risk_level = "中"
        risk_percent = 50
    else:
        risk_level = "高"
        risk_percent = 85

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
        "abilities": [
            {"name": "实践能力", "value": 35, "rate": sim_rate},
            {"name": "理论掌握", "value": 25, "rate": cor_rate},
            {"name": "项目完成度", "value": 20, "rate": com_rate},
            {"name": "学习态度", "value": 10, "rate": attendance_rate},
            {"name": "创新能力", "value": 10, "rate": min(100, round(overall_score * 0.8, 1))},
        ],
        "overallScore": overall_score,
        "gradeLabel": grade_label,
        "gradeDesc": grade_desc,
        "metrics": {
            "avgScore": avg_score,
            "submissionCount": submission_count,
            "completedTasks": completed_tasks,
            "attendanceRate": attendance_rate,
        },
        "riskLevel": risk_level,
        "riskPercent": risk_percent,
        "riskDesc": "学习状态良好，继续保持" if risk_level == "低" else "需要关注学习进度",
        "suggestions": [
            {"icon": "", "text": "继续保持项目实践，建议参与更多团队协作项目", "tag": "提升"},
            {"icon": "📚", "text": "加强算法与数据结构学习，提升理论基础", "tag": "建议"},
            {"icon": "🏆", "text": "可尝试参与学科竞赛，提升综合能力", "tag": "拓展"},
        ],
    })


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
    """教师/管理员视角：按课程分块的完整统计数据
       - 教师：仅看到自己所属组织（班级/学院）的数据
       - 管理员：看到全校全部数据
    """
    is_admin = user["role"] == "admin"
    org_filter = None if is_admin else (user.get("organization") or "")
    rows = build_submission_rows({"organization": org_filter} if org_filter else {})

    with get_conn() as conn:
        # 获取所有课程
        course_list = rows_to_list(conn.execute("""
            SELECT id, name, description FROM courses ORDER BY created_at
        """).fetchall())

        # 全局统计（跨所有课程）
        student_ids = set(r["student_id"] for r in rows if r.get("student_id"))
        # 教师只统计本班学生，管理员统计全部
        if is_admin:
            total_students = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'student'").fetchone()[0]
        elif org_filter:
            org_clean = org_filter.replace(" ", "")
            dept_code = org_clean[:2] if len(org_clean) >= 2 else org_clean
            total_students = conn.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'student' AND REPLACE(organization, ' ', '') LIKE ?",
                (f"{dept_code}%",)
            ).fetchone()[0]
        else:
            total_students = len(student_ids) or 0
        total_tasks = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        summary = report_summary(organization=org_filter or "")
        total_submissions = summary.get("totalSubmissions", 0)
        avg_score = summary.get("averageScore", 0)

        # 班级分布（教师只看本班，管理员看全局）
        if is_admin:
            class_rows = rows_to_list(conn.execute("""
                SELECT TRIM(REPLACE(u.organization, ' ', '')) AS class_name, COUNT(*) AS student_count
                FROM users u WHERE u.role = 'student'
                GROUP BY TRIM(REPLACE(u.organization, ' ', ''))
                ORDER BY student_count DESC
            """).fetchall())
        elif org_filter:
            class_rows = [{"class_name": org_filter.replace(" ", ""), "student_count": total_students}]
        else:
            class_rows = []
        if not class_rows and rows:
            org_students = {}
            for r in rows:
                cls = (r.get("organization") or "").replace(" ", "").strip()
                sid = r.get("student_id")
                if cls and sid:
                    org_students.setdefault(cls, set()).add(sid)
            class_rows = [{"class_name": k, "student_count": len(v)} for k, v in sorted(org_students.items(), key=lambda x: -len(x[1]))]

        # 按课程聚合每门课的数据
        courses_data = []
        for course in course_list:
            cid = course["id"]
            cname = course["name"]

            # 该课程的任务（优先按 course_id 匹配，兜底按课程名称匹配）
            task_rows = rows_to_list(conn.execute(
                "SELECT id, title FROM tasks WHERE course_id = ? OR (course_id IS NULL AND course = ?) ORDER BY created_at",
                (cid, cname),
            ).fetchall())
            task_ids = [t["id"] for t in task_rows]

            if not task_ids:
                # 无任务的课程也展示，但数据为空
                courses_data.append({
                    "courseId": cid,
                    "courseName": cname,
                    "totalTasks": 0,
                    "totalSubmissions": 0,
                    "avgScore": 0,
                    "classBreakdown": [],
                    "scoreDistribution": _empty_dist(),
                    "trends": [],
                    "topErrors": [],
                })
                continue

            placeholders = ",".join(["?"] * len(task_ids))

            # 该课程的提交记录
            sub_rows = rows_to_list(conn.execute(f"""
                SELECT s.*, u.organization,
                       sr.ai_total_score, sr.final_score
                FROM submissions s
                JOIN users u ON u.id = s.student_id
                LEFT JOIN score_records sr ON sr.submission_id = s.id
                WHERE s.task_id IN ({placeholders})
            """, task_ids).fetchall())

            sub_count = len(sub_rows)
            scores = [float(r.get("final_score") or r.get("ai_total_score") or 0) for r in sub_rows]
            course_avg = round(sum(scores) / len(scores), 1) if scores else 0

            # 该课程的班级分布（按去重学生人数）
            class_students = {}
            for r in sub_rows:
                cls = (r.get("organization") or "").replace(" ", "").strip()
                sid = r.get("student_id")
                if cls and sid:
                    class_students.setdefault(cls, set()).add(sid)
            course_class_breakdown = [
                {"class_name": k, "student_count": len(v)}
                for k, v in sorted(class_students.items(), key=lambda x: -len(x[1]))
            ]

            # 该课程的分数分布
            dist = {"<60": 0, "60-69": 0, "70-79": 0, "80-89": 0, "90-100": 0}
            for s in scores:
                if s < 60: dist["<60"] += 1
                elif s < 70: dist["60-69"] += 1
                elif s < 80: dist["70-79"] += 1
                elif s < 90: dist["80-89"] += 1
                else: dist["90-100"] += 1
            course_dist = [{"range": k, "count": v} for k, v in dist.items()]

            # 该课程的班级均分趋势
            trend_rows = rows_to_list(conn.execute(f"""
                SELECT t.id AS task_id, t.title AS task_name,
                       TRIM(REPLACE(u.organization, ' ', '')) AS class_name,
                       COALESCE(AVG(CAST(sr.final_score AS REAL)),
                                AVG(CAST(sr.ai_total_score AS REAL)), 0) AS avg_score,
                       COUNT(s.id) AS submission_count
                FROM tasks t
                JOIN submissions s ON s.task_id = t.id
                JOIN users u ON u.id = s.student_id
                LEFT JOIN score_records sr ON sr.submission_id = s.id
                WHERE (t.course_id = ? OR (t.course_id IS NULL AND t.course = ?))
                GROUP BY t.id, TRIM(REPLACE(u.organization, ' ', ''))
                ORDER BY t.created_at, class_name
            """, (cid, cname)).fetchall())

            # 该课程的高频错误
            error_rows = rows_to_list(conn.execute(f"""
                SELECT ci.name AS check_item, ci.category AS category,
                       ci.conclusion AS conclusion, ci.risk_level AS risk_level,
                       COUNT(*) AS count
                FROM check_items ci
                JOIN check_reports cr ON cr.id = ci.report_id
                JOIN submissions s ON cr.submission_id = s.id
                WHERE ci.conclusion = '不通过'
                  AND (ci.teacher_mark IS NULL OR ci.teacher_mark != '误判')
                  AND s.task_id IN ({placeholders})
                GROUP BY ci.name, ci.category
                ORDER BY count DESC
                LIMIT 10
            """, task_ids).fetchall())  # 高频错误：按课程任务筛选

            courses_data.append({
                "courseId": cid,
                "courseName": cname,
                "totalTasks": len(task_ids),
                "totalSubmissions": sub_count,
                "avgScore": course_avg,
                "classBreakdown": course_class_breakdown,
                "scoreDistribution": course_dist,
                "trends": trend_rows,
                "topErrors": error_rows,
            })

    return ok({
        "globalStats": {
            "totalStudents": total_students,
            "totalTasks": total_tasks,
            "totalSubmissions": total_submissions,
            "avgScore": avg_score,
            "classBreakdown": class_rows,
        },
        "courses": courses_data,
    })


async def _dashboard_student_view(user):
    """学生视角：显示个人课程、任务和成绩"""
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
            ORDER BY s.submitted_at DESC
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

        # 获取学生关联的课程（通过班级-课程关系）
        org = (user.get("organization") or "").replace(" ", "").strip()
        course_rows = rows_to_list(conn.execute("""
            SELECT DISTINCT c.id, c.name
            FROM courses c
            JOIN course_classes cc ON cc.course_id = c.id
            JOIN classes cl ON cl.id = cc.class_id
            WHERE cl.name = ?
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

    return ok({
        "globalStats": {
            "totalStudents": 1,
            "totalTasks": len(best_by_task),
            "totalSubmissions": len(sub_rows),
            "avgScore": round(sum(t["bestScore"] for t in best_by_task.values() if t["bestScore"]) / len(best_by_task), 1) if best_by_task else None,
        },
        "courses": courses_data,
        "studentName": user.get("name", ""),
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


if __name__ == "__main__":
    import uvicorn
    from app.config import HOST, PORT
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
