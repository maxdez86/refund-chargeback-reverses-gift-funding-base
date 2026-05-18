export const CONTACT_EMAIL =
  (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ?? "casamento@brimax.life";

export const CONTACT_EMAIL_MAILTO = `mailto:${CONTACT_EMAIL}`;
