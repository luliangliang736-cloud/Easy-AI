"use client";
import { useState, useEffect, useRef } from "react";

const MESSAGES = [
  { text: "小亿随时为你工作", emoji: "💼" },
  { text: "快来陪俺玩耍吧", emoji: "🎮" },
  { text: "我一直在等你", emoji: "👀" },
  { text: "帮您分忧是小亿的无上使命", emoji: "🫡" },
  { text: "有什么想创作的，尽管说！", emoji: "✨" },
  { text: "今天也要元气满满哦", emoji: "🌟" },
  { text: "让我来帮你搞定一切", emoji: "🚀" },
];

export default function FloatingRobot() {
  const [visible, setVisible] = useState(false);
  const [msgIndex, setMsgIndex] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    function triggerShow() {
      setMsgIndex(Math.floor(Math.random() * MESSAGES.length));
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
        const nextDelay = 8000 + Math.random() * 7000;
        timerRef.current = setTimeout(() => triggerShow(), nextDelay);
      }, 4000);
    }

    const firstShow = setTimeout(() => triggerShow(), 3000);
    return () => {
      clearTimeout(firstShow);
      clearTimeout(timerRef.current);
    };
  }, []);

  const msg = MESSAGES[msgIndex];

  return (
    <div
      className="fixed bottom-10 left-10 z-50 select-none cursor-pointer"
      style={{ pointerEvents: visible ? "auto" : "none" }}
      onClick={() => { window.location.href = "/chat"; }}
    >
      <div
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0) scale(1)" : "translateY(10px) scale(0.9)",
          transition: "opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <div className="bg-white text-gray-800 text-sm font-medium px-4 py-2.5 rounded-2xl shadow-xl whitespace-nowrap">
          {msg.text} {msg.emoji}
        </div>
      </div>
    </div>
  );
}
