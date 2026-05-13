import {
  sortRuntimeFallbackStatuses,
  type RuntimeFallbackStatus,
  type RuntimeFallbackSeverity,
} from "../core/runtime/fallback-status";

export interface FallbackStatusPanel {
  readonly element: HTMLElement;
  update(statuses: readonly RuntimeFallbackStatus[]): void;
}

export function createFallbackStatusPanel(): FallbackStatusPanel {
  const element = document.createElement("section");
  element.className = "penumbra__fallback-status";
  element.setAttribute("aria-label", "PENUMBRA runtime fallback status");
  element.setAttribute("aria-live", "polite");
  element.hidden = true;

  return {
    element,
    update(statuses) {
      const sorted = sortRuntimeFallbackStatuses(statuses);
      element.hidden = sorted.length === 0;
      element.replaceChildren(...sorted.map(createStatusRow));
    },
  };
}

function createStatusRow(status: RuntimeFallbackStatus): HTMLElement {
  const row = document.createElement("article");
  row.className = "penumbra__fallback-status-row";
  row.dataset.severity = status.severity;

  const meta = document.createElement("div");
  meta.className = "penumbra__fallback-status-meta";
  meta.textContent = `${status.demo ? "DEMO " : ""}${severityLabel(status.severity)}`;

  const label = document.createElement("div");
  label.className = "penumbra__fallback-status-label";
  label.textContent = status.label;

  const message = document.createElement("div");
  message.className = "penumbra__fallback-status-message";
  message.textContent = status.message;

  row.append(meta, label, message);
  return row;
}

function severityLabel(severity: RuntimeFallbackSeverity): string {
  if (severity === "audio-muted") {
    return "AUDIO PAUSED";
  }
  return severity.toUpperCase();
}
