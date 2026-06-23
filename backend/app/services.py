import os
from datetime import datetime
from pathlib import Path

from fpdf import FPDF
from openpyxl import Workbook

from .config import EXPORT_DIR, MODEL_DISPLAY_NAME, PLATFORM_NAME
from .db import get_conn, loads, new_id, rows_to_list, utc_now


def _pdf_font_candidates() -> list[Path]:
    windir = Path(os.environ.get("WINDIR", r"C:\Windows"))
    return [
        windir / "Fonts" / "msyh.ttf",
        windir / "Fonts" / "simhei.ttf",
        windir / "Fonts" / "simsun.ttc",
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
    ]


def _setup_pdf_font(pdf: FPDF) -> bool:
    for path in _pdf_font_candidates():
        if path.exists():
            pdf.add_font("CJK", "", str(path))
            pdf.set_font("CJK", size=11)
            return True
    pdf.set_font("Helvetica", size=10)
    return False


def _task_filters(task_id: str | None) -> dict:
    return {"task_id": task_id} if task_id else {}


def get_task_detail(task_id: str, user_role: str, user_id: str) -> dict | None:
    with get_conn() as conn:
        task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not task_row:
        return None

    filters = {"task_id": task_id}
    if user_role == "student":
        filters["student_id"] = user_id

    rows = build_submission_rows(filters)
    serialized = [serialize_submission(row) for row in rows]
    student_ids = {item["studentId"] for item in serialized}
    pending_checks = [item for item in serialized if item["status"] in {"submitted", "parsed"}]
    pending_scores = [
        item for item in serialized
        if item["status"] in {"checked", "scored"} and not item.get("finalScore")
    ]
    high_risk = [item for item in serialized if item.get("riskLevel") == "高"]
    score_values = [
        item.get("finalScore") or item.get("aiTotalScore")
        for item in serialized
        if item.get("finalScore") or item.get("aiTotalScore")
    ]

    submitters: dict[str, dict] = {}
    for item in serialized:
        sid = item["studentId"]
        if sid not in submitters:
            submitters[sid] = {
                "studentId": sid,
                "studentName": item["studentName"],
                "studentNumber": item["studentNumber"],
                "organization": item["organization"],
                "submissionCount": 0,
                "latestStatus": item["status"],
                "latestScore": item.get("finalScore") or item.get("aiTotalScore"),
                "latestSubmittedAt": item["submittedAt"],
                "latestSubmissionId": item["id"],
                "riskLevel": item.get("riskLevel") or "低",
            }
        submitters[sid]["submissionCount"] += 1

    task = dict(task_row)
    return {
        "task": task,
        "stats": {
            "submissionCount": len(serialized),
            "studentCount": len(student_ids),
            "pendingCheck": len(pending_checks),
            "pendingScore": len(pending_scores),
            "highRisk": len(high_risk),
            "averageScore": round(sum(score_values) / len(score_values), 1) if score_values else None,
        },
        "submitters": sorted(
            submitters.values(),
            key=lambda item: item["latestSubmittedAt"] or "",
            reverse=True,
        ),
        "submissions": serialized,
    }


def build_submission_rows(filters: dict | None = None) -> list[dict]:
    filters = filters or {}
    query = """
        SELECT s.*, t.title AS task_title, t.course, t.class_name,
               u.name AS student_name, u.student_id AS student_number, u.organization,
               sr.ai_total_score, sr.teacher_adjusted_score, sr.final_score,
               pr.status AS parse_status, cr.status AS check_status
        FROM submissions s
        JOIN tasks t ON t.id = s.task_id
        JOIN users u ON u.id = s.student_id
        LEFT JOIN score_records sr ON sr.submission_id = s.id
        LEFT JOIN parse_results pr ON pr.submission_id = s.id
        LEFT JOIN check_reports cr ON cr.submission_id = s.id
        WHERE 1=1
    """
    params = []
    if filters.get("student_id"):
        query += " AND s.student_id = ?"
        params.append(filters["student_id"])
    if filters.get("task_id"):
        query += " AND s.task_id = ?"
        params.append(filters["task_id"])
    if filters.get("organization"):
        # 教师按所属组织过滤：取前2字符作为院系代码匹配下属班级
        # "软件工程学院"(前2字="软件") 匹配 "软件 2301"、"软件2302"
        org = filters["organization"].replace(" ", "")
        dept_code = org[:2] if len(org) >= 2 else org
        query += " AND REPLACE(u.organization, ' ', '') LIKE ?"
        params.append(f"{dept_code}%")
    query += " ORDER BY s.submitted_at DESC"
    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    return rows_to_list(rows)


