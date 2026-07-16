"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { timeAgo } from "../../../lib/format";
import { Search, MessageSquarePlus, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface ConversationItem {
  id: string;
  customer: {
    id: string;
    phone: string;
    name: string | null;
    company: string | null;
  };
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  status: string;
}

export default function Inbox() {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.get("/inbox", { params: q ? { q } : {} });
      setItems(r.data.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [q]);

  return (
    <div className="flex h-full min-h-0 text-ink">
      <div className="w-[360px] shrink-0 border-r border-line bg-surface flex flex-col">
        <div className="px-5 py-5 border-b border-line">
          <div className="flex items-center justify-between mb-4">
            <h1 className="font-display text-xl font-semibold">Inbox</h1>
            <SimulateInboundDialog onCreated={load} />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or phone"
              className="pl-9 bg-canvas border-line h-9"
              data-testid="inbox-search-input"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin" data-testid="inbox-list">
          {loading && <div className="p-6 text-sm text-ink-muted">Loading…</div>}
          {!loading && items.length === 0 && (
            <div className="p-6 text-sm text-ink-muted">
              No conversations yet. Click <span className="text-ink font-medium">New</span> to simulate one.
            </div>
          )}
          {items.map((it) => (
            <Link
              key={it.id}
              href={`/inbox/${it.id}`}
              data-testid={`inbox-row-${it.id}`}
              className="block px-5 py-4 border-b border-line hover:bg-canvas transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-medium text-ink truncate">
                  {it.customer?.name || it.customer?.phone || "Unknown"}
                </div>
                <div className="text-[11px] text-ink-muted whitespace-nowrap">{timeAgo(it.lastMessageAt)}</div>
              </div>
              <div className="text-xs text-ink-muted mt-0.5">{it.customer?.phone}</div>
              <div className="flex items-center justify-between gap-3 mt-2">
                <div className="text-sm text-ink-muted truncate">{it.lastMessagePreview || "—"}</div>
                {it.unreadCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-brand text-white text-[11px] font-medium">
                    {it.unreadCount}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center text-ink-muted bg-canvas">
        <div className="text-center">
          <MessageSquarePlus className="h-10 w-10 mx-auto text-ink-muted/50" />
          <p className="mt-3 text-sm">Select a conversation to begin.</p>
        </div>
      </div>
    </div>
  );
}

function SimulateInboundDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("+91 98765 43210");
  const [name, setName] = useState("Sunil Office Mart");
  const [content, setContent] = useState("Hi, please send rates for A4 paper, blue pens and stapler.");
  const [type, setType] = useState("text");
  const [dataUrl, setDataUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setDataUrl(reader.result as string);
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const body: any = { phone, name, type, content };
      if (type === "image" && dataUrl) body.mediaDataUrl = dataUrl;
      const r = await api.post("/webhooks/simulate-inbound", body);
      toast.success("Inbound message simulated");
      setOpen(false);
      onCreated();
      if (r.data?.conversationId) {
        router.push(`/inbox/${r.data.conversationId}`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to simulate");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-line" data-testid="simulate-inbound-button">
          <Send className="h-3.5 w-3.5 mr-1.5" /> New
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-surface border-line text-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-ink">New Quote</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1.5" data-testid="simulate-phone-input" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Customer Name (optional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" data-testid="simulate-name-input" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("text")}
              data-testid="simulate-type-text"
              className={`flex-1 text-xs py-2 rounded-md border ${type === "text" ? "bg-brand text-white border-brand" : "bg-surface text-ink border-line"}`}
            >
              Text
            </button>
            <button
              type="button"
              onClick={() => setType("image")}
              data-testid="simulate-type-image"
              className={`flex-1 text-xs py-2 rounded-md border ${type === "image" ? "bg-brand text-white border-brand" : "bg-surface text-ink border-line"}`}
            >
              Image (handwritten slip)
            </button>
          </div>
          {type === "text" ? (
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Message</Label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="mt-1.5" rows={3} data-testid="simulate-text-input" />
            </div>
          ) : (
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Slip image</Label>
              <input type="file" accept="image/*" onChange={onFile} className="mt-1.5 block text-sm" data-testid="simulate-image-input" />
              {dataUrl && <img src={dataUrl} alt="" className="mt-2 max-h-40 rounded border border-line" />}
              <Label className="text-xs uppercase tracking-wider text-ink-muted mt-3 block">Caption (optional)</Label>
              <Input value={content} onChange={(e) => setContent(e.target.value)} className="mt-1.5" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={submitting} className="bg-brand hover:bg-brand-hover text-white" data-testid="simulate-submit-button">
            {submitting ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
