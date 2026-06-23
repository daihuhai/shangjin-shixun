from .db import get_conn, new_id, utc_now

DEFAULT_METRICS = [
    {"name": "代码质量", "weight": 0.30, "max_score": 25, "criteria": "规范性、可读性、结构设计"},
    {"name": "文档规范性", "weight": 0.20, "max_score": 20, "criteria": "说明完整、格式规范、截图清晰"},
    {"name": "功能实现度", "weight": 0.35, "max_score": 35, "criteria": "需求覆盖、核心功能可用"},
    {"name": "过程表现", "weight": 0.15, "max_score": 20, "criteria": "步骤完整、测试与部署说明"}
]

SEED_USERS = [
    {"id": "teacher-001", "username": "teacher", "password": "teacher123", "name": "戴祜豪", "role": "teacher", "organization": "软件工程学院", "student_id": None},
    {"id": "student-001", "username": "student", "password": "student123", "name": "陈晓雯", "role": "student", "organization": "软件 2301", "student_id": "202301018"},
    {"id": "student-002", "username": "student2", "password": "student123", "name": "李明轩", "role": "student", "organization": "软件 2301", "student_id": "202301021"},
    {"id": "admin-001", "username": "admin", "password": "admin123", "name": "平台管理员", "role": "admin", "organization": "教务处", "student_id": None}
]

SEED_TASK = {
    "title": "Java Web 实训阶段成果提交",
    "course": "Java Web 实训",
    "class_name": "软件 2301",
    "description": "完成用户登录、权限控制、接口联调与部署说明文档。",
    "requirements": "1. 提供可运行源码或压缩包；2. 提交 Word/PDF 报告；3. 附界面截图；4. 说明测试步骤。",
    "checklist": "登录功能|权限控制|接口文档|部署说明|异常处理",
    "scoring_criteria": "代码质量 25 分：命名规范、结构清晰、无明显坏味道；文档规范性 20 分：报告完整、截图清楚；功能实现度 35 分：登录、权限、接口联调可用；过程表现 20 分：测试步骤与部署说明齐全。",
    "deadline": "2026-06-15T23:59:00",
    "allowed_formats": "doc,docx,pdf,zip,png,jpg,java,py,js"
}

SEED_COURSES = [
    {"name": "Java Web 实训", "description": "Java Web 开发综合实训课程"},
    {"name": "数据库设计", "description": "数据库原理与设计实训"}
]

SEED_CLASSES = [
    # ── 行政部门 ──
    {"name": "教务处"},
    {"name": "学工处"},
    {"name": "人事处"},
    {"name": "财务处"},
    {"name": "后勤管理处"},
    {"name": "信息化中心"},
    {"name": "图书馆"},
    {"name": "招生就业处"},
    # ── 学院（院系）──
    {"name": "软件工程学院"},
    {"name": "计算机科学与技术学院"},
    {"name": "信息工程学院"},
    {"name": "人工智能学院"},
    {"name": "大数据学院"},
    {"name": "电子工程学院"},
    {"name": "机械工程学院"},
    {"name": "土木工程学院"},
    {"name": "经济管理学院"},
    {"name": "外国语学院"},
    {"name": "艺术设计学院"},
    {"name": "理学院"},
    {"name": "马克思主义学院"},
    # ── 班级 ──
    {"name": "软件 2301"},
    {"name": "软件2302"},
    {"name": "软件2501"},
]

SEED_COURSE_CLASS_MAP = {
    "Java Web 实训": ["软件 2301"],
    "数据库设计": ["软件 2301"],
}


def seed_if_empty():
    with get_conn() as conn:
        now = utc_now()
        for user in SEED_USERS:
            exists = conn.execute(
                "SELECT 1 FROM users WHERE username = ? AND role = ?",
                (user["username"], user["role"])
            ).fetchone()
            if not exists:
                conn.execute(
                    """
                    INSERT INTO users (id, username, password, name, role, organization, student_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user["id"], user["username"], user["password"], user["name"], user["role"], user["organization"], user["student_id"], now)
                )

        metric_count = conn.execute("SELECT COUNT(*) AS c FROM score_metrics").fetchone()["c"]
        if metric_count == 0:
            for index, metric in enumerate(DEFAULT_METRICS):
                conn.execute(
                    """
                    INSERT INTO score_metrics (id, name, weight, max_score, criteria, parent_id, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (new_id(), metric["name"], metric["weight"], metric["max_score"], metric["criteria"], None, index)
                )

        # ---- 种子：课程 ----
        course_map = {}  # name -> id
        course_count = conn.execute("SELECT COUNT(*) AS c FROM courses").fetchone()["c"]
        if course_count == 0:
            for c in SEED_COURSES:
                cid = new_id()
                conn.execute(
                    "INSERT INTO courses (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (cid, c["name"], c["description"], "teacher-001", now, now)
                )
                course_map[c["name"]] = cid
        else:
            rows = conn.execute("SELECT id, name FROM courses").fetchall()
            course_map = {row["name"]: row["id"] for row in rows}

        # ---- 种子：班级 ----
        class_map = {}  # name -> id
        class_count = conn.execute("SELECT COUNT(*) AS c FROM classes").fetchone()["c"]
        if class_count == 0:
            for cl in SEED_CLASSES:
                clid = new_id()
                conn.execute(
                    "INSERT INTO classes (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
                    (clid, cl["name"], "teacher-001", now)
                )
                class_map[cl["name"]] = clid
        else:
            rows = conn.execute("SELECT id, name FROM classes").fetchall()
            class_map = {row["name"]: row["id"] for row in rows}

        # ---- 种子：课程-班级关联 ----
        cc_count = conn.execute("SELECT COUNT(*) AS c FROM course_classes").fetchone()["c"]
        if cc_count == 0:
            for course_name, class_names in SEED_COURSE_CLASS_MAP.items():
                cid = course_map.get(course_name)
                if not cid: continue
                for cn in class_names:
                    clid = class_map.get(cn)
                    if not clid: continue
                    conn.execute(
                        "INSERT INTO course_classes (id, course_id, class_id, created_at) VALUES (?, ?, ?, ?)",
                        (new_id(), cid, clid, now)
                    )

        # ---- 种子：任务（关联课程和班级）----
        task_count = conn.execute("SELECT COUNT(*) AS c FROM tasks").fetchone()["c"]
        if task_count == 0:
            task_id = new_id()
            java_course_id = course_map.get("Java Web 实训", "")
            software2301_class_id = class_map.get("软件 2301", "")
            conn.execute(
                """
                INSERT INTO tasks (
                    id, title, course, class_name, description, requirements, checklist, scoring_criteria,
                    deadline, allowed_formats, status, created_by, course_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    SEED_TASK["title"],
                    SEED_TASK["course"],
                    SEED_TASK["class_name"],
                    SEED_TASK["description"],
                    SEED_TASK["requirements"],
                    SEED_TASK["checklist"],
                    SEED_TASK["scoring_criteria"],
                    SEED_TASK["deadline"],
                    SEED_TASK["allowed_formats"],
                    "published",
                    "teacher-001",
                    java_course_id or None,
                    now,
                    now
                )
            )
            # 关联任务-班级
            if task_id and software2301_class_id:
                conn.execute(
                    "INSERT INTO task_classes (id, task_id, class_id, created_at) VALUES (?, ?, ?, ?)",
                    (new_id(), task_id, software2301_class_id, now)
                )
        else:
            conn.execute(
                """
                UPDATE tasks SET scoring_criteria = ?
                WHERE scoring_criteria IS NULL OR scoring_criteria = ''
                """,
                (SEED_TASK["scoring_criteria"],)
            )
