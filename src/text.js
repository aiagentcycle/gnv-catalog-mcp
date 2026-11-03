const NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", nbsp: " ", apos: "'" };
export const TEXT_CAP = 20_000;

export function character(point) {
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return " ";
  return String.fromCodePoint(point);
}

export function decodeText(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => character(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => character(Number(num)))
    .replace(/&([a-z]+);/gi, (all, name) => NAMED[name.toLowerCase()] ?? " ");
}

function safeHttps(href) {
  const compact = String(href).replace(/[\s\u0000-\u001f]+/g, "");
  if (!/^https:\/\//i.test(compact)) return null;
  try {
    const url = new URL(compact);
    if (url.username || url.password || url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function anchorsToText(html) {
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, label) => {
    const quoted = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs) || /\bhref\s*=\s*'([^']*)'/i.exec(attrs);
    const href = quoted ? safeHttps(quoted[1]) : null;
    const inner = label.replace(/<[^>]*>/g, " ");
    return href ? ` ${inner} (${href}) ` : ` ${inner} `;
  });
}

function dropActive(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/<[^>]*$/g, " ");
}

export function htmlToText(html) {
  let cleaned = anchorsToText(dropActive(html ?? ""));
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ");
  cleaned = decodeText(stripTags(cleaned));
  cleaned = stripTags(anchorsToText(dropActive(cleaned))).replace(/</g, " ");
  return cleaned
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function elementStart(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return -1;
  const open = html.lastIndexOf("<", at);
  return open >= 0 ? open : at;
}

export function extractText(html) {
  const post = elementStart(html, 'class="post-description');
  const product = elementStart(html, 'id="description"');
  const main = elementStart(html, 'class="column main"');
  const start = post >= 0 ? post : product >= 0 ? product : main >= 0 ? main : 0;
  const ends = ["Jouw keuze voor cookies", "<footer", 'id="related"', "column sidebar"]
    .map((needle) => html.indexOf(needle, start + 20))
    .filter((index) => index > start);
  const end = ends.length ? Math.min(...ends) : Math.min(html.length, start + 100_000);
  const text = htmlToText(html.slice(start, end));
  return { text: text.slice(0, TEXT_CAP), truncated: text.length > TEXT_CAP };
}
