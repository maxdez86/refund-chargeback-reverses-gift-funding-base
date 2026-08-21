import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import type { AdminDashboardSnapshot } from "@/lib/admin-dashboard-types";

/**
 * The one seam between the dashboard UI and its data.
 *
 * Today the panel runs on demonstration fixtures, because the API exposes no admin
 * list endpoints yet — only `GET /admin/session`, `DELETE /admin/guest-messages/{id}`
 * and the WhatsApp RSVP routes. When those endpoints land, add a second implementation
 * of `AdminDashboardSource` that fetches and maps them onto `AdminDashboardSnapshot`,
 * and pass it to `useAdminDashboard`. No screen or component changes.
 */
export type AdminDashboardSource = {
  /** Whether the data is demonstration-only; drives the banner that says so. */
  readonly demo: boolean;
  load(): Promise<AdminDashboardSnapshot>;
};

export const fixtureDashboardSource: AdminDashboardSource = {
  demo: true,
  load: async () => createFixtureDashboardSnapshot()
};