def dashboard_data(role: str, user_id: str) -> dict:
    submissions = build_submission_rows({"student_id": user_id} if role == "student" else {})
    pending_checks = [item for item in submissions if item["status"] in {"submitted", "parsed"}]
    pending_scores = [item for item in submissions if item["status"] in {"checked", "scored"} and not item.get("final_score")]
    high_risk = [item for item in submissions if item.get("risk_level") == "高"]

    if role == "student":
        return {
            "heroTitle": "学习工作台",
            "metrics": [
                {"label": "进行中任务", "value": str(len({item["task_id"] for item in submissions}) or 1), "state": "进行中"},
                {"label": "我的提交", "value": str(len(submissions)), "state": "稳定"},
                {"label": "待查看反馈", "value": str(len([item for item in submissions if item.get("check_status")])), "state": "待处理"},
                {"label": "平均成绩", "value": _avg_score(submissions), "state": "稳定"}
            ],
            "todos": [
                {
                    "name": item["task_title"],
                    "target": item["course"],
                    "due": item["submitted_at"][:10],
                    "status": item["status"]
                }
                for item in submissions[:5]
            ]
        }

    if role == "teacher":
        return {
            "heroTitle": "教师工作台",
            "cards": [
                {"title": "待核查提交", "value": f"{len(pending_checks)} 份", "note": "需发起智能核查"},
                {"title": "待评分记录", "value": f"{len(pending_scores)} 份", "note": "需教师复核定稿"},
                {"title": "高风险提交", "value": f"{len(high_risk)} 份", "note": "建议优先处理"},
                {"title": "累计提交", "value": f"{len(submissions)} 份", "note": "覆盖全部实训任务"}
            ],
            "warning": {
                "value": f"{len(high_risk)} 份高风险提交待复核",
                "detail": "进入具体任务详情页，在「智能核查」标签中查看证据片段与修复建议。"
            },
            "visits": [
                {"label": "周一", "value": 12 + len(submissions)},
                {"label": "周二", "value": 18 + len(submissions)},
                {"label": "周三", "value": 22 + len(submissions)},
                {"label": "周四", "value": 20 + len(submissions)},
                {"label": "周五", "value": 16 + len(submissions)},
                {"label": "周六", "value": 8},
                {"label": "周日", "value": 6}
            ],
            "todos": [
                {
                    "name": item["task_title"],
                    "target": item["student_name"],
                    "due": item["submitted_at"][:10],
                    "status": item["status"]
                }
                for item in (pending_checks + pending_scores)[:5]
            ]
        }

    with get_conn() as conn:
        user_count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        task_count = conn.execute("SELECT COUNT(*) AS c FROM tasks").fetchone()["c"]
        log_count = conn.execute("SELECT COUNT(*) AS c FROM model_call_logs WHERE success = 1").fetchone()["c"]
        export_count = conn.execute("SELECT COUNT(*) AS c FROM report_snapshots").fetchone()["c"]

    return {
        "heroTitle": "管理后台",
        "metrics": [
            {"label": "平台用户", "value": str(user_count), "state": "稳定"},
            {"label": "实训任务", "value": str(task_count), "state": "稳定"},
            {"label": "模型成功调用", "value": str(log_count), "state": "稳定"},
            {"label": "报表导出次数", "value": str(export_count), "state": "稳定"}
        ],
        "charts": {
            "course": [
                {"label": "待核查", "value": len(pending_checks)},
                {"label": "待评分", "value": len(pending_scores)},
                {"label": "高风险", "value": len(high_risk)}
            ]
        },
        "rankings": [
            {"name": "尚进大模型", "indicator": MODEL_DISPLAY_NAME, "status": "在线"},
            {"name": "Java Web 实训", "indicator": f"{len(submissions)} 份提交", "status": "活跃"}
        ]
    }


def _avg_score(submissions: list[dict]) -> str:
    scores = [item["final_score"] or item["teacher_adjusted_score"] or item["ai_total_score"] for item in submissions]
    scores = [score for score in scores if score is not None]
    if not scores:
        return "--"
    return f"{sum(scores) / len(scores):.1f}"


