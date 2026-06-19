"use client";

import type { StageKey } from "./helpers";
import { STAGES } from "./helpers";

type StageStripProps = {
  activeStage: StageKey;
};

export function StageStrip({ activeStage }: StageStripProps) {
  const activeIndex = STAGES.findIndex((stage) => stage.key === activeStage);

  return (
    <div className="grid gap-2 border-b border-border p-4 sm:grid-cols-5">
      {STAGES.map((stage, index) => {
        const active = stage.key === activeStage;
        const done = activeIndex > index;
        return (
          <div
            key={stage.key}
            className={`min-h-12 rounded-md border p-2 transition-colors ${
              active
                ? "border-foreground bg-muted text-foreground"
                : done
                  ? "border-border bg-background text-green-600 dark:text-green-400"
                  : "border-border bg-background text-muted-foreground"
            }`}
          >
            <span className="block font-mono text-[11px] font-semibold tracking-widest">{stage.agent}</span>
            <span className="mt-1 block text-[11px]">{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
}
