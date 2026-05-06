"use client";

import { useEffect } from "react";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ProjectError]", error.message, error.stack);
  }, [error]);

  return (
    <div style={{ padding: 32, fontFamily: "monospace" }}>
      <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
      <p style={{ color: "red", marginBottom: 8 }}>
        <strong>{error.message}</strong>
      </p>
      <pre
        style={{
          background: "#f0f0f0",
          padding: 12,
          overflow: "auto",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          marginBottom: 12,
        }}
      >
        {error.stack}
      </pre>
      {error.digest && (
        <p style={{ fontSize: 12, color: "#666" }}>Digest: {error.digest}</p>
      )}
      <button
        onClick={reset}
        style={{
          padding: "6px 16px",
          background: "#333",
          color: "white",
          border: "none",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
