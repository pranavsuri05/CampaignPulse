"use client";
import { useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { senderSchema, type SenderForm } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ErrorState, Loading } from "@/components/ui/states";
import { Notice, PageHeader } from "@/components/common";
import { ImportDialog, type ImportKind } from "@/components/import-dialog";
import { ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { Sender } from "@/lib/types";

export default function SettingsPage() {
  const senders = useApi(() => api<Sender[]>("/api/settings/senders"), []);
  const [serverError, setServerError] = useState<string | null>(null);
  const [imp, setImp] = useState<ImportKind | null>(null);
  const [del, setDel] = useState<Sender | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SenderForm>({ resolver: zodResolver(senderSchema), defaultValues: { name: "", email: "" } });

  async function onSubmit(v: SenderForm) {
    setServerError(null);
    try {
      await api("/api/settings/senders", { method: "POST", json: { ...v, is_default: (senders.data?.length ?? 0) === 0 } });
      reset();
      senders.reload();
    } catch (e) { setServerError(e instanceof ApiError ? e.message : "Could not save sender"); }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Sender configuration and data import." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Senders" description="Saved sender identities you can pick when creating a campaign." />
          {senders.loading && !senders.data ? <Loading /> : senders.error ? <ErrorState message={senders.error.message} onRetry={senders.reload} /> : (
            <>
              {senders.data!.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">No senders yet. Add the first one below.</p> : (
                <Table><THead><TR><TH>Name</TH><TH>Email</TH><TH /></TR></THead><TBody>
                  {senders.data!.map((s) => (
                    <TR key={s.id}><TD>{s.name} {s.is_default && <Badge tone="primary">Default</Badge>}</TD><TD>{s.email}</TD>
                      <TD className="text-right"><Button variant="ghost" size="icon" aria-label={`Delete ${s.email}`} onClick={() => setDel(s)}><Trash2 /></Button></TD></TR>
                  ))}</TBody></Table>
              )}
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 border-t p-5" noValidate aria-label="Add sender">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label htmlFor="s-name">Sender name</Label><Input id="s-name" aria-invalid={!!errors.name} {...register("name")} /><FieldError message={errors.name?.message} /></div>
                  <div><Label htmlFor="s-email">Sender email</Label><Input id="s-email" type="email" aria-invalid={!!errors.email} {...register("email")} /><FieldError message={errors.email?.message} /></div>
                </div>
                {serverError && <FieldError message={serverError} />}
                <Button type="submit" size="sm" disabled={isSubmitting}>Add sender</Button>
              </form>
            </>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Import data" description="Load contacts, then campaign history, from CSV." />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setImp("contacts")}><Upload />Import contacts</Button>
                <Button variant="outline" onClick={() => setImp("recipients")}><Upload />Import campaign recipients</Button>
              </div>
              <p className="text-[13px] text-muted-foreground">Every import shows a preview first. Rejected rows are listed in a downloadable error report, never skipped silently.</p>
            </CardBody>
          </Card>
          <Notice tone="warning" title="Simulation Mode — No real emails are being sent.">
            Campaigns are executed by a deterministic simulation provider. A real email provider can be added later behind the same interface.
          </Notice>
        </div>
      </div>
      <ImportDialog kind="contacts" open={imp === "contacts"} onOpenChange={(v) => setImp(v ? "contacts" : null)} />
      <ImportDialog kind="recipients" open={imp === "recipients"} onOpenChange={(v) => setImp(v ? "recipients" : null)} />
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent title="Delete sender?" description={del ? `${del.email} will be removed. Existing campaigns keep their copy of the address.` : ""}>
          <div className="flex justify-end gap-2 px-5 py-4">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button variant="danger" onClick={async () => { if (del) { await api(`/api/settings/senders/${del.id}`, { method: "DELETE" }); setDel(null); senders.reload(); } }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
