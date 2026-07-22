"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatDate } from "../../../lib/format";
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

interface GalleryImageItem {
  id: string;
  url: string | null;
  sortOrder: number;
}

interface GalleryListItem {
  id: string;
  name: string;
  imageCount: number;
  hasPdf: boolean;
  thumbnailUrl: string | null;
  updatedAt: string;
}

interface GalleryDetail extends GalleryListItem {
  images: GalleryImageItem[];
}

export default function GalleriesPage() {
  const [galleries, setGalleries] = useState<GalleryListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GalleryDetail | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    const r = await api.get("/galleries");
    setGalleries(r.data.items || []);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const r = await api.get(`/galleries/${id}`);
    setDetail(r.data);
    setName(r.data.name || "");
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadList();
      } catch {
        toast.error("Failed to load galleries");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setName("");
      return;
    }
    loadDetail(selectedId).catch(() => toast.error("Failed to load gallery"));
  }, [selectedId, loadDetail]);

  const createGallery = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a gallery name first");
      return;
    }
    setCreating(true);
    try {
      const r = await api.post("/galleries", { name: trimmed });
      await loadList();
      setSelectedId(r.data.id);
      toast.success("Gallery created");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to create gallery");
    } finally {
      setCreating(false);
    }
  };

  const saveGallery = async () => {
    if (!selectedId || !detail) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Gallery name is required");
      return;
    }
    if (detail.images.length === 0) {
      toast.error("Add at least one image before saving");
      return;
    }

    setSaving(true);
    try {
      const imageOrder = detail.images.map((img) => img.id);
      const r = await api.put(`/galleries/${selectedId}`, { name: trimmed, imageOrder });
      setDetail(r.data);
      setName(r.data.name);
      await loadList();
      toast.success("Gallery saved and PDF generated");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to save gallery");
    } finally {
      setSaving(false);
    }
  };

  const uploadImages = async (files: FileList | File[] | null | undefined) => {
    if (!selectedId || !files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await api.post(`/galleries/${selectedId}/images`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      await loadDetail(selectedId);
      await loadList();
      toast.success(files.length > 1 ? "Images uploaded" : "Image uploaded");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to upload image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = async (imageId: string) => {
    if (!selectedId) return;
    try {
      await api.delete(`/galleries/${selectedId}/images/${imageId}`);
      await loadDetail(selectedId);
      await loadList();
      toast.success("Image removed");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to remove image");
    }
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    if (!detail) return;
    const next = [...detail.images];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDetail({ ...detail, images: next });
  };

  const deleteGallery = async () => {
    if (!selectedId) return;
    if (!window.confirm("Delete this gallery and all its images?")) return;
    try {
      await api.delete(`/galleries/${selectedId}`);
      setSelectedId(null);
      setDetail(null);
      setName("");
      await loadList();
      toast.success("Gallery deleted");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to delete gallery");
    }
  };

  const startNew = () => {
    setSelectedId(null);
    setDetail(null);
    setName("");
  };

  return (
    <div className="p-8 lg:p-12 text-ink h-full">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Admin</div>
          <h1 className="font-display text-3xl font-semibold mt-1">Galleries</h1>
          <p className="text-sm text-ink-muted mt-2 max-w-xl">
            Create product catalogs with images. Saving generates a PDF that staff can send to customers from the inbox.
          </p>
        </div>
        <Button onClick={startNew} className="bg-brand hover:bg-brand-hover text-white shrink-0">
          <Plus className="h-4 w-4 mr-1.5" />
          New gallery
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 min-h-[520px]">
        <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-xs uppercase tracking-wider text-ink-muted">
            All galleries
          </div>
          <div className="max-h-[640px] overflow-y-auto">
            {loading && <div className="p-4 text-sm text-ink-muted">Loading…</div>}
            {!loading && galleries.length === 0 && (
              <div className="p-4 text-sm text-ink-muted">No galleries yet.</div>
            )}
            {galleries.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedId(g.id)}
                className={`w-full text-left px-4 py-3 border-b border-line hover:bg-canvas transition-colors ${
                  selectedId === g.id ? "bg-brand-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded border border-line bg-canvas overflow-hidden shrink-0">
                    {g.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-ink-muted">
                        <ImagePlus className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{g.name}</div>
                    <div className="text-[11px] text-ink-muted">
                      {g.imageCount} image{g.imageCount === 1 ? "" : "s"}
                      {g.hasPdf ? " · PDF ready" : ""}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface shadow-card p-5 space-y-5">
          {!selectedId && !detail ? (
            <div className="space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Gallery name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Havells Switches"
                  className="mt-1.5 border-line text-ink"
                />
              </div>
              <Button
                onClick={createGallery}
                disabled={creating || !name.trim()}
                className="bg-brand hover:bg-brand-hover text-white"
              >
                {creating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
                Create gallery
              </Button>
            </div>
          ) : detail ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1">
                  <Label className="text-xs uppercase tracking-wider text-ink-muted">Gallery name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1.5 border-line text-ink"
                  />
                  <p className="text-[11px] text-ink-muted mt-1.5">
                    Updated {formatDate(detail.updatedAt)}
                    {detail.hasPdf ? " · PDF ready to send" : " · Save to generate PDF"}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    onClick={deleteGallery}
                    className="border-line text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                  <Button
                    onClick={saveGallery}
                    disabled={saving || uploading}
                    className="bg-brand hover:bg-brand-hover text-white"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1.5" />
                    )}
                    Save gallery
                  </Button>
                </div>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  uploadImages(e.dataTransfer.files);
                }}
                className="border-2 border-dashed border-line rounded-md p-8 text-center cursor-pointer hover:bg-canvas transition-colors"
              >
                {uploading ? (
                  <Loader2 className="h-6 w-6 mx-auto text-ink-muted animate-spin" />
                ) : (
                  <Upload className="h-6 w-6 mx-auto text-ink-muted" />
                )}
                <div className="text-sm mt-2 font-medium">
                  {uploading ? "Uploading…" : "Drop images or click to upload"}
                </div>
                <div className="text-xs text-ink-muted mt-1">PNG, JPEG, or WebP</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => uploadImages(e.target.files)}
                />
              </div>

              {detail.images.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {detail.images.map((img, index) => (
                    <div key={img.id} className="rounded-md border border-line overflow-hidden bg-canvas">
                      <div className="aspect-square bg-white">
                        {img.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img.url} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-ink-muted text-xs">
                            No preview
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between px-2 py-1.5 border-t border-line bg-surface">
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveImage(index, -1)}
                            disabled={index === 0}
                            className="p-1 rounded hover:bg-canvas disabled:opacity-30"
                            title="Move up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveImage(index, 1)}
                            disabled={index === detail.images.length - 1}
                            className="p-1 rounded hover:bg-canvas disabled:opacity-30"
                            title="Move down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeImage(img.id)}
                          className="p-1 rounded hover:bg-red-50 text-red-600"
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-ink-muted text-center py-4">No images yet.</div>
              )}
            </>
          ) : (
            <div className="text-sm text-ink-muted">Loading gallery…</div>
          )}
        </div>
      </div>
    </div>
  );
}
