"use client";

import { useEffect, useRef } from "react";

interface SampleReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SampleReportModal({ isOpen, onClose }: SampleReportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) dialog.showModal();
    else dialog.close();
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 m-0 max-h-[100dvh] w-full max-w-full border-0 bg-noir-bg/95 p-0 backdrop:bg-black/60"
      aria-modal="true"
      aria-labelledby="sample-report-title"
    >
      <div className="flex min-h-full flex-col items-center justify-center p-4 sm:p-6">
        <div
          className="w-full max-w-2xl rounded-xl border border-noir-border bg-noir-surface shadow-noir-card"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-noir-border px-5 py-4">
            <h2 id="sample-report-title" className="font-display text-lg text-zinc-100">
              Sample Report
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-noir-border hover:text-zinc-300 focus-visible:text-noir-brass-light"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-5 font-mono text-sm text-zinc-400">
            <pre className="whitespace-pre-wrap break-words">
{`Report ID: PT-2024-001
Generated: 2024-02-14T12:00:00Z
Source: https://example.com/article

--- PROVENANCE ---
First seen: 2024-02-10
Last modified: 2024-02-14
Capture hash: a3f2c1...

--- TIMELINE ---
[2024-02-10] Initial capture
[2024-02-12] Content edit detected
[2024-02-14] Current version

--- CONTEXT ---
Platform: Web
Language: en
Confidence: 0.94`}
            </pre>
          </div>
          <div className="border-t border-noir-border px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-noir-brass/50 bg-transparent px-4 py-2 text-sm text-noir-brass-light hover:border-noir-brass hover:bg-noir-brass/10 focus-visible:ring-noir-brass/60"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
