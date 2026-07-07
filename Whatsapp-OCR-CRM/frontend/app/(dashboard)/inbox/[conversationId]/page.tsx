"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { timeAgo } from "../../../../lib/format";
import { socket } from "../../../../lib/socket";
import { Loader2, Check, ImagePlus, FileText, ArrowRight, Send, MessageSquare, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const STEPS = [
  { key: "queued", label: "Uploading" },
  { key: "ocr", label: "Gemini OCR" },
  { key: "inventory_score", label: "Scoring inventory" },
  { key: "done", label: "Done" },
];

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  content: string | null;
  mediaUrl: string | null;
  waMessageId: string | null;
  createdAt: string;
}

interface Customer {
  id: string;
  phone: string;
  name: string | null;
  company: string | null;
}

interface EnquirySummary {
  id: string;
  status: "DRAFT" | "REVIEW" | "FINALIZED" | "SENT" | "IGNORED";
  createdAt: string;
  itemsCount: number;
}

interface ProcessingJob {
  jobId: string;
  step: string;
  status: "processing" | "failed";
  createdAt: string;
  error?: string | null;
  retryable?: boolean;
  enquiryId?: string | null;
}

type HistoryItem =
  | { kind: "enquiry"; createdAt: string; enquiry: EnquirySummary }
  | { kind: "job"; createdAt: string; job: ProcessingJob };

interface ConversationData {
  conversation: {
    id: string;
    customerId: string;
    waConversationId: string;
    status: string;
    lastMessageAt: string;
    createdAt: string;
  };
  customer: Customer;
  messages: Message[];
}

function getEnquiryStatusLabel(
  status: string,
  options?: { isProcessingJob?: boolean; jobStep?: string; itemsCount?: number }
): { label: string; color: string } {
  if (options?.isProcessingJob) {
    if (options.jobStep === "queued") return { label: "Processing", color: "bg-blue-400" };
    if (options.jobStep === "ocr") return { label: "Processing", color: "bg-blue-500" };
    if (options.jobStep === "inventory_score") return { label: "Processing", color: "bg-blue-600" };
    return { label: "Processing", color: "bg-blue-500" };
  }

  switch (status) {
    case "IGNORED":
      return { label: "Ignored", color: "bg-gray-400" };
    case "SENT":
    case "FINALIZED":
      return { label: "Sent", color: "bg-emerald-500" };
    case "DRAFT":
    case "REVIEW":
      if ((options?.itemsCount ?? 0) > 0) {
        return { label: "Ready", color: "bg-brand" };
      }
      return { label: "Draft", color: "bg-amber-500" };
    default:
      return { label: status, color: "bg-gray-500" };
  }
}