def export_excel(report_type: str, created_by: str, task_id: str | None = None, student_id: str | None = None) -> dict:
    filters = _task_filters(task_id)
    if student_id:
        filters["student_id"] = student_id
    rows = build_submission_rows(filters)
    wb = Workbook()
    ws = wb.active
    ws.title = "实训评价"
    ws.append(["学生", "学号", "班级", "任务", "提交时间", "状态", "风险", "尚进大模型分", "教师分", "最终分"])
    for row in rows:
        ws.append([
            row["student_name"],
            row["student_number"],
            row["organization"],
            row["task_title"],
            row["submitted_at"][:19].replace("T", " "),
            row["status"],
            row["risk_level"],
            _row_get(row, "ai_total_score"),
            _row_get(row, "teacher_adjusted_score"),
            _row_get(row, "final_score")
        ])

    snapshot_id = new_id()[:8]
    filename = f"{report_type}-{snapshot_id}.xlsx"
    file_path = EXPORT_DIR / filename
    wb.save(file_path)
    _save_snapshot(report_type, "excel", filename, str(file_path), created_by)
    return {"filename": filename, "snapshotId": snapshot_id, "downloadUrl": f"/api/reports/download/{filename}"}


def export_pdf(report_type: str, created_by: str, task_id: str | None = None, student_id: str | None = None) -> dict:
    filters = _task_filters(task_id)
    if student_id:
        filters["student_id"] = student_id
    rows = build_submission_rows(filters)
    pdf = FPDF()
    pdf.add_page()
    has_cjk = _setup_pdf_font(pdf)
    title = f"{PLATFORM_NAME} 实训评价报表" if has_cjk else "Training Evaluation Report"
    pdf.set_font("CJK" if has_cjk else "Helvetica", size=14)
    pdf.cell(0, 10, title, ln=1)
    pdf.set_font("CJK" if has_cjk else "Helvetica", size=10)
    generated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pdf.cell(0, 8, f"生成时间：{generated}" if has_cjk else f"Generated: {generated}", ln=1)
    if task_id and rows:
        task_title = rows[0]["task_title"]
        pdf.cell(0, 8, f"任务：{task_title}" if has_cjk else f"Task: {task_title}", ln=1)
    pdf.ln(4)

    for row in rows[:50]:
        if has_cjk:
            line = (
                f"{row['student_name']}（{row['student_number']}）| "
                f"状态={row['status']} | 风险={row['risk_level']} | "
                f"尚进大模型分={row.get('ai_total_score') or '--'} | 最终分={row.get('final_score') or '--'}"
            )
        else:
            line = (
                f"{row['student_number']} | status={row['status']} | "
                f"risk={row['risk_level']} | final={row.get('final_score') or '--'}"
            )
        pdf.multi_cell(0, 6, line)
        pdf.ln(1)

    snapshot_id = new_id()[:8]
    filename = f"{report_type}-{snapshot_id}.pdf"
    file_path = EXPORT_DIR / filename
    pdf.output(str(file_path))
    _save_snapshot(report_type, "pdf", filename, str(file_path), created_by)
    return {"filename": filename, "snapshotId": snapshot_id, "downloadUrl": f"/api/reports/download/{filename}"}


def report_summary(task_id: str | None = None, user_role: str = "", user_id: str = "", organization: str = "") -> dict:
    filters = _task_filters(task_id)
    if user_role == "student":
        filters["student_id"] = user_id
    if organization and user_role != "student":
        filters["organization"] = organization
    rows = build_submission_rows(filters)
    score_values = [row.get("final_score") or row.get("ai_total_score") for row in rows if row.get("final_score") or row.get("ai_total_score")]
    distribution = {"90-100": 0, "80-89": 0, "70-79": 0, "60-69": 0, "<60": 0}
    for score in score_values:
        if score >= 90:
            distribution["90-100"] += 1
        elif score >= 80:
            distribution["80-89"] += 1
        elif score >= 70:
            distribution["70-79"] += 1
        elif score >= 60:
            distribution["60-69"] += 1
        else:
            distribution["<60"] += 1

    risk_stats = {"低": 0, "中": 0, "高": 0}
    for row in rows:
        risk_stats[row.get("risk_level") or "低"] = risk_stats.get(row.get("risk_level") or "低", 0) + 1

    return {
        "totalSubmissions": len(rows),
        "averageScore": round(sum(score_values) / len(score_values), 1) if score_values else 0,
        "distribution": [{"label": key, "value": value} for key, value in distribution.items()],
        "riskStats": [{"label": key, "value": value} for key, value in risk_stats.items()],
        "recentExports": _recent_exports(user_id)
    }


