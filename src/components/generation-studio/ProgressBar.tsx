"use client";

type ProgressBarProps = {
  progress: number;
  text: string;
};

export function ProgressBar({ progress, text }: ProgressBarProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">生成进度</div>
        <div className="line-clamp-1 text-xs text-muted-foreground">{text}</div>
      </div>
      <div className="h-1.5 bg-muted">
        <div className="h-full bg-foreground transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
    </div>
  );
}
