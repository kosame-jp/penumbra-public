import {
  AUDIO_PERF_DIAGNOSTIC_BYPASSES,
  AUDIO_PERF_DIAGNOSTIC_HUMAN_EVENT_CAPS,
  AUDIO_PERF_DIAGNOSTIC_HUMAN_PARTIAL_CAPS,
  AUDIO_PERF_DIAGNOSTIC_HUMAN_VOICE_CAPS,
  AUDIO_TUNING_CONTROLS,
  clampAudioPerfDiagnostics,
  clampAudioPerfDiagnosticBypasses,
  clampAudioTuningOverrides,
  createAudioTuningSnapshot,
  createDefaultAudioPerfDiagnostics,
  createDefaultAudioTuningOverrides,
  type AudioPerfDiagnosticBypassKey,
  type AudioPerfDiagnostics,
  type AudioTuningControlKey,
  type AudioTuningOverrides,
} from "../core/audio/audio-tuning";

export interface AudioTuningPanel {
  readonly element: HTMLElement;
  dispose(): void;
}

interface AudioTuningPanelOptions {
  readonly onChange: (overrides: AudioTuningOverrides) => void;
  readonly onDiagnosticsChange?: (diagnostics: AudioPerfDiagnostics) => void;
}

export function createAudioTuningPanel(options: AudioTuningPanelOptions): AudioTuningPanel {
  let overrides = createDefaultAudioTuningOverrides();
  let diagnostics = createDefaultAudioPerfDiagnostics();
  const disposers: Array<() => void> = [];
  const element = document.createElement("section");
  const controlsElement = document.createElement("div");
  const diagnosticsElement = document.createElement("div");
  const exportButton = document.createElement("button");
  const resetButton = document.createElement("button");
  const exportText = document.createElement("textarea");
  const valueOutputs = new Map<AudioTuningControlKey, HTMLOutputElement>();
  const inputs = new Map<AudioTuningControlKey, HTMLInputElement>();
  const diagnosticInputs = new Map<AudioPerfDiagnosticBypassKey, HTMLInputElement>();
  const humanVoiceCapSelect = document.createElement("select");
  const humanEventCapSelect = document.createElement("select");
  const humanPartialCapSelect = document.createElement("select");

  element.className = "penumbra__audio-tuning";
  element.setAttribute("aria-label", "Audio tuning");
  element.innerHTML = `
    <div class="penumbra__audio-tuning-head">
      <span class="penumbra__audio-tuning-title">AUDIO TUNE</span>
      <span class="penumbra__audio-tuning-mode">dev</span>
    </div>
  `;
  controlsElement.className = "penumbra__audio-tuning-controls";
  diagnosticsElement.className = "penumbra__audio-diagnostics";

  for (const control of AUDIO_TUNING_CONTROLS) {
    const row = document.createElement("label");
    const label = document.createElement("span");
    const input = document.createElement("input");
    const output = document.createElement("output");

    row.className = "penumbra__audio-tuning-row";
    label.className = "penumbra__audio-tuning-label";
    input.className = "penumbra__audio-tuning-slider";
    output.className = "penumbra__audio-tuning-value";

    label.textContent = control.label;
    input.type = "range";
    input.min = String(control.minDb);
    input.max = String(control.maxDb);
    input.step = String(control.stepDb);
    input.value = String(control.defaultDb);
    output.value = formatDb(control.defaultDb);
    output.textContent = output.value;

    const handleInput = (): void => {
      overrides = clampAudioTuningOverrides({
        ...overrides,
        [control.key]: Number(input.value),
      });
      output.value = formatDb(overrides[control.key]);
      output.textContent = output.value;
      options.onChange(overrides);
    };
    input.addEventListener("input", handleInput);
    disposers.push(() => input.removeEventListener("input", handleInput));

    row.append(label, input, output);
    controlsElement.append(row);
    valueOutputs.set(control.key, output);
    inputs.set(control.key, input);
  }

  const diagnosticsTitle = document.createElement("div");
  const diagnosticsNote = document.createElement("div");
  diagnosticsTitle.className = "penumbra__audio-diagnostics-title";
  diagnosticsNote.className = "penumbra__audio-diagnostics-note";
  diagnosticsTitle.textContent = "IPHONE PERF BYPASS";
  diagnosticsNote.textContent = "Set before Start audio for full node bypass.";
  diagnosticsElement.append(diagnosticsTitle, diagnosticsNote);

  for (const bypass of AUDIO_PERF_DIAGNOSTIC_BYPASSES) {
    const row = document.createElement("label");
    const label = document.createElement("span");
    const input = document.createElement("input");

    row.className = "penumbra__audio-diagnostics-row";
    label.className = "penumbra__audio-diagnostics-label";
    input.className = "penumbra__audio-diagnostics-checkbox";

    label.textContent = bypass.label;
    input.type = "checkbox";
    input.checked = diagnostics.bypasses[bypass.key];

    const handleInput = (): void => {
      diagnostics = clampAudioPerfDiagnostics({
        ...diagnostics,
        bypasses: clampAudioPerfDiagnosticBypasses({
          ...diagnostics.bypasses,
          [bypass.key]: input.checked,
        }),
      });
      options.onDiagnosticsChange?.(diagnostics);
    };
    input.addEventListener("change", handleInput);
    disposers.push(() => input.removeEventListener("change", handleInput));

    row.append(label, input);
    diagnosticsElement.append(row);
    diagnosticInputs.set(bypass.key, input);
  }

  const voiceCapRow = document.createElement("label");
  const voiceCapLabel = document.createElement("span");
  voiceCapRow.className = "penumbra__audio-diagnostics-row";
  voiceCapLabel.className = "penumbra__audio-diagnostics-label";
  humanVoiceCapSelect.className = "penumbra__audio-diagnostics-select";
  voiceCapLabel.textContent = "HUMAN VOICE CAP";
  for (const cap of AUDIO_PERF_DIAGNOSTIC_HUMAN_VOICE_CAPS) {
    const option = document.createElement("option");
    option.value = String(cap);
    option.textContent = String(cap);
    humanVoiceCapSelect.append(option);
  }
  humanVoiceCapSelect.value = String(diagnostics.humanVoiceCap);
  const handleVoiceCapInput = (): void => {
    diagnostics = clampAudioPerfDiagnostics({
      ...diagnostics,
      humanVoiceCap: Number(humanVoiceCapSelect.value),
    });
    options.onDiagnosticsChange?.(diagnostics);
  };
  humanVoiceCapSelect.addEventListener("change", handleVoiceCapInput);
  disposers.push(() => humanVoiceCapSelect.removeEventListener("change", handleVoiceCapInput));
  voiceCapRow.append(voiceCapLabel, humanVoiceCapSelect);
  diagnosticsElement.append(voiceCapRow);

  const eventCapRow = document.createElement("label");
  const eventCapLabel = document.createElement("span");
  eventCapRow.className = "penumbra__audio-diagnostics-row";
  eventCapLabel.className = "penumbra__audio-diagnostics-label";
  humanEventCapSelect.className = "penumbra__audio-diagnostics-select";
  eventCapLabel.textContent = "HUMAN EVENT CAP";
  for (const cap of AUDIO_PERF_DIAGNOSTIC_HUMAN_EVENT_CAPS) {
    const option = document.createElement("option");
    option.value = String(cap);
    option.textContent = cap === 0 ? "OFF" : `${cap}/s`;
    humanEventCapSelect.append(option);
  }
  humanEventCapSelect.value = String(diagnostics.humanEventCapPerSecond);
  const handleEventCapInput = (): void => {
    diagnostics = clampAudioPerfDiagnostics({
      ...diagnostics,
      humanEventCapPerSecond: Number(humanEventCapSelect.value),
    });
    options.onDiagnosticsChange?.(diagnostics);
  };
  humanEventCapSelect.addEventListener("change", handleEventCapInput);
  disposers.push(() => humanEventCapSelect.removeEventListener("change", handleEventCapInput));
  eventCapRow.append(eventCapLabel, humanEventCapSelect);
  diagnosticsElement.append(eventCapRow);

  const partialCapRow = document.createElement("label");
  const partialCapLabel = document.createElement("span");
  partialCapRow.className = "penumbra__audio-diagnostics-row";
  partialCapLabel.className = "penumbra__audio-diagnostics-label";
  humanPartialCapSelect.className = "penumbra__audio-diagnostics-select";
  partialCapLabel.textContent = "HUMAN PARTIAL CAP";
  for (const cap of AUDIO_PERF_DIAGNOSTIC_HUMAN_PARTIAL_CAPS) {
    const option = document.createElement("option");
    option.value = String(cap);
    option.textContent = String(cap);
    humanPartialCapSelect.append(option);
  }
  humanPartialCapSelect.value = String(diagnostics.humanPartialCap);
  const handlePartialCapInput = (): void => {
    diagnostics = clampAudioPerfDiagnostics({
      ...diagnostics,
      humanPartialCap: Number(humanPartialCapSelect.value),
    });
    options.onDiagnosticsChange?.(diagnostics);
  };
  humanPartialCapSelect.addEventListener("change", handlePartialCapInput);
  disposers.push(() => humanPartialCapSelect.removeEventListener("change", handlePartialCapInput));
  partialCapRow.append(partialCapLabel, humanPartialCapSelect);
  diagnosticsElement.append(partialCapRow);

  const buttonRow = document.createElement("div");
  buttonRow.className = "penumbra__audio-tuning-buttons";
  exportButton.className = "penumbra__audio-tuning-button";
  exportButton.type = "button";
  exportButton.textContent = "Export JSON";
  resetButton.className = "penumbra__audio-tuning-button";
  resetButton.type = "button";
  resetButton.textContent = "Reset";

  const handleExport = (): void => {
    const snapshot = createAudioTuningSnapshot(overrides, new Date(), diagnostics);
    const json = `${JSON.stringify(snapshot, null, 2)}\n`;
    exportText.value = json;
    void window.navigator.clipboard?.writeText(json).catch(() => undefined);
  };
  const handleReset = (): void => {
    overrides = createDefaultAudioTuningOverrides();
    diagnostics = createDefaultAudioPerfDiagnostics();
    for (const control of AUDIO_TUNING_CONTROLS) {
      const input = inputs.get(control.key);
      const output = valueOutputs.get(control.key);
      if (input) {
        input.value = String(overrides[control.key]);
      }
      if (output) {
        output.value = formatDb(overrides[control.key]);
        output.textContent = output.value;
      }
    }
    for (const bypass of AUDIO_PERF_DIAGNOSTIC_BYPASSES) {
      const input = diagnosticInputs.get(bypass.key);
      if (input) {
        input.checked = diagnostics.bypasses[bypass.key];
      }
    }
    humanVoiceCapSelect.value = String(diagnostics.humanVoiceCap);
    humanEventCapSelect.value = String(diagnostics.humanEventCapPerSecond);
    humanPartialCapSelect.value = String(diagnostics.humanPartialCap);
    options.onChange(overrides);
    options.onDiagnosticsChange?.(diagnostics);
  };

  exportButton.addEventListener("click", handleExport);
  resetButton.addEventListener("click", handleReset);
  disposers.push(() => exportButton.removeEventListener("click", handleExport));
  disposers.push(() => resetButton.removeEventListener("click", handleReset));

  exportText.className = "penumbra__audio-tuning-export";
  exportText.readOnly = true;
  exportText.spellcheck = false;
  exportText.placeholder = "export appears here";
  buttonRow.append(exportButton, resetButton);
  element.append(controlsElement, diagnosticsElement, buttonRow, exportText);
  options.onChange(overrides);
  options.onDiagnosticsChange?.(diagnostics);

  return {
    element,
    dispose(): void {
      for (const dispose of disposers) {
        dispose();
      }
    },
  };
}

function formatDb(db: number): string {
  if (db === 0) {
    return "0.0 dB";
  }
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}
