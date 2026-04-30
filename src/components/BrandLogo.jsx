"use client";

export default function BrandLogo({
  className = "h-4",
  showText = true,
  gapClassName = "gap-[0.58em]",
  wordmarkClassName = "h-[40%]",
  wordmarkOffsetClassName = "translate-y-[2px]",
}) {
  return (
    <span className={`inline-flex items-center ${gapClassName} ${className}`} aria-label="EasyAI">
      <img
        src="/images/easyai-smile.svg"
        alt=""
        className="h-full w-auto shrink-0"
        aria-hidden="true"
      />
      {showText && (
        <img
          src="/images/easyai-wordmark.svg"
          alt=""
          className={`${wordmarkClassName} ${wordmarkOffsetClassName} w-auto shrink-0`}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
