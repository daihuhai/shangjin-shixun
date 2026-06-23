import asyncio
from pathlib import Path

from .config import MODEL_DISPLAY_NAME
from .db import dumps, get_conn, new_id, rows_to_list, utc_now
from .llm import analyze_image, run_auto_score, run_check_analysis, get_reference_analysis
from .parser import parse_submission_files
from .services import build_submission_rows

STATUS_LABELS = {
    "submitted": "已提交",
    "parsed": "已解析",
    "evaluating": "尚进大模型评价中",
    "evaluation_failed": "评价失败",
    "checked": "已核查",
    "scored": "已评分",
    "finalized": "已定稿"
}


def _set_submission_state(submission_id: str, status: str, error: str = ""):
    with get_conn() as conn:
        conn.execute(
            "UPDATE submissions SET status = ?, evaluation_error = ?, updated_at = ? WHERE id = ?",
            (status, error or None, utc_now(), submission_id)
        )


async def run_parse(submission_id: str) -> dict:
    with get_conn() as conn:
        files = rows_to_list(
            conn.execute(
                "SELECT filename, stored_name FROM submission_files WHERE submission_id = ?",
                (submission_id,)
            ).fetchall()
        )

    result = parse_submission_files(submission_id, files)

    # 异步分析图片文件（视觉OCR）
    image_paths = result.get("structure", {}).get("image_paths", [])
    if image_paths:
        image_texts = []
        for img_info in image_paths:
            try:
                ocr_text = await analyze_image(Path(img_info["path"]))
                image_texts.append(f"【{img_info['filename']}】(图片视觉识别)\n{ocr_text[:6000]}")
            except Exception as exc:
                image_texts.append(f"【{img_info['filename']}】(图片视觉识别失败: {exc})")
        # 合并图片分析结果到提取文本中
        if image_texts:
            result["extractedText"] = result["extractedText"].replace(
                "[图片文件，等待视觉分析]", ""
            ).strip()
            result["extractedText"] += "\n\n" + "\n\n".join(image_texts)
            # 更新摘要
            all_text = "\n".join(image_texts)
            result["summary"] = f"包含 {len(image_paths)} 张图片（已通过{MODEL_DISPLAY_NAME}视觉能力识别）。" + (
                f"\n图片内容概要：{all_text[:400]}" if all_text else ""
            )
            result["status"] = "success"

    now = utc_now()
    # 确保所有值都是字符串，避免SQLite绑定错误
    summary = str(result.get("summary", ""))
    extracted_text = str(result.get("extractedText", ""))
    structure_json = str(dumps(result.get("structure", {})))
    status = str(result.get("status", "partial"))
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM parse_results WHERE submission_id = ?", (submission_id,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE parse_results SET summary = ?, extracted_text = ?, structure_json = ?, status = ?, error_message = ?, updated_at = ?
                WHERE submission_id = ?
                """,
                (summary, extracted_text, structure_json, status, "", now, submission_id)
            )
        else:
            conn.execute(
                """
                INSERT INTO parse_results (id, submission_id, summary, extracted_text, structure_json, status, error_message, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id(), submission_id, summary, extracted_text, structure_json, status, "", now, now)
            )
        conn.execute(
            "UPDATE submissions SET status = ?, evaluation_error = NULL, updated_at = ? WHERE id = ?",
            ("parsed", now, submission_id)
        )
    return result


