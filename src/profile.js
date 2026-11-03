import { STORES, DEFAULT_STORE } from "./stores.js";

// Merchant profile for this public read-only server. Its capabilities describe this server only.
export const merchantProfile = {
  name: "Good Nature Vibe",
  website: "https://goodnaturevibe.com",
  stores: [...STORES],
  defaultStore: DEFAULT_STORE,
  currency: "EUR",
  capabilities: {
    catalog: "live",
    knowledge: "live",
    checkout: "not-on-this-server",
    selfRegistration: false,
  },
};
