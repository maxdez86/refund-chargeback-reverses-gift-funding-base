export function RegistrySection() {
  return (
    <section className="panel stack">
      <header>
        <h2 className="section-title">Digital Registry</h2>
        <p className="muted">
          Registry contributions are routed through Stripe Checkout, while the
          application tracks the contribution lifecycle separately from payment
          data.
        </p>
      </header>
      <ul className="meta-list">
        <li>Secure redirect to Stripe Checkout</li>
        <li>Contribution state tracked through webhook idempotency</li>
        <li>No cardholder data stored in Brimax infrastructure</li>
      </ul>
    </section>
  );
}
