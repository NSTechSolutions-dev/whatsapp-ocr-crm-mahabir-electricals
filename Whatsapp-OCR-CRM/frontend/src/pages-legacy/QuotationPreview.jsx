import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Send, CheckCircle2, Download } from "lucide-react";
import { toast } from "sonner";
import { formatINR, timeAgo } from "@/lib/format";

export default function QuotationPreview() {
  const { quotationId } = useParams();
  const [q, setQ] = useState(null);
  const [sending, setSending] = useState(false);

  const load = async () => {
    const r = await api.get(`/quotations/${quotationId}`);
    setQ(r.data);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [quotationId]);

  const send = async () => {
    setSending(true);
    try {
      await api.post(`/quotations/${quotationId}/send`);
      toast.success("Sent on WhatsApp");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setSending(false);
    }
  };

  if (!q) return <div className="p-8 text-ink-muted">Loading…</div>;

  return (
    <div className="p-8 lg:p-12 max-w-6xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Quotation</div>
          <h1 className="font-display text-3xl font-semibold mt-1">{q.number}</h1>
          <p className="text-ink-muted text-sm mt-1">
            {q.customer?.name} · {q.customer?.phone}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-ink-muted">Grand Total</div>
          <div className="font-display text-3xl font-semibold text-brand tabular mt-1">{formatINR(q.grandTotal)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-surface border border-line rounded-lg shadow-card overflow-hidden">
          {q.presignedUrl ? (
            <iframe
              src={q.presignedUrl}
              className="w-full h-[750px] border-0 block"
              title={`Quotation ${q.number}`}
              data-testid="quotation-image"
            />
          ) : (
            <div className="p-8 text-center text-ink-muted">
              <div className="text-sm">Quotation not available</div>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="bg-surface border border-line rounded-lg shadow-card p-5">
            <h3 className="font-display font-semibold text-base mb-3">Delivery</h3>
            {q.sentAt ? (
              <div className="flex items-start gap-2 text-sm" data-testid="delivery-status">
                <CheckCircle2 className="h-4 w-4 text-brand mt-0.5" />
                <div>
                  <div className="font-medium">{q.deliveryStatus || "sent"}</div>
                  <div className="text-xs text-ink-muted">Sent {timeAgo(q.sentAt)}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink-muted">Not sent yet.</div>
            )}
            <Button
              onClick={send}
              disabled={sending}
              className="w-full bg-brand hover:bg-brand-hover mt-4"
              data-testid="send-quotation-button"
            >
              <Send className="h-4 w-4 mr-2" />
              {sending ? "Sending…" : q.sentAt ? "Resend on WhatsApp" : "Send via WhatsApp"}
            </Button>

            {q.presignedUrl && (
              <a
                href={q.presignedUrl}
                download={`Quotation-${q.number}.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-2"
              >
                <Button
                  variant="outline"
                  className="w-full border-line hover:bg-surface-hover text-ink"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </Button>
              </a>
            )}
            <p className="text-[11px] text-ink-muted mt-2">
              MSG91 is MOCKED in this preview — message is logged to the conversation.
            </p>
          </div>
          <div className="bg-surface border border-line rounded-lg shadow-card p-5">
            <h3 className="font-display font-semibold text-base mb-3">Summary</h3>
            <div className="text-sm space-y-1.5">
              <Row label="Subtotal" value={formatINR(q.subtotal)} />
              <Row label={`GST (${q.gstPercent}%)`} value={formatINR(q.gstAmount)} />
              <div className="border-t border-line my-2" />
              <Row label="Grand total" value={formatINR(q.grandTotal)} bold />
              <Row label="Items" value={q.items?.length || 0} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className={`tabular ${bold ? "font-semibold text-ink" : ""}`}>{value}</span>
    </div>
  );
}