async def run_check(submission_id: str) -> None:
    rows = build_submission_rows()
    row = next((item for item in rows if item["id"] == submission_id), None)
    if not row:
        return

    with get_conn() as conn:
        task = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (row["task_id"],)).fetchone())
        parse_row = conn.execute("SELECT * FROM parse_results WHERE submission_id = ?", (submission_id,)).fetchone()
        if not parse_row:
            return

    scoring_hint = task.get("scoring_criteria") or ""
    ref_analysis = get_reference_analysis(row["task_id"])
    analysis = await run_check_analysis(
        task,
        parse_row["summary"] or "",
        (parse_row["extracted_text"] or "") + f"\n\n评分标准参考：{scoring_hint}" + (f"\n\n【教师参考文档分析】\n{ref_analysis}" if ref_analysis else "")
    )

    items = analysis.get("items") or []
    high_risk = sum(1 for item in items if item.get("riskLevel") == "高")
    overall = analysis.get("overallConclusion", "存疑")
    risk_level = "高" if high_risk >= 2 else ("中" if high_risk >= 1 else "低")
    now = utc_now()

    with get_conn() as conn:
        report_id = new_id()
        conn.execute("DELETE FROM check_items WHERE report_id IN (SELECT id FROM check_reports WHERE submission_id = ?)", (submission_id,))
        conn.execute("DELETE FROM check_reports WHERE submission_id = ?", (submission_id,))
        conn.execute(
            """
            INSERT INTO check_reports (id, submission_id, status, overall_conclusion, high_risk_count, model_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (report_id, submission_id, "completed", overall, high_risk, MODEL_DISPLAY_NAME, now, now)
        )
        for index, item in enumerate(items):
            conn.execute(
                """
                INSERT INTO check_items (id, report_id, name, category, conclusion, risk_level, evidence, suggestion, needs_review, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id(),
                    report_id,
                    item.get("name", f"核查项{index + 1}"),
                    item.get("category", "完整性"),
                    item.get("conclusion", "存疑"),
                    item.get("riskLevel", "低"),
                    item.get("evidence", ""),
                    item.get("suggestion", ""),
                    1 if item.get("needsReview") else 0,
                    index
                )
            )
        conn.execute(
            "UPDATE submissions SET status = ?, risk_level = ?, evaluation_error = NULL, updated_at = ? WHERE id = ?",
            ("checked", risk_level, now, submission_id)
        )


async def run_auto_scoring(submission_id: str) -> None:
    rows = build_submission_rows()
    row = next((item for item in rows if item["id"] == submission_id), None)
    if not row:
        return

    with get_conn() as conn:
        task = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (row["task_id"],)).fetchone())
        parse_row = conn.execute("SELECT * FROM parse_results WHERE submission_id = ?", (submission_id,)).fetchone()
        check_row = conn.execute("SELECT id FROM check_reports WHERE submission_id = ?", (submission_id,)).fetchone()
        if not parse_row:
            return
        items = []
        if check_row:
            items = rows_to_list(
                conn.execute(
                    "SELECT name, conclusion, risk_level, evidence FROM check_items WHERE report_id = ? AND (teacher_mark IS NULL OR teacher_mark != '误判')",
                    (check_row["id"],)
                ).fetchall()
            )

    scoring_hint = task.get("scoring_criteria") or ""
    ref_analysis = get_reference_analysis(row["task_id"])
    score_data = await run_auto_score(
        task,
        items,
        (parse_row["extracted_text"] or "") + f"\n\n评分标准：{scoring_hint}",
        ref_analysis
    )

    # 新版评分数据结构
    ai_score = float(score_data.get("aiTotalScore", 0))
    dimensions = score_data.get("dimensions", [])
    # 保留完整的反馈信息
    feedback_info = {
        "errors": score_data.get("errors", []),
        "highlights": score_data.get("highlights", []),
        "feedback": score_data.get("feedback", ""),
        "summary": score_data.get("summary", ""),
        "similarityScore": score_data.get("similarityScore", 0),
        "correctnessScore": score_data.get("correctnessScore", 0),
        "completenessScore": score_data.get("completenessScore", 0),
    }
    # 将 dimensions 和 feedback_info 合并存储到 dimensions_json
    full_dimensions = {
        "dimensions": dimensions,
        **feedback_info
    }
    now = utc_now()

    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM score_records WHERE submission_id = ?", (submission_id,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE score_records SET ai_total_score = ?, dimensions_json = ?, status = ?, scored_at = ?, updated_at = ?, final_score = ?
                WHERE submission_id = ?
                """,
                (ai_score, dumps(full_dimensions), "auto_scored", now, now, ai_score, submission_id)
            )
        else:
            conn.execute(
                """
                INSERT INTO score_records (id, submission_id, ai_total_score, final_score, dimensions_json, status, scored_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id(), submission_id, ai_score, ai_score, dumps(full_dimensions), "auto_scored", now, now)
            )
        conn.execute(
            "UPDATE submissions SET status = ?, evaluation_error = NULL, updated_at = ? WHERE id = ?",
            ("scored", now, submission_id)
        )


async def run_full_evaluation(submission_id: str) -> None:
    _set_submission_state(submission_id, "evaluating")
    try:
        await run_parse(submission_id)
        await run_check(submission_id)
        await run_auto_scoring(submission_id)
    except Exception as exc:
        _set_submission_state(submission_id, "evaluation_failed", str(exc)[:500])
        raise


def schedule_full_evaluation(submission_id: str) -> None:
    asyncio.create_task(run_full_evaluation(submission_id))
