"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Download,
  Palette,
  Check,
  Loader2,
  AlertCircle,
  Search,
  Copy,
  FileText,
  Phone,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type AppState = "idle" | "loading" | "results" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractDomain(input: string): string {
  let cleaned = input.trim();
  if (!/^https?:\/\//i.test(cleaned)) cleaned = "https://" + cleaned;
  try {
    return new URL(cleaned).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function fullUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

function prettyName(domain: string): string {
  return (
    domain
      .replace(/\.(com|org|net|health|med|io|co|us|ca)$/i, "")
      .split(".")
      .pop()
      ?.replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) || domain
  );
}

// ─── Canvas Logo Processor ────────────────────────────────────────────────────
function processLogoOnCanvas(
  imgSrc: string
): Promise<{ blobUrl: string; logoColors: string[]; wasUpscaled: boolean; originalWidth: number; finalWidth: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const MIN_WIDTH = 200; // HD: ensure at least 200px wide
      const padding = 4;
      const radius = 4;

      const originalWidth = img.naturalWidth;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const wasUpscaled = w < MIN_WIDTH;
      if (w < MIN_WIDTH) {
        const scale = MIN_WIDTH / w;
        w = MIN_WIDTH;
        h = Math.round(h * scale);
      }

      const cw = w + padding * 2;
      const ch = h + padding * 2;
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d")!;

      // White bg with rounded corners
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.roundRect(0, 0, cw, ch, radius);
      ctx.fill();
      ctx.drawImage(img, padding, padding, w, h);

      // Detect white logo
      const imageData = ctx.getImageData(padding, padding, w, h);
      const px = imageData.data;
      let whiteCount = 0;
      let totalSampled = 0;
      for (let i = 0; i < px.length; i += 40) {
        const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
        if (a < 50) continue;
        totalSampled++;
        if (r > 230 && g > 230 && b > 230) whiteCount++;
      }

      if (totalSampled > 0 && whiteCount / totalSampled > 0.8) {
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.roundRect(0, 0, cw, ch, radius);
        ctx.fill();
        ctx.filter = "invert(1)";
        ctx.drawImage(img, padding, padding, w, h);
        ctx.filter = "none";
      }

      // Extract logo colors
      const fd = ctx.getImageData(padding, padding, w, h).data;
      const colorMap = new Map<string, number>();
      for (let i = 0; i < fd.length; i += 40) {
        const r = fd[i], g = fd[i + 1], b = fd[i + 2], a = fd[i + 3];
        if (a < 128) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max - min < 25) continue;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (lum > 0.85 || lum < 0.08) continue;
        const qr = Math.round(r / 16) * 16;
        const qg = Math.round(g / 16) * 16;
        const qb = Math.round(b / 16) * 16;
        const hex = "#" + [qr, qg, qb].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("");
        colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
      }

      const logoColors = [...colorMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([hex]) => hex);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Canvas export failed"));
          resolve({ blobUrl: URL.createObjectURL(blob), logoColors, wasUpscaled, originalWidth, finalWidth: w });
        },
        "image/png",
        1
      );
    };
    img.onerror = () => reject(new Error("Failed to load logo image"));
    img.src = imgSrc;
  });
}

