import { ChevronRight } from "lucide-react";
import { formatBrl, formatBrlShort, percentWidth } from "@/lib/admin-dashboard-format";
import {
  GIFT_FILTERS,
  TONE_CLASSES,
  filterGifts,
  giftBadge,
  type GiftFilter
} from "@/lib/admin-dashboard-model";
import type { AdminGift } from "@/lib/admin-dashboard-types";
import {
  ADMIN_BUTTON,
  FilterTabs,
  PageHeader,
  SearchField
} from "@/components/dashboard/AdminPrimitives";

const COLUMNS = "grid-cols-[2.3fr_1.2fr_1fr_1.7fr_1.1fr_28px]";

export function GiftsScreen({
  gifts,
  filter,
  query,
  onFilterChange,
  onQueryChange,
  onOpenGift,
  onNewGift
}: {
  gifts: AdminGift[];
  filter: GiftFilter;
  query: string;
  onFilterChange: (next: GiftFilter) => void;
  onQueryChange: (next: string) => void;
  onOpenGift: (giftId: string) => void;
  onNewGift: () => void;
}) {
  const visible = filterGifts(gifts, filter, query);
  const active = gifts.filter((gift) => !gift.paused);
  const totalPaid = gifts.reduce((sum, gift) => sum + gift.confirmedAmountCents, 0);
  const totalReserved = gifts.reduce((sum, gift) => sum + gift.reservedAmountCents, 0);
  const goal = active.reduce((sum, gift) => sum + gift.totalValueCents, 0);
  const fractional = gifts.filter((gift) => gift.fractional);
  const partsSold = fractional.reduce((sum, gift) => sum + gift.partsFunded, 0);
  const partsAll = fractional.reduce((sum, gift) => sum + (gift.totalParts ?? 0), 0);
  const completed = gifts.filter((gift) => gift.fullyFunded).length;
  const pausedCount = gifts.length - active.length;

  const heroStats = [
    {
      label: "PRESENTES NO SITE",
      value: String(active.length),
      hint: pausedCount ? `${pausedCount} pausados` : "nenhum pausado",
      className: "text-admin-ink"
    },
    {
      label: "COMPLETOS",
      value: String(completed),
      hint: "100% financiados",
      className: "text-admin-ok-fg"
    },
    {
      label: "COTAS VENDIDAS",
      value: `${partsSold}/${partsAll}`,
      hint: "em toda a lista",
      className: "text-admin-gold"
    },
    {
      label: "RESERVADO",
      value: formatBrlShort(totalReserved),
      hint: "aguardando pagamento",
      className: "text-admin-err-fg"
    }
  ];

  return (
    <div>
      <PageHeader
        id="conteudo-titulo"
        eyebrow="LISTA DE PRESENTES"
        title="Presentes"
        description="Cada presente tem um valor total dividido em cotas. Os convidados reservam cotas no site e o pagamento confirma o valor."
        actions={
          <button type="button" className={ADMIN_BUTTON.primary} onClick={onNewGift}>
            Novo presente
          </button>
        }
      />

      <section className="mt-9 flex flex-wrap items-end gap-x-14 gap-y-8 rounded-2xl border border-admin-line bg-admin-surface px-9 py-[34px]">
        <div className="min-w-0 flex-[1_1_320px]">
          <h2 className="font-admin-sans text-[11.5px] font-medium tracking-[0.16em] text-admin-muted">
            TOTAL ARRECADADO
          </h2>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-3.5">
            <span className="font-admin-serif text-[clamp(3rem,7vw,4.625rem)] leading-[0.95] tracking-[-0.015em] text-admin-ink">
              {formatBrlShort(totalPaid)}
            </span>
            <span className="text-[14.5px] text-admin-faint">
              de {formatBrlShort(goal)} em presentes ativos
            </span>
          </div>
          <div
            className="mt-[22px] flex h-2 overflow-hidden rounded-full bg-admin-track"
            role="img"
            aria-label={`${formatBrl(totalPaid)} confirmados e ${formatBrl(totalReserved)} reservados de ${formatBrl(goal)}`}
          >
            <span className="bg-admin-bar-paid" style={{ width: percentWidth(totalPaid, goal) }} />
            <span
              className="bg-admin-bar-reserved"
              style={{ width: percentWidth(totalReserved, goal) }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-[22px] gap-y-2 text-[13px] text-admin-muted">
            <span className="inline-flex items-center gap-2">
              <span className="size-[9px] rounded-full bg-admin-bar-paid" aria-hidden="true" />
              {formatBrl(totalPaid)} confirmados
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-[9px] rounded-full bg-admin-bar-reserved" aria-hidden="true" />
              {formatBrl(totalReserved)} reservados, aguardando pagamento
            </span>
          </div>
        </div>
        <dl className="grid flex-[1_1_380px] gap-x-[26px] gap-y-5 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {heroStats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-[11px] font-medium tracking-[0.14em] text-admin-faint">
                {stat.label}
              </dt>
              <dd className={`mt-2 font-admin-serif text-[30px] leading-none ${stat.className}`}>
                {stat.value}
              </dd>
              <p className="mt-1.5 text-[12.5px] text-admin-fainter">{stat.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-[34px] flex flex-wrap items-center gap-3.5">
        <SearchField
          className="bg-admin-surface"
          label="Buscar presentes"
          value={query}
          onChange={onQueryChange}
          placeholder="Buscar presente pelo nome ou código"
        />
        <FilterTabs
          className="sm:ml-auto"
          label="Filtrar presentes"
          options={GIFT_FILTERS}
          value={filter}
          onChange={onFilterChange}
        />
      </div>

      <div className="mt-5 overflow-hidden rounded-[14px] border border-admin-line bg-admin-surface">
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            {/* Column headings are decorative: each row button carries its own summary label. */}
            <div
              aria-hidden="true"
              className={`grid ${COLUMNS} gap-[18px] border-b border-admin-line bg-admin-subtle px-[22px] py-3 text-[11px] font-medium tracking-[0.13em] text-admin-faint`}
            >
              <div>PRESENTE</div>
              <div>MODELO</div>
              <div>VALOR</div>
              <div>ARRECADADO</div>
              <div>SITUAÇÃO</div>
              <div />
            </div>

            <ul aria-label="Presentes">
              {visible.map((gift) => {
                const badge = giftBadge(gift);
                const progress = gift.fractional
                  ? `${gift.partsFunded}/${gift.totalParts} cotas${gift.partsReserved ? ` · ${gift.partsReserved} reserv.` : ""}`
                  : gift.fullyFunded
                    ? "presenteado"
                    : "sem reserva";
                return (
                  <li key={gift.id}>
                    <button
                      type="button"
                      onClick={() => onOpenGift(gift.id)}
                      aria-label={`Editar ${gift.name}. ${formatBrl(gift.confirmedAmountCents)} de ${formatBrl(gift.totalValueCents)}. ${badge.label}.`}
                      className={`grid ${COLUMNS} w-full items-center gap-[18px] border-b border-admin-line-soft px-[22px] py-[15px] text-left transition-colors hover:bg-admin-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-admin-ink ${gift.paused ? "opacity-60" : ""}`}
                    >
                      <span className="block min-w-0">
                        <span className="block truncate text-[14.5px] font-medium">{gift.name}</span>
                        <span className="admin-mono mt-1 block truncate text-[11.5px] text-admin-fainter">
                          {gift.id}
                        </span>
                      </span>

                      <span className="text-[13px] text-admin-ink-soft">
                        {gift.fractional
                          ? `${gift.totalParts} cotas de ${formatBrl(gift.partValueCents ?? 0)}`
                          : "Item único"}
                      </span>

                      <span className="whitespace-nowrap text-sm font-medium tabular-nums">
                        {formatBrl(gift.totalValueCents)}
                      </span>

                      <span className="block min-w-0">
                        <span className="flex h-1.5 overflow-hidden rounded-full bg-admin-track">
                          <span
                            className="bg-admin-bar-paid"
                            style={{ width: percentWidth(gift.confirmedAmountCents, gift.totalValueCents) }}
                          />
                          <span
                            className="bg-admin-bar-reserved"
                            style={{ width: percentWidth(gift.reservedAmountCents, gift.totalValueCents) }}
                          />
                        </span>
                        <span className="mt-2 flex flex-wrap items-baseline gap-2.5">
                          <span className="text-[13px] font-medium tabular-nums text-admin-ok-fg">
                            {formatBrl(gift.confirmedAmountCents)}
                          </span>
                          <span className="text-xs text-admin-fainter">{progress}</span>
                        </span>
                      </span>

                      <span className="block">
                        <span
                          className={`inline-flex items-center gap-[7px] whitespace-nowrap rounded-full px-[11px] py-[5px] text-xs font-medium tracking-[0.03em] ${TONE_CLASSES[badge.tone]}`}
                        >
                          <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
                          {badge.label}
                        </span>
                      </span>

                      <span className="flex justify-end opacity-35">
                        <ChevronRight className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {visible.length === 0 && (
              <p className="px-[22px] py-10 text-center text-sm text-admin-faint">
                Nenhum presente corresponde a esta busca.
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="mt-[22px] text-[13px] text-admin-faint">
        Mostrando {visible.length} de {gifts.length} presentes
      </p>
    </div>
  );
}
