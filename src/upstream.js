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
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new CatalogError("upstream_timeout", "upstream gaf geen antwoord", 504);
    }
    throw error;
  }
  const text = await readUpstream(response, max);
  return { response, text };
}
