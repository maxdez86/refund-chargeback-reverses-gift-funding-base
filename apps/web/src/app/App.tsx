import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Carousel } from "./Carousel";
import {
  FAQ_ITEMS,
  GIFT_ITEMS,
  MAP_URL,
  NAV_ITEMS,
  PEOPLE_GROUPS,
  PRE_WEDDING_ITEMS,
  STORY_ITEMS,
  VENDORS,
  WEDDING_DATE_ISO,
  type GiftItem
} from "./data";
import {
  clampGiftQuantity,
  formatBRL,
  fundedAmount,
  fundingPercent,
  giftStateLabel,
  remainingParts,
  sortGifts
} from "./gifts";
import { useCountdown, useMobileRsvpShortcut, useReducedMotion, useRevealItems } from "./hooks";
import {
  buildConfirmationPayload,
  groupPreview,
  invitationGroupsById,
  resetSelections,
  resolveInvitationGroup,
  type RsvpConfirmationPayload
} from "./rsvp";
import "./styles.css";

type RsvpStatus = "idle" | "searching" | "resolved" | "ambiguous" | "not-found" | "success";

type RsvpState = {
  status: RsvpStatus;
  searchTerm: string;
  resolvedGroupId: string | null;
  ambiguousGroupIds: string[];
  selections: Record<string, boolean>;
  payload: RsvpConfirmationPayload | null;
};

const initialRsvpState: RsvpState = {
  status: "idle",
  searchTerm: "",
  resolvedGroupId: null,
  ambiguousGroupIds: [],
  selections: {},
  payload: null
};

