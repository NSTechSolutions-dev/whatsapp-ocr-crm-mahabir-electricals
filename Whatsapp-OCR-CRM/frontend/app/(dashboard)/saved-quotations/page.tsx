"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatDate, formatINR } from "../../../lib/format";
import { formatUserErrorMessage } from "../../../lib/user-error";
import { Plus, Pencil, Trash2, Send, FileText } from "lucide-react";
import type { GstMode } from "../../../lib/gst-calculation";

interface TemplateItem {
  productName: string;
  qty: number;
  unit?: string | null;
  rate?: number | null;
  inventoryId?: string | null;
}

interface QuotationTemplate {
  id: string;
  name: string;
  gstPercent: number;
  gstMode: string;
  deliveryCharge: number;
  items: TemplateItem[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string; email: string };
}

function emptyItem(): TemplateItem {
  return { productName: "", qty: 1, unit: "", rate: null };
}

export default function SavedQuotationsPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [gstPercent, setGstPercent] = useState<number | string>(18);
  const [gstMode, setGstMode] = useState<GstMode>("exclusive");
  const [deliveryCharge, setDeliveryCharge] = useState<number | string>(0);
  const [items, setItems] = useState<TemplateItem[]>([emptyItem()]);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendTemplate, setSendTemplate] = useState<QuotationTemplate | null>(null);
  const [sending, setSending] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCompany, setCustomerCompany] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/quotation-templates");
      setTemplates(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || formatUserErrorMessage(e?.message, "Failed to load saved quotations"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setGstPercent(18);
    setGstMode("exclusive");
    setDeliveryCharge(0);
    setItems([emptyItem()]);
    setEditorOpen(true);
  };

  const openEdit = (template: QuotationTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setGstPercent(template.gstPercent);
    setGstMode(template.gstMode === "inclusive" ? "inclusive" : "exclusive");
    setDeliveryCharge(template.deliveryCharge ?? 0);
    setItems(
      template.items?.length
        ? template.items.map((item) => ({
            productName: item.productName || "",
            qty: item.qty || 1,
            unit: item.unit || "",
            rate: item.rate ?? null,
            inventoryId: item.inventoryId ?? null,
          }))
        : [emptyItem()]
    );
    setEditorOpen(true);
  };

  const saveTemplate = async () => {
    const title = name.trim();
    if (!title) {
      toast.error("Template name is required");
      return;
    }
    const payloadItems = items
      .map((item) => ({
        productName: item.productName.trim(),
        qty: Number(item.qty),
        unit: item.unit?.trim() || null,
        rate:
          item.rate === null || item.rate === undefined || item.rate === ("" as any)
            ? null
            : Number(item.rate),
      }))
      .filter((item) => item.productName && Number.isFinite(item.qty) && item.qty > 0);

    if (!payloadItems.length) {
      toast.error("Add at least one line item");
      return;
    }

    setSaving(true);
    try {
      const body = {
        name: title,
        gstPercent: Number(gstPercent),
        gstMode,
        deliveryCharge: Number(deliveryCharge) || 0,
        items: payloadItems,
      };
      if (editingId) {
        await api.put(`/quotation-templates/${editingId}`, body);
        toast.success("Template updated");
      } else {
        await api.post("/quotation-templates", body);
        toast.success("Template saved");
      }
      setEditorOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || formatUserErrorMessage(e?.message, "Failed to save template"));
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      await api.delete(`/quotation-templates/${id}`);
      toast.success("Template deleted");
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || formatUserErrorMessage(e?.message, "Failed to delete template"));
    }
  };

  const openSend = (template: QuotationTemplate) => {
    setSendTemplate(template);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerCompany("");
    setSendOpen(true);
  };

  const sendToCustomer = async () => {
    if (!sendTemplate) return;
    if (!customerPhone.trim()) {
      toast.error("Customer phone is required");
      return;
    }

    setSending(true);
    try {
      const r = await api.post(`/quotation-templates/${sendTemplate.id}/send`, {
        name: customerName.trim() || undefined,
        phone: customerPhone.trim(),
        company: customerCompany.trim() || undefined,
        billCustomerName: customerName.trim() || undefined,
        billCustomerPhone: customerPhone.trim(),
        billCustomerCompany: customerCompany.trim() || undefined,
      });
      toast.success(`Sent ${r.data.quotationNumber || "quotation"}`);
      setSendOpen(false);
      if (r.data.conversationId) {
        router.push(`/inbox/${r.data.conversationId}`);
      } else if (r.data.enquiryId) {
        router.push(`/enquiries/${r.data.enquiryId}`);
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || formatUserErrorMessage(e?.message, "Failed to send quotation"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-8 lg:p-12 max-w-5xl text-ink space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Quotations</div>
          <h1 className="font-display text-3xl font-semibold mt-1 text-ink">Saved Quotations</h1>
          <p className="text-sm text-ink-muted mt-2">
            Reusable quotation templates. Save explicitly — quotes are never auto-saved here.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-brand hover:bg-brand-hover text-white shrink-0">
          <Plus className="h-4 w-4 mr-1.5" />
          New template
        </Button>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-sm text-ink-muted">Loading…</div>
        ) : templates.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <FileText className="h-8 w-8 text-ink-muted mx-auto" />
            <div className="text-sm text-ink-muted">No saved quotations yet.</div>
            <Button variant="outline" onClick={openCreate} className="border-line">
              Create your first template
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-canvas border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">GST</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{template.name}</div>
                    {template.createdBy?.name && (
                      <div className="text-[11px] text-ink-muted">by {template.createdBy.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{template.itemCount}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {template.gstPercent}% {template.gstMode}
                    {template.deliveryCharge > 0 && (
                      <div className="text-[11px]">+ {formatINR(template.deliveryCharge)} delivery</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{formatDate(template.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs border-line"
                        onClick={() => openSend(template)}
                      >
                        <Send className="h-3 w-3 mr-1" />
                        Send
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs border-line"
                        onClick={() => openEdit(template)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-line text-red-700">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete template?</AlertDialogTitle>
                            <AlertDialogDescription>
                              “{template.name}” will be removed. Past sent quotations are not affected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteTemplate(template.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit template" : "New quotation template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 border-line"
                placeholder="e.g. Standard wire pack"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">GST %</Label>
                <Input
                  type="number"
                  value={gstPercent}
                  onChange={(e) => setGstPercent(e.target.value)}
                  className="mt-1.5 border-line"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">GST mode</Label>
                <select
                  value={gstMode}
                  onChange={(e) => setGstMode(e.target.value as GstMode)}
                  className="mt-1.5 w-full h-10 rounded-md border border-line bg-background px-3 text-sm"
                >
                  <option value="exclusive">Exclusive</option>
                  <option value="inclusive">Inclusive</option>
                </select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Delivery</Label>
                <Input
                  type="number"
                  value={deliveryCharge}
                  onChange={(e) => setDeliveryCharge(e.target.value)}
                  className="mt-1.5 border-line"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Line items</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-line"
                  onClick={() => setItems((prev) => [...prev, emptyItem()])}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add row
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-center">
                    <Input
                      className="col-span-5 border-line"
                      placeholder="Product"
                      value={item.productName}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) =>
                            i === index ? { ...row, productName: e.target.value } : row
                          )
                        )
                      }
                    />
                    <Input
                      className="col-span-2 border-line"
                      type="number"
                      placeholder="Qty"
                      value={item.qty}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) =>
                            i === index ? { ...row, qty: Number(e.target.value) } : row
                          )
                        )
                      }
                    />
                    <Input
                      className="col-span-2 border-line"
                      placeholder="Unit"
                      value={item.unit || ""}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) =>
                            i === index ? { ...row, unit: e.target.value } : row
                          )
                        )
                      }
                    />
                    <Input
                      className="col-span-2 border-line"
                      type="number"
                      placeholder="Rate"
                      value={item.rate ?? ""}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  rate: e.target.value === "" ? null : Number(e.target.value),
                                }
                              : row
                          )
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="col-span-1 h-9 px-2 text-ink-muted"
                      disabled={items.length <= 1}
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} className="border-line">
              Cancel
            </Button>
            <Button onClick={saveTemplate} disabled={saving} className="bg-brand hover:bg-brand-hover text-white">
              {saving ? "Saving…" : editingId ? "Update template" : "Save template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send to customer</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-muted">
            Creates a new quotation from “{sendTemplate?.name}” and sends it on WhatsApp. It will
            appear in that customer’s inbox.
          </p>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Name</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1.5 border-line"
                placeholder="Customer name"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Phone</Label>
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="mt-1.5 border-line"
                placeholder="10-digit mobile"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Company</Label>
              <Input
                value={customerCompany}
                onChange={(e) => setCustomerCompany(e.target.value)}
                className="mt-1.5 border-line"
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)} className="border-line">
              Cancel
            </Button>
            <Button
              onClick={sendToCustomer}
              disabled={sending}
              className="bg-brand hover:bg-brand-hover text-white"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {sending ? "Sending…" : "Send quotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
