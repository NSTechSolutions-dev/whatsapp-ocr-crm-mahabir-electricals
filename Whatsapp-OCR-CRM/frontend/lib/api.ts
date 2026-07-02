import axios from "axios";

export const API_BASE = "/api";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 10000,
});

// Attach bearer token if present (cookie-based auth is primary; this is a fallback)
if (typeof window !== "undefined") {
  api.interceptors.request.use((config) => {
    const token = localStorage.getItem("accessToken");
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
}

// On 401 try refresh once
let refreshing: any = null;
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url.includes("/auth/")) {
      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = api.post("/auth/refresh").finally(() => {
            refreshing = null;
          });
        }
        const r = await refreshing;
        if (r?.data?.accessToken) {
          if (typeof window !== "undefined") {
            localStorage.setItem("accessToken", r.data.accessToken);
          }
        }
        return api(original);
      } catch (e) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("accessToken");
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);
