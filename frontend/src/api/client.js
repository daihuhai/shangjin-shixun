import { handleMockRequest } from "../mock/server";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const TOKEN_KEY = "training-eval-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function buildHeaders(isJson = true) {
  const headers = {};
  if (isJson) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) {
    headers["X-Auth-Token"] = token;
  }
  return headers;
}

async function parseResponse(response) {
  // 兜底：网络失败/后端未启动时拿到空响应或非 JSON，直接抛出可读错误
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!text) {
    throw new Error(
      !response.ok
        ? `后端服务无响应（HTTP ${response.status}），请检查后端是否启动`
        : "后端返回空响应"
    );
  }
  let data;
  try {
    data = contentType.includes("application/json") ? JSON.parse(text) : { message: text };
  } catch (e) {
    throw new Error(`后端返回非 JSON 数据：${text.slice(0, 120)}`);
  }
  // 兼容两种格式：{code,data,message} 与 FastAPI 抛出的 {detail:{code,...}}
  let payload = data;
  if (data && data.detail && typeof data.detail === "object" && "code" in data.detail) {
    payload = data.detail;
  } else if (data && data.data !== undefined && data.code !== undefined) {
    payload = data;
  }
  if (!response.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.message || data?.message || `请求失败 (HTTP ${response.status})`);
  }
  return payload.data;
}

async function request(method, path, body) {
  if (USE_MOCK) {
    return handleMockRequest({ method, path, body });
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: buildHeaders(true),
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });

  return parseResponse(response);
}

export function get(path) {
  return request("GET", path);
}

export function post(path, body) {
  return request("POST", path, body);
}

export function put(path, body) {
  return request("PUT", path, body);
}

export async function upload(path, formData) {
  if (USE_MOCK) {
    throw new Error("Mock 模式不支持文件上传，请设置 VITE_USE_MOCK=false");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: buildHeaders(false),
    credentials: "include",
    body: formData
  });

  return parseResponse(response);
}

export function downloadUrl(path) {
  const token = getToken();
  const base = API_BASE_URL.startsWith("http") ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`;
  const normalizedPath = path.startsWith("/api/") ? path.slice(4) : path;
  const url = `${base}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
  if (!token) {
    return url;
  }
  const separator = normalizedPath.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * 把后端返回的时间字符串（ISO8601，可能带时区）格式化为本地时间显示。
 * 兼容：UTC（13:00+00:00）→ 本地时区（如北京时间 21:00）。
 */
export function formatTime(value) {
  if (!value) return "--";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return value;
  }
}

export async function downloadFile(path, filename) {
  const response = await fetch(downloadUrl(path), {
    credentials: "include",
    headers: buildHeaders(false),
  });
  if (!response.ok) {
    throw new Error("下载失败");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
