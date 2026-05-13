"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, UserRound } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirectTo, setRedirectTo] = useState("/");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next?.startsWith("/")) setRedirectTo(next);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "登录失败");
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err?.message || "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#050806] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(63,202,88,0.28),transparent_32%),radial-gradient(circle_at_70%_70%,rgba(34,197,94,0.18),transparent_34%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-5 py-10">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-[420px] rounded-[28px] border border-white/10 bg-white/[0.07] p-7 shadow-2xl shadow-black/40 backdrop-blur-2xl"
        >
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center">
              <BrandLogo className="h-14" showText={false} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">EasyAI 内测登录</h1>
              <p className="mt-1 text-sm text-white/55">仅限团队内部账号访问</p>
            </div>
          </div>

          <label className="mb-2 block text-sm font-medium text-white/80">账号</label>
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 focus-within:border-[#3FCA58]/70">
            <UserRound size={18} className="text-white/45" />
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入账号"
              required
              className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
            />
          </div>

          <label className="mb-2 block text-sm font-medium text-white/80">密码</label>
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 focus-within:border-[#3FCA58]/70">
            <LockKeyhole size={18} className="text-white/45" />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              required
              className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
            />
          </div>

          {error ? (
            <div className="mb-5 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-2xl bg-[#3FCA58] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#35b54d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "登录中..." : "进入 EasyAI"}
          </button>

          <p className="mt-5 text-center text-xs leading-5 text-white/40">
            登录状态会在当前浏览器保留 30 天。未登录用户无法访问页面和核心 API。
          </p>
        </form>
      </div>
    </main>
  );
}
