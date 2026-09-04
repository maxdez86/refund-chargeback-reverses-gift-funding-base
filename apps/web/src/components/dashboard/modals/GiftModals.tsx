import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  formatBrl,
  formatCentsInput,
  formatShortDate,
  parseBrlToCents,
  percentWidth
} from "@/lib/admin-dashboard-format";
import {
  GIFT_PART_CENTS,
  TONE_CLASSES,
  giftBadge,
  giftTileClasses,
  isValidGiftTotal
} from "@/lib/admin-dashboard-model";
import type { AdminGift } from "@/lib/admin-dashboard-types";
import {
  ADMIN_BUTTON,
  AdminModal,
  ModalActions,
  ModalNote,
  TextInput
} from "@/components/dashboard/AdminPrimitives";
import { ResponsivePhoto } from "@/components/ResponsivePhoto";
import {
  buildSharedWidthImageFallbackSrc,
  buildSharedWidthImageSources
} from "@/lib/media";
import { cn } from "@/lib/utils";

const GIFT_TILE_IMAGE_SIZES = "(max-width: 640px) 90vw, 280px";

/** Keeps one object URL alive at a time, revoking the previous preview when it is replaced. */
function usePhotoPicker(initial: string | null) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial);
  const [photoName, setPhotoName] = useState("");
  const createdRef = useRef<string | null>(null);
  const keepRef = useRef(false);

  useEffect(
    () => () => {
      if (createdRef.current && !keepRef.current) URL.revokeObjectURL(createdRef.current);
    },
    []
  );

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (createdRef.current) URL.revokeObjectURL(createdRef.current);
    const url = URL.createObjectURL(file);
    createdRef.current = url;
    setPhotoUrl(url);
    setPhotoName(file.name);
  };

  /** Call before saving, so the preview URL survives into the saved gift. */
  const keep = () => {
    keepRef.current = true;
  };

  return { photoUrl, photoName, pick, keep };
}

/** Local pick wins; otherwise the tile shows the same catalog image the public Presentes page uses. */
function GiftTileImage({ gift, photoUrl }: { gift: AdminGift; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      <span
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${photoUrl}")` }}
        aria-hidden="true"
      />
    );
  }

  return (
    <ResponsivePhoto
      section="presentes"
      sources={buildSharedWidthImageSources("presentes", gift.image, GIFT_TILE_IMAGE_SIZES)}
      fallbackSrc={buildSharedWidthImageFallbackSrc("presentes", gift.image)}
      alt={gift.name}
      loading="lazy"
      pictureClassName="absolute inset-0 flex h-full w-full items-center justify-center"
      className="h-full w-full object-contain object-center p-3"
    />
  );
}

