'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Accessible modal: labelled, focus moves in on open and back out on close, Escape closes. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl outline-none"
      >
        <h2 id={id} className="mb-3 text-lg font-bold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
