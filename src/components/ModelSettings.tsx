"use client";

import { useEffect, useState } from "react";
import { Activity, Loader2, Settings2, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  MODEL_AGENT_NAMES,
  MODEL_CONFIG_STORAGE_KEY,
  ModelOverrideFields,
  ModelOverrides,
  normalizeModelOverrides,
  parseModelOverrides,
} from "@/lib/modelOverrides";
import type { AgentName } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  ASSISTANT: "通用助手",
  ARCHITECT: "课程规划师",
  AUTHOR: "教材作者",
  POLISHER: "格式润色员",
  REVIEWER: "质量评审员",
  TUTOR: "阅读导师",
  REVISER: "局部改写员",
};

const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  ASSISTANT: "负责通用协调、问答和兜底回复。",
  ARCHITECT: "负责课程结构、课程全局设定和章节规划。",
  AUTHOR: "负责撰写章节教材正文。",
  POLISHER: "负责章节排版、表达润色和格式修复。",
  REVIEWER: "负责质量评审、问题检查和改进建议。",
  TUTOR: "负责阅读页中的批注问答和辅导。",
  REVISER: "负责阅读页中按要求对选定正文做局部改写与修复。",
};

const AGENT_BADGES: Record<AgentName, string> = {
  ASSISTANT: "助",
  ARCHITECT: "规",
  AUTHOR: "写",
  POLISHER: "润",
  REVIEWER: "审",
  TUTOR: "导",
  REVISER: "改",
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
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const buttonSize = size ?? (showLabel ? "sm" : "icon-sm");

  useEffect(() => {
    if (!open) return;
    setStatus("");
    setPendingSave(false);
    setIsLoading(true);
    const local = readStoredSettings();
    setSettings(local);

    let cancelled = false;
    async function loadServerConfig() {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/user/model-config", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const { modelConfig } = (await res.json()) as { modelConfig: unknown };
        const parsed = normalizeModelOverrides(modelConfig);
        if (parsed) {
          const next = overridesToState(parsed);
          if (!cancelled) {
            setSettings(next);
            localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(parsed));
          }
        }
      } catch {
        // silent — localStorage is the offline fallback
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadServerConfig();
    return () => {
      cancelled = true;
    };
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

  async function saveSettings(): Promise<boolean> {
    setStatus("保存中…");
    const normalized = normalizeModelOverrides(toOverrides(settings));
    if (normalized) {
      localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    } else {
      localStorage.removeItem(MODEL_CONFIG_STORAGE_KEY);
    }
    // The config now lives in localStorage, which is what actually drives
    // requests — so it has taken effect even before cloud sync finishes.
    setPendingSave(false);

    try {
      const token = await getAccessToken();
      if (!token) {
        setStatus("");
        toast.success(normalized ? "已保存并生效" : "已清除本地设置", {
          description: normalized ? "登录后可同步到云端、跨设备使用。" : undefined,
        });
        return true;
      }
      const res = await fetch("/api/user/model-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(normalized ?? {}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus("");
        toast.error("云端同步失败", { description: data.error ?? "本地已保存，请稍后重试。" });
        return false;
      }
      setStatus("");
      toast.success(normalized ? "模型设置已保存" : "云端设置已清除", {
        description: normalized ? "已同步到云端，立即生效。" : undefined,
      });
      return true;
    } catch {
      setStatus("");
      toast.error("云端同步失败", { description: "本地已保存，但网络异常。" });
      return false;
    }
  }

  async function clearSettings() {
    localStorage.removeItem(MODEL_CONFIG_STORAGE_KEY);
    setSettings(emptySettings());
    setPendingSave(false);
    setStatus("清除中…");

    try {
      const token = await getAccessToken();
      if (!token) {
        setStatus("已清除本地设置。");
        return;
      }
      const res = await fetch("/api/user/model-config", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus(data.error ?? "清除云端设置失败。");
        return;
      }
      setStatus("本地与云端设置已清除。");
    } catch {
      setStatus("已清除本地设置，云端清除失败。");
    }
  }

  function handleOpenChange(next: boolean) {
    // Closing with a tested-but-unsaved config: intercept and confirm.
    if (!next && pendingSave) {
      setConfirmClose(true);
      return;
    }
    setOpen(next);
  }

  async function handleSaveAndClose() {
    await saveSettings();
    setConfirmClose(false);
    setOpen(false);
  }

  function handleDiscardAndClose() {
    setConfirmClose(false);
    setOpen(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={buttonSize}
            className={cn(
              "rounded-full text-muted-foreground transition-all duration-300 hover:text-foreground",
              showLabel && "bg-secondary/40 px-3.5 font-mono text-xs hover:bg-secondary",
              className,
            )}
            aria-label="模型设置"
            onClick={() => setOpen(true)}
          >
            <Settings2 className={cn("h-4 w-4", showLabel && "mr-2")} />
            {showLabel && <span>模型设置</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="text-xs">
          模型设置
        </TooltipContent>
      </Tooltip>

      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>模型设置</DialogTitle>
          <DialogDescription>
            配置默认模型接口，或为不同 Agent 单独设置模型。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto pb-2 pr-2 scrollbar-thin">
          <section className="relative mb-6 overflow-hidden rounded-xl border border-primary/20 bg-primary/5 p-5">
            <div className="absolute left-0 top-0 h-full w-1 bg-primary/40" />
            <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              默认配置
            </h3>
            <Fields
              idPrefix="model-default"
              values={settings.default}
              onChange={updateDefault}
              getTestPayload={() => ({ agent: "default", overrides: toOverrides(settings) })}
              onTestSuccess={() => setPendingSave(true)}
            />
          </section>

          <div className="mb-3 px-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              智能体单独配置
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
                      {AGENT_BADGES[agent]}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium tracking-tight">{AGENT_LABELS[agent]}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {agent}
                      </span>
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-5 pt-1">
                  <div className="mb-5 rounded-md bg-muted/50 px-3 py-2.5">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {AGENT_DESCRIPTIONS[agent]}
                    </p>
                  </div>
                  <Fields
                    idPrefix={`model-${agent.toLowerCase()}`}
                    values={settings.agents[agent]}
                    onChange={(field, value) => updateAgent(agent, field, value)}
                    getTestPayload={() => ({ agent, overrides: toOverrides(settings) })}
                    onTestSuccess={() => setPendingSave(true)}
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
              清除
            </Button>
            <Button type="button" onClick={saveSettings}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>是否保存本次测试配置？</AlertDialogTitle>
            <AlertDialogDescription>
              你测试通过的配置还没有保存，直接退出不会生效。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button variant="ghost" onClick={handleDiscardAndClose}>
              不保存退出
            </Button>
            <Button onClick={handleSaveAndClose}>保存并退出</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Fields({
  idPrefix,
  values,
  onChange,
  getTestPayload,
  onTestSuccess,
}: {
  idPrefix: string;
  values: ModelOverrideFields;
  onChange: (field: keyof ModelOverrideFields, value: string) => void;
  getTestPayload: () => unknown;
  onTestSuccess?: () => void;
}) {
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleTest() {
    setIsTesting(true);
    setTestResult(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/test-model", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(getTestPayload()),
      });
      const data = await readJsonResponse(res);
      if (data.ok) {
        setTestResult({ ok: true, msg: `连接成功（${data.elapsed}ms）` });
        onTestSuccess?.();
      } else {
        setTestResult({ ok: false, msg: data.error || "请求失败" });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "未知错误";
      setTestResult({ ok: false, msg: `网络错误：${message}` });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id={`${idPrefix}-api-key`}
          label="接口密钥"
          type="password"
          autoComplete="off"
          value={values.apiKey ?? ""}
          onChange={(value) => {
            onChange("apiKey", value);
            setTestResult(null);
          }}
        />
        <Field
          id={`${idPrefix}-base-url`}
          label="接口地址"
          type="url"
          value={values.baseUrl ?? ""}
          onChange={(value) => {
            onChange("baseUrl", value);
            setTestResult(null);
          }}
        />
        <Field
          id={`${idPrefix}-model`}
          label="模型"
          type="text"
          value={values.model ?? ""}
          onChange={(value) => {
            onChange("model", value);
            setTestResult(null);
          }}
        />
      </div>
      <div className="flex items-center gap-3 border-t border-border/30 pt-2.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 px-3 text-[11px] font-medium shadow-none transition-colors hover:bg-primary/10 hover:text-primary"
          onClick={handleTest}
          disabled={isTesting}
        >
          {isTesting ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <Activity className="mr-1.5 h-3 w-3" />
          )}
          测试
        </Button>
        {testResult && (
          <span
            className={cn(
              "line-clamp-1 flex-1 text-[11px] font-medium",
              testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
            )}
            title={testResult.msg}
          >
            {testResult.ok ? "成功：" : "错误："}
            {testResult.msg}
          </span>
        )}
      </div>
    </div>
  );
}

async function readJsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: `服务器返回了非 JSON 响应（HTTP ${res.status}），请检查应用服务或网关是否正常。`,
    };
  }
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
        placeholder={type === "password" ? "使用服务器默认配置" : ""}
        className="h-8 border-border/60 bg-secondary/30 font-mono text-xs transition-colors placeholder:text-muted-foreground/40 focus-visible:bg-background"
      />
    </div>
  );
}

async function getAccessToken(): Promise<string | undefined> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return undefined;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token;
}

function overridesToState(overrides: ModelOverrides): ModelSettingsState {
  return {
    default: { ...EMPTY_FIELDS, ...overrides.default },
    agents: MODEL_AGENT_NAMES.reduce((agents, agent) => {
      agents[agent] = { ...EMPTY_FIELDS, ...overrides.agents?.[agent] };
      return agents;
    }, {} as Record<AgentName, ModelOverrideFields>),
  };
}

function readStoredSettings(): ModelSettingsState {
  const stored = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
  const parsed = parseModelOverrides(stored);
  if (!parsed) return emptySettings();
  return overridesToState(parsed);
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
