import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { File, FileText, Image, FileArchive, Film, Music, Download, Loader, Check } from "lucide-react";
import { listAttachments, downloadAttachment } from "@/lib/api";
import type { Attachment } from "@/lib/api";
import { sanitizeFilename } from "@/lib/sanitizeFilename";
import { useToastStore } from "@/stores/toast.store";

interface Props {
  messageId: string;
  /**
   * `bar` is the full-width footer used by one-column themes; `panel` is the
   * sidebar block used by two-column themes. Styling lives in the stylesheet so
   * it can read the active theme's `--msg-*` variables.
   */
  variant?: "bar" | "panel";
}

function getMimeIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.startsWith("video/")) return Film;
  if (mimeType.startsWith("audio/")) return Music;
  if (mimeType.includes("zip") || mimeType.includes("archive") || mimeType.includes("compressed") || mimeType.includes("tar") || mimeType.includes("rar")) return FileArchive;
  if (mimeType.includes("text") || mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("word")) return FileText;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getErrorMessage(err: unknown): string | null {
  if (typeof err === "string") return err;
  if (!err || typeof err !== "object") return null;
  const record = err as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  return null;
}

export default function AttachmentList({ messageId, variant = "bar" }: Props) {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedPaths, setDownloadedPaths] = useState<Record<string, string>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  // Listen for download progress events
  useEffect(() => {
    const unlisten = listen<{ attachment_id: string; bytes_copied: number; total_bytes: number }>(
      "attachment:download-progress",
      (event) => {
        const { attachment_id, bytes_copied, total_bytes } = event.payload;
        const pct = total_bytes > 0 ? Math.round((bytes_copied / total_bytes) * 100) : 0;
        setDownloadProgress((prev) => ({ ...prev, [attachment_id]: pct }));
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    listAttachments(messageId)
      .then((list) => {
        if (!cancelled) {
          setAttachments(list.filter((a) => !a.is_inline));
        }
      })
      .catch(() => {
        if (!cancelled) setAttachments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [messageId]);

  async function handleDownload(attachment: Attachment) {
    setDownloadingId(attachment.id);
    try {
      const { downloadDir } = await import("@tauri-apps/api/path");
      const dir = await downloadDir();
      const safeName = sanitizeFilename(attachment.filename);
      const savePath = `${dir}/${safeName}`;
      const downloadedPath = await downloadAttachment(attachment.id, savePath);
      setDownloadedPaths((prev) => ({ ...prev, [attachment.id]: downloadedPath }));
      setDownloadProgress((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    } catch (err) {
      console.error("Failed to download attachment:", err);
      const reason = getErrorMessage(err);
      useToastStore.getState().addToast({
        message: reason
          ? t("attachments.downloadFailedWithReason", "Failed to download attachment: {{reason}}", { reason })
          : t("attachments.downloadFailed", "Failed to download attachment"),
        type: "error",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  if (loading) return null;
  if (attachments.length === 0) return null;

  return (
    <div className="attachment-list" data-variant={variant}>
      <div className="attachment-list-inner">
        <div className="attachment-list-title">
          {t("attachments.title")} ({attachments.length})
        </div>
        <div className="attachment-list-items">
          {attachments.map((attachment) => {
            const Icon = getMimeIcon(attachment.mime_type);
            const isDownloading = downloadingId === attachment.id;

            return (
              <div key={attachment.id} className="attachment-list-row">
                <Icon size={16} className="attachment-list-icon" style={{ flexShrink: 0 }} />
                <span className="attachment-list-name">{attachment.filename}</span>
                <span className="attachment-list-size">{formatFileSize(attachment.size)}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                  {isDownloading && downloadProgress[attachment.id] != null && (
                    <span className="attachment-list-progress">
                      {downloadProgress[attachment.id]}%
                    </span>
                  )}
                  <button
                    className="attachment-list-download"
                    onClick={() => handleDownload(attachment)}
                    disabled={isDownloading}
                    aria-label={t("attachments.download") + ": " + attachment.filename}
                    title={isDownloading ? t("attachments.downloading") : downloadedPaths[attachment.id] ? downloadedPaths[attachment.id] : t("attachments.download")}
                    style={{ opacity: isDownloading ? 0.5 : 1 }}
                  >
                    {isDownloading ? (
                      <Loader size={14} className="spinner" />
                    ) : downloadedPaths[attachment.id] ? (
                      <Check size={14} style={{ color: "var(--msg-accent, var(--color-accent))" }} />
                    ) : (
                      <Download size={14} />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
