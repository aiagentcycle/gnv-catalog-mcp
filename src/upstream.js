import { CatalogError } from "./errors.js";

const TIMEOUT_MS = 8_000;

export async function readUpstream(response, max) {
  const reader = response.body?.getReader?.bind(response.body);
  if (reader) {
    const stream = reader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await stream.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await stream.cancel();
        throw new CatalogError("response_too_large", "upstream-antwoord is te groot", 502);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const text = await response.text();
  if (text.length > max) throw new CatalogError("response_too_large", "upstream-antwoord is te groot", 502);
  return text;
}

// Geen redirects volgen, harde timeout, begrensde body.
export async function fetchUpstream(fetchImpl, url, options, max) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await readUpstream(response, max);
    return { response, text };
  } catch (error) {
    throw upstreamError(error);
  }
}

// Every way the shop can fail to answer becomes a coded error for the client, never a bare crash:
// a timeout (also while the body is still coming in) or a network failure such as a refused or reset connection.
function upstreamError(error) {
  if (error instanceof CatalogError) return error;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return new CatalogError("upstream_timeout", "upstream gaf geen antwoord", 504);
  }
  console.error(`upstream_failed ${error?.cause?.code ?? error?.code ?? error?.name ?? "unknown"}`);
  return new CatalogError("upstream_unavailable", "upstream is niet bereikbaar", 502);
}
