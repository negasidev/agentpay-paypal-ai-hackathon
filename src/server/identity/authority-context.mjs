// A validated session token must reach only server-side adapters, never an
// actor JSON response, URL, browser state or a persisted commerce record.
export const canonicalAuthorityToken=Symbol('canonical-authority-token');
