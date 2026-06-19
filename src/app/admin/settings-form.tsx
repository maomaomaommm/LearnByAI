"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { MODEL_AGENT_NAMES } from "@/lib/modelOverrides";
import { AdminAppSettings } from "@/lib/adminSettings";
import { USAGE_ACTION_LABEL } from "./parts";

const AGENT_LABEL: Record<string, string> = {
  ASSISTANT: "助手",
  ARCHITECT: "课程规划",
  AUTHOR: "章节写作",
  POLISHER: "格式修复",
  REVIEWER: "质量评审",
  TUTOR: "导师问答",
};

export function AdminSettingsForm({ settings }: { settings: AdminAppSettings }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");
    const formData = new FormData(event.currentTarget);
    const agentOverrides: NonNullable<AdminAppSettings["modelOverrides"]>["agents"] = {};
    for (const agent of MODEL_AGENT_NAMES) {
      const fields = cleanFields({
        apiKey: read(formData, `${agent}.apiKey`),
        baseUrl: read(formData, `${agent}.baseUrl`),
        model: read(formData, `${agent}.model`),
      });
      if (Object.keys(fields).length) agentOverrides[agent] = fields;
    }

    const nextSettings: AdminAppSettings = {
      modelOverrides: {
        version: 1,
        default: cleanFields({
          apiKey: read(formData, "default.apiKey"),
          baseUrl: read(formData, "default.baseUrl"),
          model: read(formData, "default.model"),
        }),
        agents: agentOverrides,
      },
      quotas: {
        create_course: readNumber(formData, "quota.create_course"),
        generate_chapter: readNumber(formData, "quota.generate_chapter"),
        ask_tutor: readNumber(formData, "quota.ask_tutor"),
        export: readNumber(formData, "quota.export"),
      },
      worker: {
        globalLimit: readNumber(formData, "worker.globalLimit"),
        courseChapterConcurrency: readNumber(formData, "worker.courseChapterConcurrency"),
      },
    };

    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_settings", settings: nextSettings }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "保存失败。");
      setMessage("系统设置已保存，新任务会使用最新配置。");
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "保存失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-medium">默认模型配置</h2>
        <p className="mt-1 text-xs text-muted-foreground">API Key 不会回显；留空会保留已配置的后台值，未配置时继续使用环境变量兜底。</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="API Key"><input name="default.apiKey" type="password" placeholder={settings.modelOverrides?.default?.apiKey ? "已配置，留空则保留" : "未配置"} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
          <Field label="Base URL"><input name="default.baseUrl" defaultValue={settings.modelOverrides?.default?.baseUrl ?? ""} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
          <Field label="Model"><input name="default.model" defaultValue={settings.modelOverrides?.default?.model ?? ""} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-medium">Agent 单独配置</h2>
        <div className="mt-4 space-y-4">
          {MODEL_AGENT_NAMES.map((agent) => {
            const fields = settings.modelOverrides?.agents?.[agent];
            return (
              <div key={agent} className="rounded-md border border-border p-4">
                <p className="mb-3 font-medium">{AGENT_LABEL[agent]} <span className="font-mono text-xs text-muted-foreground">{agent}</span></p>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="API Key"><input name={`${agent}.apiKey`} type="password" placeholder={fields?.apiKey ? "已配置，留空则保留" : "未配置"} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
                  <Field label="Base URL"><input name={`${agent}.baseUrl`} defaultValue={fields?.baseUrl ?? ""} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
                  <Field label="Model"><input name={`${agent}.model`} defaultValue={fields?.model ?? ""} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-medium">每日配额</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(["create_course", "generate_chapter", "ask_tutor", "export"] as const).map((action) => (
              <Field key={action} label={USAGE_ACTION_LABEL[action]}>
                <input name={`quota.${action}`} type="number" min={0} defaultValue={settings.quotas?.[action] ?? ""} placeholder="使用代码/环境默认值" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              </Field>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-medium">Worker 并发</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="全局领取数量"><input name="worker.globalLimit" type="number" min={1} defaultValue={settings.worker?.globalLimit ?? ""} placeholder="默认 10" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
            <Field label="同课程章节并发"><input name="worker.courseChapterConcurrency" type="number" min={1} defaultValue={settings.worker?.courseChapterConcurrency ?? ""} placeholder="默认 2" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
          </div>
        </div>
      </section>

      {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {message && <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      <button type="submit" disabled={loading} className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">{loading ? "保存中" : "保存系统设置"}</button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm text-muted-foreground">{label}</span>{children}</label>;
}

function read(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(formData: FormData, key: string) {
  const raw = read(formData, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function cleanFields(fields: { apiKey?: string; baseUrl?: string; model?: string }) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value)) as typeof fields;
}