function Toggle({
  on,
  title,
  hint,
  onToggle,
  tone
}: {
  on: boolean;
  title: string;
  hint: string;
  onToggle: () => void;
  tone: "gold" | "danger";
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={cn(
        "flex flex-[1_1_240px] items-center gap-3.5 rounded-[11px] border px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
        on
          ? tone === "gold"
            ? "border-admin-line-gold bg-admin-gold-pale"
            : "border-admin-danger-edge bg-admin-err-bg"
          : "border-admin-line-strong bg-admin-surface"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-[22px] w-[38px] flex-none rounded-full transition-colors",
          on ? (tone === "gold" ? "bg-admin-gold" : "bg-admin-danger") : "bg-admin-toggle-off"
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(20_30_25/0.25)] transition-[left]",
            on ? "left-[19px]" : "left-[3px]"
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-admin-ink">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-admin-muted">{hint}</span>
      </span>
    </button>
  );
}

function partsHint(totalCents: number, fractional: boolean) {
  if (!fractional) return "Item único: o convidado cobre o valor inteiro.";
  if (!totalCents) return `Em cotas o valor total deve ser múltiplo de ${formatBrl(GIFT_PART_CENTS)}.`;
  if (!isValidGiftTotal(totalCents, true)) {
    return `Valor inválido: use múltiplos de ${formatBrl(GIFT_PART_CENTS)} (ex.: 1.450,00).`;
  }
  return `Gera ${totalCents / GIFT_PART_CENTS} cotas de ${formatBrl(GIFT_PART_CENTS)}`;
}

/* ── Detalhe e edição de presente ────────────────────────────────────────── */

export function GiftEditorModal({
  gift,
  onCancel,
  onSave
}: {
  gift: AdminGift;
  onCancel: () => void;
  onSave: (values: {
    name: string;
    totalValueCents: number;
    fractional: boolean;
    paused: boolean;
    photoUrl: string | null;
  }) => void;
}) {
  const [name, setName] = useState(gift.name);
  const [total, setTotal] = useState(() => formatCentsInput(gift.totalValueCents));
  const [fractional, setFractional] = useState(gift.fractional);
  const [paused, setPaused] = useState(gift.paused);
  const [touched, setTouched] = useState(false);
  const { photoUrl, pick, keep } = usePhotoPicker(gift.photoUrl);

  const totalCents = parseBrlToCents(total);
  const badTotal = !isValidGiftTotal(totalCents, fractional);
  const badge = giftBadge({ ...gift, paused });
  const changed =
    name.trim() !== gift.name ||
    totalCents !== gift.totalValueCents ||
    fractional !== gift.fractional ||
    paused !== gift.paused ||
    photoUrl !== gift.photoUrl;

  const save = () => {
    if (badTotal) {
      setTouched(true);
      return;
    }
    keep();
    onSave({ name, totalValueCents: totalCents, fractional, paused, photoUrl });
  };

  const facts = [
    { label: "MODELO", value: gift.fundingModelVersion },
    { label: "VALOR DA COTA", value: gift.fractional ? formatBrl(gift.partValueCents ?? 0) : "—" },
    { label: "COTAS TOTAIS", value: gift.fractional ? String(gift.totalParts) : "Item único" },
    { label: "COTAS PAGAS", value: String(gift.partsFunded) },
    { label: "COTAS RESERVADAS", value: String(gift.partsReserved) },
    { label: "VALOR RESERVADO", value: formatBrl(gift.reservedAmountCents) },
    { label: "ATUALIZADO EM", value: formatShortDate(gift.updatedAt) },
    { label: "VERSÃO", value: `v${gift.version}` }
  ];

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && onCancel()}
      alignTop
      widthClassName="max-w-[860px]"
      eyebrow={gift.id}
      title={gift.name}
      description="Cotas já pagas não são afetadas por estas alterações."
      closeButton
      footer={
        <>
          <ModalNote tone={badTotal && touched ? "error" : "info"}>
            {badTotal
              ? "Ajuste o valor total para salvar."
              : changed
                ? "Alterações não salvas. Cotas já pagas não são afetadas."
                : "Nada alterado até agora."}
          </ModalNote>
          <ModalActions>
            <button type="button" className={ADMIN_BUTTON.neutral} onClick={onCancel}>
              Cancelar
            </button>
            <button type="button" className={ADMIN_BUTTON.primary} onClick={save}>
              Salvar alterações
            </button>
          </ModalActions>
        </>
      }
    >
      <div className="mt-5 flex flex-wrap gap-6">
        <div
          className={cn(
            "relative flex min-h-[220px] flex-[1_1_260px] items-center justify-center overflow-hidden rounded-xl",
            giftTileClasses(gift.id)
          )}
        >
          <GiftTileImage gift={gift} photoUrl={photoUrl} />
          <span
            className={`absolute left-4 top-4 rounded-full px-3 py-[5px] text-[11.5px] font-medium tracking-[0.04em] ${TONE_CLASSES[badge.tone]}`}
          >
            {badge.label}
          </span>
          <label className="absolute bottom-4 left-4 inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[9px] bg-white/95 px-3.5 text-[13px] font-medium text-admin-ink shadow-[0_2px_8px_rgb(20_30_25/0.16)] focus-within:ring-2 focus-within:ring-admin-ink">
            <Upload className="size-[15px] shrink-0 opacity-70" strokeWidth={1.7} aria-hidden="true" />
            Trocar imagem
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => pick(event.target.files?.[0])}
            />
          </label>
        </div>

        <div className="min-w-0 flex-[1_1_320px]">
          <div className="flex h-2 overflow-hidden rounded-full bg-admin-track">
            <span
              className="bg-admin-bar-paid"
              style={{ width: percentWidth(gift.confirmedAmountCents, gift.totalValueCents) }}
            />
            <span
              className="bg-admin-bar-reserved"
              style={{ width: percentWidth(gift.reservedAmountCents, gift.totalValueCents) }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <span className="font-admin-serif text-[27px] leading-none text-admin-ok-fg">
              {formatBrl(gift.confirmedAmountCents)}
            </span>
            <span className="text-[13px] text-admin-faint">
              de {formatBrl(gift.totalValueCents)} ·{" "}
              {gift.fractional
                ? `${gift.partsFunded}/${gift.totalParts} cotas`
                : gift.fullyFunded
                  ? "presenteado"
                  : "sem reserva"}
            </span>
          </div>

          <dl className="mt-6 grid gap-x-[22px] gap-y-[18px] sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-[10.5px] font-medium tracking-[0.13em] text-admin-fainter">
                  {fact.label}
                </dt>
                <dd className="mt-1.5 text-[14.5px] tabular-nums text-admin-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 border-t border-admin-line pt-5">
            <dt className="text-[10.5px] font-medium tracking-[0.13em] text-admin-fainter">
              PAGANTES
            </dt>
            <dd className="mt-2 text-[14.5px] text-admin-ink">
              {gift.payerNames.length > 0 ? (
                <ul className="space-y-1.5">
                  {gift.payerNames.map((payerName) => (
                    <li key={payerName}>{payerName}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-admin-faint">Nenhum pagante identificado</span>
              )}
            </dd>
          </div>
        </div>
      </div>

      <div className="mt-6 border-t border-admin-line pt-6">
        <h3 className="font-admin-sans text-[11px] font-medium tracking-[0.2em] text-admin-gold">
          EDITAR PRESENTE
        </h3>
        <TextInput
          className="mt-[18px]"
          label="NOME"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextInput
          className="mt-[18px] max-w-[320px]"
          label="VALOR TOTAL (R$)"
          inputMode="decimal"
          value={total}
          invalid={touched && badTotal}
          onChange={(event) => setTotal(event.target.value)}
          hint={
            <span className={fractional && badTotal ? "text-admin-danger" : undefined}>
              {partsHint(totalCents, fractional)}
            </span>
          }
        />
        <div className="mt-[18px] flex flex-wrap gap-3">
          <Toggle
            tone="gold"
            on={fractional}
            title="Presente em cotas"
            hint={
              fractional
                ? "Convidados podem pagar parte do valor"
                : "Um convidado cobre o valor inteiro"
            }
            onToggle={() => setFractional((current) => !current)}
          />
          <Toggle
            tone="danger"
            on={paused}
            title={paused ? "Presente pausado" : "Presente ativo"}
            hint={
              paused
                ? "Oculto no site, não aceita novas cotas"
                : "Visível no site e aceitando cotas"
            }
            onToggle={() => setPaused((current) => !current)}
          />
        </div>
      </div>
    </AdminModal>
  );
}

/* ── Novo presente ───────────────────────────────────────────────────────── */

export function NewGiftModal({
  onCancel,
  onCreate
}: {
  onCancel: () => void;
  onCreate: (values: {
    name: string;
    totalValueCents: number;
    fractional: boolean;
    photoUrl: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [total, setTotal] = useState("");
  const [fractional, setFractional] = useState(true);
  const [touched, setTouched] = useState(false);
  const { photoUrl, photoName, pick, keep } = usePhotoPicker(null);

  const totalCents = parseBrlToCents(total);
  const badTotal = !isValidGiftTotal(totalCents, fractional);
  const valid = Boolean(name.trim()) && !badTotal && Boolean(photoUrl);

  const create = () => {
    if (!valid) {
      setTouched(true);
      return;
    }
    keep();
    onCreate({ name, totalValueCents: totalCents, fractional, photoUrl });
  };

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && onCancel()}
      alignTop
      closeButton
      widthClassName="max-w-[620px]"
      eyebrow="NOVO PRESENTE"
      title="Adicionar à lista"
      description="A imagem aparece no card do presente no site. Use uma foto quadrada ou 4:3, de preferência clara."
      footer={
        <>
          <ModalNote tone={touched && !valid ? "error" : "info"}>
            {touched && !valid
              ? "Preencha nome, valor válido e imagem para publicar."
              : "O presente entra no site imediatamente após salvar."}
          </ModalNote>
          <ModalActions>
            <button type="button" className={ADMIN_BUTTON.neutral} onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className={ADMIN_BUTTON.primary}
              aria-disabled={!valid}
              onClick={create}
            >
              Criar presente
            </button>
          </ModalActions>
        </>
      }
    >
      <label
        className={cn(
          "relative mt-5 flex aspect-[16/9] cursor-pointer flex-col items-center justify-center gap-2.5 overflow-hidden rounded-[13px] border border-dashed text-center focus-within:ring-2 focus-within:ring-admin-ink hover:border-admin-gold",
          touched && !photoUrl ? "border-admin-danger" : "border-admin-line-strong",
          photoUrl ? "bg-admin-mute-bg" : "bg-admin-surface"
        )}
      >
        {photoUrl ? (
          <>
            <span
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${photoUrl}")` }}
              aria-hidden="true"
            />
            <span className="absolute bottom-3 right-3 rounded-lg bg-white/95 px-3 py-[7px] text-[12.5px] font-medium text-admin-ink shadow-[0_2px_8px_rgb(20_30_25/0.16)]">
              {photoName}
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-2.5 p-5">
            <Upload className="size-[26px] text-admin-gold" strokeWidth={1.7} aria-hidden="true" />
            <span className="text-[14.5px] font-medium text-admin-ink">
              Enviar imagem do presente
            </span>
            <span className="text-[12.5px] text-admin-faint">
              PNG ou JPG até 5 MB · clique para escolher
            </span>
          </span>
        )}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => pick(event.target.files?.[0])}
        />
      </label>
      {touched && !photoUrl && (
        <p className="mt-2.5 text-[12.5px] text-admin-danger">
          A imagem é obrigatória para publicar o presente no site.
        </p>
      )}

      <TextInput
        className="mt-5"
        label="NOME DO PRESENTE *"
        placeholder="Jogo de jantar"
        value={name}
        invalid={touched && !name.trim()}
        onChange={(event) => setName(event.target.value)}
      />

      <TextInput
        className="mt-[18px] max-w-[320px]"
        label="VALOR TOTAL (R$) *"
        placeholder="1450,00"
        inputMode="decimal"
        value={total}
        invalid={touched && badTotal}
        onChange={(event) => setTotal(event.target.value)}
        hint={
          <span className={fractional && touched && badTotal ? "text-admin-danger" : undefined}>
            {partsHint(totalCents, fractional)}
          </span>
        }
      />

      <div className="mt-[18px] flex">
        <Toggle
          tone="gold"
          on={fractional}
          title="Presente em cotas"
          hint={
            fractional
              ? "Convidados podem pagar parte do valor"
              : "Um convidado cobre o valor inteiro"
          }
          onToggle={() => setFractional((current) => !current)}
        />
      </div>
    </AdminModal>
  );
}
