export function statusTone(status) {
  if (["进行中", "已发布", "已完成", "正常", "已签到", "启用", "显示", "稳定", "领先", "教师置顶", "活跃", "已提交", "已解析", "已核查", "已评分", "已定稿", "published"].includes(status)) return "ok";
  if (["待处理", "待关注", "未读", "未开始", "可选", "审核中", "考试说明", "置顶", "处理中", "预警", "关注", "待评分", "尚进大模型评价中", "evaluating"].includes(status)) return "warn";
  if (["风险", "锁定", "打回重做", "隐藏", "高"].includes(status)) return "danger";
  return "info";
}

export function statusLabel(status) {
  const map = {
    submitted: "已提交",
    parsed: "已解析",
    evaluating: "尚进大模型评价中",
    evaluation_failed: "评价失败",
    checked: "已核查",
    scored: "已评分",
    finalized: "已定稿",
    published: "已发布"
  };
  return map[status] || status;
}
