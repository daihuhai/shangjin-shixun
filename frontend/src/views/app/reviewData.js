function parseScore(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickStatus(status, fallback) {
  return status || fallback || "待处理";
}

function buildAssignmentDimensions(score) {
  const safeScore = score ?? 0;
  return [
    {
      name: "功能完成度",
      score: Math.max(Math.min(safeScore, 35), score == null ? 0 : 24),
      total: 35,
      note: "核心流程、页面联动和提交内容完整性。"
    },
    {
      name: "代码规范",
      score: Math.max(Math.min(Math.round(safeScore * 0.3), 30), score == null ? 0 : 20),
      total: 30,
      note: "结构划分、命名、可维护性和异常处理。"
    },
    {
      name: "文档说明",
      score: Math.max(Math.min(Math.round(safeScore * 0.2), 20), score == null ? 0 : 12),
      total: 20,
      note: "设计说明、截图与部署步骤是否齐全。"
    },
    {
      name: "细节表现",
      score: Math.max(Math.min(Math.round(safeScore * 0.15), 15), score == null ? 0 : 8),
      total: 15,
      note: "交互、边界场景和自测痕迹。"
    }
  ];
}

function buildExamQuestions(score) {
  const safeScore = score ?? 0;
  return [
    {
      name: "简答题 1",
      aiScore: Math.max(Math.min(Math.round(safeScore * 0.18), 18), score == null ? 0 : 10),
      total: 20,
      note: "需要复核学生对认证流程的解释是否覆盖 token 生命周期。"
    },
    {
      name: "综合题 2",
      aiScore: Math.max(Math.min(Math.round(safeScore * 0.32), 32), score == null ? 0 : 18),
      total: 40,
      note: "重点看数据库索引优化理由与性能对比。"
    },
    {
      name: "案例分析题",
      aiScore: Math.max(Math.min(Math.round(safeScore * 0.24), 24), score == null ? 0 : 14),
      total: 30,
      note: "关注异常场景、接口安全和部署策略是否交代清楚。"
    },
    {
      name: "规范表达",
      aiScore: Math.max(Math.min(Math.round(safeScore * 0.08), 8), score == null ? 0 : 5),
      total: 10,
      note: "术语使用、结构条理和答题完整性。"
    }
  ];
}

export function buildAssignmentReviewRecords(courses = []) {
  return courses.flatMap((course) => {
    const assignments = course.assignments || [];
    const gradingStudents = course.grading?.students || [];
    const defaultStudent = course.grading?.current?.student || course.classMembers?.[0]?.name || "待分配";

    return assignments.flatMap((assignment, assignmentIndex) => {
      const students = gradingStudents.length
        ? gradingStudents
        : [{ name: defaultStudent, status: "待批阅", score: "--" }];

      return students.map((student, studentIndex) => {
        const score = parseScore(student.score);
        const status = pickStatus(student.status, "待批阅");
        const submissionTime = `05-${18 + assignmentIndex} ${14 + studentIndex}:1${studentIndex}`;

        return {
          id: `${course.id}-assignment-${assignmentIndex}-${studentIndex}`,
          type: "assignment",
          courseId: course.id,
          courseName: course.name,
          className: course.className,
          title: assignment.title,
          student: student.name,
          status,
          score,
          scoreText: score == null ? "--" : String(score),
          due: assignment.due,
          submissionTime,
          attempts: assignment.attempts || "1 次",
          reviewState: assignment.review || "待批阅",
          summary:
            assignment.title === course.grading?.current?.title
              ? course.grading?.current?.summary
              : "请重点检查实现完整性、说明文档和关键界面截图。",
          teacherComment:
            assignment.title === course.grading?.current?.title
              ? course.grading?.current?.comment
              : "建议补充关键流程说明，并附上自测记录。",
          dimensions: buildAssignmentDimensions(score),
          attachments: [
            "需求说明.docx",
            "系统截图.zip",
            studentIndex % 2 === 0 ? "演示视频.mp4" : "部署说明.pdf"
          ],
          checklist: [
            "是否按时提交",
            "关键功能是否可运行",
            "文档与截图是否齐全"
          ]
        };
      });
    });
  });
}

export function buildExamReviewRecords(courses = []) {
  return courses.flatMap((course) =>
    (course.exams || []).flatMap((exam, examIndex) => {
      const examinees = (course.proctoring || []).length
        ? course.proctoring
        : [{ name: course.classMembers?.[0]?.name || "待分配", state: "待阅卷", warning: "无预警" }];

      return examinees.map((student, studentIndex) => {
        const baseScore =
          student.state === "已交卷" ? 88 : student.state === "考试中" ? 74 : student.state === "已进入" ? 81 : 76;
        const objectiveScore = Math.round(baseScore * 0.65);
        const subjectiveScore = Math.round(baseScore * 0.35);
        const finalScore = student.state === "考试中" ? null : baseScore;

        return {
          id: `${course.id}-exam-${examIndex}-${studentIndex}`,
          type: "exam",
          courseId: course.id,
          courseName: course.name,
          className: course.className,
          title: exam.title,
          student: student.name,
          status: student.state === "考试中" ? "待复核" : student.state === "已交卷" ? "待批阅" : "复核中",
          objectiveScore,
          subjectiveScore,
          finalScore,
          duration: exam.duration,
          antiCheat: exam.antiCheat,
          warning: student.warning,
          submittedAt: student.state === "考试中" ? "未交卷" : `05-${20 + examIndex} ${16 + studentIndex}:20`,
          summary: "客观题已自动判分，主观题需要教师复核采分点和表达完整性。",
          teacherComment: "优先复核案例分析题，对偏离标准答案但思路合理的情况保留酌情分。",
          questions: buildExamQuestions(finalScore ?? objectiveScore + subjectiveScore),
          timeline: [
            "进入考试",
            student.warning,
            student.state === "已交卷" ? "已提交答卷" : "等待答卷完成"
          ]
        };
      });
    })
  );
}
