import { NextRequest, NextResponse } from "next/server";

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; }
  catch { return ""; }
}

function hexToRgb(hex: string): [number, number, number] | null {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length === 8) hex = hex.slice(0, 6);
  if (hex.length !== 6) return null;
  const n = parseInt(hex, 16);
  if (isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function isGenericColor(hex: string): boolean {
  const generics = new Set([
    "#000000", "#111111", "#222222", "#333333", "#444444", "#555555",
    "#666666", "#777777", "#888888", "#999999", "#aaaaaa", "#bbbbbb",
    "#cccccc", "#dddddd", "#eeeeee", "#f5f5f5", "#fafafa", "#ffffff",
    "#f0f0f0", "#e0e0e0", "#d0d0d0", "#c0c0c0", "#b0b0b0", "#a0a0a0",
    "#808080", "#f8f8f8", "#f9f9f9", "#fbfbfb", "#fcfcfc", "#fdfdfd",
  ]);
  return generics.has(hex.toLowerCase());
}

function isNearGray(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) < 20;
}

interface ColorEntry {
  hex: string;
  priority: number;
  count: number;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function deduplicateColors(entries: ColorEntry[]): ColorEntry[] {
  const result: ColorEntry[] = [];
  for (const entry of entries) {
    const rgb = hexToRgb(entry.hex);
    if (!rgb) continue;
    const existing = result.find((r) => {
      const rRgb = hexToRgb(r.hex);
      return rRgb && colorDistance(rgb, rRgb) < 35;
    });
    if (existing) {
      existing.count += entry.count;
      if (entry.priority < existing.priority) {
        existing.priority = entry.priority;
        existing.hex = entry.hex;
      }
    } else {
      result.push({ ...entry });
    }
  }
  return result;
}

function normalizeHex(hex: string): string {
  hex = hex.toLowerCase();
  if (hex.length === 4) hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  return hex;
}

// Extract ALL logo images from header area of the HTML
function extractLogoUrls(html: string, baseUrl: string): string[] {
  const logos: string[] = [];
  const seen = new Set<string>();

  function addLogo(src: string) {
    try {
      const resolved = new URL(src, baseUrl).href;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        logos.push(resolved);
      }
    } catch {
      if (!seen.has(src)) {
        seen.add(src);
        logos.push(src);
      }
    }
  }

  // Look for logo in <header>, <nav>, or top-level areas
  const headerMatch = html.match(/<header[^>]*>([\s\S]*?)<\/header>/i);
  const navMatch = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  const searchArea = (headerMatch?.[1] || "") + (navMatch?.[1] || "");
  const area = searchArea || html.slice(0, 80000);

  // 1. img tags with "logo" in class, id, alt, or src
  const logoImgPatterns = [
    /<img[^>]*(?:class|id|alt|src)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/gi,
    /<img[^>]*src=["']([^"']+)["'][^>]*(?:class|id|alt)=["'][^"']*logo[^"']*["']/gi,
  ];
  for (const pattern of logoImgPatterns) {
    let m;
    while ((m = pattern.exec(area)) !== null) {
      if (m[1]) addLogo(m[1]);
    }
  }

  // 2. All images in header/nav area (often the logo is the first img)
  if (searchArea) {
    const allImgs = searchArea.matchAll(/<img[^>]*src=["']([^"']+)["']/gi);
    for (const m of allImgs) {
      if (m[1] && !m[1].includes("icon") && !m[1].includes("avatar") && !m[1].includes("pixel") && !m[1].includes("tracking")) {
        addLogo(m[1]);
      }
    }
  }

  // 3. og:image as another option
  const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch?.[1]) addLogo(ogMatch[1]);

