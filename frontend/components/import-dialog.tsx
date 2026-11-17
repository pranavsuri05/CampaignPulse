"use client";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/common";
import { ApiError, uploadCsv } from "@/lib/api";
import { downloadText, toCsv } from "@/lib/csv";
import type { ImportResult } from "@/lib/types";

export type ImportKind = "contacts" | "recipients";
const CFG = {
  contacts: { path: "/api/import/contacts", title: "Import contacts", hint: "Required columns: contact_id, email. Optional: first_name, last_name, audience, status, suppression_reason.", fields: ["contact_id", "email", "first_name", "last_name", "audience", "status", "suppression_reason"], required: ["contact_id", "email"] },
  recipients: { path: "/api/import/campaign-recipients", title: "Import campaign recipients", hint: "Required columns: campaign_name, contact_id, delivery_status. Import contacts first.", fields: ["campaign_name", "contact_id", "delivery_status", "bounce_type", "bounce_reason", "sent_at", "opened_at", "clicked_at", "subject"], required: ["campaign_name", "contact_id", "delivery_status"] },
} as const;

export function ImportDialog({ kind, open, onOpenChange, onDone }: { kind: ImportKind; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const cfg = CFG[kind];
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setFile(null); setMapping({}); setResult(null); setCommitted(false); setError(null); };

  async function run(f: File, commit: boolean, m?: Record<string, string | null>) {
    setBusy(true); setError(null);
    try {
      const r = await uploadCsv(cfg.path, f, commit, m);
      setResult(r); setMapping(r.mapping);
      if (commit) { setCommitted(true); onDone?.(); }
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.message : "Upload failed.");
    } finally { setBusy(false); }
  }

  function pick(f: File | null) {
    reset();
    if (!f) return;
    setFile(f);
    void run(f, false);
  }

  function downloadReport() {
    if (!result) return;
    downloadText(`${kind}-import-issues.csv`, toCsv(["row", "severity", "code", "field", "message"], result.issues.map((i) => [i.row, i.severity, i.code, i.field ?? "", i.message])));
  }

  const blocked = !result || result.missing_required.length > 0 || result.valid_rows === 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent title={cfg.title} description={cfg.hint} className="max-w-2xl">
        <div className="space-y-4 overflow-y-auto p-5">
          <div className="flex items-center gap-3">
            <input ref={input} type="file" accept=".csv,text/csv" aria-label="CSV file" data-testid="csv-input" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <Button variant="outline" onClick={() => input.current?.click()}><FileUp />Choose CSV file</Button>
            <span className="truncate text-sm text-muted-foreground">{file ? file.name : "No file selected"}</span>
            {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          {error && <Notice tone="danger" title="Import problem">{error}</Notice>}

          {result && (
            <>
              {result.missing_required.length > 0 && (
                <Notice tone="warning" title="Map the required columns">
                  <p>We could not detect: {result.missing_required.join(", ")}. Choose the matching column from your file.</p>
                </Notice>
              )}
              <div className="grid gap-2 sm:grid-cols-2" aria-label="Column mapping">
                {cfg.fields.map((f) => (
                  <div key={f} className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-[13px]">
                    <span className="font-mono text-xs">{f}{(cfg.required as readonly string[]).includes(f) && <span className="text-danger"> *</span>}</span>
                    <Select aria-label={`Map ${f}`} className="h-8 w-40" value={mapping[f] ?? "__none"} placeholder="Not mapped"
                      onValueChange={(v) => setMapping((m) => ({ ...m, [f]: v === "__none" ? null : v }))}
                      options={[{ value: "__none", label: "Not mapped" }, ...result.headers.map((h) => ({ value: h, label: h }))]} />
                  </div>
                ))}
              </div>
              {result.missing_required.length > 0 && file && !committed && (
                <Button size="sm" variant="outline" onClick={() => run(file, false, mapping)}>Re-check with this mapping</Button>
              )}

              <div className="grid grid-cols-4 gap-2 text-center" data-testid="import-summary">
                {[["Rows", result.total_rows], ["Valid", result.valid_rows], ["Rejected", result.rejected_rows], ["Warnings", result.warning_rows]].map(([l, v]) => (
                  <div key={l} className="rounded-md border p-2"><p className="tabular text-lg font-semibold">{v}</p><p className="text-xs text-muted-foreground">{l}</p></div>
                ))}
              </div>

              {result.preview.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  <Table><THead><TR><TH>Row</TH><TH>Email</TH><TH>Result</TH></TR></THead>
                    <TBody>{result.preview.map((p) => (
                      <TR key={p.row}><TD className="py-2">{p.row}</TD><TD className="py-2">{p.email}</TD>
                        <TD className="py-2"><Badge tone={p.status === "ok" ? "success" : p.status === "warning" ? "warning" : "danger"}>{p.status}</Badge> <span className="text-xs text-muted-foreground">{p.message}</span></TD></TR>
                    ))}</TBody></Table>
                </div>
              )}

              {result.issues.length > 0 && (
                <div className="flex items-center justify-between rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px]">
                  <span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" />{result.issues.length} issue(s) found. Rejected rows are not imported.</span>
                  <Button size="sm" variant="outline" onClick={downloadReport}><Download />Error report</Button>
                </div>
              )}

              {committed && (
                <Notice tone="success"><span className="flex items-center gap-2"><CheckCircle2 className="size-4" />Imported {result.imported_rows} rows. {result.rejected_rows} rejected.</span></Notice>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{committed ? "Close" : "Cancel"}</Button>
          {!committed && <Button disabled={blocked || busy} onClick={() => file && run(file, true, mapping)}>Import {result?.valid_rows ?? 0} rows</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
