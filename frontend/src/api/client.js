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
  const data = await response.json();
  const payload = data?.data !== undefined && data?.code !== undefined ? data : data?.detail;
  if (!response.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.message || data?.message || "请求失败");
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
