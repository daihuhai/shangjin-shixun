import { get, post, setToken } from "../api/client";

export async function login(payload) {
  setToken(null);
  const result = await post("/auth/login", payload);
  if (result?.token) {
    setToken(result.token);
  }
  return result;
}

export async function register(payload) {
  return post("/auth/register", payload);
}

export async function logout() {
  try {
    await post("/auth/logout", {});
  } finally {
    setToken(null);
  }
}

export async function getCurrentUser() {
  return post("/auth/me", {});
}
