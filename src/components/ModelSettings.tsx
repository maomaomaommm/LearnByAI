"use client";

import { useEffect, useMemo, useState } from "react";
import { Settings2, Sparkles } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MODEL_AGENT_NAMES,
  MODEL_CONFIG_STORAGE_KEY,
  ModelOverrideFields,
  ModelOverrides,
  normalizeModelOverrides,
  parseModelOverrides,
} from "@/lib/modelOverrides";
import { cn } from "@/lib/utils";
import type { AgentName } from "@/lib/types";

type ModelSettingsProps = {
  className?: string;
  showLabel?: boolean;
  size?: "icon" | "icon-sm" | "sm";
};

type ModelSettingsState = {
  default: ModelOverrideFields;
  agents: Record<AgentName, ModelOverrideFields>;
};

const AGENT_LABELS: Record<AgentName, string> = {
  ASSISTANT: "助手智能体",
  ARCHITECT: "架构智能体",
  AUTHOR: "作者智能体",
  POLISHER: "润色智能体",
  REVIEWER: "审阅智能体",
  TUTOR: "导师智能体",
};

const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  ASSISTANT: "通用问答与协调。",
  ARCHITECT: "课程结构与 Course Bible。",
  AUTHOR: "章节正文生成。",
  POLISHER: "章节润色与表达优化。",
  REVIEWER: "质量审阅与问题检查。",
  TUTOR: "阅读器内答疑。",
};

const EMPTY_FIELDS: ModelOverrideFields = {
  apiKey: "",
  baseUrl: "",
  model: "",
};

