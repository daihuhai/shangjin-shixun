import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./ui/AppShell";
import ProtectedRoute from "./ui/ProtectedRoute";
import LoginPage from "./views/auth/LoginPage";
import RegisterPage from "./views/auth/RegisterPage";
import ForgotPasswordPage from "./views/auth/ForgotPasswordPage";
import DashboardPage from "./views/app/DashboardPage";
import CoursesPage from "./views/app/CoursesPage";
import TasksPage from "./views/app/TasksPage";
import TaskDetailPage from "./views/app/TaskDetailPage";
import ReportsPage from "./views/app/ReportsPage";
import UploadPage from "./views/app/UploadPage";
import UsersPage from "./views/app/UsersPage";
import ModelsPage from "./views/app/ModelsPage";
import ScoresPage from "./views/app/ScoresPage";
import MetricsPage from "./views/app/MetricsPage";
import { useAuth } from "./state/AuthContext";

function RoleHomeRedirect() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === "student") {
    return <Navigate to="/dashboard" replace />;
  }

  if (user.role === "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<RoleHomeRedirect />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="courses" element={<CoursesPage />} />
        <Route path="tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="submissions" element={<Navigate to="/tasks" replace />} />
        <Route path="checks" element={<Navigate to="/tasks" replace />} />
        <Route path="scores" element={<ScoresPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="metrics" element={<MetricsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="models" element={<ModelsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
