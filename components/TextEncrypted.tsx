"use client";

import { useState, useEffect, useRef } from "react";

const CHARS = "-_~`!@#$%^&*()+=[]{}|;:,.<>?";

/** Deterministic "random" char index from cycle tick and position (so scramble ticks at interval, not every frame) */
function cycleCharIndex(cycleTick: number, position: number): number {
  const n = CHARS.length;
  const x = Math.sin(cycleTick * 12.9898 + position * 78.233) * 43758.5453;
  return Math.floor(((x - Math.floor(x)) * n) % n);
}

interface TextEncryptedProps {
  text: string;
  /** Keep fully encrypted (cycling) for this many ms before starting decrypt */
  holdEncryptedMs?: number;
  /** Max random delay (ms) per character after hold; all reveal within this window */
  spreadMs?: number;
  /** How often (ms) the scrambling chars change; higher = slower cycle */
  cycleIntervalMs?: number;
  className?: string;
}

export default function TextEncrypted({
  text,
  holdEncryptedMs = 1000,
  spreadMs = 380,
  cycleIntervalMs = 80,
  className = "",
}: TextEncryptedProps) {
  const [elapsed, setElapsed] = useState(0);
  const [delays, setDelays] = useState<number[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setDelays(
      Array.from({ length: text.length }, () => Math.random() * spreadMs)
    );
    startTimeRef.current = Date.now();
    setElapsed(0);
  }, [text, spreadMs]);

  useEffect(() => {
    if (delays.length === 0) return;

    const maxDelay = Math.max(...delays);
    const totalDuration = holdEncryptedMs + maxDelay + 50;
    let rafId: number;

    const tick = () => {
      const now = Date.now();
      const elapsedMs = now - startTimeRef.current;
      setElapsed(elapsedMs);

      if (elapsedMs < totalDuration) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [delays, holdEncryptedMs]);

  if (!isMounted || delays.length !== text.length) {
    return <span className={className}> </span>;
  }

  const cycleTick = Math.floor(elapsed / cycleIntervalMs);
  const display = text
    .split("")
    .map((char, i) => {
      const revealAt = holdEncryptedMs + delays[i];
      return elapsed >= revealAt ? char : CHARS[cycleCharIndex(cycleTick, i)];
    })
    .join("");

  return <span className={className}>{display}</span>;
}
