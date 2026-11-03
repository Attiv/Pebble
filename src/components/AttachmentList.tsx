import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Download, Loader, Check } from "lucide-react";
import { listAttachments, downloadAttachment } from "@/lib/api";
import type { Attachment } from "@/lib/api";
import { sanitizeFilename } from "@/lib/sanitizeFilename";
import { attachmentVisual } from "./attachmentVisual";
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

/** A meeting invitation is rendered by `MeetingInviteCard`, not as a file. */
export function isCalendarAttachment(attachment: Attachment): boolean {
  const mime = attachment.mime_type.toLowerCase();
  return (
    mime.startsWith("text/calendar") ||
    mime.startsWith("application/ics") ||
    attachment.filename.toLowerCase().endsWith(".ics")
  );
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
          // Inline images decorate the body, and a calendar payload is shown as
          // a meeting card instead of as a file to download.
          setAttachments(list.filter((a) => !a.is_inline && !isCalendarAttachment(a)));
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
            const { Icon, color } = attachmentVisual(attachment.mime_type, attachment.filename);
            const isDownloading = downloadingId === attachment.id;

            return (
              <div key={attachment.id} className="attachment-card">
                <div className="attachment-icon-tile" style={{ backgroundColor: `${color}1f` }}>
                  <Icon size={17} color={color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="attachment-name" title={attachment.filename}>
                    {attachment.filename}
                  </div>
                  <div className="attachment-meta">{formatFileSize(attachment.size)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  {isDownloading && downloadProgress[attachment.id] != null && (
                    <span className="attachment-list-progress">
                      {downloadProgress[attachment.id]}%
                    </span>
                  )}
                  <button
                    className="attachment-download"
                    onClick={() => handleDownload(attachment)}
                    disabled={isDownloading}
                    aria-label={t("attachments.download") + ": " + attachment.filename}
                    title={isDownloading ? t("attachments.downloading") : downloadedPaths[attachment.id] ? downloadedPaths[attachment.id] : t("attachments.download")}
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