def _recent_exports(user_id: str = "") -> list[dict]:
    with get_conn() as conn:
        if user_id:
            rows = conn.execute(
                "SELECT id, report_type, format, filename, created_at FROM report_snapshots WHERE created_by = ? ORDER BY created_at DESC LIMIT 8",
                (user_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, report_type, format, filename, created_at FROM report_snapshots ORDER BY created_at DESC LIMIT 8"
            ).fetchall()
    return [
        {
            "id": row["id"],
            "type": row["report_type"],
            "format": row["format"],
            "filename": row["filename"],
            "createdAt": row["created_at"],
            "downloadUrl": f"/api/reports/download/{row['filename']}"
        }
        for row in rows
    ]


def _save_snapshot(report_type: str, fmt: str, filename: str, file_path: str, created_by: str):
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO report_snapshots (id, report_type, format, filename, file_path, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (new_id(), report_type, fmt, filename, file_path, created_by, utc_now())
        )


def _row_get(row, key, default=None):
    """安全获取 sqlite3.Row 的值，兼容 .get() 语义"""
    try:
        return row[key]
    except (IndexError, KeyError):
        return default


def _parse_score_dimensions(dimensions_json: str | None) -> dict:
    """
    解析评分维度数据，兼容新旧两种格式
    - 旧格式：直接是 dimensions 数组
    - 新格式：包含 dimensions + feedback 信息的对象
    """
    if not dimensions_json:
        return {"dimensions": []}

    data = loads(dimensions_json, {})

    # 新版格式（包含 feedback, highlights, errors 等）
    if isinstance(data, dict) and "dimensions" in data:
        return {
            "dimensions": data.get("dimensions", []),
            "feedback": data.get("feedback", ""),
            "summary": data.get("summary", ""),
            "highlights": data.get("highlights", []),
            "errors": data.get("errors", []),
            "similarityScore": data.get("similarityScore"),
            "correctnessScore": data.get("correctnessScore"),
            "completenessScore": data.get("completenessScore"),
        }

    # 旧版格式（直接是数组）
    if isinstance(data, list):
        return {"dimensions": data}

    # 兜底
    return {"dimensions": []}


def serialize_submission(row: dict) -> dict:
    with get_conn() as conn:
        files = rows_to_list(
            conn.execute(
                "SELECT id, filename, file_type, file_size, created_at FROM submission_files WHERE submission_id = ?",
                (row["id"],)
            ).fetchall()
        )
        parse_row = conn.execute("SELECT * FROM parse_results WHERE submission_id = ?", (row["id"],)).fetchone()
        check_row = conn.execute("SELECT * FROM check_reports WHERE submission_id = ?", (row["id"],)).fetchone()
        score_row = conn.execute("SELECT * FROM score_records WHERE submission_id = ?", (row["id"],)).fetchone()
        items = []
        if check_row:
            items = rows_to_list(
                conn.execute(
                    "SELECT * FROM check_items WHERE report_id = ? ORDER BY sort_order ASC",
                    (check_row["id"],)
                ).fetchall()
            )

    return {
        "id": row["id"],
        "taskId": row["task_id"],
        "taskTitle": _row_get(row, "task_title") or _row_get(row, "title"),
        "course": _row_get(row, "course"),
        "className": _row_get(row, "class_name"),
        "studentId": row["student_id"],
        "studentName": _row_get(row, "student_name"),
        "studentNumber": _row_get(row, "student_number"),
        "organization": _row_get(row, "organization"),
        "version": row["version"],
        "status": row["status"],
        "riskLevel": _row_get(row, "risk_level") or "低",
        "remark": _row_get(row, "remark"),
        "evaluationError": _row_get(row, "evaluation_error"),
        "submittedAt": row["submitted_at"],
        "files": files,
        "parseResult": dict(parse_row) if parse_row else None,
        "checkReport": {
            **dict(check_row),
            "items": [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "category": item["category"],
                    "conclusion": item["conclusion"],
                    "riskLevel": item["risk_level"],
                    "evidence": item["evidence"],
                    "suggestion": item["suggestion"],
                    "needsReview": bool(item["needs_review"]),
                    "teacherMark": item["teacher_mark"]
                }
                for item in items
            ],
            "effectiveHighRiskCount": sum(1 for item in items if item["risk_level"] == "高" and item.get("teacher_mark") != "误判")
        } if check_row else None,
        "scoreRecord": {
            "ai_total_score": score_row["ai_total_score"],
            "teacher_adjusted_score": score_row["teacher_adjusted_score"],
            "final_score": score_row["final_score"],
            "adjustment_reason": score_row["adjustment_reason"],
            "teacher_comment": score_row["teacher_comment"],
            **_parse_score_dimensions(score_row["dimensions_json"])
        } if score_row else None,
        "aiTotalScore": _row_get(row, "ai_total_score"),
        "teacherAdjustedScore": _row_get(row, "teacher_adjusted_score"),
        "finalScore": _row_get(row, "final_score")
    }
