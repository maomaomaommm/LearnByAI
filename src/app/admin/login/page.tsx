"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = event.currentTarget;
    const username = (form.elements.namedItem("username") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "登录失败。");
      router.push("/admin");
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "登录失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">LearnByAI Admin</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">中文后台登录</h1>
          <p className="mt-2 text-sm text-muted-foreground">请输入管理员账号密码。</p>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-muted-foreground">用户名</span>
          <input
            name="username"
            autoComplete="username"
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          />
        </label>
        <label className="mb-5 block">
          <span className="mb-1 block text-sm text-muted-foreground">密码</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          />
        </label>

        {error && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {loading ? "登录中..." : "登录"}
        </button>
      </form>
    </main>
  );
}
