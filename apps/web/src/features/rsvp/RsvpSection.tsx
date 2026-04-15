import { FormEvent, useState } from "react";
import type { RsvpSubmissionRequest } from "@brimax/contracts";
import { submitRsvp } from "../../lib/api";

const initialForm: RsvpSubmissionRequest = {
  invitationCode: "",
  householdId: "",
  submittedBy: "",
  guestResponses: [{ guestId: "primary-guest", status: "pending" }],
  attendingGuestCount: 0
};

export function RsvpSection() {
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const response = await submitRsvp(form);
      setMessage(`RSVP saved for ${response.householdId} at ${response.updatedAt}.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to submit RSVP.";
      setMessage(errorMessage);
    }
  }

  return (
    <section className="panel stack">
      <header>
        <h2 className="section-title">RSVP</h2>
        <p className="muted">
          The frontend only exchanges stable contracts with the API. DynamoDB
          item layout remains an internal backend concern.
        </p>
      </header>
      <form className="stack" onSubmit={handleSubmit}>
        <label className="field">
          Invitation code
          <input
            value={form.invitationCode}
            onChange={(event) =>
              setForm((current) => ({ ...current, invitationCode: event.target.value }))
            }
            placeholder="ABCD1234"
          />
        </label>
        <label className="field">
          Household ID
          <input
            value={form.householdId}
            onChange={(event) =>
              setForm((current) => ({ ...current, householdId: event.target.value }))
            }
            placeholder="household-001"
          />
        </label>
        <label className="field">
          Submitted by
          <input
            value={form.submittedBy}
            onChange={(event) =>
              setForm((current) => ({ ...current, submittedBy: event.target.value }))
            }
            placeholder="Max"
          />
        </label>
        <button className="button" type="submit">
          Submit RSVP
        </button>
      </form>
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
