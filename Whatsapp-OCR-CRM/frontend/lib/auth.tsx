"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";

interface User {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  isActive: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = async () => {
    try {
      const r = await api.get("/auth/me", { timeout: 5000 });
      setUser(r.data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  // Proactively refresh access token every 10 minutes while logged in
  useEffect(() => {
    if (!user) return;

    const refreshSession = async () => {
      try {
        const r = await api.post("/auth/refresh");
        if (r.data?.accessToken) {
          localStorage.setItem("accessToken", r.data.accessToken);
        }
      } catch {
        // Interceptor handles hard logout on authentic 401
      }
    };

    const intervalId = window.setInterval(refreshSession, 10 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [user]);

  const login = async (email: string, password: string) => {
    const r = await api.post("/auth/login", { email, password });
    if (r.data?.accessToken) {
      localStorage.setItem("accessToken", r.data.accessToken);
    }
    setUser(r.data.user);
    return r.data.user;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    localStorage.removeItem("accessToken");
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, refresh: fetchMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthCtx);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
