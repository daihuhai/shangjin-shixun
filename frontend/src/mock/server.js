import { readAuth, readDb, writeAuth, writeDb } from "./storage";

function delay(result) {
  return new Promise((resolve) => window.setTimeout(() => resolve(result), 180));
}

function ok(data) {
  return delay(data);
}

function fail(message) {
  return Promise.reject(new Error(message));
}

function normalizeRole(role) {
  if (role === "teacher" || role === "student" || role === "admin") {
    return role;
  }
  return "student";
}

function parseQuery(path) {
  const query = path.split("?")[1];
  return new URLSearchParams(query || "");
}

function parseRole(path) {
  return normalizeRole(parseQuery(path).get("role"));
}

function getDashboardByRole(role) {
  if (role === "teacher") {
    return {
      heroTitle: "教学空间",
      heroDescription: "以课程为中心组织班级、课件、任务点、作业、考试和互动活动。",
      metrics: [
        { label: "本学期课程", value: "6", state: "进行中" },
        { label: "未批阅作业", value: "28", state: "待处理" },
        { label: "未读通知", value: "7", state: "待关注" },
        { label: "低完成率预警", value: "12", state: "风险" }
      ],
      cards: [
        { title: "本学期课程数量", value: "6 门", note: "覆盖软件工程学院 4 个班级" },
        { title: "未批阅作业数", value: "28 份", note: "其中主观题待批阅 16 份" },
        { title: "未读通知数", value: "7 条", note: "含 2 条课程公告待查看" }
      ],
      warning: {
        title: "教学预警",
        value: "9 名学生视频任务点完成率低于 50%",
        detail: "Java Web 实训与数据库课程设计两门课预警最集中。"
      },
      visits: [
        { label: "周一", value: 42 },
        { label: "周二", value: 58 },
        { label: "周三", value: 64 },
        { label: "周四", value: 71 },
        { label: "周五", value: 67 },
        { label: "周六", value: 36 },
        { label: "周日", value: 29 }
      ],
      todos: [
        { name: "在线考试系统阶段一批阅", target: "软件 2301", due: "今天 18:00", status: "待批阅" },
        { name: "数据库课程设计评分复核", target: "软件 2302", due: "今天 20:00", status: "待处理" },
        { name: "直播课堂回放整理", target: "Python 开发实训", due: "明天 09:00", status: "进行中" }
      ]
    };
  }

  if (role === "student") {
    return {
      heroTitle: "学习空间",
      heroDescription: "课程学习、任务完成、消息通知和个人学习档案在同一入口统一管理。",
      metrics: [
        { label: "进行中课程", value: "4", state: "进行中" },
        { label: "待完成任务", value: "5", state: "待处理" },
        { label: "未读消息", value: "8", state: "待关注" },
        { label: "总学习进度", value: "68%", state: "稳定" }
      ],
      profile: {
        title: "个人学习档案",
        progress: "本周学习时长 9.5 小时",
        rank: "班级任务点完成率排名第 7",
        note: "已完成 11 个视频任务点，3 份作业已批阅。"
      },
      timeline: [
        { time: "09:20", title: "教师发布新作业", description: "Java Web 实训新增接口安全整改报告。" },
        { time: "昨天", title: "系统提醒", description: "数据库课程设计作业将在 2 天后截止。" },
        { time: "05-12", title: "学习完成", description: "你已完成 SpringBoot 项目骨架视频任务点。" }
      ]
    };
  }

  return {
    heroTitle: "管理后台",
    heroDescription: "面向平台级用户、课程、门户和系统配置的统一管理控制台。",
    metrics: [
      { label: "累计课程", value: "286", state: "稳定" },
      { label: "活跃课程占比", value: "78%", state: "稳定" },
      { label: "本月新增课程", value: "24", state: "进行中" },
      { label: "审核待办", value: "13", state: "待处理" }
    ],
    charts: {
      course: [
        { label: "通识课", value: 86 },
        { label: "专业课", value: 132 },
        { label: "实训课", value: 68 }
      ],
      traffic: [
        { label: "周一", value: 240 },
        { label: "周二", value: 310 },
        { label: "周三", value: 332 },
        { label: "周四", value: 368 },
        { label: "周五", value: 355 },
        { label: "周六", value: 214 },
        { label: "周日", value: 168 }
      ]
    },
    rankings: [
      { name: "软件工程学院", indicator: "教师活跃度 92", status: "领先" },
      { name: "大数据学院", indicator: "任务点完成率 85%", status: "稳定" },
      { name: "汽车工程学院", indicator: "挂科率 6.8%", status: "关注" }
    ]
  };
}