  // 4. apple-touch-icon (often a clean logomark)
  const touchMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i);
  if (touchMatch?.[1]) addLogo(touchMatch[1]);

  return logos;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ colors: [], error: "Missing url parameter" }, { status: 400 });
  }

  const normalized = normalizeUrl(url);
  const domain = extractDomain(normalized);
  if (!domain) {
    return NextResponse.json({ colors: [], error: "Invalid URL" }, { status: 400 });
  }

  let html: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(normalized, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      return NextResponse.json({ colors: [], error: "URL did not return HTML content" }, { status: 400 });
    }

    html = await res.text();
    if (html.length > 300_000) html = html.slice(0, 300_000);
  } catch (e: unknown) {
    const message = e instanceof Error && e.name === "AbortError"
      ? "Website took too long to respond"
      : "Could not reach website";
    return NextResponse.json({ colors: [], error: message }, { status: 502 });
  }

  const colorEntries: ColorEntry[] = [];
  let match;

  // ─── Priority 1: Button / CTA colors (strongest brand signal) ───
  // Look for background-color on elements with button/btn/cta in class or tag
  const buttonPatterns = [
    // Inline styles on button-like elements
    /(?:<button|<a[^>]*class=["'][^"']*(?:btn|button|cta|primary)[^"']*["'])[^>]*style=["'][^"']*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
    // CSS classes with btn/button/cta in name
    /\.(?:btn|button|cta|primary-btn|submit|book|schedule|contact)[^{]*\{[^}]*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
    // background-color properties near button/btn keywords
    /(?:btn|button|cta|submit|primary)[a-z0-9_-]*[^{]{0,60}\{[^}]*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
  ];
  for (const pattern of buttonPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      colorEntries.push({ hex: normalizeHex(match[1]), priority: 1, count: 15 });
    }
  }

  // ─── Priority 1: Meta theme-color (intentionally set brand color) ───
  const themeColorMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
  if (themeColorMatch?.[1]?.startsWith("#")) {
    colorEntries.push({ hex: normalizeHex(themeColorMatch[1]), priority: 1, count: 12 });
  }
  const tileColorMatch = html.match(/<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i);
  if (tileColorMatch?.[1]?.startsWith("#")) {
    colorEntries.push({ hex: normalizeHex(tileColorMatch[1]), priority: 1, count: 12 });
  }

  // ─── Priority 2: CSS custom properties with brand/primary/accent names ───
  const brandVarRegex = /--(?:brand|primary|secondary|accent|main|theme|color-primary|color-accent|site)[a-z0-9-]*\s*:\s*(#[0-9a-fA-F]{3,8})/gi;
  while ((match = brandVarRegex.exec(html)) !== null) {
    colorEntries.push({ hex: normalizeHex(match[1]), priority: 2, count: 8 });
  }

  // ─── Priority 3: Link/anchor colors (often brand primary) ───
  const linkPatterns = [
    /\ba\s*[{,][^}]*color\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
    /\.(?:link|nav-link|menu-link)[^{]*\{[^}]*color\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
  ];
  for (const pattern of linkPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      colorEntries.push({ hex: normalizeHex(match[1]), priority: 3, count: 4 });
    }
  }

  // ─── Priority 4: Header/nav background colors ───
  const headerPatterns = [
    /(?:header|nav|navbar|top-bar|site-header)[^{]*\{[^}]*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
  ];
  for (const pattern of headerPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      colorEntries.push({ hex: normalizeHex(match[1]), priority: 4, count: 3 });
    }
  }

  // ─── Priority 5: All hex colors by frequency (lowest priority) ───
  const allHexRegex = /#[0-9a-fA-F]{3,8}\b/g;
  const hexFrequency = new Map<string, number>();
  while ((match = allHexRegex.exec(html)) !== null) {
    const hex = normalizeHex(match[0]);
    hexFrequency.set(hex, (hexFrequency.get(hex) || 0) + 1);
  }
  for (const [hex, count] of hexFrequency) {
    colorEntries.push({ hex, priority: 5, count });
  }

  // rgb() values
  const rgbRegex = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;
  while ((match = rgbRegex.exec(html)) !== null) {
    const hex = rgbToHex(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    colorEntries.push({ hex: hex.toLowerCase(), priority: 5, count: 1 });
  }

  // ─── Filter out non-brand colors ───
  const filtered = colorEntries.filter((entry) => {
    const rgb = hexToRgb(entry.hex);
    if (!rgb) return false;
    const lum = luminance(...rgb);
    if (lum > 0.85) return false;
    if (lum < 0.05) return false;
    if (isNearGray(...rgb)) return false;
    if (isGenericColor(entry.hex)) return false;
    return true;
  });

  const deduped = deduplicateColors(filtered);
  deduped.sort((a, b) => a.priority - b.priority || b.count - a.count);
  const topColors = deduped.slice(0, 2).map((e) => e.hex);

  // Extract logo URLs from header (multiple: logomark, wordmark, etc.)
  const logoUrls = extractLogoUrls(html, normalized);

  return NextResponse.json({ colors: topColors, domain, logoUrls });
}
