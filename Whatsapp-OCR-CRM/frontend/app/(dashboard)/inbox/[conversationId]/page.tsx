"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { timeAgo } from "../../../../lib/format";
import { socket } from "../../../../lib/socket";
import { Loader2, Check, ImagePlus, FileText, ArrowRight, Send, MessageSquare, RotateCcw, Images } from "lucide-react";
import { toast } from "sonner";
import { formatUserErrorMessage } from "../../../../lib/user-error";
import { formatWhatsappMessageContent } from "../../../../lib/whatsapp-templates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  status: "WAITING" | "PROCESSING" | "FAILED" | "DRAFT" | "REVIEW" | "FINALIZED" | "SENT" | "IGNORED";
  createdAt: string;
  itemsCount: number;
  imageCount?: number;
  processAt?: string | null;
  remainingSeconds?: number | null;
  processingError?: string | null;
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
  options?: { isProcessingJob?: boolean; jobStep?: string; itemsCount?: number; remainingSeconds?: number | null }
): { label: string; color: string } {
  if (options?.isProcessingJob) {
    if (options.jobStep === "queued") return { label: "Processing", color: "bg-blue-400" };
    if (options.jobStep === "ocr") return { label: "Processing", color: "bg-blue-500" };
    if (options.jobStep === "inventory_score") return { label: "Processing", color: "bg-blue-600" };
    return { label: "Processing", color: "bg-blue-500" };
  }

  switch (status) {
    case "WAITING":
      return { label: "Waiting", color: "bg-amber-500" };
    case "PROCESSING":
      return { label: "Processing OCR", color: "bg-blue-500" };
    case "FAILED":
      return { label: "Failed", color: "bg-red-500" };
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

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "--:--";
  const s = Math.max(0, seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
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
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);
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
      const r = await api.post("/ocr/active-jobs/cancel", { conversationId }, { timeout: 30000 });
      const cleared = r.data.cancelled || 0;
      if (cleared === 0) {
        toast.message("No stuck jobs to clear");
      } else {
        toast.success(`Cleared ${cleared} stuck job(s)`);
      }
      setOcrJob(null);
      setBusy(false);
      await loadActiveJobs();
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) {
        toast.error("Clear jobs is not available yet — deploy the latest backend");
      } else {
        toast.error(e?.response?.data?.detail || "Failed to clear processing jobs");
      }
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

    const refreshEnquiries = () => {
      void loadEnquiries();
    };

    socket.on("enquiry_waiting", refreshEnquiries);
    socket.on("enquiry_image_added", refreshEnquiries);
    socket.on("enquiry_updated", refreshEnquiries);

    return () => {
      socket.emit("leave_conversation", conversationId);
      socket.off("new_message");
      socket.off("ocr_job_started");
      socket.off("enquiry_waiting");
      socket.off("enquiry_image_added");
      socket.off("enquiry_updated");
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
        toast.error(formatUserErrorMessage(j.data.error, "Gemini processing failed"));
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
    <div className="flex h-full min-h-0 text-ink">
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

          <Button
            type="button"
            variant="outline"
            onClick={() => setGalleryPickerOpen(true)}
            className="w-full border-line text-ink"
            data-testid="send-gallery-button"
          >
            <Images className="h-4 w-4 mr-1.5" />
            Send images
          </Button>
        </div>

        <SendGalleryDialog
          open={galleryPickerOpen}
          onOpenChange={setGalleryPickerOpen}
          conversationId={conversationId}
          onSent={() => {
            load();
            setGalleryPickerOpen(false);
          }}
        />

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
                <div className="text-xs text-red-700">
                  {formatUserErrorMessage(ocrJob.error, "Rate limit or temporary API error")}
                </div>
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
                {cancellingJobs ? "Clearing…" : `Clear ${activeJobs.length} stuck`}
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
                const status = getEnquiryStatusLabel(enq.status, {
                  itemsCount: enq.itemsCount,
                  remainingSeconds: enq.remainingSeconds,
                });
                return (
                  <button
                    key={enq.id}
                    onClick={() => router.push(`/enquiries/${enq.id}`)}
                    className="w-full text-left p-3 rounded-lg border border-line hover:bg-canvas transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {enq.status === "WAITING" || enq.status === "PROCESSING" ? (
                          <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4 text-ink-muted" />
                        )}
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
                      {enq.status === "WAITING" && (
                        <>
                          {enq.imageCount ?? 0} page(s) · {formatCountdown(enq.remainingSeconds)} remaining ·{" "}
                        </>
                      )}
                      {enq.status === "PROCESSING" && (
                        <>{enq.imageCount ?? 0} page(s) · Processing OCR… · </>
                      )}
                      {enq.status === "FAILED" && (
                        <>{enq.processingError || "Batch failed"} · </>
                      )}
                      {enq.status === "IGNORED"
                        ? "Not an inventory enquiry"
                        : enq.status === "WAITING" || enq.status === "PROCESSING"
                          ? ""
                          : `${enq.itemsCount} items`}{" "}
                      · {timeAgo(enq.createdAt)}
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
      if (r.data.grouped) {
        toast.success("Image added to inquiry batch — waiting for more pages");
        onSent();
      } else {
        toast.success("Message simulated — AI processing started");
        onSent(r.data.jobId);
      }
      setContent(type === "text" ? "" : content);
      if (type === "image") setDataUrl("");
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

interface GalleryPickerItem {
  id: string;
  name: string;
  imageCount: number;
  hasPdf: boolean;
  thumbnailUrl: string | null;
}

function SendGalleryDialog({
  open,
  onOpenChange,
  conversationId,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onSent: () => void;
}) {
  const [galleries, setGalleries] = useState<GalleryPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get("/galleries")
      .then((r) => setGalleries(r.data.items || []))
      .catch(() => toast.error("Failed to load galleries"))
      .finally(() => setLoading(false));
  }, [open]);

  const sendGallery = async (gallery: GalleryPickerItem) => {
    if (!gallery.hasPdf) {
      toast.error("This gallery has no PDF yet — ask admin to save it first");
      return;
    }
    if (!window.confirm(`Send "${gallery.name}" catalog to this customer?`)) return;

    setSendingId(gallery.id);
    try {
      await api.post(`/galleries/${gallery.id}/send`, { conversationId });
      toast.success(`Sent ${gallery.name} catalog`);
      onSent();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to send gallery");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-line bg-surface text-ink">
        <DialogHeader>
          <DialogTitle className="font-display">Send gallery catalog</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-ink-muted -mt-2">
          Select a gallery to send its PDF catalog via WhatsApp.
        </p>

        <div className="max-h-80 overflow-y-auto space-y-2 mt-2">
          {loading && (
            <div className="flex items-center justify-center py-8 text-ink-muted">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading galleries…
            </div>
          )}
          {!loading && galleries.length === 0 && (
            <div className="text-sm text-ink-muted py-6 text-center">No galleries available.</div>
          )}
          {!loading &&
            galleries.map((g) => (
              <button
                key={g.id}
                type="button"
                disabled={!!sendingId}
                onClick={() => sendGallery(g)}
                className="w-full flex items-center gap-3 p-3 rounded-md border border-line hover:bg-canvas transition-colors text-left disabled:opacity-60"
              >
                <div className="h-12 w-12 rounded border border-line bg-canvas overflow-hidden shrink-0">
                  {g.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-ink-muted">
                      <Images className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{g.name}</div>
                  <div className="text-[11px] text-ink-muted">
                    {g.imageCount} image{g.imageCount === 1 ? "" : "s"}
                    {!g.hasPdf ? " · PDF not ready" : ""}
                  </div>
                </div>
                {sendingId === g.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-brand shrink-0" />
                ) : (
                  <Send className="h-4 w-4 text-ink-muted shrink-0" />
                )}
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith("http")) return mediaUrl;
  if (mediaUrl.startsWith("/")) return mediaUrl;
  return `/api/files/${mediaUrl}`;
}

function isPdfUrl(url: string): boolean {
  return url.includes("/pdf") || url.toLowerCase().endsWith(".pdf");
}

function MessageBubble({ m }: { m: Message }) {
  const isOut = m.direction === "OUTBOUND";
  const url = resolveMediaUrl(m.mediaUrl);
  const showImage = !!url && m.type === "image";
  const showPdf = !!url && (m.type === "document" || isPdfUrl(url));

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
      <div
        className={`max-w-[min(70%,42rem)] min-w-0 rounded-lg px-4 py-2.5 ${
          isOut
            ? "bg-emerald-50 text-ink border border-emerald-200/70"
            : "bg-secondary text-ink border border-line/60"
        }`}
      >
        {showImage && (
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt="" className="max-h-[260px] rounded mb-1 object-cover" />
          </a>
        )}
        {showPdf && (
          <div className="mb-2 space-y-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              Open quotation PDF
            </a>
            <iframe
              src={url}
              title="Quotation PDF preview"
              className="w-full h-52 rounded border border-line bg-white"
            />
          </div>
        )}
        {m.content && <MessageContent content={m.content} />}
        <div className="text-[10px] text-ink-muted mt-1.5 flex gap-2">
          <span>{timeAgo(m.createdAt)}</span>
          {isOut && <span className="text-emerald-700/80">Sent</span>}
        </div>
      </div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const display = formatWhatsappMessageContent(content);

  return (
    <div className="text-sm whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere] min-w-0">
      {display}
    </div>
  );
}