export default function ConversationPage() {
  const { conversationId } = useParams() as { conversationId: string };
  const router = useRouter();
  const [data, setData] = useState<ConversationData | null>(null);
  const [enquiries, setEnquiries] = useState<EnquirySummary[]>([]);
  const [activeJobs, setActiveJobs] = useState<ProcessingJob[]>([]);
  const [cancellingJobs, setCancellingJobs] = useState(false);
  const [ocrJob, setOcrJob] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const r = await api.get(`/inbox/${conversationId}`);
      const raw = r.data.messages || [];
      const seen = new Set<string>();
      const seenWa = new Set<string>();
      const messages = raw.filter((m: Message) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        if (m.waMessageId) {
          if (seenWa.has(m.waMessageId)) return false;
          seenWa.add(m.waMessageId);
        }
        return true;
      });
      setData({ ...r.data, messages });
    } catch (e) {
      toast.error("Failed to load conversation");
    }
  };

  const loadEnquiries = async () => {
    try {
      const r = await api.get("/enquiries", { params: { conversationId, limit: 20 } });
      setEnquiries(r.data.items || []);
    } catch (e) {
      // Silent fail - enquiries are secondary
    }
  };

  const loadActiveJobs = async () => {
    try {
      const r = await api.get("/ocr/active-jobs/list", { params: { conversationId } });
      setActiveJobs(r.data.items || []);
    } catch (e) {
      // Silent fail
    }
  };

  const cancelActiveJobs = async () => {
    setCancellingJobs(true);
    try {
      const r = await api.post("/ocr/active-jobs/cancel", { conversationId });
      toast.success(`Cancelled ${r.data.cancelled || 0} processing job(s)`);
      setOcrJob(null);
      setBusy(false);
      await loadActiveJobs();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to cancel processing jobs");
    } finally {
      setCancellingJobs(false);
    }
  };

  useEffect(() => {
    load();
    loadEnquiries();
    loadActiveJobs();
    const t = setInterval(() => {
      load();
      loadEnquiries();
      loadActiveJobs();
    }, 5000);
    return () => clearInterval(t);
  }, [conversationId]);

  useEffect(() => {
    // Socket connection
    socket.connect();
    socket.emit("join_conversation", conversationId);

    socket.on("new_message", (msg: Message) => {
      setData((prev) => {
        if (!prev) return prev;
        if (prev.messages.some((m) => m.id === msg.id)) return prev;
        if (msg.waMessageId && prev.messages.some((m) => m.waMessageId === msg.waMessageId)) return prev;
        return {
          ...prev,
          messages: [...prev.messages, msg],
        };
      });
    });

    socket.on("ocr_job_started", ({ jobId, conversationId: cid }: { jobId: string; conversationId: string }) => {
      if (cid === conversationId && jobId) {
        startOcrTracking(jobId);
      }
    });

    return () => {
      socket.emit("leave_conversation", conversationId);
      socket.off("new_message");
      socket.off("ocr_job_started");
      socket.disconnect();
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages?.length]);

  const pollOcrJob = (jobId: string, onComplete?: () => void) => {
    let tries = 0;
    const poll = async () => {
      tries += 1;
      const j = await api.get(`/ocr/${jobId}`);
      setOcrJob({ ...j.data, id: jobId, jobId });

      if (j.data.status === "done" && j.data.enquiryId) {
        toast.success(j.data.ignored ? "Message ignored — opening details" : "Enquiry drafted! Redirecting...");
        router.push(`/enquiries/${j.data.enquiryId}`);
        onComplete?.();
        return;
      }

      if (j.data.status === "failed") {
        toast.error(j.data.error || "Gemini processing failed");
        setBusy(false);
        onComplete?.();
        return;
      }

      if (tries < 90) {
        setTimeout(poll, 2000);
      } else {
        toast.error("Processing timeout — use Retry when ready");
        setBusy(false);
        onComplete?.();
      }
    };
    setTimeout(poll, 800);
  };

  const startOcrTracking = (jobId: string) => {
    setBusy(true);
    setOcrJob({ id: jobId, step: "queued", status: "processing" });
    pollOcrJob(jobId);
  };

  useEffect(() => {
    if (activeJobs.length > 0 && !ocrJob && !busy) {
      startOcrTracking(activeJobs[0].jobId);
    }
  }, [activeJobs]);

  const retryOcrJob = async () => {
    if (!ocrJob?.id && !ocrJob?.jobId) return;
    const jobId = ocrJob.id || ocrJob.jobId;
    setRetrying(true);
    setBusy(true);
    try {
      await api.post(`/ocr/${jobId}/retry`);
      setOcrJob({ id: jobId, step: "queued", status: "processing" });
      pollOcrJob(jobId, () => setRetrying(false));
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Retry failed");
      setRetrying(false);
      setBusy(false);
    }
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("conversationId", conversationId);
      const r = await api.post("/ocr/process", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const jobId = r.data.jobId;
      setOcrJob({ id: jobId, step: "queued", status: "processing" });
      pollOcrJob(jobId);
    } catch (e) {
      toast.error("Upload failed");
      setBusy(false);
    }
  };

  if (!data) return <div className="p-8 text-ink-muted">Loading…</div>;

  return (
    <div className="flex h-screen text-ink">
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

        <div className="px-6 py-5 border-b border-line space-y-3">
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
            <input
              type="file"
              accept="image/*"
              ref={fileRef}
              onChange={(e) => onUpload(e.target.files?.[0])}
              className="hidden"
              data-testid="ocr-file-input"
            />
          </div>

          <SimulateMessagePanel
            open={simulateOpen}
            onToggle={() => setSimulateOpen((v) => !v)}
            customer={data.customer}
            onSent={(jobId) => {
              load();
              loadEnquiries();
              loadActiveJobs();
              if (jobId) startOcrTracking(jobId);
            }}
          />
        </div>

        {ocrJob && (
          <div className="px-6 py-5 border-b border-line space-y-3" data-testid="ocr-progress">
            {STEPS.map((s, i) => {
              const stepIdx = STEPS.findIndex((x) => x.key === ocrJob.step);
              const done = i < stepIdx || ((ocrJob.status === "completed" || ocrJob.status === "done") && i < STEPS.length);
              const active = i === stepIdx && ocrJob.status !== "completed" && ocrJob.status !== "done";
              return (
                <div key={s.key} className="flex items-center gap-3 text-sm">
                  <div
                    className={`h-5 w-5 rounded-full flex items-center justify-center border ${
                      done ? "bg-brand border-brand text-white" : active ? "border-brand text-brand" : "border-line text-ink-muted"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
                  </div>
                  <span className={active ? "text-ink font-medium" : done ? "text-ink font-medium" : "text-ink-muted"}>{s.label}</span>
                </div>
              );
            })}
            {ocrJob.status === "done" && ocrJob.enquiryId && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                <div className="text-sm text-emerald-800 font-medium">Enquiry drafted!</div>
                <div className="text-xs text-emerald-600 mt-1">Redirecting to enquiry page...</div>
              </div>
            )}
            {ocrJob.status === "failed" && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md space-y-2">
                <div className="text-sm text-red-800 font-medium">Gemini processing failed</div>
                <div className="text-xs text-red-700">{ocrJob.error || "Rate limit or temporary API error"}</div>
                {(ocrJob.retryable ?? true) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-red-300 text-red-800 hover:bg-red-100"
                    onClick={retryOcrJob}
                    disabled={retrying || busy}
                  >
                    <RotateCcw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? "animate-spin" : ""}`} />
                    {retrying ? "Retrying…" : "Retry with Gemini"}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {!ocrJob && !busy && (
          <div className="px-6 py-5 text-xs text-ink-muted">
            Once you upload a slip, it will be processed through:
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li>Gemini 2.5 Flash Lite OCR</li>
              <li>AI inventory scoring</li>
              <li>Auto-creation of DRAFT enquiry</li>
            </ul>
          </div>
        )}

        {/* Enquiry History */}
        <div className="flex-1 overflow-y-auto px-6 py-5 border-t border-line">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Past Enquiries ({enquiries.length + activeJobs.length})
            </h4>
            {activeJobs.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={cancelActiveJobs}
                disabled={cancellingJobs}
              >
                {cancellingJobs ? "Cancelling…" : `Cancel ${activeJobs.length} processing`}
              </Button>
            )}
          </div>
          {enquiries.length === 0 && activeJobs.length === 0 ? (
            <div className="text-xs text-ink-muted">No enquiries yet.</div>
          ) : (
            <div className="space-y-2">
              {/* Active Processing Jobs - show first */}
              {activeJobs.map((job) => {
                const status = getEnquiryStatusLabel("processing", { isProcessingJob: true, jobStep: job.step });
                return (
                  <div
                    key={job.jobId}
                    className="w-full text-left p-3 rounded-lg border border-line bg-canvas/50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                        <span className="text-sm font-medium text-ink">
                          Processing...
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-ink-muted mt-1">
                      {job.step === "queued" && "Uploading..."}
                      {job.step === "ocr" && "Gemini OCR..."}
                      {job.step === "inventory_score" && "Scoring inventory..."}
                      {job.step === "done" && "Finalizing..."}
                      {" · "}{timeAgo(job.createdAt)}
                    </div>
                  </div>
                );
              })}
              
              {/* Completed Enquiries */}
              {enquiries.map((enq) => {
                const status = getEnquiryStatusLabel(enq.status, { itemsCount: enq.itemsCount });
                return (
                  <button
                    key={enq.id}
                    onClick={() => router.push(`/enquiries/${enq.id}`)}
                    className="w-full text-left p-3 rounded-lg border border-line hover:bg-canvas transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-ink-muted" />
                        <span className="text-sm font-medium text-ink">
                          {enq.id.slice(0, 8).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${status.color}`}>
                          {status.label}
                        </span>
                        <ArrowRight className="h-4 w-4 text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                    <div className="text-[10px] text-ink-muted mt-1">
                      {enq.status === "IGNORED" ? "Not an inventory enquiry" : `${enq.itemsCount} items`} · {timeAgo(enq.createdAt)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SimulateMessagePanel({
  open,
  onToggle,
  customer,
  onSent,
}: {
  open: boolean;
  onToggle: () => void;
  customer: Customer;
  onSent: (jobId?: string) => void;
}) {
  const [type, setType] = useState<"text" | "image">("text");
  const [content, setContent] = useState("Need 5 ream A4 paper, 10 blue pens, 1 stapler");
  const [dataUrl, setDataUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setDataUrl(reader.result as string);
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (type === "text" && !content.trim()) {
      toast.error("Enter a message");
      return;
    }
    if (type === "image" && !dataUrl) {
      toast.error("Select an image");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        phone: customer.phone,
        name: customer.name || "",
        type,
        content: content || "",
      };
      if (type === "image" && dataUrl) body.mediaDataUrl = dataUrl;

      const r = await api.post("/webhooks/simulate-inbound", body);
      toast.success("Message simulated — AI processing started");
      setContent(type === "text" ? "" : content);
      if (type === "image") setDataUrl("");
      onSent(r.data.jobId);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to simulate");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-line rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between text-xs text-ink-muted hover:bg-canvas transition-colors"
        data-testid="simulate-toggle"
      >
        <span className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          Simulate WhatsApp message
        </span>
        <span>{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-line pt-2">
          <p className="text-[10px] text-ink-muted">MSG91 mocked — sends as {customer.phone}</p>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setType("text")}
              data-testid="simulate-type-text"
              className={`flex-1 text-[11px] py-1.5 rounded border ${type === "text" ? "bg-brand text-white border-brand" : "bg-surface text-ink border-line"}`}
            >
              Text
            </button>
            <button
              type="button"
              onClick={() => setType("image")}
              data-testid="simulate-type-image"
              className={`flex-1 text-[11px] py-1.5 rounded border ${type === "image" ? "bg-brand text-white border-brand" : "bg-surface text-ink border-line"}`}
            >
              Image slip
            </button>
          </div>

          {type === "text" ? (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              placeholder="e.g. Need 5 ream A4 paper..."
              className="text-xs resize-none border-line"
              data-testid="simulate-text-input"
            />
          ) : (
            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                onChange={onFile}
                className="block w-full text-[11px]"
                data-testid="simulate-image-input"
              />
              {dataUrl && (
                <img src={dataUrl} alt="" className="max-h-28 rounded border border-line object-contain" />
              )}
            </div>
          )}

          <Button
            size="sm"
            onClick={submit}
            disabled={submitting}
            className="w-full h-7 text-xs bg-brand hover:bg-brand-hover text-white"
            data-testid="simulate-submit-button"
          >
            <Send className="h-3 w-3 mr-1" />
            {submitting ? "Sending…" : "Send as customer"}
          </Button>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  const isOut = m.direction === "OUTBOUND";
  const url = m.mediaUrl ? (m.mediaUrl.startsWith("http") ? m.mediaUrl : `/api/files/${m.mediaUrl}`) : null;

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
      <div
        className={`max-w-[min(70%,42rem)] min-w-0 rounded-lg px-4 py-2.5 ${
          isOut
            ? "bg-emerald-50 text-ink border border-emerald-200/70"
            : "bg-secondary text-ink border border-line/60"
        }`}
      >
        {url && m.type === "image" && (
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt="" className="max-h-[260px] rounded mb-1 object-cover" />
          </a>
        )}
        {m.content && <MessageContent content={m.content} type={m.type} />}
        <div className="text-[10px] text-ink-muted mt-1.5 flex gap-2">
          <span>{timeAgo(m.createdAt)}</span>
          {isOut && <span className="text-emerald-700/80">Sent</span>}
        </div>
      </div>
    </div>
  );
}

function MessageContent({ content, type }: { content: string; type: string }) {
  if (type === "template" && content.includes("|")) {
    const parts = content.split("|").map((part) => part.trim()).filter(Boolean);
    const [title, ...rest] = parts;
    return (
      <div className="text-sm space-y-1 min-w-0 break-words [overflow-wrap:anywhere]">
        <div className="font-medium text-ink">{title}</div>
        {rest.map((part, index) => (
          <div key={index} className="text-xs text-ink-muted leading-relaxed">
            {part}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="text-sm whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere] min-w-0">
      {content}
    </div>
  );
}
