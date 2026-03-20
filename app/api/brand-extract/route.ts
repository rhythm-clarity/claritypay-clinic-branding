import { NextRequest, NextResponse } from "next/server";

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function hexToRgb(hex: string): [number, number, number] | null {
  hex = hex.replace("#", "");
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length === 8) hex = hex.slice(0, 6); // strip alpha
  if (hex.length !== 6) return null;
  const n = parseInt(hex, 16);
  if (isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
  );
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
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 20;
}

interface ColorEntry {
  hex: string;
  priority: number; // lower = higher priority
  count: number;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(
    Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2)
  );
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
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      return NextResponse.json(
        { colors: [], error: "URL did not return HTML content" },
        { status: 400 }
      );
    }

    html = await res.text();
    // Limit to first 300KB to avoid memory issues
    if (html.length > 300_000) html = html.slice(0, 300_000);
  } catch (e: unknown) {
    const message = e instanceof Error && e.name === "AbortError"
      ? "Website took too long to respond"
      : "Could not reach website";
    return NextResponse.json({ colors: [], error: message }, { status: 502 });
  }

  const colorEntries: ColorEntry[] = [];

  // Priority 1: Meta theme-color
  const themeColorMatch = html.match(
    /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i
  );
  if (themeColorMatch) {
    const hex = themeColorMatch[1].trim();
    if (hex.startsWith("#")) {
      colorEntries.push({ hex: hex.toLowerCase(), priority: 1, count: 10 });
    }
  }

  // Priority 1: msapplication-TileColor
  const tileColorMatch = html.match(
    /<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i
  );
  if (tileColorMatch) {
    const hex = tileColorMatch[1].trim();
    if (hex.startsWith("#")) {
      colorEntries.push({ hex: hex.toLowerCase(), priority: 1, count: 10 });
    }
  }

  // Priority 2: CSS custom properties with brand/primary/secondary/accent in name
  const brandVarRegex =
    /--(?:brand|primary|secondary|accent|main|theme)[a-z0-9-]*\s*:\s*(#[0-9a-fA-F]{3,8})/gi;
  let match;
  while ((match = brandVarRegex.exec(html)) !== null) {
    colorEntries.push({ hex: match[1].toLowerCase(), priority: 2, count: 5 });
  }

  // Priority 3: Button/CTA background colors
  const buttonBgRegex =
    /(?:btn|button|cta)[^{]*\{[^}]*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/gi;
  while ((match = buttonBgRegex.exec(html)) !== null) {
    colorEntries.push({ hex: match[1].toLowerCase(), priority: 3, count: 3 });
  }

  // Priority 4: Link colors
  const linkColorRegex = /\ba\s*\{[^}]*color\s*:\s*(#[0-9a-fA-F]{3,8})/gi;
  while ((match = linkColorRegex.exec(html)) !== null) {
    colorEntries.push({ hex: match[1].toLowerCase(), priority: 4, count: 2 });
  }

  // Priority 5: All hex colors in the HTML (frequency-based)
  const allHexRegex = /#[0-9a-fA-F]{3,8}\b/g;
  const hexFrequency = new Map<string, number>();
  while ((match = allHexRegex.exec(html)) !== null) {
    let hex = match[0].toLowerCase();
    // Normalize 3-char hex to 6-char
    if (hex.length === 4) {
      hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    hexFrequency.set(hex, (hexFrequency.get(hex) || 0) + 1);
  }

  for (const [hex, count] of hexFrequency) {
    colorEntries.push({ hex, priority: 5, count });
  }

  // Priority 5: rgb() values
  const rgbRegex = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;
  while ((match = rgbRegex.exec(html)) !== null) {
    const hex = rgbToHex(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    colorEntries.push({ hex: hex.toLowerCase(), priority: 5, count: 1 });
  }

  // Filter out non-brand colors
  const filtered = colorEntries.filter((entry) => {
    const rgb = hexToRgb(entry.hex);
    if (!rgb) return false;
    const lum = luminance(...rgb);
    if (lum > 0.85) return false; // near-white
    if (lum < 0.05) return false; // near-black
    if (isNearGray(...rgb)) return false;
    if (isGenericColor(entry.hex)) return false;
    return true;
  });

  // Deduplicate similar colors
  const deduped = deduplicateColors(filtered);

  // Sort by priority (lower first), then by count (higher first)
  deduped.sort((a, b) => a.priority - b.priority || b.count - a.count);

  const topColors = deduped.slice(0, 2).map((e) => e.hex);

  return NextResponse.json({ colors: topColors, domain });
}
