export function FaqSection() {
  return (
    <section className="panel stack">
      <header>
        <h2 className="section-title">Operational Notes</h2>
      </header>
      <ul className="meta-list">
        <li>All guest data changes go through Lambda handlers.</li>
        <li>Webhook events are recorded with idempotency keys before side effects.</li>
        <li>Admin exports remain separate from guest-facing flows.</li>
      </ul>
    </section>
  );
}