function getTeacherCourseWorkspace(activeId) {
  const courses = [
    {
      id: "course-01",
      name: "Java Web 实训",
      className: "软件 2301、软件 2302",
      semester: "2025-2026 学年第二学期",
      teacher: "戴祜豪",
      status: "进行中",
      progress: 74,
      secondaryNav: ["章节建设", "班级管理", "活动", "作业", "考试", "统计", "通知", "资料"],
      chapters: [
        { title: "第 1 章 环境准备", children: ["1.1 JDK 与 Maven", "1.2 数据库初始化"], status: "已发布" },
        { title: "第 2 章 用户与权限", children: ["2.1 登录认证", "2.2 权限控制"], status: "已发布" },
        { title: "第 3 章 联调与部署", children: ["3.1 接口联调", "3.2 部署说明"], status: "隐藏" }
      ],
      taskPoints: [
        { name: "SpringBoot 项目骨架视频", type: "视频", rule: "观看时长达到 90%", state: "任务点" },
        { name: "接口设计说明", type: "文档", rule: "在线阅读后可下载", state: "任务点" },
        { name: "章节测验 1", type: "测验", rule: "得分达到 60 分即完成", state: "任务点" }
      ],
      classMembers: [
        { name: "陈晓雯", number: "202301018", department: "软件工程学院", status: "正常" },
        { name: "李明轩", number: "202301021", department: "软件工程学院", status: "正常" },
        { name: "周可", number: "202301032", department: "软件工程学院", status: "预警" }
      ],
      groups: [
        { name: "第 1 组", members: "6 人", leader: "陈晓雯" },
        { name: "第 2 组", members: "6 人", leader: "李明轩" },
        { name: "第 3 组", members: "5 人", leader: "周可" }
      ],
      activities: [
        { title: "二维码签到", type: "签到", status: "已结束", result: "到课 35 / 38" },
        { title: "接口设计投票", type: "投票", status: "进行中", result: "参与 29 人" },
        { title: "部署难点讨论", type: "主题讨论", status: "活跃", result: "18 条回复" }
      ],
      assignments: [
        { title: "在线考试系统阶段一", due: "05-18 23:59", attempts: "2 次", review: "待批阅 12 份", status: "已发布" },
        { title: "接口安全整改报告", due: "05-22 18:00", attempts: "1 次", review: "待提交 24 人", status: "已发布" }
      ],
      grading: {
        students: [
          { name: "陈晓雯", status: "待批阅", score: "--" },
          { name: "李明轩", status: "已批阅", score: "88" },
          { name: "周可", status: "打回重做", score: "72" }
        ],
        current: {
          title: "在线考试系统阶段一",
          student: "陈晓雯",
          summary: "支持主观题打分、写评语、打回重做。客观题已自动判分。",
          comment: "主流程完成度高，建议补充接口异常处理说明。"
        }
      },
      exams: [
        { title: "期中实训测验", duration: "90 分钟", antiCheat: "防切屏 + 乱序", status: "已发布" },
        { title: "数据库安全专题测验", duration: "45 分钟", antiCheat: "人脸识别", status: "组卷中" }
      ],
      proctoring: [
        { name: "陈晓雯", state: "已进入", warning: "切屏 0 次" },
        { name: "李明轩", state: "已交卷", warning: "切屏 1 次" },
        { name: "周可", state: "考试中", warning: "切屏 2 次" }
      ],
      statistics: [
        { label: "任务点完成率", value: "79%" },
        { label: "视频观看时长排名", value: "前 10 学生均值 8.4h" },
        { label: "章节测验平均分", value: "82.5" }
      ],
      notifications: [
        { title: "下周直播课堂安排", audience: "全班", status: "已发送" },
        { title: "第 3 组任务提醒", audience: "第 3 组", status: "待发送" }
      ],
      materials: [
        { name: "实验指导书", type: "PDF", access: "学生可下载", status: "已发布" },
        { name: "部署模板", type: "ZIP", access: "仅课内", status: "已发布" }
      ]
    },
    {
      id: "course-02",
      name: "数据库课程设计",
      className: "软件 2301",
      semester: "2025-2026 学年第二学期",
      teacher: "戴祜豪",
      status: "进行中",
      progress: 61,
      secondaryNav: ["章节建设", "班级管理", "活动", "作业", "考试", "统计", "通知", "资料"],
      chapters: [
        { title: "第 1 章 需求分析", children: ["1.1 场景分析", "1.2 ER 图设计"], status: "已发布" },
        { title: "第 2 章 SQL 优化", children: ["2.1 索引策略", "2.2 查询优化"], status: "已发布" }
      ],
      taskPoints: [
        { name: "ER 图设计案例", type: "图文", rule: "阅读完成并提交笔记", state: "任务点" },
        { name: "SQL 优化文档", type: "文档", rule: "在线阅读 100%", state: "任务点" }
      ],
      classMembers: [
        { name: "陈晓雯", number: "202301018", department: "软件工程学院", status: "正常" },
        { name: "周可", number: "202301032", department: "软件工程学院", status: "正常" }
      ],
      groups: [{ name: "数据库 A 组", members: "5 人", leader: "陈晓雯" }],
      activities: [{ title: "手势签到", type: "签到", status: "已结束", result: "到课 31 / 33" }],
      assignments: [{ title: "图书管理系统课程设计", due: "05-21 18:00", attempts: "1 次", review: "待提交 19 人", status: "已发布" }],
      grading: {
        students: [{ name: "陈晓雯", status: "待批阅", score: "--" }],
        current: {
          title: "图书管理系统课程设计",
          student: "陈晓雯",
          summary: "主观题手动批阅，客观题自动判分。",
          comment: "数据库命名规范良好，建议补充索引优化理由。"
        }
      },
      exams: [{ title: "数据库阶段测验", duration: "60 分钟", antiCheat: "题目乱序", status: "已发布" }],
      proctoring: [{ name: "陈晓雯", state: "考试中", warning: "切屏 0 次" }],
      statistics: [
        { label: "任务点完成率", value: "71%" },
        { label: "章节测验平均分", value: "80.3" },
        { label: "预警学生", value: "3 人" }
      ],
      notifications: [{ title: "课程设计提交规范", audience: "全班", status: "已发送" }],
      materials: [{ name: "SQL 优化案例集", type: "PDF", access: "学生可下载", status: "已发布" }]
    }
  ];

  const detail = courses.find((item) => item.id === activeId) || courses[0];
  return {
    list: courses,
    activeId: detail.id,
    detail
  };
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyTeacherWorkspaceOverrides(courses, overrides) {
  return courses.map((course) => {
    const override = overrides?.[course.id];
    if (!override) {
      return course;
    }

    return {
      ...course,
      activities: override.activities || course.activities,
      assignments: override.assignments || course.assignments,
      exams: override.exams || course.exams
    };
  });
}

function getTeacherWorkspaceState(db, activeId) {
  const base = getTeacherCourseWorkspace(activeId);
  const courses = applyTeacherWorkspaceOverrides(cloneData(base.list), db.teacherCourseWorkspace);
  const detail = courses.find((item) => item.id === (activeId || base.activeId)) || courses[0];

  return {
    list: courses,
    activeId: detail.id,
    detail
  };
}

function ensureTeacherCourseWorkspace(db, courseId, fallbackDetail) {
  if (!db.teacherCourseWorkspace) {
    db.teacherCourseWorkspace = {};
  }

  if (!db.teacherCourseWorkspace[courseId]) {
    db.teacherCourseWorkspace[courseId] = {
      activities: cloneData(fallbackDetail.activities || []),
      assignments: cloneData(fallbackDetail.assignments || []),
      exams: cloneData(fallbackDetail.exams || [])
    };
  }

  return db.teacherCourseWorkspace[courseId];
}

function getStudentCourseWorkspace(activeId) {
  const courses = [
    {
      id: "sc-01",
      name: "Java Web 实训",
      teacher: "戴祜豪",
      progress: 68,
      term: "2025-2026 学年第二学期",
      status: "进行中",
      secondaryNav: ["章节", "任务", "通知", "资料", "讨论", "进度成绩"],
      chapters: [
        { title: "第 1 章 环境准备", status: "已完成", taskPoints: ["JDK 与 Maven 视频", "数据库初始化文档"] },
        { title: "第 2 章 用户与权限", status: "进行中", taskPoints: ["登录认证视频", "章节测验 1", "权限控制文档"] },
        { title: "第 3 章 联调与部署", status: "未开始", taskPoints: ["部署说明视频"] }
      ],
      currentTaskPoint: {
        title: "登录认证视频",
        type: "视频任务点",
        player: "支持倍速、清晰度、断点续播和防拖拽规则。",
        note: "观看满 90% 且完成弹出测验后自动标记完成。"
      },
      documentReader: {
        title: "接口设计说明",
        note: "支持在线阅读 PDF/PPT，允许教师控制是否可下载。"
      },
      quiz: {
        title: "章节测验 1",
        note: "单选 / 多选 / 判断题提交后立即出分，达到要求分数才算完成。"
      },
      notes: [
        { title: "登录流程梳理", updatedAt: "今天 10:12" },
        { title: "权限控制易错点", updatedAt: "昨天 21:04" }
      ],
      tasks: {
        assignments: [
          { title: "在线考试系统阶段一", status: "进行中", due: "05-18 23:59" },
          { title: "接口安全整改报告", status: "未开始", due: "05-22 18:00" }
        ],
        exams: [
          { title: "期中实训测验", status: "考试说明", due: "05-26 19:00" }
        ],
        signins: [
          { title: "二维码签到", status: "已签到", due: "今天 08:00" },
          { title: "手势签到", status: "待签到", due: "明天 09:00" }
        ]
      },
      notices: [
        { title: "下周直播课堂安排", status: "未读", time: "今天 09:30" },
        { title: "第 2 章任务点说明", status: "已读", time: "昨天 18:00" }
      ],
      materials: [
        { name: "实验指导书", type: "PDF", access: "在线预览 / 下载" },
        { name: "部署模板", type: "ZIP", access: "下载" }
      ],
      discussion: [
        { topic: "登录鉴权方案讨论", status: "教师置顶", replies: 18 },
        { topic: "部署异常求助", status: "进行中", replies: 9 }
      ],
      grade: {
        standard: ["作业 30%", "考试 40%", "视频 10%", "签到 10%", "讨论 10%"],
        progress: [
          { label: "第 1 章", value: 100 },
          { label: "第 2 章", value: 72 },
          { label: "第 3 章", value: 18 }
        ],
        scores: [
          { name: "在线考试系统阶段一", score: "88" },
          { name: "章节测验 1", score: "92" },
          { name: "当前总成绩", score: "86.4" }
        ]
      }
    },
    {
      id: "sc-02",
      name: "数据库课程设计",
      teacher: "李老师",
      progress: 43,
      term: "2025-2026 学年第二学期",
      status: "进行中",
      secondaryNav: ["章节", "任务", "通知", "资料", "讨论", "进度成绩"],
      chapters: [
        { title: "第 1 章 需求分析", status: "已完成", taskPoints: ["ER 图设计文档"] },
        { title: "第 2 章 SQL 优化", status: "进行中", taskPoints: ["SQL 优化案例", "章节测验"] }
      ],
      currentTaskPoint: {
        title: "SQL 优化案例",
        type: "文档任务点",
        player: "支持 PDF 缩略图、全屏和教师控制下载权限。",
        note: "阅读完成后自动记录完成进度。"
      },
      documentReader: {
        title: "SQL 优化案例",
        note: "在线阅读完成后可跳转随堂测验。"
      },
      quiz: {
        title: "章节测验",
        note: "客观题自动判分，达到 60 分后算通过。"
      },
      notes: [{ title: "索引策略整理", updatedAt: "昨天 20:10" }],
      tasks: {
        assignments: [{ title: "图书管理系统课程设计", status: "进行中", due: "05-21 18:00" }],
        exams: [],
        signins: [{ title: "普通签到", status: "已签到", due: "昨天 08:10" }]
      },
      notices: [{ title: "课程设计提交规范", status: "未读", time: "今天 08:20" }],
      materials: [{ name: "SQL 优化案例集", type: "PDF", access: "在线预览 / 下载" }],
      discussion: [{ topic: "数据库命名规范", status: "进行中", replies: 5 }],
      grade: {
        standard: ["作业 40%", "考试 30%", "讨论 10%", "签到 20%"],
        progress: [
          { label: "第 1 章", value: 100 },
          { label: "第 2 章", value: 48 }
        ],
        scores: [
          { name: "章节测验", score: "84" },
          { name: "当前总成绩", score: "81.2" }
        ]
      }
    }
  ];

  const detail = courses.find((item) => item.id === activeId) || courses[0];
  return {
    list: courses,
    activeId: detail.id,
    detail
  };
}

function getAdminCourseData() {
  return {
    templates: [
      { name: "全校课程模板 A", category: "通识课", owner: "教务处", status: "启用" },
      { name: "专业课实训模板", category: "专业课", owner: "软件工程学院", status: "启用" },
      { name: "校企协同课程模板", category: "实训课", owner: "产教融合中心", status: "审核中" }
    ],
    opened: [
      { name: "Java Web 实训", teacher: "戴祜豪", className: "软件 2301", term: "2025-2026-2", status: "进行中" },
      { name: "数据库课程设计", teacher: "李老师", className: "软件 2302", term: "2025-2026-2", status: "进行中" },
      { name: "Python 开发实训", teacher: "王老师", className: "大数据 2301", term: "2025-2026-2", status: "待开课" }
    ],
    categories: [
      { label: "通识课", value: "42 门" },
      { label: "专业课", value: "118 门" },
      { label: "实训课", value: "56 门" }
    ],
    quotas: [
      { teacher: "戴祜豪", limit: "20 GB", used: "12.4 GB", status: "正常" },
      { teacher: "李老师", limit: "20 GB", used: "18.9 GB", status: "预警" }
    ]
  };
}

function getCloudSpace(role) {
  if (role === "teacher") {
    return {
      summary: [
        { label: "总空间", value: "20 GB" },
        { label: "已使用", value: "12.4 GB" },
        { label: "最近引用到课程", value: "8 份资源" }
      ],
      folders: [
        { name: "Java Web 实训", files: "12 个文件", updatedAt: "今天 09:20", status: "已同步课程" },
        { name: "数据库课程设计", files: "6 个文件", updatedAt: "昨天 17:40", status: "可引用" },
        { name: "直播回放", files: "4 个视频", updatedAt: "05-10 21:00", status: "处理中" }
      ]
    };
  }

  return {
    summary: [
      { label: "总空间", value: "5 GB" },
      { label: "已使用", value: "1.8 GB" },
      { label: "同步笔记", value: "16 条" }
    ],
    folders: [
      { name: "课程资料", files: "18 个文件", updatedAt: "今天 10:20", status: "正常" },
      { name: "作业草稿", files: "4 个文件", updatedAt: "昨天 22:10", status: "正常" },
      { name: "个人笔记", files: "16 条", updatedAt: "05-12 20:50", status: "正常" }
    ]
  };
}

function getTeacherApps() {
  return {
    tools: [
      { name: "虚拟仿真实验", category: "实验工具", status: "已启用", note: "可挂接到课程菜单" },
      { name: "论文查重", category: "学术工具", status: "已启用", note: "支持作业提交后查重" },
      { name: "课堂直播", category: "互动工具", status: "已启用", note: "支持回放" },
      { name: "问卷调查", category: "反馈工具", status: "可选", note: "可在课堂活动中启用" }
    ],
    shortcuts: [
      "配置课程菜单中的第三方应用入口",
      "为不同课程启用不同工具组合",
      "查看插件接入状态与最近调用记录"
    ]
  };
}

function getStudentMessages() {
  return {
    system: [
      { title: "作业截止提醒", from: "系统通知", status: "未读", time: "今天 09:40" },
      { title: "开课提醒：数据库课程设计", from: "系统通知", status: "已读", time: "昨天 18:00" }
    ],
    chats: [
      { title: "戴祜豪老师", from: "课程私信", status: "未读", time: "今天 08:15" },
      { title: "第 7 组组内讨论", from: "同学消息", status: "已读", time: "昨天 21:10" }
    ]
  };
}

function getPortalData() {
  return {
    notices: [
      { title: "校级通知：教学平台维护安排", status: "置顶", target: "全校用户" },
      { title: "新闻公告：智慧教学月启动", status: "发布中", target: "门户首页" }
    ],
    navs: [
      { name: "首页", status: "显示" },
      { name: "课程中心", status: "显示" },
      { name: "通知公告", status: "显示" },
      { name: "学习广场", status: "隐藏" }
    ],
    pages: [
      { name: "学校门户首页", status: "可编辑", owner: "门户管理员" },
      { name: "院系教学专区", status: "可编辑", owner: "院系管理员" }
    ],
    assets: [
      { name: "学校 Logo", status: "当前使用中" },
      { name: "首页 Banner", status: "轮播 3 张" },
      { name: "友情链接", status: "12 个链接" }
    ]
  };
}

function getUserAdminData() {
  const students = [
    { id: "s1", name: "陈晓雯", organization: "软件工程学院 / 软件 2301", role: "学生", roleKey: "student", college: "软件工程学院", className: "软件 2301", studentId: "202301018", grade: "2023级", status: "正常", createdAt: "2024-09-01T08:00:00" },
    { id: "s2", name: "李明轩", organization: "软件工程学院 / 软件 2302", role: "学生", roleKey: "student", college: "软件工程学院", className: "软件 2302", studentId: "202301021", grade: "2023级", status: "正常", createdAt: "2024-09-01T08:00:00" },
    { id: "s3", name: "周可", organization: "软件工程学院 / 软件 2301", role: "学生", roleKey: "student", college: "软件工程学院", className: "软件 2301", studentId: "202301032", grade: "2023级", status: "风险", createdAt: "2024-09-01T08:00:00" },
    { id: "s4", name: "王梓涵", organization: "软件工程学院 / 软件 2302", role: "学生", roleKey: "student", college: "软件工程学院", className: "软件 2302", studentId: "202301045", grade: "2023级", status: "正常", createdAt: "2024-09-01T08:00:00" },
    { id: "s5", name: "张雨欣", organization: "大数据学院 / 大数据 2301", role: "学生", roleKey: "student", college: "大数据学院", className: "大数据 2301", studentId: "202302003", grade: "2023级", status: "正常", createdAt: "2024-09-01T08:00:00" },
    { id: "s6", name: "刘子豪", organization: "大数据学院 / 大数据 2301", role: "学生", roleKey: "student", college: "大数据学院", className: "大数据 2301", studentId: "202302012", grade: "2023级", status: "异常", createdAt: "2024-09-01T08:00:00" },
    { id: "s7", name: "孙悦", organization: "汽车工程学院 / 汽服 2301", role: "学生", roleKey: "student", college: "汽车工程学院", className: "汽服 2301", studentId: "202303007", grade: "2023级", status: "正常", createdAt: "2024-09-01T08:00:00" },
  ];
  const teachers = [
    { id: "t1", name: "戴祜豪", organization: "软件工程学院", role: "教师", roleKey: "teacher", college: "软件工程学院", studentId: "T001", status: "正常", createdAt: "2023-03-15T10:00:00" },
    { id: "t2", name: "李老师", organization: "大数据学院", role: "教师", roleKey: "teacher", college: "大数据学院", studentId: "T002", status: "正常", createdAt: "2023-04-01T10:00:00" },
    { id: "t3", name: "王老师", organization: "软件工程学院", role: "教师", roleKey: "teacher", college: "软件工程学院", studentId: "T003", status: "正常", createdAt: "2023-05-10T10:00:00" },
    { id: "t4", name: "赵老师", organization: "汽车工程学院", role: "教师", roleKey: "teacher", college: "汽车工程学院", studentId: "T004", status: "正常", createdAt: "2023-06-01T10:00:00" },
  ];
  const admins = [
    { id: "a1", name: "平台管理员", organization: "教务处", role: "超级管理员", roleKey: "admin", college: "教务处", studentId: "admin", status: "正常", createdAt: "2023-01-01T00:00:00" },
    { id: "a2", name: "院系管理员A", organization: "软件工程学院", role: "院系管理员", roleKey: "admin", college: "软件工程学院", studentId: "A001", status: "正常", createdAt: "2023-02-01T00:00:00" },
  ];

  const orgMap = {};
  students.forEach((s) => {
    if (!orgMap[s.college]) {
      orgMap[s.college] = { student: 0, teacher: 0, admin: 0, teachers: [], classes: {} };
    }
    orgMap[s.college].student++;
    if (s.className) {
      orgMap[s.college].classes[s.className] = (orgMap[s.college].classes[s.className] || 0) + 1;
    }
  });
  teachers.forEach((t) => {
    if (!orgMap[t.college]) {
      orgMap[t.college] = { student: 0, teacher: 0, admin: 0, teachers: [], classes: {} };
    }
    orgMap[t.college].teacher++;
    orgMap[t.college].teachers.push({ id: t.id, name: t.name, username: t.studentId, studentId: t.studentId, organization: t.organization });
  });

  const organizationTree = Object.entries(orgMap).map(([name, counts]) => ({
    name,
    studentCount: counts.student,
    teacherCount: counts.teacher,
    adminCount: counts.admin,
    totalCount: counts.student + counts.teacher + counts.admin,
    teachers: counts.teachers,
    classes: Object.entries(counts.classes).map(([cn, sc]) => ({ name: cn, studentCount: sc })),
  }));

  return {
    students,
    teachers,
    admins,
    organizationTree,
    stats: {
      totalStudents: students.length,
      totalTeachers: teachers.length,
      totalAdmins: admins.length,
    },
    logs: [
      { action: "重置学生密码", actor: "平台管理员", time: "今天 09:20" },
      { action: "审核教师注册申请", actor: "院系管理员A", time: "昨天 16:40" }
    ]
  };
}

function getCollegeProfileData(college) {
  const collegeDataMap = {
    "软件工程学院": {
      totalStudents: 328, totalTeachers: 24, totalClasses: 8, totalCourses: 12, avgScore: 78.6, totalSubmissions: 1560
    },
    "大数据学院": {
      totalStudents: 186, totalTeachers: 15, totalClasses: 5, totalCourses: 8, avgScore: 75.2, totalSubmissions: 890
    },
    "汽车工程学院": {
      totalStudents: 145, totalTeachers: 12, totalClasses: 4, totalCourses: 6, avgScore: 72.8, totalSubmissions: 620
    },
  };
  const overview = collegeDataMap[college] || collegeDataMap["软件工程学院"];

  return {
    college: college || "软件工程学院",
    overview,
    abilities: [
      { name: "实践能力", value: 32, rate: 78 },
      { name: "理论掌握", value: 23, rate: 68 },
      { name: "项目完成度", value: 22, rate: 75 },
      { name: "出勤参与", value: 13, rate: 82 },
      { name: "创新思维", value: 10, rate: 62 },
    ],
    overallScore: overview.avgScore,
    gradeLabel: "B+",
    gradeDesc: "良好",
    scoreDistribution: [
      { range: "90-100", count: 42 },
      { range: "80-89", count: 128 },
      { range: "70-79", count: 96 },
      { range: "60-69", count: 45 },
      { range: "<60", count: 17 },
    ],
    classComparison: [
      { className: "软件 2301", avgScore: 82.5, studentCount: 42, submissionCount: 380 },
      { className: "软件 2302", avgScore: 79.8, studentCount: 45, submissionCount: 360 },
      { className: "软件 2201", avgScore: 77.2, studentCount: 38, submissionCount: 310 },
      { className: "软件 2202", avgScore: 75.6, studentCount: 40, submissionCount: 280 },
      { className: "软件 2401", avgScore: 74.3, studentCount: 41, submissionCount: 120 },
      { className: "软件 2402", avgScore: 71.8, studentCount: 39, submissionCount: 110 },
    ],
    trendData: [
      { month: "01月", avgScore: 72.5, submissions: 220 },
      { month: "02月", avgScore: 73.8, submissions: 180 },
      { month: "03月", avgScore: 75.6, submissions: 280 },
      { month: "04月", avgScore: 76.2, submissions: 310 },
      { month: "05月", avgScore: 77.9, submissions: 320 },
      { month: "06月", avgScore: 78.6, submissions: 250 },
    ],
    riskStats: [
      { level: "低风险", count: 268, color: "#22c55e" },
      { level: "中风险", count: 43, color: "#f59e0b" },
      { level: "高风险", count: 17, color: "#ef4444" },
    ],
    overallRisk: "低",
    riskPercent: 5,
    highRiskStudents: [
      { id: "hr1", name: "周可", studentId: "202301032", className: "软件 2301", avgScore: 45.2, submissionCount: 3 },
      { id: "hr2", name: "马晓宇", studentId: "202301056", className: "软件 2302", avgScore: 48.6, submissionCount: 2 },
      { id: "hr3", name: "胡志远", studentId: "202201023", className: "软件 2201", avgScore: 51.3, submissionCount: 4 },
      { id: "hr4", name: "林小雨", studentId: "202202011", className: "软件 2202", avgScore: 53.8, submissionCount: 3 },
      { id: "hr5", name: "郑文博", studentId: "202401008", className: "软件 2401", avgScore: 55.2, submissionCount: 2 },
    ],
    suggestions: [
      { icon: "📊", text: `学院整体均分${overview.avgScore}分，良好水平，建议继续保持项目驱动教学优势`, tag: "总览" },
      { icon: "⚠️", text: "高风险学生17名，建议辅导员和班主任及时介入，开展一对一帮扶", tag: "预警" },
      { icon: "📚", text: "实践能力维度表现突出（78分），建议理论课程增加案例教学提升理论掌握度", tag: "建议" },
      { icon: "🏆", text: "软件2301班均分最高(82.5分)，建议推广其学习小组模式到其他班级", tag: "拓展" },
      { icon: "📈", text: "近6个月均分稳步上升，教学质量持续改善，趋势向好", tag: "提升" },
    ],
    updatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
}

function getAdminExtras() {
  return {
    apps: [
      { name: "直播", status: "开启", note: "支持课程直播与回放" },
      { name: "小组", status: "开启", note: "支持课程分组活动" },
      { name: "问卷", status: "关闭", note: "按院系单独开放" }
    ],
    certificates: [
      { name: "课程完成证书模板 A", status: "启用" },
      { name: "实训结业证书模板", status: "草稿" }
    ],
    settings: [
      { name: "允许学生修改头像", value: "开启" },
      { name: "允许查看成绩排名", value: "关闭" },
      { name: "数据库自动备份", value: "每日 02:00" }
    ],
    backup: [
      { name: "2025-05-14 全量备份", status: "成功" },
      { name: "2025-05-13 全量备份", status: "成功" }
    ]
  };
}

export async function handleMockRequest({ method, path, body }) {
  const db = readDb();
  const auth = readAuth();

  if (method === "POST" && path === "/auth/login") {
    const user = db.users.find(
      (item) => item.username === body.username && item.password === body.password && item.role === body.role
    );
    if (!user) {
      return fail("账号、密码或身份标签不匹配");
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      organization: user.organization
    };
    writeAuth({ token: `mock-${user.id}`, user: safeUser });
    return ok({ user: safeUser });
  }

  if (method === "POST" && path === "/auth/register") {
    const exists = db.users.some((item) => item.username === body.username);
    if (exists) {
      return fail("用户名已存在");
    }

    const nextUser = {
      id: `user-${Date.now()}`,
      name: body.name,
      username: body.username,
      password: body.password,
      role: normalizeRole(body.role),
      organization: body.organization || "未分配组织"
    };

    db.users.push(nextUser);
    writeDb(db);
    return ok({ message: "注册成功" });
  }

  if (method === "POST" && path === "/auth/logout") {
    writeAuth(null);
    return ok({ success: true });
  }

  if (method === "POST" && path === "/auth/me") {
    return ok(auth?.user || null);
  }

  if (!auth?.user) {
    return fail("请先登录平台");
  }

  if (method === "POST" && path === "/course-workspace/assignment") {
    const fallback = getTeacherCourseWorkspace(body.courseId).detail;
    if (!fallback) {
      return fail("课程不存在");
    }

    const workspace = ensureTeacherCourseWorkspace(db, body.courseId, fallback);
    workspace.assignments.unshift({
      title: body.title,
      due: body.due,
      attempts: body.attempts || "1 次",
      review: body.review || "待提交",
      status: body.publishMode === "scheduled" ? "待发布" : "草稿"
    });
    writeDb(db);
    return ok({ success: true });
  }

  if (method === "POST" && path === "/course-workspace/exam") {
    const fallback = getTeacherCourseWorkspace(body.courseId).detail;
    if (!fallback) {
      return fail("课程不存在");
    }

    const workspace = ensureTeacherCourseWorkspace(db, body.courseId, fallback);
    workspace.exams.unshift({
      title: body.title,
      duration: body.duration,
      antiCheat: body.antiCheat,
      status: body.publishMode === "scheduled" ? "待发布" : "草稿"
    });
    writeDb(db);
    return ok({ success: true });
  }

  if (method === "POST" && path === "/course-workspace/activity") {
    const fallback = getTeacherCourseWorkspace(body.courseId).detail;
    if (!fallback) {
      return fail("课程不存在");
    }

    const workspace = ensureTeacherCourseWorkspace(db, body.courseId, fallback);
    workspace.activities.unshift({
      title: body.title,
      type: body.type,
      status: body.status || "未开始",
      result: body.result || "等待学生参与"
    });
    writeDb(db);
    return ok({ success: true });
  }

  if (method === "GET" && path.startsWith("/dashboard")) {
    return ok(getDashboardByRole(parseRole(path)));
  }

  if (method === "GET" && path.startsWith("/workspace")) {
    return ok(getDashboardByRole(parseRole(path)));
  }

  if (method === "GET" && path.startsWith("/course-workspace")) {
    const role = parseRole(path);
    const activeId = parseQuery(path).get("activeId");
    return ok(role === "teacher" ? getTeacherWorkspaceState(db, activeId) : role === "student" ? getStudentCourseWorkspace(activeId) : getAdminCourseData());
  }

  if (method === "GET" && path.startsWith("/cloud-space")) {
    return ok(getCloudSpace(parseRole(path)));
  }

  if (method === "GET" && path.startsWith("/apps")) {
    return ok(getTeacherApps());
  }

  if (method === "GET" && path.startsWith("/messages")) {
    return ok(getStudentMessages());
  }

  if (method === "GET" && path === "/portal") {
    return ok(getPortalData());
  }

  if (method === "GET" && path === "/admin/users") {
    return ok(getUserAdminData());
  }

  if (method === "GET" && path === "/admin/extras") {
    return ok(getAdminExtras());
  }

  if (method === "GET" && path.startsWith("/admin/colleges/") && path.endsWith("/profile")) {
    const collegeName = decodeURIComponent(path.replace("/admin/colleges/", "").replace("/profile", ""));
    return ok(getCollegeProfileData(collegeName));
  }

  return fail(`未实现的接口: ${method} ${path}`);
}
