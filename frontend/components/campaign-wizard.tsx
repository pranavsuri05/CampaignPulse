"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Notice, PageHeader } from "@/components/common";
import { EmailFrame } from "@/components/email-frame";
import { Stepper } from "@/components/stepper";
import { ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { CAMPAIGN_TYPES, STARTER_TEMPLATES, STEPS, VARIABLES, campaignSchema, type CampaignForm } from "@/lib/schemas";
import { cn, num } from "@/lib/utils";
import type { Audience, Campaign, Sender } from "@/lib/types";

const EMPTY: CampaignForm = { name: "", campaign_type: "invitation", event_name: "", sender_id: "", sender_name: "", sender_email: "", subject: "", preview_text: "", audience_name: "", body_html: "" };

function toForm(c: Campaign): CampaignForm {
  return { name: c.name, campaign_type: c.campaign_type as CampaignForm["campaign_type"], event_name: c.event_name ?? "", sender_id: c.sender_id ? String(c.sender_id) : "", sender_name: c.sender_name ?? "", sender_email: c.sender_email ?? "", subject: c.subject ?? "", preview_text: c.preview_text ?? "", audience_name: c.audience_name ?? "", body_html: c.body_html ?? "" };
}

export function CampaignWizard({ campaignId }: { campaignId?: number }) {
  const router = useRouter();
  const existing = useApi(() => (campaignId ? api<Campaign>(`/api/campaigns/${campaignId}`) : Promise.resolve(null)), [campaignId]);
  if (campaignId && existing.loading && !existing.data) return <Loading />;
  if (existing.error) return <ErrorState message={existing.error.message} onRetry={existing.reload} />;
  if (existing.data?.status === "sent")
    return <Notice tone="warning" title="This campaign has been sent">Sent campaigns are read-only. <Link className="font-medium text-primary" href={`/analytics?campaign=${existing.data.id}`}>View analytics</Link></Notice>;
  return <WizardInner key={existing.data?.id ?? "new"} initial={existing.data} router={router} />;
}

function WizardInner({ initial, router }: { initial: Campaign | null; router: ReturnType<typeof useRouter> }) {
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(initial ? 4 : 0);
  const [id, setId] = useState<number | null>(initial?.id ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const senders = useApi(() => api<Sender[]>("/api/settings/senders"), []);
  const audiences = useApi(() => api<{ items: Audience[] }>("/api/audiences"), []);
  const form = useForm<CampaignForm>({ resolver: zodResolver(campaignSchema), defaultValues: initial ? toForm(initial) : EMPTY, mode: "onTouched" });
  const { register, control, trigger, getValues, setValue, watch, formState: { errors } } = form;

  async function save(): Promise<number | null> {
    const v = getValues();
    const payload = { name: v.name, campaign_type: v.campaign_type, event_name: v.event_name || null, sender_name: v.sender_name || null, sender_email: v.sender_email || null, subject: v.subject || null, preview_text: v.preview_text || null, audience_name: v.audience_name || null, body_html: v.body_html || null };
    setSaving(true); setSaveError(null);
    try {
      if (id) { await api(`/api/campaigns/${id}`, { method: "PATCH", json: payload }); return id; }
      const c = await api<Campaign>("/api/campaigns", { method: "POST", json: payload });
      setId(c.id);
      return c.id;
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not save the campaign.");
      return null;
    } finally { setSaving(false); }
  }

  async function next() {
    const fields = STEPS[step].fields as unknown as (keyof CampaignForm)[];
    if (!(await trigger(fields))) return;
    const cid = await save();
    if (!cid) return;
    if (step === 4) { router.push(`/review/${cid}`); return; }
    setStep(step + 1);
    setMaxReached((m) => Math.max(m, step + 1));
  }

  const body = watch("body_html");
  const audience = watch("audience_name");
  const [rendered, setRendered] = useState("");
  const [renderErr, setRenderErr] = useState(false);
  const eventName = watch("event_name"); const cName = watch("name");
  useEffect(() => {
    if (step !== 4) return;
    const t = setTimeout(() => {
      api<{ html: string }>("/api/render", { method: "POST", json: { html: body || "", audience_name: audience || null, event_name: eventName || null, campaign_name: cName || null } })
        .then((r) => { setRendered(r.html); setRenderErr(false); }).catch(() => setRenderErr(true));
    }, 350);
    return () => clearTimeout(t);
  }, [body, audience, eventName, cName, step]);

  const senderOptions = useMemo(() => [{ value: "__custom", label: "Custom sender…" }, ...(senders.data ?? []).map((s) => ({ value: String(s.id), label: `${s.name} <${s.email}>` }))], [senders.data]);

  return (
    <div>
      <PageHeader title={initial ? `Edit “${initial.name}”` : "New campaign"} description="Seven steps: configure, verify, approve, then run in Simulation Mode." />
      {initial?.status === "approved" && <div className="mb-4"><Notice tone="warning">This campaign is approved. Saving any change will reset its approval.</Notice></div>}
      <Stepper current={step} onSelect={setStep} maxReached={maxReached} />
      <Card>
        <CardBody className="space-y-5 md:p-6">
          <h2 className="text-base">Step {step + 1}: {STEPS[step].label}</h2>

          {step === 0 && (
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label htmlFor="name">Campaign name</Label><Input id="name" aria-invalid={!!errors.name} {...register("name")} placeholder="e.g. Spring Summit invitation" /><FieldError message={errors.name?.message} /></div>
              <div><Label htmlFor="type">Campaign type</Label>
                <Controller control={control} name="campaign_type" render={({ field }) => <Select id="type" value={field.value} onValueChange={field.onChange} options={CAMPAIGN_TYPES.map((t) => ({ ...t }))} />} /></div>
              <div><Label htmlFor="event">Event name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="event" {...register("event_name")} placeholder="Used for {{event_name}}" /></div>
            </div>
          )}

          {step === 1 && (
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              {(senders.data?.length ?? 0) > 0 && (
                <div className="sm:col-span-2"><Label htmlFor="saved">Saved sender</Label>
                  <Controller control={control} name="sender_id" render={({ field }) => (
                    <Select id="saved" value={field.value || "__custom"} options={senderOptions} onValueChange={(v) => {
                      field.onChange(v === "__custom" ? "" : v);
                      const s = senders.data?.find((x) => String(x.id) === v);
                      if (s) { setValue("sender_name", s.name, { shouldValidate: true }); setValue("sender_email", s.email, { shouldValidate: true }); }
                    }} />)} /></div>
              )}
              <div><Label htmlFor="sname">Sender name</Label><Input id="sname" aria-invalid={!!errors.sender_name} {...register("sender_name")} /><FieldError message={errors.sender_name?.message} /></div>
              <div><Label htmlFor="semail">Sender email</Label><Input id="semail" type="email" aria-invalid={!!errors.sender_email} {...register("sender_email")} /><FieldError message={errors.sender_email?.message} /></div>
              <p className="text-[13px] text-muted-foreground sm:col-span-2">Manage saved senders in <Link className="text-primary" href="/settings">Settings</Link>.</p>
            </div>
          )}

          {step === 2 && (
            <div className="max-w-2xl space-y-4">
              <div><Label htmlFor="subject">Subject line</Label><Input id="subject" aria-invalid={!!errors.subject} {...register("subject")} /><FieldError message={errors.subject?.message} /></div>
              <div><Label htmlFor="preview">Preview text</Label><Input id="preview" {...register("preview_text")} />
                <p className="mt-1 text-xs text-muted-foreground">Shown next to the subject in many inboxes. Leaving it empty creates a warning at review.</p><FieldError message={errors.preview_text?.message} /></div>
            </div>
          )}

          {step === 3 && (
            <div>
              {audiences.loading && !audiences.data ? <Loading /> : (audiences.data?.items.length ?? 0) === 0 ? (
                <EmptyState icon={<Upload />} title="No audiences yet" description="Import a contacts CSV to create audiences. Contacts with the same audience value are grouped together."
                  action={<Button variant="outline" asChild><Link href="/settings">Go to import</Link></Button>} />
              ) : (
                <fieldset className="grid gap-3 md:grid-cols-2" aria-label="Audience">
                  {audiences.data!.items.map((a) => (
                    <label key={a.name} className={cn("flex cursor-pointer gap-3 rounded-md border p-4 transition-colors hover:bg-muted/40", audience === a.name && "border-primary bg-primary-soft/50 ring-1 ring-primary")}>
                      <input type="radio" value={a.name} className="mt-1 accent-[hsl(var(--primary))]" {...register("audience_name")} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{a.name}</p>
                        <p className="tabular text-[13px] text-muted-foreground">{num(a.total)} contacts · <span className="font-medium text-success">{num(a.eligible)} eligible</span></p>
                        <p className="mt-1 text-xs text-muted-foreground">{a.invalid} invalid · {a.duplicate} duplicate · {a.unsubscribed} unsubscribed · {a.suppressed} suppressed</p>
                      </div>
                      {audience === a.name && <Check className="size-4 text-primary" />}
                    </label>
                  ))}
                </fieldset>
              )}
              <FieldError message={errors.audience_name?.message} />
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between"><Label htmlFor="body" className="mb-0">Email HTML</Label>
                  <div className="flex gap-1">{Object.entries(STARTER_TEMPLATES).map(([k, v]) => <Button key={k} type="button" size="sm" variant="outline" onClick={() => setValue("body_html", v, { shouldValidate: true })}>Use {k.toLowerCase()} template</Button>)}</div></div>
                <Textarea id="body" rows={16} className="font-mono text-xs" aria-invalid={!!errors.body_html} {...register("body_html")} />
                <FieldError message={errors.body_html?.message} />
                <p className="mt-2 text-xs text-muted-foreground">Variables: {VARIABLES.map((v) => <code key={v} className="mr-1 rounded bg-muted px-1">{`{{${v}}}`}</code>)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Scripts and unsafe markup are removed automatically.</p>
              </div>
              <div><p className="mb-2 text-[13px] font-medium">Live preview (sample recipient)</p>
                {renderErr ? <Notice tone="danger">Preview unavailable.</Notice> : <EmailFrame html={rendered || "<p style='color:#98a2b3'>Start typing to see a preview.</p>"} />}</div>
            </div>
          )}

          {saveError && <Notice tone="danger">{saveError}</Notice>}
          <div className="flex justify-between border-t pt-4">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft />Back</Button>
            <Button onClick={next} disabled={saving}>{step === 4 ? "Save & go to review" : "Save & continue"}<ArrowRight /></Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
