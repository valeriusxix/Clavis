import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cutEdge, cutsOf } from "../lib/bitting";
import { shortHash } from "../lib/format";

type Material = { body: [number, string][]; sheen: number; hi: string; deep: string; side: string };

/** Anodized green, for a key that works. */
const LIVE: Material = {
  body: [
    [0, "#4fbf85"],
    [0.22, "#2a9a60"],
    [0.55, "#187a48"],
    [0.82, "#0f5f37"],
    [1, "#0b4a2b"],
  ],
  sheen: 0.12,
  hi: "#a9edc8",
  deep: "#06331d",
  side: "#042213",
};

/** Dull steel, for an expired key. */
const SPENT: Material = {
  body: [
    [0, "#aab2ad"],
    [0.22, "#878f8a"],
    [0.55, "#666e69"],
    [0.82, "#4d5450"],
    [1, "#3b413d"],
  ],
  sheen: 0.1,
  hi: "#d5dbd7",
  deep: "#232825",
  side: "#1a1e1c",
};

/** Cuts for a hash, tweened when the hash changes so the key visibly recuts itself. */
function useCuts(hash: string | null | undefined): number[] {
  const target = useMemo(() => cutsOf(hash), [hash]);
  const [cuts, setCuts] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    const from = shown.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = target;
      setCuts(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / 320);
      const eased = 1 - (1 - t) ** 3;
      shown.current = target.map((cut, i) => from[i]! + (cut - from[i]!) * eased);
      setCuts(shown.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return cuts;
}

/** Ids for one SVG's gradients: useId output can hold characters that break url(#id). */
const useSvgId = () => useId().replace(/\W/g, "");

/** The key: its teeth are cut from the hash stamped on its blade. No hash gives an uncut blank. */
export function CutKey({ hash, spent = false, className = "" }: { hash: string | null | undefined; spent?: boolean; className?: string }) {
  const id = useSvgId();
  const cuts = useCuts(hash);
  const m = spent ? SPENT : LIVE;
  const edge = cutEdge(cuts, { x0: 176, x1: 592, top: 60, step: 1.7, root: 7 });
  const outline = `M150 50 L170 50 L170 60${edge} L604 60 L632 90 L604 114 L170 114 L170 124 L150 124 L150 110 A70 70 0 1 1 150 64 Z`;
  const shape = `${outline} M58 87 a15 15 0 1 0 -30 0 a15 15 0 1 0 30 0 Z`;

  return (
    <svg viewBox="-8 0 672 196" role="img" aria-label={hash ? `Key cut from head hash ${shortHash(hash)}` : "Uncut key"} className={`block w-full ${className}`}>
      <defs>
        <linearGradient id={`${id}body`} x1="0" y1="0" x2="0" y2="1">
          {m.body.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
        <linearGradient id={`${id}sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity={m.sheen} />
          <stop offset="0.18" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.46" stopColor="#fff" stopOpacity={m.sheen * 0.75} />
          <stop offset="0.62" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={`${id}edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={m.hi} />
          <stop offset="0.5" stopColor={m.hi} stopOpacity="0.15" />
          <stop offset="1" stopColor={m.deep} />
        </linearGradient>
        <filter id={`${id}shadow`} x="-10%" y="-40%" width="120%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <path d={shape} fill="#000" fillOpacity="0.7" fillRule="evenodd" filter={`url(#${id}shadow)`} transform="translate(6 18)" />
      <path d={shape} fill={m.side} fillRule="evenodd" transform="translate(0 4)" />
      <path d={shape} fill={`url(#${id}body)`} fillRule="evenodd" />
      <path d={shape} fill={`url(#${id}sheen)`} fillRule="evenodd" />
      <path d={shape} fill="none" stroke={`url(#${id}edge)`} strokeWidth="1.25" />
      <circle cx="80" cy="87" r="59" fill="none" stroke={m.deep} strokeOpacity="0.6" strokeWidth="1.25" />
      <circle cx="80" cy="87.8" r="59" fill="none" stroke={m.hi} strokeOpacity="0.28" strokeWidth="0.75" />
      <text x="102" y="94" textAnchor="middle" fontSize="22" fontWeight="500" fill={m.deep} className="font-serif">
        Clavis
      </text>
      <rect x="180" y="91" width="412" height="3" rx="1.5" fill={m.deep} fillOpacity="0.7" />
      <rect x="180" y="94" width="412" height="0.8" fill={m.hi} fillOpacity="0.35" />
      <text x="182" y="108" fontSize="10.5" letterSpacing="1.2" fill={m.deep} className="num">
        {hash ? shortHash(hash) : "uncut"}
      </text>
    </svg>
  );
}

/** The same 12 cuts in small: the signature wherever a head hash appears. Takes its colour from the text. */
export function MiniKey({ hash, className = "" }: { hash: string | null | undefined; className?: string }) {
  const edge = cutEdge(cutsOf(hash), { x0: 18, x1: 88, top: 5, step: 0.42, root: 1.1 });
  return (
    <svg width="96" height="20" viewBox="0 0 96 20" aria-hidden fill="currentColor" className={`shrink-0 ${className}`}>
      <path fillRule="evenodd" d="M16 10 a8 8 0 1 1 -16 0 a8 8 0 1 1 16 0 Z M9.5 10 a2.5 2.5 0 1 0 -5 0 a2.5 2.5 0 1 0 5 0 Z" />
      <path d={`M12 5${edge} L90 5 L95 10 L90 15 L12 15 Z`} />
    </svg>
  );
}

/**
 * The Verify result as a fit: the lock is cut from the head stored in the contract, the key from the
 * hash the browser computed for the same entries. Equal hashes leave one even gap; different hashes
 * collide, and the overlap shows red.
 */
export function FitTest({ lockHash, keyHash, fits }: { lockHash: string; keyHash: string; fits: boolean }) {
  const id = useSvgId();
  const keyCuts = useCuts(keyHash);
  const width = 640;
  const height = 104;
  const top = 26;
  const gap = 3;
  const edge = { x0: 0, x1: width, step: 3.4, root: 16 };
  const lockTop = top - gap;
  const keyTop = top + gap;
  const lock = `M0 0 L0 ${lockTop}${cutEdge(cutsOf(lockHash), { ...edge, top: lockTop })} L${width} ${lockTop} L${width} 0 Z`;
  const key = `M0 ${height} L0 ${keyTop}${cutEdge(keyCuts, { ...edge, top: keyTop })} L${width} ${keyTop} L${width} ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={fits ? "The key fits the lock: both hashes match" : "The key does not fit the lock: the hashes differ"}
      className="block h-20 w-full rounded-lg sm:h-auto"
    >
      <defs>
        <linearGradient id={`${id}key`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4fbf85" />
          <stop offset="0.45" stopColor="#187a48" />
          <stop offset="1" stopColor="#0b4a2b" />
        </linearGradient>
        <linearGradient id={`${id}lock`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#242625" />
          <stop offset="1" stopColor="#4a4e4c" />
        </linearGradient>
        <clipPath id={`${id}clip`}>
          <path d={lock} />
        </clipPath>
      </defs>
      <path d={lock} fill={`url(#${id}lock)`} />
      <path d={key} fill={`url(#${id}key)`} />
      <path d={key} fill="var(--color-down)" clipPath={`url(#${id}clip)`} />
    </svg>
  );
}

/** The logo: a flat key glyph, in the colour of the text around it. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" aria-hidden className={className}>
      <circle cx="8" cy="12" r="5" />
      <path d="M13 12h9.5M18 12v3.5M22 12v3.5" />
    </svg>
  );
}
