const GOOGLE_IDENTITY_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const scriptLoads = new WeakMap<Document, Promise<GoogleAccountsId>>();

export function loadGoogleIdentityServices(documentObject: Document = document) {
  const loaded = window.google?.accounts.id;
  if (loaded) return Promise.resolve(loaded);

  const pending = scriptLoads.get(documentObject);
  if (pending) return pending;

  const promise = new Promise<GoogleAccountsId>((resolve, reject) => {
    const existing = documentObject.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`
    );
    const script = existing ?? documentObject.createElement("script");

    const failLoad = (message: string) => {
      scriptLoads.delete(documentObject);
      script.remove();
      reject(new Error(message));
    };

    const handleLoad = () => {
      const googleId = window.google?.accounts.id;
      if (googleId) resolve(googleId);
      else failLoad("Google Identity Services não ficou disponível.");
    };
    const handleError = () => {
      failLoad("Não foi possível carregar o Google Identity Services.");
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      documentObject.head.appendChild(script);
    }
  });

  scriptLoads.set(documentObject, promise);
  return promise;
}

export function disableGoogleAutoSelect() {
  window.google?.accounts.id.disableAutoSelect();
}
