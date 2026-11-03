import { STORES, DEFAULT_STORE } from "./stores.js";

// Merchantprofiel van de winkel. De capabilities beschrijven DEZE server (alleen lezen); bestellen loopt via de
// aparte commerce-MCP, die alleen werkt voor agents die de merchant zelf heeft uitgegeven (tegenlezing).
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
    commerce_mcp: "com.goodnaturevibe/commerce (merchant-issued agents only)",
    selfRegistration: false,
  },
};