export function ModelSettings({ className, showLabel = false, size }: ModelSettingsProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [settings, setSettings] = useState<ModelSettingsState>(() => emptySettings());
  const defaultAccordion = useMemo(() => MODEL_AGENT_NAMES.slice(0, 1), []);
  const buttonSize = size ?? (showLabel ? "sm" : "icon-sm");

  useEffect(() => {
    if (!open) return;
    setStatus("");
    setSettings(readStoredSettings());
  }, [open]);

  function updateDefault(field: keyof ModelOverrideFields, value: string) {
    setSettings((current) => ({
      ...current,
      default: {
        ...current.default,
        [field]: value,
      },
    }));
  }

  function updateAgent(agent: AgentName, field: keyof ModelOverrideFields, value: string) {
    setSettings((current) => ({
      ...current,
      agents: {
        ...current.agents,
        [agent]: {
          ...current.agents[agent],
          [field]: value,
        },
      },
    }));
  }

  function saveSettings() {
    const normalized = normalizeModelOverrides(toOverrides(settings));
    if (normalized) {
      localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
      setStatus("已保存模型配置");
    } else {
      localStorage.removeItem(MODEL_CONFIG_STORAGE_KEY);
      setStatus("配置为空，已清除");
    }
  }

  function clearSettings() {
    localStorage.removeItem(MODEL_CONFIG_STORAGE_KEY);
    setSettings(emptySettings());
    setStatus("已清除模型配置");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={buttonSize}
            className={cn(
              "text-muted-foreground hover:text-foreground rounded-full transition-all duration-300",
              showLabel && "bg-secondary/40 hover:bg-secondary px-3.5 font-mono text-xs",
              className,
            )}
            aria-label="模型配置"
            onClick={() => setOpen(true)}
          >
            <Settings2 className={cn("h-4 w-4", showLabel && "mr-2")} />
            {showLabel && <span>模型配置</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="text-xs">模型配置</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>模型配置</DialogTitle>
          <DialogDescription>配置全局默认模型，也可以为每个智能体单独指定接口。</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto pr-2 pb-2 scrollbar-thin">
          <section className="mb-6 relative overflow-hidden rounded-xl border border-primary/20 bg-primary/5 p-5">
            <div className="absolute left-0 top-0 h-full w-1 bg-primary/40"></div>
            <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              全局默认配置
            </h3>
            <Fields
              idPrefix="model-default"
              values={settings.default}
              onChange={updateDefault}
            />
          </section>

          <div className="mb-3 px-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              智能体专属覆写 (可选)
            </h4>
          </div>

          <Accordion type="single" collapsible className="space-y-2.5">
            {MODEL_AGENT_NAMES.map((agent) => (
              <AccordionItem
                key={agent}
                value={agent}
                className="overflow-hidden rounded-xl border bg-card px-4 shadow-sm transition-all data-[state=open]:border-primary/30"
              >
                <AccordionTrigger className="py-3.5 hover:no-underline">
                  <span className="flex min-w-0 items-center gap-3 text-left">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary font-mono text-[11px] font-bold text-secondary-foreground">
                      {agent.substring(0, 2)}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-mono text-sm font-medium tracking-tight">{agent}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">{AGENT_LABELS[agent]}</span>
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-5 pt-1">
                  <div className="mb-5 rounded-md bg-muted/50 px-3 py-2.5">
                    <p className="text-xs leading-relaxed text-muted-foreground">{AGENT_DESCRIPTIONS[agent]}</p>
                  </div>
                  <Fields
                    idPrefix={`model-${agent.toLowerCase()}`}
                    values={settings.agents[agent]}
                    onChange={(field, value) => updateAgent(agent, field, value)}
                  />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <div className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
            {status}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={clearSettings}>
              清空
            </Button>
            <Button type="button" onClick={saveSettings}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fields({
  idPrefix,
  values,
  onChange,
}: {
  idPrefix: string;
  values: ModelOverrideFields;
  onChange: (field: keyof ModelOverrideFields, value: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field
        id={`${idPrefix}-api-key`}
        label="API 密钥"
        type="password"
        autoComplete="off"
        value={values.apiKey ?? ""}
        onChange={(value) => onChange("apiKey", value)}
      />
      <Field
        id={`${idPrefix}-base-url`}
        label="接口地址"
        type="url"
        value={values.baseUrl ?? ""}
        onChange={(value) => onChange("baseUrl", value)}
      />
      <Field
        id={`${idPrefix}-model`}
        label="模型名称"
        type="text"
        value={values.model ?? ""}
        onChange={(value) => onChange("model", value)}
      />
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label === "API 密钥" ? "未配置则使用默认" : ""}
        className="h-8 bg-secondary/30 border-border/60 text-xs font-mono placeholder:text-muted-foreground/40 focus-visible:bg-background transition-colors"
      />
    </div>
  );
}

function readStoredSettings(): ModelSettingsState {
  const stored = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
  const parsed = parseModelOverrides(stored);
  if (!parsed) return emptySettings();

  return {
    default: { ...EMPTY_FIELDS, ...parsed.default },
    agents: MODEL_AGENT_NAMES.reduce((agents, agent) => {
      agents[agent] = { ...EMPTY_FIELDS, ...parsed.agents?.[agent] };
      return agents;
    }, {} as Record<AgentName, ModelOverrideFields>),
  };
}

function emptySettings(): ModelSettingsState {
  return {
    default: { ...EMPTY_FIELDS },
    agents: MODEL_AGENT_NAMES.reduce((agents, agent) => {
      agents[agent] = { ...EMPTY_FIELDS };
      return agents;
    }, {} as Record<AgentName, ModelOverrideFields>),
  };
}

function toOverrides(settings: ModelSettingsState): ModelOverrides {
  return {
    version: 1,
    default: cleanFields(settings.default),
    agents: MODEL_AGENT_NAMES.reduce((agents, agent) => {
      agents[agent] = cleanFields(settings.agents[agent]);
      return agents;
    }, {} as Record<AgentName, ModelOverrideFields>),
  };
}

function cleanFields(fields: ModelOverrideFields): ModelOverrideFields {
  const cleaned: ModelOverrideFields = {};
  const apiKey = fields.apiKey?.trim();
  const baseUrl = fields.baseUrl?.trim();
  const model = fields.model?.trim();

  if (apiKey) cleaned.apiKey = apiKey;
  if (baseUrl) cleaned.baseUrl = baseUrl;
  if (model) cleaned.model = model;

  return cleaned;
}
