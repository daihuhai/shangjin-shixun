import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DB_PATH


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                organization TEXT,
                student_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_role ON users(username, role);

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                course TEXT NOT NULL,
                class_name TEXT NOT NULL,
                description TEXT,
                requirements TEXT,
                checklist TEXT,
                scoring_criteria TEXT,
                deadline TEXT,
                allowed_formats TEXT,
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS submissions (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL,
                risk_level TEXT DEFAULT '低',
                remark TEXT,
                evaluation_error TEXT,
                submitted_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id),
                FOREIGN KEY(student_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS submission_files (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                file_type TEXT,
                file_size INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY(submission_id) REFERENCES submissions(id)
            );

            CREATE TABLE IF NOT EXISTS parse_results (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL UNIQUE,
                summary TEXT,
                extracted_text TEXT,
                structure_json TEXT,
                status TEXT NOT NULL,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(submission_id) REFERENCES submissions(id)
            );

            CREATE TABLE IF NOT EXISTS check_reports (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                overall_conclusion TEXT,
                high_risk_count INTEGER DEFAULT 0,
                model_version TEXT,
                rule_version TEXT DEFAULT 'v1.0',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(submission_id) REFERENCES submissions(id)
            );

            CREATE TABLE IF NOT EXISTS check_items (
                id TEXT PRIMARY KEY,
                report_id TEXT NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                conclusion TEXT NOT NULL,
                risk_level TEXT NOT NULL,
                evidence TEXT,
                suggestion TEXT,
                needs_review INTEGER DEFAULT 0,
                teacher_mark TEXT,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY(report_id) REFERENCES check_reports(id)
            );

            CREATE TABLE IF NOT EXISTS score_metrics (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                weight REAL NOT NULL,
                max_score REAL NOT NULL DEFAULT 100,
                criteria TEXT,
                parent_id TEXT,
                sort_order INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS score_records (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL UNIQUE,
                ai_total_score REAL,
                teacher_adjusted_score REAL,
                final_score REAL,
                adjustment_reason TEXT,
                teacher_comment TEXT,
                dimensions_json TEXT,
                status TEXT NOT NULL,
                scored_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(submission_id) REFERENCES submissions(id)
            );

            CREATE TABLE IF NOT EXISTS model_call_logs (
                id TEXT PRIMARY KEY,
                scene TEXT NOT NULL,
                model_name TEXT NOT NULL,
                latency_ms INTEGER,
                success INTEGER NOT NULL,
                error_message TEXT,
                input_summary TEXT,
                output_summary TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS report_snapshots (
                id TEXT PRIMARY KEY,
                report_type TEXT NOT NULL,
                format TEXT NOT NULL,
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                created_by TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reference_codes (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                file_type TEXT,
                file_size INTEGER,
                extracted_text TEXT,
                analysis_result TEXT,
                analysis_status TEXT DEFAULT 'pending',
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id)
            );

            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS classes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS course_classes (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                class_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(course_id) REFERENCES courses(id),
                FOREIGN KEY(class_id) REFERENCES classes(id),
                UNIQUE(course_id, class_id)
            );

            CREATE TABLE IF NOT EXISTS task_classes (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                class_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id),
                FOREIGN KEY(class_id) REFERENCES classes(id)
            );
            """
        )
        _migrate(conn)


def _migrate(conn):
    task_cols = {row[1] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    if "scoring_criteria" not in task_cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN scoring_criteria TEXT")
    if "course_id" not in task_cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN course_id TEXT")

    sub_cols = {row[1] for row in conn.execute("PRAGMA table_info(submissions)").fetchall()}
    if "evaluation_error" not in sub_cols:
        conn.execute("ALTER TABLE submissions ADD COLUMN evaluation_error TEXT")
    ref_cols = {row[1] for row in conn.execute("PRAGMA table_info(reference_codes)").fetchall()}
    if "task_id" not in ref_cols:
        conn.execute("ALTER TABLE reference_codes ADD COLUMN task_id TEXT")


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(row) for row in rows]


def dumps(value):
    return json.dumps(value, ensure_ascii=False)


def loads(value, default=None):
    if not value:
        return default if default is not None else {}
    return json.loads(value)
