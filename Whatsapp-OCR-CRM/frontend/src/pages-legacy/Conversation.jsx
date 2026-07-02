import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Upload, Loader2, Check, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const STEPS = [
  { key: "queued", label: "Uploading" },
  { key: "ocr", label: "OCR" },
  { key: "ai_structuring", label: "AI Structuring" },
  { key: "matching", label: "Matching inventory" },
  { key: "done", label: "Done" },
];

export default function Conversation() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [ocrJob, setOcrJob] = useState(null);
  const [ocrRows, setOcrRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);

  const load = async () => {
    try {
      const r = await api.get(`/inbox/${conversationId}`);
      setData(r.data);
    } catch (e) {
      toast.error("Failed to load conversation");
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages?.length]);

  const onUpload = async (file) => {
    if (!file) return;
    setBusy(true);
    setOcrRows(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("conversationId", conversationId);
      const r = await api.post("/ocr/process", form, { headers: { "Content-Type": "multipart/form-data" } });
      const jobId = r.data.jobId;
      setOcrJob({ id: jobId, step: "queued", status: "processing" });
      // poll
      let tries = 0;
      const poll = async () => {
        tries += 1;
        const j = await api.get(`/ocr/${jobId}`);
        setOcrJob(j.data);
        if (j.data.status === "done") {
          setOcrRows(j.data.rows || []);
          setBusy(false);
          return;
        }
        if (j.data.status === "failed") {
          toast.error("OCR failed");
          setBusy(false);
          return;
        }
        if (tries < 40) setTimeout(poll, 1500);
        else setBusy(false);
      };
      setTimeout(poll, 800);
    } catch (e) {
      toast.error("Upload failed");
      setBusy(false);
    }
  };

  const createEnquiry = async () => {
    if (!ocrRows || ocrRows.length === 0) return;
    try {
      const r = await api.post("/enquiries", {
        conversationId,
        items: ocrRows.map((r) => ({
          rawText: r.raw,
          productName: r.matchedName || r.product,
          qty: r.qty,
          unit: r.unit,
          rate: r.rate,
          confidence: r.confidence,
          inventoryId: r.inventoryId || null,
          matchType: r.matchType,
          matchScore: r.matchScore,
        })),
      });
      toast.success("Enquiry created");
      navigate(`/enquiries/${r.data.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create enquiry");
    }
  };

  if (!data) return <div className="p-8 text-ink-muted">Loading…</div>;

  return (
    <div className="flex h-screen">
      {/* Thread */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-line">
        <header className="px-6 py-4 border-b border-line bg-surface flex items-center justify-between">
          <div>
            <div className="font-display text-lg font-semibold">{data.customer?.name || "Customer"}</div>
            <div className="text-xs text-ink-muted">{data.customer?.phone}</div>
          </div>
          <div className="text-xs text-ink-muted">{data.messages?.length || 0} messages</div>
        </header>
        <div className="flex-1 overflow-y-auto scroll-thin px-6 py-6 space-y-3 bg-canvas" data-testid="message-thread">
          {data.messages?.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Right sidebar */}
      <aside className="w-[380px] shrink-0 bg-surface flex flex-col">
        <div className="px-6 py-5 border-b border-line">
          <h3 className="font-display text-base font-semibold">Enquiry Actions</h3>
          <p className="text-xs text-ink-muted mt-1">Upload a handwritten slip to extract products.</p>
        </div>

        <div className="px-6 py-5 border-b border-line">
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onUpload(e.dataTransfer.files?.[0]);
            }}
            data-testid="ocr-dropzone"
            className="border-2 border-dashed border-line rounded-md p-6 text-center cursor-pointer hover:bg-canvas transition-colors"
          >
            <ImagePlus className="h-6 w-6 mx-auto text-ink-muted" />
            <div className="text-sm mt-2 font-medium">Drop slip image or click to upload</div>
            <div className="text-[11px] text-ink-muted mt-1">PNG / JPG up to 10 MB</div>
            <input
              type="file"
              accept="image/*"
              ref={fileRef}
              onChange={(e) => onUpload(e.target.files?.[0])}
              className="hidden"
              data-testid="ocr-file-input"
            />
          </div>
        </div>

        {ocrJob && (
          <div className="px-6 py-5 border-b border-line space-y-3" data-testid="ocr-progress">
            {STEPS.map((s, i) => {
              const stepIdx = STEPS.findIndex((x) => x.key === ocrJob.step);
              const done = i < stepIdx || ocrJob.status === "done" && i < STEPS.length;
              const active = i === stepIdx && ocrJob.status !== "done";
              return (
                <div key={s.key} className="flex items-center gap-3 text-sm">
                  <div
                    className={`h-5 w-5 rounded-full flex items-center justify-center border ${
                      done ? "bg-brand border-brand text-white" : active ? "border-brand text-brand" : "border-line text-ink-muted"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
                  </div>
                  <span className={active ? "text-ink font-medium" : done ? "text-ink" : "text-ink-muted"}>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {ocrRows && (
          <div className="flex-1 overflow-y-auto scroll-thin px-6 py-5 space-y-3" data-testid="ocr-rows">
            <div className="text-xs uppercase tracking-wider text-ink-muted">Extracted rows</div>
            <div className="space-y-2">
              {ocrRows.map((r, i) => (
                <div key={i} className="border border-line rounded-md p-3 bg-canvas">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-ink truncate">{r.matchedName || r.product}</div>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${r.matchType === "new" ? "bg-skyTint text-brand" : "bg-brand-50 text-brand"}`}>
                      {r.matchType || "—"}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted mt-1 tabular">
                    {r.qty} {r.unit || ""} {r.rate ? `· ₹${r.rate}` : ""} · conf {Math.round((r.confidence || 0) * 100)}%
                  </div>
                  {r.raw && r.raw !== r.product && (
                    <div className="text-[11px] text-ink-muted mt-1 italic truncate">“{r.raw}”</div>
                  )}
                </div>
              ))}
            </div>
            <Button onClick={createEnquiry} className="w-full bg-brand hover:bg-brand-hover mt-2" data-testid="create-enquiry-button">
              Create enquiry
            </Button>
          </div>
        )}

        {!ocrRows && !ocrJob && !busy && (
          <div className="px-6 py-5 text-xs text-ink-muted">
            Once you upload a slip, extracted products will appear here for review.
          </div>
        )}
      </aside>
    </div>
  );
}

function MessageBubble({ m }) {
  const isOut = m.direction === "OUTBOUND";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
      <div className={`max-w-[70%] rounded-lg px-4 py-2.5 ${isOut ? "bg-brand-50 text-ink" : "bg-secondary text-ink"}`}>
        {m.mediaUrl && m.type === "image" && (
          <a href={m.mediaUrl} target="_blank" rel="noreferrer">
            <img src={m.mediaUrl} alt="" className="max-h-[260px] rounded mb-1 object-cover" />
          </a>
        )}
        {m.content && <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>}
        <div className="text-[10px] text-ink-muted mt-1 flex gap-2">
          <span>{timeAgo(m.createdAt)}</span>
          {isOut && m.deliveryStatus && <span className="uppercase tracking-wider">{m.deliveryStatus}</span>}
        </div>
      </div>
    </div>
  );
}
