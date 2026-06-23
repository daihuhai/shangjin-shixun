import { buildAssignmentReviewRecords, buildExamReviewRecords } from "./reviewData";

function toSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildAssignmentReviewId(courseId, assignmentIndex, title) {
  return `${courseId}-assignment-${assignmentIndex}-${toSlug(title)}`;
}

export function buildExamReviewId(courseId, examIndex, title) {
  return `${courseId}-exam-${examIndex}-${toSlug(title)}`;
}

function parseCount(text) {
  const matched = String(text || "").match(/\d+/);
  return matched ? Number(matched[0]) : 0;
}

function makeQuestionId(prefix, index) {
  return `${prefix}-q${index + 1}`;
}

function buildExamPaper(title, reviewId) {
  const baseSections = [
    {
      title: "一. 单选题",
      total: 20,
      questions: [
        {
          stem: "职教城报警电话是",
          score: 5,
          options: ["22396110", "22369110", "23369110", "110"],
          answer: "A"
        },
        {
          stem: "HTTP 状态码 404 表示",
          score: 5,
          options: ["请求成功", "资源不存在", "服务器错误", "权限不足"],
          answer: "B"
        }
      ]
    },
    {
      title: "二. 简答题",
      total: 30,
      questions: [
        {
          stem: `结合《${title}》说明接口鉴权的基本流程。`,
          score: 15,
          options: [],
          answer: "要求说明 Token 生成、校验、续期和失效处理。"
        },
        {
          stem: "简述数据库索引优化的三个常见原则。",
          score: 15,
          options: [],
          answer: "围绕查询条件、回表成本和写入代价进行说明。"
        }
      ]
    }
  ];

  return baseSections.map((section, sectionIndex) => ({
    ...section,
    id: `${reviewId}-section-${sectionIndex + 1}`,
    questions: section.questions.map((question, questionIndex) => ({
      ...question,
      id: makeQuestionId(`${reviewId}-${sectionIndex + 1}`, questionIndex),
      number: questionIndex + 1
    }))
  }));
}

function buildAssignmentPanels(title, reviewId) {
  return [
    {
      id: `${reviewId}-panel-1`,
      title: "需求说明",
      note: `围绕《${title}》补充功能边界、关键流程和页面说明。`
    },
    {
      id: `${reviewId}-panel-2`,
      title: "运行截图",
      note: "提交登录、核心功能、异常处理和结果展示等关键页面截图。"
    },
    {
      id: `${reviewId}-panel-3`,
      title: "部署说明",
      note: "说明依赖环境、启动方式、测试账号和注意事项。"
    }
  ];
}

export function buildAssignmentReviewSummaries(courses = []) {
  const records = buildAssignmentReviewRecords(courses);

  return courses.flatMap((course) =>
    (course.assignments || []).map((assignment, assignmentIndex) => {
      const reviewId = buildAssignmentReviewId(course.id, assignmentIndex, assignment.title);
      const matchedRecords = records.filter(
        (item) => item.courseId === course.id && item.title === assignment.title
      );
      const pendingCount = matchedRecords.filter((item) => item.status === "待批阅").length;
      const reviewedCount = matchedRecords.filter((item) => item.status === "已批阅").length;
      const totalCount = Math.max(matchedRecords.length, course.classMembers?.length || 0, 1);
      const submittedCount = Math.max(reviewedCount + pendingCount, matchedRecords.length);
      const unsubmittedCount = Math.max(parseCount(assignment.review), totalCount - submittedCount, 0);

      return {
        id: reviewId,
        courseId: course.id,
        courseName: course.name,
        className: course.className,
        title: assignment.title,
        due: assignment.due,
        attempts: assignment.attempts || "1 次",
        reviewLabel: assignment.review || "待提交",
        pendingCount,
        reviewedCount,
        submittedCount,
        unsubmittedCount,
        totalCount,
        status: unsubmittedCount > 0 ? "进行中" : "待批阅",
        students: matchedRecords,
        heroNote: course.grading?.current?.summary || "请重点查看实现完整度、文档质量和部署说明。"
      };
    })
  );
}

export function buildAssignmentReviewDetail(courses = [], reviewId) {
  const summaries = buildAssignmentReviewSummaries(courses);
  const summary = summaries.find((item) => item.id === reviewId);
  if (!summary) {
    return null;
  }

  const primaryRecord = summary.students[0];

  return {
    ...summary,
    scoreBreakdown: primaryRecord?.dimensions || [],
    attachments: primaryRecord?.attachments || [],
    checklist: primaryRecord?.checklist || [],
    panels: buildAssignmentPanels(summary.title, reviewId),
    reviewerNote:
      primaryRecord?.teacherComment || "建议优先核对功能演示、异常处理和自测记录，必要时要求补充说明。",
    currentStudent: primaryRecord?.student || "待分配",
    currentSubmissionTime: primaryRecord?.submissionTime || summary.due
  };
}

export function buildExamReviewSummaries(courses = []) {
  const records = buildExamReviewRecords(courses);

  return courses.flatMap((course) =>
    (course.exams || []).map((exam, examIndex) => {
      const reviewId = buildExamReviewId(course.id, examIndex, exam.title);
      const matchedRecords = records.filter(
        (item) => item.courseId === course.id && item.title === exam.title
      );
      const pendingCount = matchedRecords.filter(
        (item) => item.status === "待批阅" || item.status === "待复核"
      ).length;
      const submittedCount = matchedRecords.filter((item) => item.submittedAt !== "未交卷").length;
      const totalCount = Math.max(matchedRecords.length, course.classMembers?.length || 0, 1);
      const unsubmittedCount = Math.max(totalCount - submittedCount, 0);

      return {
        id: reviewId,
        courseId: course.id,
        courseName: course.name,
        className: course.className,
        title: exam.title,
        duration: exam.duration,
        antiCheat: exam.antiCheat,
        pendingCount,
        submittedCount,
        unsubmittedCount,
        totalCount,
        status: pendingCount > 0 ? "已结束" : "待复核",
        examinees: matchedRecords,
        examTime: `${20 + examIndex}:00 - ${21 + examIndex}:30`
      };
    })
  );
}

export function buildExamReviewDetail(courses = [], reviewId) {
  const summaries = buildExamReviewSummaries(courses);
  const summary = summaries.find((item) => item.id === reviewId);
  if (!summary) {
    return null;
  }

  const primaryRecord = summary.examinees[0];
  const sections = buildExamPaper(summary.title, reviewId);
  const totalScore = sections.reduce(
    (sum, section) => sum + section.questions.reduce((sectionSum, question) => sectionSum + question.score, 0),
    0
  );
  const totalCount = sections.reduce((sum, section) => sum + section.questions.length, 0);

  return {
    ...summary,
    sections,
    totalScore,
    totalCount,
    objectiveScore: primaryRecord?.objectiveScore ?? 0,
    subjectiveScore: primaryRecord?.subjectiveScore ?? 0,
    finalScore: primaryRecord?.finalScore,
    reviewerNote:
      primaryRecord?.teacherComment || "请结合客观题结果、主观题采分点和监考预警信息完成最终复核。",
    warning: primaryRecord?.warning || "无异常预警"
  };
}
