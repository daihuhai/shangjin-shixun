export const roleLabels = {
  teacher: "教师",
  student: "学生",
  admin: "管理员"
};

export const workspaceLabels = {
  teacher: "教师工作台",
  student: "学生工作台",
  admin: "管理后台"
};

export const roleNavigation = {
  teacher: [
    { path: "/dashboard", label: "数据看板" },
    { path: "/courses", label: "课程管理" },
    { path: "/tasks", label: "任务管理" },
    { path: "/reports", label: "报表中心" },
    { path: "/metrics", label: "指标配置" }
  ],
  student: [
    { path: "/dashboard", label: "工作台" },
    { path: "/tasks", label: "我的任务" },
    { path: "/upload", label: "成果上传" },
    { path: "/scores", label: "我的成绩" },
    { path: "/reports", label: "个人报告" }
  ],
  admin: [
    { path: "/dashboard", label: "数据看板" },
    { path: "/users", label: "用户管理" },
    { path: "/models", label: "模型管理" },
    { path: "/reports", label: "报表中心" },
    { path: "/metrics", label: "指标配置" }
  ]
};
