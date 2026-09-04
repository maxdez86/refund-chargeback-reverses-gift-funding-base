import { CircleAlert } from "lucide-react";
import { formatLongDate } from "@/lib/admin-dashboard-format";
import type { AdminGuestMessage } from "@/lib/admin-dashboard-types";
import {
  ADMIN_BUTTON,
  AdminModal,
  ModalActions
} from "@/components/dashboard/AdminPrimitives";

/** Longest recado excerpt the confirmation card shows before it is cut with an ellipsis. */
const PREVIEW_LIMIT = 140;

export function truncateMessage(body: string, limit = PREVIEW_LIMIT) {
  const collapsed = body.trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit).trimEnd()}…`;
}

/**
 * Confirms a hard delete of one recado.
 *
 * Deletion is irreversible and the content is guest-authored, so the operator sees who wrote it
 * and an excerpt of what they are about to destroy. Dismissal is blocked while the request is in
 * flight; the failure reason renders in place rather than as a toast, so the modal stays open and
 * the operator can retry against the same row.
 */
export function DeleteMessageModal({
  message,
  submitting,
  error,
  onCancel,
  onConfirm
}: {
  message: AdminGuestMessage;
  submitting: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && !submitting && onCancel()}
      widthClassName="max-w-[470px]"
      title="Excluir este recado?"
      icon={
        <span
          aria-hidden="true"
          className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-admin-err-bg text-admin-err-fg"
        >
          <CircleAlert className="size-[19px]" strokeWidth={1.7} />
        </span>
      }
      description="O recado será removido do mural do site e não poderá ser recuperado."
      footer={
        <ModalActions>
          <button
            type="button"
            className={ADMIN_BUTTON.neutral}
            onClick={onCancel}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={ADMIN_BUTTON.destructive}
            onClick={onConfirm}
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Excluindo…" : "Excluir recado"}
          </button>
        </ModalActions>
      }
    >
      <div className="mt-[18px] rounded-[11px] border border-admin-line bg-admin-surface px-4 py-3.5">
        <p className="text-[15px] font-semibold">{message.authorName}</p>
        <p className="mt-1 text-[13px] text-admin-faint">{formatLongDate(message.createdAt)}</p>
        <p className="mt-2.5 font-admin-serif text-[15px] leading-[1.5] text-admin-ink-soft [text-wrap:pretty]">
          {truncateMessage(message.message)}
        </p>
      </div>
      <p className="mt-4 text-[13px] leading-[1.5] text-admin-danger">
        Esta ação não pode ser desfeita.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm leading-relaxed text-admin-danger">
          {error}
        </p>
      )}
    </AdminModal>
  );
}
