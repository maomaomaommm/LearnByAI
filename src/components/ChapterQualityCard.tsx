import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import type { EntityStatus } from "@/lib/types";

interface ChapterQualityCardProps {
  title: string;
  description: string;
  estimatedMinutes: number;
  status: EntityStatus;
  overallScore?: number | null;
  structureScore?: number | null;
  formatScore?: number | null;
  continuityScore?: number | null;
  generatingAgent?: string | null;
  needsHumanReview?: number | null;
  onGenerate?: () => void;
}

const statusConfig: Record<
  EntityStatus,
  { label: string; color: string; icon: typeof CheckCircle }
> = {
  pending: { label: "待生成", color: "text-gray-400", icon: Loader2 },
  queued: { label: "队列中", color: "text-amber-400", icon: Loader2 },
  generating: { label: "生成中", color: "text-blue-400", icon: Loader2 },
  ready: { label: "已完成", color: "text-green-400", icon: CheckCircle },
  failed: { label: "失败", color: "text-red-400", icon: XCircle },
};

export function ChapterQualityCard({
  title,
  description,
  estimatedMinutes,
  status,
  overallScore,
  structureScore,
  formatScore,
  continuityScore,
  generatingAgent,
  needsHumanReview,
  onGenerate,
}: ChapterQualityCardProps) {
  const config = statusConfig[status];
  const StatusIcon = config.icon;
  const canGenerate = status === "pending" || status === "failed";

  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-all hover:border-border/80">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {description}
          </p>
        </div>
        <div className="ml-3 flex items-center gap-1.5">
          <StatusIcon
            size={14}
            className={`${config.color} ${status === "generating" || status === "queued" ? "animate-spin" : ""}`}
          />
          <span className={`text-xs font-medium ${config.color}`}>
            {config.label}
          </span>
        </div>
      </div>

      {/* Meta */}
      <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span>预计 {estimatedMinutes} 分钟</span>
        {generatingAgent && (
          <span>
            Agent: <span className="text-primary">{generatingAgent}</span>
          </span>
        )}
        {needsHumanReview === 1 && (
          <span className="text-orange-400">需人工复核</span>
        )}
      </div>

      {/* Scores */}
      {overallScore !== null && overallScore !== undefined && (
        <div className="mb-3 space-y-2">
          {/* Overall */}
          <div className="flex items-center gap-2">
            <span className="w-12 text-[10px] uppercase text-muted-foreground">
              总分
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${
                  overallScore >= 90
                    ? "bg-green-500"
                    : overallScore >= 75
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
                style={{ width: `${overallScore}%` }}
              />
            </div>
            <span className="w-8 text-right text-[10px] font-medium text-foreground">
              {overallScore}
            </span>
          </div>
          {/* Sub scores */}
          <div className="flex gap-3">
            {[
              { label: "结构", score: structureScore },
              { label: "格式", score: formatScore },
              { label: "连贯", score: continuityScore },
            ].map(({ label, score }) =>
              score !== null && score !== undefined ? (
                <div key={label} className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    {label}
                  </span>
                  <span
                    className={`text-[10px] font-medium ${
                      score >= 90
                        ? "text-green-400"
                        : score >= 75
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {Math.round(score)}
                  </span>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}

      {/* Action */}
      {canGenerate && (
        <button
          onClick={onGenerate}
          className="w-full rounded-md bg-primary py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          生成章节
        </button>
      )}
    </div>
  );
}