// ─── Billing Portal Preview ──────────────────────────────────────────────────
function BillingPortalPreview({
  brandColor,
  logoUrl,
  clinicName,
  label,
  isSelected,
  onSelect,
}: {
  brandColor: string;
  logoUrl: string | null;
  clinicName: string;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.div
      onClick={onSelect}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      style={{
        cursor: "pointer",
        borderRadius: 20,
        border: isSelected ? `3px solid ${brandColor}` : "3px solid transparent",
        boxShadow: isSelected
          ? `0 8px 32px ${brandColor}22, 0 0 0 1px ${brandColor}33`
          : "var(--elevation-2)",
        overflow: "hidden",
        background: "#fff",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
    >
      {/* Label bar */}
      <div
        style={{
          padding: "10px 16px",
          background: isSelected ? brandColor : "#f3f4f6",
          color: isSelected ? "#fff" : "#6b7280",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          display: "flex",
          alignItems: "center",
          gap: 6,
          transition: "background 0.2s, color 0.2s",
        }}
      >
        {isSelected && <Check size={12} strokeWidth={3} />}
        {label}
      </div>

      {/* Phone mockup */}
      <div
        style={{
          width: 280,
          margin: "0 auto",
          background: "#f9fafb",
          fontFamily: "var(--font-body)",
        }}
      >
        {/* Logo bar */}
        <div
          style={{
            padding: "16px 16px 12px",
            display: "flex",
            justifyContent: "center",
            background: "#fff",
          }}
        >
          {logoUrl ? (
            <img src={logoUrl} alt="" style={{ height: 30, objectFit: "contain" }} />
          ) : (
            <div style={{ height: 30, width: 100, background: "#e5e7eb", borderRadius: 4 }} />
          )}
        </div>

        {/* Hero header */}
        <div style={{ background: brandColor, padding: "22px 20px 24px", color: "#fff" }}>
          <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 4, fontWeight: 400 }}>
            Hi Samantha,
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, fontFamily: "var(--font-display)" }}>
            A new medical bill is ready for payment
          </div>
        </div>

        {/* Bill card */}
        <div style={{ padding: "0 16px", marginTop: -10, position: "relative" }}>
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
              overflow: "hidden",
            }}
          >
            {/* Card header */}
            <div
              style={{
                padding: "16px 16px 12px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                borderBottom: "1px solid #f0f0f0",
              }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="" style={{ height: 24, objectFit: "contain", marginBottom: 2 }} />
              ) : (
                <div style={{ height: 24, width: 80, background: "#e5e7eb", borderRadius: 3 }} />
              )}
              <div style={{ fontWeight: 700, fontSize: 13, color: "#1f2937", fontFamily: "var(--font-display)" }}>
                {clinicName}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>Dr. Lavanya Krishnan MD</div>
            </div>

            {/* Amount */}
            <div style={{ padding: "16px 16px 18px", textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Total Amount Due
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#111827", letterSpacing: "-0.02em", fontFamily: "var(--font-display)" }}>
                $895.00
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "#9ca3af",
                  marginTop: 6,
                  background: "#f3f4f6",
                  display: "inline-block",
                  padding: "4px 10px",
                  borderRadius: 20,
                  fontWeight: 500,
                }}
              >
                Due September 25, 2025
              </div>

              {/* Pay now button */}
              <div
                style={{
                  marginTop: 16,
                  background: brandColor,
                  color: "#fff",
                  borderRadius: 10,
                  padding: "12px 0",
                  fontWeight: 700,
                  fontSize: 14,
                  fontFamily: "var(--font-display)",
                }}
              >
                Pay now
              </div>
            </div>
          </div>
        </div>

        {/* Zigzag */}
        <div
          style={{
            height: 12,
            margin: "4px 16px 0",
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='16' height='8' viewBox='0 0 16 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 8 L8 0 L16 8' fill='none' stroke='%23e5e7eb' stroke-width='1'/%3E%3C/svg%3E")`,
            backgroundRepeat: "repeat-x",
            backgroundSize: "16px 8px",
            backgroundPosition: "bottom",
            opacity: 0.6,
          }}
        />

        {/* View Statement */}
        <div style={{ padding: "12px 16px", textAlign: "center" }}>
          <span
            style={{
              fontSize: 12,
              color: brandColor,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              borderBottom: `2px solid ${brandColor}`,
              paddingBottom: 2,
            }}
          >
            <FileText size={11} />
            View Statement
          </span>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 16px 10px",
            textAlign: "center",
            borderTop: "1px solid #f0f0f0",
            background: "#f9fafb",
          }}
        >
          <div style={{ fontSize: 10, color: "#9ca3af", lineHeight: 1.6 }}>
            459 Geary St #400,<br />San Francisco, CA 94102
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#9ca3af",
              marginTop: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Phone size={9} /> (415) 329 5100
          </div>
        </div>

        {/* Powered by */}
        <div
          style={{
            padding: "10px 16px 14px",
            textAlign: "center",
            fontSize: 10,
            color: "#b0b8c4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
          }}
        >
          Powered by
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "#1f2937", fontSize: 12 }}>
            Clarity
          </span>
          <span style={{ fontWeight: 400, fontSize: 8, color: "#9ca3af", marginLeft: -3 }}>RCM</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BrandKitPage() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<AppState>("idle");
  const [logoOptions, setLogoOptions] = useState<{ src: string; blobUrl: string | null; label: string; wasUpscaled: boolean; originalWidth: number; finalWidth: number }[]>([]);
  const [selectedLogoIndex, setSelectedLogoIndex] = useState(0);
  const [colors, setColors] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Current selected logo
  const selectedLogo = logoOptions[selectedLogoIndex] || null;

  useEffect(() => {
    return () => {
      logoOptions.forEach((opt) => { if (opt.blobUrl) URL.revokeObjectURL(opt.blobUrl); });
    };
  }, [logoOptions]);

  const handleExtract = useCallback(async () => {
    const d = extractDomain(url);
    if (!d) {
      setError("Please enter a valid website URL");
      setState("error");
      return;
    }
    setDomain(d);
    setState("loading");
    setError(null);
    setColors([]);
    setSelectedColor(null);
    logoOptions.forEach((opt) => { if (opt.blobUrl) URL.revokeObjectURL(opt.blobUrl); });
    setLogoOptions([]);
    setSelectedLogoIndex(0);

    try {
      // Fetch colors + server-extracted logo URLs from our API
      const apiRes = await fetch(`/api/brand-extract?url=${encodeURIComponent(fullUrl(url))}`);
      const apiData = await apiRes.json();
      if (!apiRes.ok) throw new Error(apiData.error || "Extraction failed");

      const serverColors: string[] = apiData.colors || [];
      const serverLogoUrls: string[] = apiData.logoUrls || [];

      // Collect all logo candidates
      const logoCandidates: { src: string; label: string }[] = [];

      // 1. Clearbit (clean logomark, usually just the icon)
      try {
        const clearbitUrl = `https://logo.clearbit.com/${d}?size=800&format=png`;
        const clearbitRes = await fetch(clearbitUrl);
        if (clearbitRes.ok) logoCandidates.push({ src: clearbitUrl, label: "Logomark (Clearbit)" });
      } catch { /* skip */ }

      // 2. Server-extracted from website header (full wordmark + logo usually)
      for (let i = 0; i < Math.min(serverLogoUrls.length, 4); i++) {
        const u = serverLogoUrls[i];
        // Try to label intelligently
        const isIcon = /icon|favicon|apple-touch/i.test(u);
        const isSvg = /\.svg/i.test(u);
        const label = isIcon
          ? "Icon"
          : i === 0
            ? `Full Logo (Website Header)${isSvg ? " — SVG" : ""}`
            : `Logo Option ${i + 1}${isSvg ? " — SVG" : ""}`;
        logoCandidates.push({ src: u, label });
      }

      // 3. Google Favicon fallback
      if (logoCandidates.length === 0) {
        logoCandidates.push({ src: `https://www.google.com/s2/favicons?domain=${d}&sz=128`, label: "Favicon" });
      }

      // Process each logo on canvas (white bg, padded, rounded, upscale to 200px min)
      const processedLogos = await Promise.all(
        logoCandidates.map(async (candidate) => {
          try {
            const processed = await processLogoOnCanvas(candidate.src);
            return { src: candidate.src, blobUrl: processed.blobUrl, label: candidate.label, logoColors: processed.logoColors, wasUpscaled: processed.wasUpscaled, originalWidth: processed.originalWidth, finalWidth: processed.finalWidth };
          } catch {
            return { src: candidate.src, blobUrl: null, label: candidate.label, logoColors: [] as string[], wasUpscaled: false, originalWidth: 0, finalWidth: 0 };
          }
        })
      );

      setLogoOptions(processedLogos.map((p) => ({ src: p.src, blobUrl: p.blobUrl, label: p.label, wasUpscaled: p.wasUpscaled, originalWidth: p.originalWidth, finalWidth: p.finalWidth })));
      setSelectedLogoIndex(0);

      // Merge colors: server colors first, then logo-extracted colors
      const merged: string[] = [...serverColors];
      for (const pl of processedLogos) {
        for (const lc of pl.logoColors) {
          if (merged.length < 2 && !merged.some((m) => m.toLowerCase() === lc.toLowerCase())) {
            merged.push(lc);
          }
        }
      }
      const finalColors = merged.slice(0, 2);
      setColors(finalColors);
      if (finalColors.length > 0) setSelectedColor(finalColors[0]);

      if (processedLogos.length === 0 && finalColors.length === 0) {
        setError("Could not extract logo or brand colors from this website");
        setState("error");
      } else {
        setState("results");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setState("error");
    }
  }, [url, logoOptions]);

  const downloadLogo = useCallback(async () => {
    if (!selectedLogo) return;
    const href = selectedLogo.blobUrl || selectedLogo.src;

    if (selectedLogo.blobUrl) {
      const a = document.createElement("a");
      a.href = selectedLogo.blobUrl;
      a.download = `${domain || "clinic"}-logo.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    try {
      const res = await fetch(href);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${domain || "clinic"}-logo.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(href, "_blank");
    }
  }, [selectedLogo, domain]);

  const copyHex = useCallback((hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopied(hex);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-content)" }}>
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header
        style={{
          background: "#fff",
          borderBottom: "1px solid var(--border-default)",
          padding: "24px 40px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--action-default)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Palette size={18} color="#fff" />
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "var(--content-secondary)" }}>
            ClarityPay
          </span>
        </div>
        <h1 className="type-display-m" style={{ margin: 0 }}>
          Clinic Brand Kit
        </h1>
        <p className="type-body-m" style={{ color: "var(--content-secondary)", marginTop: 4 }}>
          Extract a clinic&apos;s logo and brand colors for white-labeling
        </p>
      </header>

      {/* ─── Search ─────────────────────────────────────────────── */}
      <div style={{ maxWidth: 680, margin: "32px auto 0", padding: "0 40px" }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            background: "#fff",
            borderRadius: 14,
            padding: 6,
            boxShadow: "var(--elevation-2)",
          }}
        >
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "0 14px" }}>
            <Globe size={18} color="var(--content-tertiary)" />
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExtract()}
              placeholder="Enter clinic website (e.g. westlakedermatology.com)"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                fontSize: 15,
                color: "var(--content-primary)",
                background: "transparent",
                padding: "12px 0",
                fontFamily: "var(--font-body)",
              }}
            />
          </div>
          <button
            onClick={handleExtract}
            disabled={state === "loading"}
            className="ds-btn-blue"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 24px",
              fontSize: 14,
              borderRadius: 10,
              opacity: state === "loading" ? 0.7 : 1,
            }}
          >
            {state === "loading" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Search size={16} />
            )}
            {state === "loading" ? "Extracting..." : "Extract"}
          </button>
        </div>
      </div>

      {/* ─── Error ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {state === "error" && error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ maxWidth: 680, margin: "16px auto 0", padding: "0 40px" }}
          >
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 12,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                color: "#DC2626",
              }}
            >
              <AlertCircle size={16} /> {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Loading ────────────────────────────────────────────── */}
      <AnimatePresence>
        {state === "loading" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              maxWidth: 1140,
              margin: "40px auto 0",
              padding: "0 40px",
              display: "grid",
              gridTemplateColumns: "360px 1fr",
              gap: 28,
            }}
          >
            {/* Left skeleton */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div className="ds-card" style={{ padding: 28, height: 240 }}>
                <div style={{ width: 120, height: 120, borderRadius: 10, background: "linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", margin: "0 auto 16px" }} />
                <div style={{ width: "50%", height: 14, borderRadius: 4, background: "#f0f0f0", margin: "0 auto 12px" }} />
                <div style={{ width: "100%", height: 36, borderRadius: 8, background: "#f0f0f0" }} />
              </div>
              <div className="ds-card" style={{ padding: 28, height: 160 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ width: 60, height: 60, borderRadius: 10, background: "#f0f0f0" }} />
                  <div style={{ width: 60, height: 60, borderRadius: 10, background: "#f0f0f0" }} />
                </div>
              </div>
            </div>
            {/* Right skeleton */}
            <div>
              <div style={{ width: 200, height: 12, borderRadius: 3, background: "#f0f0f0", marginBottom: 16 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div className="ds-card" style={{ height: 500 }} />
                <div className="ds-card" style={{ height: 500 }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Results ────────────────────────────────────────────── */}
      <AnimatePresence>
        {state === "results" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{ maxWidth: 1140, margin: "40px auto 0", padding: "0 40px 80px" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "360px 1fr",
                gap: 28,
                alignItems: "start",
              }}
            >
              {/* ── Left: Logo + Colors ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Logo */}
                <div className="ds-card" style={{ padding: 28 }}>
                  <div className="type-overline" style={{ marginBottom: 16 }}>Logo — Select Version</div>

                  {/* Selected logo preview */}
                  {selectedLogo && (
                    <>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                          padding: 24,
                          background: "#FFFFFF",
                          borderRadius: 12,
                          border: "1px solid var(--border-subtle)",
                          marginBottom: 8,
                          minHeight: 100,
                          position: "relative",
                        }}
                      >
                        <img
                          src={selectedLogo.blobUrl || selectedLogo.src}
                          alt={`${domain} logo`}
                          style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain" }}
                        />
                        {/* Upscaled badge */}
                        {selectedLogo.wasUpscaled && (
                          <div
                            style={{
                              position: "absolute",
                              top: 8,
                              right: 8,
                              background: "#FEF3C7",
                              color: "#92400E",
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: 6,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
                            Upscaled {selectedLogo.originalWidth}px → {selectedLogo.finalWidth}px
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: 11, color: "var(--content-tertiary)", textAlign: "center", marginBottom: 12 }}>
                        {selectedLogo.label}
                      </div>
                    </>
                  )}

                  {/* Logo options thumbnails */}
                  {logoOptions.length > 1 && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                      {logoOptions.map((opt, i) => (
                        <div
                          key={i}
                          onClick={() => setSelectedLogoIndex(i)}
                          style={{
                            flex: "1 0 0",
                            minWidth: 70,
                            padding: 10,
                            background: "#FFFFFF",
                            borderRadius: 10,
                            border: selectedLogoIndex === i ? "2px solid var(--action-default)" : "2px solid var(--border-subtle)",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 6,
                            transition: "border-color 0.15s",
                            position: "relative",
                          }}
                        >
                          <img
                            src={opt.blobUrl || opt.src}
                            alt={opt.label}
                            style={{ height: 32, maxWidth: "100%", objectFit: "contain" }}
                          />
                          <div style={{ fontSize: 9, color: "var(--content-tertiary)", textAlign: "center", lineHeight: 1.2 }}>
                            {opt.label.length > 20 ? opt.label.slice(0, 18) + "..." : opt.label}
                          </div>
                          {selectedLogoIndex === i && (
                            <div
                              style={{
                                position: "absolute",
                                top: -6,
                                right: -6,
                                width: 16,
                                height: 16,
                                borderRadius: "50%",
                                background: "var(--action-default)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Check size={10} color="#fff" strokeWidth={3} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ fontSize: 13, color: "var(--content-secondary)", textAlign: "center", marginBottom: 14, fontFamily: "var(--font-mono)" }}>
                    {domain}
                  </div>
                  <button
                    onClick={downloadLogo}
                    className="ds-btn-secondary"
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      padding: "10px 0",
                    }}
                  >
                    <Download size={14} /> Download PNG
                  </button>
                </div>

                {/* Colors */}
                <div className="ds-card" style={{ padding: 28 }}>
                  <div className="type-overline" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
                    <Palette size={12} /> Brand Colors
                  </div>

                  {colors.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--content-tertiary)", textAlign: "center", padding: "20px 0" }}>
                      No brand colors detected
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {colors.map((color, i) => (
                        <motion.div
                          key={color}
                          onClick={() => setSelectedColor(color)}
                          whileHover={{ scale: 1.01 }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            padding: "12px 14px",
                            borderRadius: 12,
                            cursor: "pointer",
                            border: selectedColor === color ? `2px solid ${color}` : "2px solid var(--border-subtle)",
                            background: selectedColor === color ? `${color}0A` : "#fff",
                            transition: "all 0.15s",
                          }}
                        >
                          {/* Swatch */}
                          <div
                            style={{
                              width: 52,
                              height: 52,
                              borderRadius: 10,
                              background: color,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#fff",
                              fontSize: 13,
                              fontWeight: 700,
                              fontFamily: "var(--font-display)",
                              flexShrink: 0,
                              boxShadow: `0 2px 8px ${color}33`,
                            }}
                          >
                            Aa
                          </div>

                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--content-secondary)" }}>
                              Color {i + 1}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>
                              {color.toUpperCase()}
                            </div>
                          </div>

                          <button
                            onClick={(e) => { e.stopPropagation(); copyHex(color); }}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 6,
                              borderRadius: 6,
                              color: copied === color ? "#10b981" : "var(--content-tertiary)",
                              transition: "color 0.15s",
                            }}
                            title="Copy hex"
                          >
                            {copied === color ? <Check size={14} /> : <Copy size={14} />}
                          </button>

                          {selectedColor === color && (
                            <div
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                background: color,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: `0 2px 6px ${color}44`,
                              }}
                            >
                              <Check size={12} color="#fff" strokeWidth={3} />
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right: Two Portal Previews ── */}
              <div>
                <div className="type-overline" style={{ marginBottom: 16 }}>
                  Preview — Patient Billing Portal
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: colors.length >= 2 ? "1fr 1fr" : "1fr",
                    gap: 16,
                  }}
                >
                  {colors.map((color, i) => (
                    <BillingPortalPreview
                      key={color}
                      brandColor={color}
                      logoUrl={selectedLogo?.blobUrl || selectedLogo?.src || null}
                      clinicName={prettyName(domain)}
                      label={`Option ${i + 1} — ${color.toUpperCase()}`}
                      isSelected={selectedColor === color}
                      onSelect={() => setSelectedColor(color)}
                    />
                  ))}
                </div>

                {/* Confirmation */}
                {selectedColor && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      marginTop: 20,
                      padding: "18px 24px",
                      background: "#fff",
                      borderRadius: 14,
                      boxShadow: "var(--elevation-1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: selectedColor,
                          boxShadow: `0 2px 8px ${selectedColor}33`,
                        }}
                      />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--content-primary)", fontFamily: "var(--font-display)" }}>
                          Selected: {selectedColor.toUpperCase()}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--content-secondary)" }}>
                          This color will be used for white-labeling
                        </div>
                      </div>
                    </div>
                    <button
                      style={{
                        background: selectedColor,
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "10px 22px",
                        fontSize: 14,
                        fontWeight: 700,
                        fontFamily: "var(--font-display)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: `0 2px 12px ${selectedColor}33`,
                      }}
                    >
                      <Check size={15} strokeWidth={3} /> Confirm Selection
                    </button>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Idle state ─────────────────────────────────────────── */}
      {state === "idle" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          style={{
            maxWidth: 480,
            margin: "80px auto 0",
            textAlign: "center",
            padding: "0 40px",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "var(--blue-1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
            }}
          >
            <Globe size={28} color="var(--action-default)" />
          </div>
          <h2 className="type-h1" style={{ marginBottom: 8 }}>Enter a clinic website</h2>
          <p className="type-body-m" style={{ color: "var(--content-secondary)", lineHeight: 1.6 }}>
            We&apos;ll extract their logo and brand colors, then show you how it looks on the ClarityPay billing portal.
          </p>
        </motion.div>
      )}
    </div>
  );
}
