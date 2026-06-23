import { get, post, put, upload, getToken } from "../api/client";

export async function getDashboardData(role) {
  return get(`/dashboard?role=${role}`);
}

export async function getTasks() {
  return get("/tasks");
}

export async function getTask(taskId) {
  return get(`/tasks/${taskId}`);
}

export async function getTaskDetail(taskId) {
  return get(`/tasks/${taskId}/detail`);
}

export async function createTask(payload) {
  return post("/tasks", payload);
}

export async function getSubmissions(taskId) {
  const query = taskId ? `?task_id=${taskId}` : "";
  return get(`/submissions${query}`);
}

export async function getSubmission(submissionId) {
  return get(`/submissions/${submissionId}`);
}

export async function uploadSubmission(taskId, files, remark = "") {
  const formData = new FormData();
  formData.append("task_id", taskId);
  formData.append("remark", remark);
  files.forEach((file) => formData.append("files", file));
  return upload("/submissions/upload", formData);
}

export async function parseSubmission(submissionId) {
  return post(`/submissions/${submissionId}/parse`, {});
}

export async function retryEvaluation(submissionId) {
  return post(`/submissions/${submissionId}/evaluate`, {});
}

export async function runCheck(submissionId) {
  return post(`/check/${submissionId}/run`, {});
}

export async function getCheck(submissionId) {
  return get(`/check/${submissionId}`);
}

export async function markCheckItem(submissionId, itemId, teacherMark) {
  return post(`/check/${submissionId}/mark`, { itemId, teacherMark });
}

export async function runAutoScore(submissionId) {
  return post(`/score/${submissionId}/auto`, {});
}

export async function getTeacherScores(activeId) {
  const pending = await get("/scores/pending");
  if (!activeId) {
    return pending;
  }
  const detail = await get(`/scores/${activeId}`);
  return { ...pending, activeId, scoreDetail: detail };
}

export async function getScores(role) {
  if (role === "student") {
    return get("/scores/mine");
  }
  return get("/scores/pending");
}

export async function saveTeacherScore(payload) {
  return post(`/score/${payload.id}/teacher`, payload);
}

export async function getMetrics() {
  return get("/metrics");
}

export async function updateMetrics(metrics) {
  return put("/metrics", { metrics });
}

export async function getReferenceDocs(taskId) {
  return get(`/tasks/${taskId}/reference-doc`);
}

export async function uploadReferenceDoc(taskId, files) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return upload(`/tasks/${taskId}/reference-doc/upload`, formData);
}

export async function deleteReferenceDoc(taskId, refId) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || "/api"}/tasks/${taskId}/reference-doc/${refId}`, {
    method: "DELETE",
    headers: { "X-Auth-Token": getToken() || "" },
  });
  if (!response.ok) throw new Error("删除失败");
  return response.json();
}

export async function createReferenceText(taskId, content, filename = "文本参考") {
  return post(`/tasks/${taskId}/reference-doc/text`, { content, filename });
}

export async function getReportSummary(taskId) {
  const query = taskId ? `?task_id=${taskId}` : "";
  return get(`/reports/summary${query}`);
}

export async function exportReport(format, reportType = "class", taskId) {
  const params = new URLSearchParams({ format, report_type: reportType });
  if (taskId) {
    params.set("task_id", taskId);
  }
  return get(`/reports/export?${params}`);
}

export async function getModelHealth() {
  return get("/model/health");
}

export async function getModelConfig() {
  return get("/model/config");
}

export async function testModel() {
  return post("/model/test", {});
}

export async function getUserAdminData() {
  return get("/admin/users");
}

// ---------- Courses ----------
export async function getCourses() {
  return get("/courses");
}

export async function createCourse(payload) {
  return post("/courses", payload);
}

export async function updateCourse(courseId, payload) {
  return put(`/courses/${courseId}`, payload);
}

export async function deleteCourse(courseId) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || "/api"}/courses/${courseId}`, {
    method: "DELETE",
    headers: { "X-Auth-Token": getToken() || "" },
  });
  if (!response.ok) throw new Error("删除课程失败");
  return response.json();
}

export async function getCourseClasses(courseId) {
  return get(`/courses/${courseId}/classes`);
}

export async function addClassToCourse(courseId, name) {
  return post(`/courses/${courseId}/classes`, { name });
}

export async function removeClassFromCourse(courseId, classId) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || "/api"}/courses/${courseId}/classes/${classId}`, {
    method: "DELETE",
    headers: { "X-Auth-Token": getToken() || "" },
  });
  if (!response.ok) throw new Error("移除班级失败");
  return response.json();
}

export async function getClassStudents(className, courseId) {
  const params = new URLSearchParams();
  if (courseId) params.set("course_id", courseId);
  return get(`/classes/${encodeURIComponent(className)}/students?${params}`);
}

// ========== Dashboard 数据可视化 ==========

export async function getDashboardOverview() {
  return get("/dashboard/overview");
}

export async function getClassTrends() {
  return get("/dashboard/class-trends");
}

export async function getScoreDistribution() {
  return get("/dashboard/score-distribution");
}

export async function getTopErrors(limit = 10) {
  return get(`/dashboard/top-errors?limit=${limit}`);
}
