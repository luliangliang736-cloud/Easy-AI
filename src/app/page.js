"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Sparkles, ArrowRight, Wand2, Image as ImageIcon,
  Layers, Zap, Crown, Rocket, PenTool,
  Palette, RefreshCw, Download, MousePointer2, Sun, Moon,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import BrandLogo from "@/components/BrandLogo";

const FEATURES = [
  { icon: Wand2, title: "AI 智能生图", desc: "输入文字描述，AI 为你生成高质量图片", iconColor: "text-violet-400" },
  { icon: Layers, title: "多图参考编辑", desc: "上传参考图进行风格迁移、材质替换等操作", iconColor: "text-blue-400" },
  { icon: PenTool, title: "交互式画布", desc: "自由拖拽、缩放、排列你的创作素材", iconColor: "text-emerald-400" },
  { icon: Palette, title: "多种模型选择", desc: "从极速到专业级，按需选择生成质量与速度", iconColor: "text-amber-400" },
  { icon: RefreshCw, title: "撤销 / 重做", desc: "完整的编辑历史，随时回退任意步骤", iconColor: "text-rose-400" },
  { icon: Download, title: "导出分享", desc: "一键导出画布或单张图片，支持复制到剪贴板", iconColor: "text-sky-400" },
];

const MODELS = [
  { icon: Zap, name: "Nano Banana", desc: "极速低价 · 适合快速出图", color: "text-green-400" },
  { icon: Rocket, name: "Nano Banana 2", desc: "推荐 · 高性价比 · 最高4K", color: "text-blue-400" },
  { icon: Crown, name: "Nano Banana Pro", desc: "专业画质 · Thinking · 最高4K", color: "text-amber-400" },
];

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const { theme, toggleTheme } = useTheme("dark");
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-screen bg-bg-primary overflow-x-hidden overflow-y-auto">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 lg:px-12 py-4 bg-bg-primary/70 backdrop-blur-xl border-b border-border-primary/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center">
            <BrandLogo className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-text-primary tracking-tight">Easy AI</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-xl bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all flex items-center justify-center"
            title={theme === "dark" ? "切换到浅色" : "切换到深色"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link
            href="/canvas"
            className="h-9 px-5 rounded-xl bg-bg-secondary text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all flex items-center gap-2"
          >
            进入工作台
            <ArrowRight size={14} />
          </Link>
        </div>
      </nav>

      {/* Hero with video */}
      <section className="relative w-full h-screen min-h-[600px] overflow-hidden">
        <video
          autoPlay muted loop playsInline
          className="absolute inset-0 w-full h-full object-cover"
          src="/videos/hero.mp4"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg-primary via-bg-primary/55 to-bg-primary/20" />

        <div className={`absolute inset-0 flex flex-col items-center justify-end pb-24 lg:pb-32 px-6 text-center transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-bg-secondary/70 backdrop-blur-md text-text-secondary text-xs font-medium mb-6 border border-border-primary/60">
            <Sparkles size={12} />
            AI 驱动的创意设计工具
          </div>
          <h1 className="text-4xl lg:text-6xl font-bold text-text-primary leading-tight tracking-tight mb-5">
            用 <span style={{ color: "#3FCA58" }}>AI</span> 释放
            <br />你的创意想象力
          </h1>
          <p className="text-base lg:text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed mb-10">
            输入文字描述，AI 即刻生成高质量图片。支持多图参考、风格迁移、材质替换，在交互式画布上自由编排你的创作。
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/canvas"
              className="h-12 px-8 rounded-2xl bg-white text-black font-medium flex items-center gap-2.5 transition-all hover:bg-white/90 hover:scale-[1.02] active:scale-[0.98]"
            >
              <MousePointer2 size={18} />
              开始创作
            </Link>
            <a
              href="#features"
              className="h-12 px-8 rounded-2xl bg-bg-secondary/80 text-text-secondary hover:text-text-primary hover:bg-bg-hover font-medium flex items-center gap-2 transition-all"
            >
              了解更多
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pt-24 pb-20 transition-all duration-700 delay-300 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">强大功能</h2>
          <p className="text-sm text-text-secondary">从生成到编辑，一站式 AI 创作体验</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className="rounded-2xl bg-bg-secondary p-6 hover:bg-bg-hover transition-all duration-300 ease-out hover:scale-[1.04] hover:shadow-lg hover:shadow-black/20 origin-center will-change-transform"
              >
                <div className={`w-10 h-10 rounded-xl bg-bg-tertiary flex items-center justify-center mb-4 ${f.iconColor}`}>
                  <Icon size={20} />
                </div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">{f.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Models */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pb-24 transition-all duration-700 delay-400 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">模型选择</h2>
          <p className="text-sm text-text-secondary">三档算力，灵活匹配你的创作需求</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {MODELS.map((m, i) => {
            const Icon = m.icon;
            return (
              <div
                key={i}
                className="rounded-2xl bg-bg-secondary p-8 text-center hover:bg-bg-hover transition-all duration-300 ease-out hover:scale-[1.04] hover:shadow-lg hover:shadow-black/20 origin-center will-change-transform"
              >
                <div className={`w-14 h-14 rounded-2xl bg-bg-tertiary flex items-center justify-center mx-auto mb-5 ${m.color}`}>
                  <Icon size={26} />
                </div>
                <h3 className="text-base font-semibold text-text-primary mb-2">{m.name}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{m.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pb-20 transition-all duration-700 delay-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="rounded-3xl bg-bg-secondary p-12 lg:p-16 text-center">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-4">准备好开始了吗？</h2>
          <p className="text-sm text-text-secondary mb-8 max-w-lg mx-auto">
            无需注册，打开画布即刻开始 AI 创作
          </p>
          <Link
            href="/canvas"
            className="inline-flex items-center gap-2.5 h-12 px-8 rounded-2xl bg-white text-black font-medium transition-all hover:bg-white/90 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles size={18} />
            立即开始
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border-primary px-6 lg:px-12 py-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-accent flex items-center justify-center">
              <BrandLogo className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-xs text-text-tertiary">Easy AI</span>
          </div>
          <span className="text-xs text-text-tertiary">Powered by Nano Banana API</span>
        </div>
      </footer>
    </div>
  );
}