export function App() {
  const reducedMotion = useReducedMotion();
  const countdown = useCountdown(WEDDING_DATE_ISO);
  const sortedGifts = useMemo(() => sortGifts(GIFT_ITEMS), []);
  const [activeGift, setActiveGift] = useState<GiftItem | null>(null);
  const [activeQuantity, setActiveQuantity] = useState(1);
  const [giftStatus, setGiftStatus] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [rsvpState, setRsvpState] = useState<RsvpState>(initialRsvpState);
  const [fieldError, setFieldError] = useState("");
  const lookupTokenRef = useRef(0);

  useRevealItems(reducedMotion);
  useMobileRsvpShortcut();

  useEffect(() => {
    document.title = "Brida e Max | 06/12/2026";
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (activeGift) {
      setGiftStatus("");

      if (typeof dialog.showModal === "function" && !dialog.open) {
        dialog.showModal();
      } else if (!dialog.open) {
        dialog.setAttribute("open", "");
      }
    } else if (dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }
  }, [activeGift]);

  const openGiftDialog = (gift: GiftItem) => {
    if (gift.fullyFunded) {
      return;
    }

    setActiveGift(gift);
    setActiveQuantity(1);
  };

  const closeGiftDialog = () => {
    setActiveGift(null);
    setActiveQuantity(1);
  };

  const resolvedGroup = rsvpState.resolvedGroupId ? invitationGroupsById.get(rsvpState.resolvedGroupId) ?? null : null;
  const rsvpStatusMessage =
    rsvpState.status === "searching"
      ? "Localizando seu convite..."
      : rsvpState.status === "resolved"
        ? "Convite localizado. Revise os nomes do seu grupo."
        : rsvpState.status === "ambiguous"
          ? "Encontramos mais de um convite parecido."
          : rsvpState.status === "not-found"
            ? "Não encontramos esse nome."
            : rsvpState.status === "success"
              ? "Confirmação organizada nesta experiência de teste."
              : "";

  const handleRsvpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const searchTerm = String(formData.get("guest-search") || "").trim();

    setFieldError("");

    if (!searchTerm) {
      setFieldError("Informe um nome para localizar o convite.");
      return;
    }

    lookupTokenRef.current += 1;
    const currentLookupToken = lookupTokenRef.current;

    setRsvpState({
      status: "searching",
      searchTerm,
      resolvedGroupId: null,
      ambiguousGroupIds: [],
      selections: {},
      payload: null
    });

    window.setTimeout(() => {
      if (currentLookupToken !== lookupTokenRef.current) {
        return;
      }

      const result = resolveInvitationGroup(searchTerm);

      if (result.state === "resolved") {
        const group = invitationGroupsById.get(result.groupId);

        if (!group) {
          return;
        }

        setRsvpState({
          status: "resolved",
          searchTerm,
          resolvedGroupId: group.id,
          ambiguousGroupIds: [],
          selections: resetSelections(group),
          payload: null
        });
        return;
      }

      if (result.state === "ambiguous") {
        setRsvpState({
          status: "ambiguous",
          searchTerm,
          resolvedGroupId: null,
          ambiguousGroupIds: result.groupIds,
          selections: {},
          payload: null
        });
        return;
      }

      setRsvpState({
        status: "not-found",
        searchTerm,
        resolvedGroupId: null,
        ambiguousGroupIds: [],
        selections: {},
        payload: null
      });
    }, 180);
  };

  const resetRsvpFlow = () => {
    lookupTokenRef.current += 1;
    setFieldError("");
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
    setRsvpState(initialRsvpState);
  };

  const renderGiftProgress = (gift: GiftItem, dialog = false) => {
    if (!gift.fractional) {
      return null;
    }

    const percent = fundingPercent(gift);
    const remaining = remainingParts(gift);

    return (
      <div className={`gift-progress${dialog ? " gift-progress-dialog" : ""}`} aria-label={`${percent}% financiado em ${gift.name}`}>
        <div className="gift-progress-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>
          <strong>{percent}%</strong>
          <span>
            {formatBRL(fundedAmount(gift))} de {formatBRL(gift.totalValue)}
          </span>
        </p>
        <small>
          {remaining} {remaining === 1 ? "cota restante" : "cotas restantes"}
        </small>
      </div>
    );
  };

  const renderRsvpDynamic = () => {
    if (rsvpState.status === "searching") {
      return (
        <section className="rsvp-panel">
          <p className="rsvp-panel-kicker">Localizando</p>
          <p className="rsvp-panel-title">Localizando seu convite...</p>
          <p className="rsvp-panel-copy">
            Estamos validando o nome informado dentro deste conjunto de dados de desenvolvimento.
          </p>
        </section>
      );
    }

    if (rsvpState.status === "resolved" && resolvedGroup) {
      return (
        <section className="rsvp-panel">
          <p className="rsvp-panel-kicker">Convite localizado</p>
          <p className="rsvp-panel-title">Confirme quais convidados do seu convite irão comparecer:</p>
          <p className="rsvp-panel-copy">
            Busca feita por <strong>{rsvpState.searchTerm}</strong>. Desmarque apenas quem não poderá ir.
          </p>
          <fieldset className="guest-selection">
            <legend>Convidados autorizados</legend>
            <div className="guest-option-list">
              {resolvedGroup.guests.map((guest) => (
                <label key={guest} className="guest-option">
                  <input
                    type="checkbox"
                    checked={Boolean(rsvpState.selections[guest])}
                    onChange={(event) =>
                      setRsvpState((current) => ({
                        ...current,
                        selections: {
                          ...current.selections,
                          [guest]: event.target.checked
                        }
                      }))
                    }
                  />
                  <span>{guest}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="rsvp-panel-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() =>
                setRsvpState((current) => ({
                  ...current,
                  status: "success",
                  payload: buildConfirmationPayload(resolvedGroup, current.searchTerm, current.selections)
                }))
              }
            >
              Confirmar presença
            </button>
            <button className="button button-secondary" type="button" onClick={resetRsvpFlow}>
              Buscar outro convite
            </button>
          </div>
        </section>
      );
    }

    if (rsvpState.status === "ambiguous") {
      return (
        <section className="rsvp-panel">
          <p className="rsvp-panel-kicker">Mais de um resultado</p>
          <p className="rsvp-panel-title">Encontramos mais de um convite parecido.</p>
          <p className="rsvp-panel-copy">Selecione o seu grupo para continuar.</p>
          <div className="rsvp-choice-list">
            {rsvpState.ambiguousGroupIds.map((groupId) => {
              const group = invitationGroupsById.get(groupId);

              if (!group) {
                return null;
              }

              return (
                <button
                  key={group.id}
                  className="rsvp-choice-card"
                  type="button"
                  onClick={() =>
                    setRsvpState((current) => ({
                      ...current,
                      status: "resolved",
                      resolvedGroupId: group.id,
                      ambiguousGroupIds: [],
                      selections: resetSelections(group),
                      payload: null
                    }))
                  }
                >
                  <span className="card-kicker">Convite parecido</span>
                  <strong>Grupo de {group.primaryName}</strong>
                  <span>{groupPreview(group)}</span>
                </button>
              );
            })}
          </div>
        </section>
      );
    }

    if (rsvpState.status === "not-found") {
      return (
        <section className="rsvp-panel">
          <p className="rsvp-panel-kicker">Convite não encontrado</p>
          <p className="rsvp-panel-title">Não encontramos esse nome.</p>
          <p className="rsvp-panel-copy">
            Confira a grafia ou fale com a gente pelo e-mail{" "}
            <a href="mailto:casamento@brimax.life">casamento@brimax.life</a>.
          </p>
        </section>
      );
    }

    if (rsvpState.status === "success" && rsvpState.payload) {
      const confirmedGuests = rsvpState.payload.confirmations.filter((guest) => guest.attending);
      const unavailableGuests = rsvpState.payload.confirmations.filter((guest) => !guest.attending);

      return (
        <section className="rsvp-panel rsvp-summary-panel">
          <p className="rsvp-panel-kicker">Confirmação registrada</p>
          <p className="rsvp-panel-title">Confirmação registrada nesta experiência de teste.</p>
          <p className="rsvp-panel-copy">
            Busca feita por <strong>{rsvpState.payload.searchedName}</strong>. A integração final será conectada ao sistema
            de convidados.
          </p>
          <div className="rsvp-summary-grid">
            <div>
              <h3>Confirmados</h3>
              <ul className="rsvp-summary-list">
                {confirmedGuests.length ? (
                  confirmedGuests.map((guest) => <li key={guest.name}>{guest.name}</li>)
                ) : (
                  <li>Nenhum nome foi marcado para comparecer.</li>
                )}
              </ul>
            </div>
            <div>
              <h3>Não selecionados</h3>
              <ul className="rsvp-summary-list">
                {unavailableGuests.length ? (
                  unavailableGuests.map((guest) => <li key={guest.name}>{guest.name}</li>)
                ) : (
                  <li>Todos os nomes do grupo foram confirmados.</li>
                )}
              </ul>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="rsvp-panel">
        <p className="rsvp-panel-kicker">Comece por aqui</p>
        <p className="rsvp-panel-title">Digite um nome do convite para localizar o grupo correto.</p>
        <p className="rsvp-panel-copy">
          Esta etapa usa dados de desenvolvimento inspirados nos nomes já presentes na página e serve para validar a
          experiência antes da integração final.
        </p>
      </section>
    );
  };

  return (
    <>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      <header className="site-header" aria-label="Navegação principal">
        <a className="brand-mark" href="#inicio" aria-label="Ir para o início">
          Brimax
        </a>
        <nav className="primary-nav" aria-label="Seções principais">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
          <a className="nav-cta" href="#confirmar-presenca">
            Confirmar Presença
          </a>
        </nav>
      </header>

      <main id="conteudo">
        <section className="hero shell-section dark-stage" id="inicio" aria-labelledby="inicio-title">
          <div className="hero-media" aria-hidden="true">
            <img
              className="hero-image hero-image-main"
              src="https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20250412_133905.jpg"
              alt=""
            />
            <img
              className="hero-image hero-image-float"
              src="https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20240908_210941.jpg"
              alt=""
            />
          </div>
          <div className="hero-content">
            <p className="eyebrow">São Paulo, 06 de dezembro de 2026</p>
            <h1 id="inicio-title">Brida e Max</h1>
            <p className="hero-copy">Vamos celebrar esse dia ao lado das pessoas que fazem parte da nossa história.</p>
            <p className="hero-note">Cerimônia às 15h · Buffet Tulipas - Unidade Villa Valentim</p>
            <dl className="event-summary">
              <div>
                <dt>Data</dt>
                <dd>06/12/2026</dd>
              </div>
              <div>
                <dt>Horário</dt>
                <dd>15:00</dd>
              </div>
              <div>
                <dt>Local</dt>
                <dd>Buffet Tulipas - Unidade Villa Valentim</dd>
              </div>
            </dl>
            <div className="hero-actions" role="group" aria-label="Ações principais" data-rsvp-action-surface="">
              <a className="button button-primary" href="#confirmar-presenca">
                Confirmar Presença
              </a>
              <a className="button button-secondary" href="#presentes">
                Ver Lista de Presentes
              </a>
            </div>
            <a className="chapter-cue" href="#historia" aria-label="Ir para os capítulos da história">
              <span>Capítulos para deslizar</span>
              <span aria-hidden="true">01 / 05</span>
            </a>
          </div>
        </section>

        <section className="shell-section" id="contagem" aria-labelledby="contagem-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">Faltam</p>
            <h2 id="contagem-title">Para celebrarmos juntos</h2>
            <p>A contagem reforça o dia e o horário da cerimônia: 06/12/2026, às 15:00, em São Paulo.</p>
          </div>
          <p className="countdown-state" aria-live="polite">
            {countdown.isComplete ? "Hoje celebramos esse momento especial." : ""}
          </p>
          <div className={`countdown-grid${countdown.isComplete ? " is-complete" : ""}`}>
            {[
              { label: "dias", value: String(countdown.days).padStart(3, "0") },
              { label: "horas", value: String(countdown.hours).padStart(2, "0") },
              { label: "minutos", value: String(countdown.minutes).padStart(2, "0") },
              { label: "segundos", value: String(countdown.seconds).padStart(2, "0") }
            ].map((item) => (
              <div key={item.label} className="time-card">
                <span>{item.value}</span>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="shell-section carousel-section" id="historia" aria-labelledby="historia-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">Nossa História</p>
            <h2 id="historia-title">Nossa História</h2>
            <p>Antes do grande dia, existe uma história feita de encontros, palco, viagens e escolhas vividas com carinho.</p>
          </div>
          <Carousel
            controlsLabel="Controles do carrossel Nossa História"
            trackAriaLabel="capítulo de Nossa História"
            className="carousel-track story-track"
            itemCount={STORY_ITEMS.length}
            reducedMotion={reducedMotion}
          >
            {STORY_ITEMS.map((item) => (
              <article key={item.chapter} className="memory-card image-led reveal-item">
                <img src={item.image} alt={item.alt} />
                <div className="card-copy">
                  <span className="card-kicker">{item.chapter}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </Carousel>
        </section>

        <section className="shell-section carousel-section warm-band" id="pre-wedding" aria-labelledby="pre-wedding-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">Pré-Wedding</p>
            <h2 id="pre-wedding-title">Pré-Wedding</h2>
            <p>Alguns registros para guardar a atmosfera desse caminho até o casamento.</p>
          </div>
          <Carousel
            controlsLabel="Controles do carrossel Pré-Wedding"
            trackAriaLabel="foto do Pré-Wedding"
            className="carousel-track photo-track"
            itemCount={PRE_WEDDING_ITEMS.length}
            reducedMotion={reducedMotion}
          >
            {PRE_WEDDING_ITEMS.map((item) => (
              <figure key={item.kicker} className="photo-card reveal-item">
                <img src={item.image} alt={item.alt} />
                <figcaption>
                  <span className="card-kicker">{item.kicker}</span>
                  <strong>{item.caption}</strong>
                </figcaption>
              </figure>
            ))}
          </Carousel>
        </section>

        <section className="shell-section" id="local" aria-labelledby="local-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">Local da Cerimônia</p>
            <h2 id="local-title">Buffet Tulipas - Unidade Villa Valentim</h2>
            <p>Rua Valentim Magalhães, 293 - São Paulo - SP</p>
          </div>
          <div className="location-grid">
            <article className="info-panel reveal-item">
              <span className="card-kicker">Cerimônia às 15h</span>
              <h3>Buffet Tulipas - Unidade Villa Valentim</h3>
              <address>Rua Valentim Magalhães, 293 - São Paulo - SP</address>
              <dl className="venue-facts">
                <div>
                  <dt>Data</dt>
                  <dd>06/12/2026</dd>
                </div>
                <div>
                  <dt>Horário</dt>
                  <dd>15:00</dd>
                </div>
              </dl>
              <div className="panel-actions" data-rsvp-action-surface="">
                <a className="button button-primary" href="#confirmar-presenca">
                  Confirmar Presença
                </a>
                <a className="button button-secondary" href={MAP_URL} target="_blank" rel="noreferrer">
                  Ver no mapa
                </a>
              </div>
            </article>
            <a
              className="map-placeholder reveal-item"
              href={MAP_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir direções para Buffet Tulipas - Unidade Villa Valentim no Google Maps"
            >
              <span className="map-marker" aria-hidden="true" />
              <span>Ver no mapa</span>
              <small>Rua Valentim Magalhães, 293</small>
              <strong>Abrir direções</strong>
            </a>
          </div>
        </section>

        <section className="shell-section carousel-section" id="padrinhos" aria-labelledby="padrinhos-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">Padrinhos e Madrinhas</p>
            <h2 id="padrinhos-title">Padrinhos e Madrinhas</h2>
            <p>Pessoas queridas que caminham conosco e terão um lugar especial nesse dia.</p>
          </div>
          <ul className="group-overview reveal-item" aria-label="Grupos representados no carrossel">
            <li>Padrinhos do Max</li>
            <li>Família do Max</li>
            <li>Padrinhos da Brida</li>
            <li>Família da Brida</li>
          </ul>
          <Carousel
            controlsLabel="Controles do carrossel Padrinhos e Madrinhas"
            trackAriaLabel="grupo de padrinhos e madrinhas"
            className="carousel-track people-track"
            itemCount={PEOPLE_GROUPS.length}
            reducedMotion={reducedMotion}
          >
            {PEOPLE_GROUPS.map((group) => (
              <article key={group.title} className={`people-card reveal-item${group.family ? " family-card" : ""}`}>
                <div>
                  <span className="card-kicker">{group.kicker}</span>
                  <h3>{group.title}</h3>
                </div>
                <ul className="name-list">
                  {group.names.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </article>
            ))}
          </Carousel>
        </section>

        <section className="shell-section carousel-section dark-stage" id="fornecedores" aria-labelledby="fornecedores-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">Fornecedores</p>
            <h2 id="fornecedores-title">Fornecedores</h2>
            <p>Profissionais que ajudam a transformar esse dia em uma experiência ainda mais especial.</p>
          </div>
          <Carousel
            controlsLabel="Controles do carrossel Fornecedores"
            trackAriaLabel="fornecedor"
            className="carousel-track vendor-track"
            itemCount={VENDORS.length}
            reducedMotion={reducedMotion}
          >
            {VENDORS.map((vendor) => (
              <article key={vendor.name} className="vendor-card reveal-item">
                <span className="vendor-role">{vendor.role}</span>
                <h3>{vendor.name}</h3>
                <a
                  className="vendor-link"
                  href={vendor.instagram}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Ver Instagram de ${vendor.name}`}
                >
                  Ver Instagram
                </a>
              </article>
            ))}
          </Carousel>
        </section>

        <section className="shell-section carousel-section" id="presentes" aria-labelledby="presentes-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">Lista de Presentes</p>
            <h2 id="presentes-title">Lista de Presentes</h2>
            <p>Se quiser nos presentear, preparamos uma seleção para nossa nova fase.</p>
            <p className="section-note">
              Esta prévia ainda não finaliza compras. O link da lista completa estará disponível em breve.
            </p>
          </div>
          <Carousel
            controlsLabel="Controles do carrossel Lista de Presentes"
            trackAriaLabel="item da lista de presentes"
            className="carousel-track gift-track"
            itemCount={sortedGifts.length}
            reducedMotion={reducedMotion}
          >
            {sortedGifts.map((gift) => (
              <article key={gift.id} className={`gift-card reveal-item${gift.fullyFunded ? " is-funded" : ""}`}>
                <div className={`gift-image-slot gift-image-${gift.image}`} aria-label={`Espaço visual substituível para ${gift.name}`}>
                  <span>{gift.name}</span>
                </div>
                <div className="gift-card-copy">
                  <span className="gift-state">{giftStateLabel(gift)}</span>
                  <h3>{gift.name}</h3>
                  <p>{gift.description}</p>
                  <div className="gift-price">
                    <strong>{formatBRL(gift.totalValue)}</strong>
                    <span>{gift.fractional ? `Cotas de ${formatBRL(gift.partValue ?? 0)}` : "Valor integral"}</span>
                  </div>
                  {renderGiftProgress(gift)}
                  {gift.fullyFunded ? (
                    <span className="gift-action is-disabled" aria-disabled="true">
                      Presente já garantido
                    </span>
                  ) : (
                    <button className="gift-action" type="button" onClick={() => openGiftDialog(gift)}>
                      {gift.fractional ? "Escolher cotas" : "Escolher presente"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </Carousel>

          <dialog
            ref={dialogRef}
            className="gift-dialog"
            aria-labelledby="gift-dialog-title"
            onCancel={(event) => {
              event.preventDefault();
              closeGiftDialog();
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeGiftDialog();
              }
            }}
          >
            {activeGift ? (
              <div className="gift-dialog-panel">
                <div className="gift-dialog-head">
                  <div className={`gift-image-slot gift-image-${activeGift.image}`} aria-label={`Espaço visual substituível para ${activeGift.name}`}>
                    <span>{activeGift.name}</span>
                  </div>
                  <div>
                    <p className="card-kicker">{activeGift.fractional ? "Escolher cotas" : "Escolher presente"}</p>
                    <h3 id="gift-dialog-title">{activeGift.name}</h3>
                    <p>{activeGift.description}</p>
                  </div>
                </div>

                {activeGift.fractional ? (
                  <>
                    <div className="gift-dialog-details">
                      <p>
                        <strong>Cada cota:</strong> {formatBRL(activeGift.partValue ?? 0)}
                      </p>
                      <p>
                        <strong>{remainingParts(activeGift)}</strong>{" "}
                        {remainingParts(activeGift) === 1 ? "cota disponível" : "cotas disponíveis"}
                      </p>
                    </div>
                    <div className="gift-stepper" aria-label="Selecionar quantidade de cotas">
                      <button
                        type="button"
                        aria-label="Diminuir quantidade de cotas"
                        onClick={() => setActiveQuantity((current) => clampGiftQuantity(current - 1, activeGift))}
                      >
                        −
                      </button>
                      <input
                        id="gift-quantity"
                        type="number"
                        min="1"
                        max={remainingParts(activeGift) ?? 1}
                        step="1"
                        inputMode="numeric"
                        value={activeQuantity}
                        onChange={(event) => setActiveQuantity(clampGiftQuantity(event.target.value, activeGift))}
                      />
                      <button
                        type="button"
                        aria-label="Aumentar quantidade de cotas"
                        onClick={() => setActiveQuantity((current) => clampGiftQuantity(current + 1, activeGift))}
                      >
                        +
                      </button>
                    </div>
                    <p className="gift-contribution">
                      <strong>Sua contribuição:</strong> {formatBRL(activeQuantity * (activeGift.partValue ?? 0))}
                    </p>
                    {renderGiftProgress(activeGift, true)}
                  </>
                ) : (
                  <div className="gift-dialog-details">
                    <p>
                      <strong>Valor integral:</strong> {formatBRL(activeGift.totalValue)}
                    </p>
                    <p>Esta escolha será conectada à lista completa quando a integração estiver disponível.</p>
                  </div>
                )}

                <div className="gift-dialog-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() =>
                      setGiftStatus("Obrigado pelo seu interesse! O link para a lista completa estará disponível em breve.")
                    }
                  >
                    Confirmar contribuição
                  </button>
                  <button className="button button-secondary" type="button" onClick={closeGiftDialog}>
                    Cancelar
                  </button>
                </div>
                <p className="gift-status" role="status" aria-live="polite">
                  {giftStatus}
                </p>
              </div>
            ) : null}
          </dialog>
        </section>

        <section className="shell-section rsvp-section" id="confirmar-presenca" aria-labelledby="confirmar-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">Confirmar Presença</p>
            <h2 id="confirmar-title">Confirmação por grupo de convite</h2>
            <p>
              Digite um nome do seu convite para localizarmos o grupo correto. Esta experiência usa dados de
              desenvolvimento e ainda não envia informações para um servidor.
            </p>
          </div>
          <form className="rsvp-form reveal-item" noValidate onSubmit={handleRsvpSubmit} data-rsvp-action-surface="">
            <p className="rsvp-helper">Digite seu nome como está no convite para localizarmos sua família ou grupo.</p>
            <p className="rsvp-dev-note">
              Protótipo com dados de desenvolvimento, pensado para validar a experiência antes da integração final.
            </p>
            <div className="field">
              <label htmlFor="guest-search">Digite seu nome para localizar seu convite</label>
              <input
                ref={searchInputRef}
                id="guest-search"
                name="guest-search"
                type="text"
                autoComplete="name"
                inputMode="text"
                disabled={rsvpState.status === "searching"}
                required
              />
              <small className="field-message">{fieldError}</small>
            </div>
            <div className="rsvp-actions">
              <button className="button button-primary" type="submit" disabled={rsvpState.status === "searching"}>
                Localizar convite
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={resetRsvpFlow}
                disabled={rsvpState.status === "idle" || rsvpState.status === "searching"}
              >
                Buscar outro convite
              </button>
            </div>
            <p className="form-status" role="status" aria-live="polite">
              {rsvpStatusMessage}
            </p>
            <div className="rsvp-dynamic" aria-live="polite">
              {renderRsvpDynamic()}
            </div>
          </form>
        </section>

        <section className="shell-section" id="faq" aria-labelledby="faq-title">
          <div className="section-heading reveal-item">
            <p className="eyebrow">FAQ</p>
            <h2 id="faq-title">Perguntas frequentes</h2>
            <p>Algumas respostas rápidas para facilitar sua visita e deixar esse caminho até o casamento mais leve.</p>
          </div>
          <div className="faq-shell">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="reveal-item">
                <summary>{item.question}</summary>
                <p>
                  {item.answer.includes("casamento@brimax.life") ? (
                    <>
                      {item.answer.split("casamento@brimax.life").map((part, index, parts) => (
                        <span key={`${item.question}-${index}`}>
                          {part}
                          {index < parts.length - 1 ? (
                            <a href="mailto:casamento@brimax.life">casamento@brimax.life</a>
                          ) : null}
                        </span>
                      ))}
                    </>
                  ) : (
                    item.answer
                  )}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-signoff">
          <p className="footer-kicker">Brimax</p>
          <p className="footer-brand">Brida e Max</p>
          <p className="footer-closing">Com carinho, Brida e Max.</p>
        </div>
        <div className="footer-meta">
          <a className="footer-email" href="mailto:casamento@brimax.life">
            casamento@brimax.life
          </a>
          <div className="footer-social" aria-label="Redes sociais e contato">
            <a href="https://www.instagram.com/brimax.life/" target="_blank" rel="noreferrer">
              Instagram
            </a>
            <a href="https://www.youtube.com/@brimaxLife" target="_blank" rel="noreferrer">
              YouTube
            </a>
          </div>
        </div>
      </footer>

      <a className="mobile-rsvp" href="#confirmar-presenca">
        Confirmar Presença
      </a>
    </>
  );
}
