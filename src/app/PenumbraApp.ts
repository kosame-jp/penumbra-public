import { PenumbraAudioEngine } from "../core/audio/engine";
import { deriveAudioFrameParams } from "../core/audio/audio-params";
import { tuningModeAtmosphereFromCloudAtlasSequence } from "../core/fusion/forecast-mode-atmosphere";
import { weatherSampleFromCloudAtlasSequence } from "../core/fusion/forecast-weather";
import { createCanonicalScanlineSamples } from "../core/fusion/scanline-sample";
import type { WeatherSample } from "../core/live-data/openmeteo-client";
import { precipitationBandFieldFromCloudAtlasSequence } from "../core/fusion/precipitation-band";
import type { EarthquakeFixtureFile } from "../core/live-data/quake-store";
import { RollingFrameProfiler, type FrameProfilerStats } from "../core/performance/frame-profiler";
import { createScanlineState } from "../core/scanline/scanline-state";
import { RuntimeStore } from "../core/app-state/runtime-store";
import { LIVE_SAFETY_COPY } from "../copy/live-safety";
import { loadTuningKernels, type TuningKernelSet } from "../core/static-data/kernels-loader";
import {
  cloudAtlasSequenceFreshness,
  DEFAULT_CLOUD_ATLAS_FORECAST_MANIFEST_URL,
  FIXTURE_CLOUD_ATLAS_URL,
  DEFAULT_CLOUD_ATLAS_URL,
  loadCloudAtlas,
  loadCloudAtlasSequence,
  type CloudAtlasSequence,
} from "../core/static-data/cloud-atlas-loader";
import {
  DEFAULT_CAPTURE_SCENE_ID,
  loadCaptureScene,
  type CaptureScene,
} from "../core/static-data/capture-scene-loader";
import {
  loadContactWorldGrid,
  loadJson,
  loadVisualSurfaceWorldGrid,
  loadWorldGridResult,
  type WorldGrid,
  type WorldGridCell,
} from "../core/static-data/worldgrid-loader";
import {
  createRuntimeFallbackStatus,
  isAudioBlockingFallbackStatus,
  type RuntimeFallbackStatus,
  type RuntimeFallbackStatusId,
} from "../core/runtime/fallback-status";
import {
  estimateServerDateClockOffset,
  ServerDateCanonicalClock,
  type ServerDateClockSyncResult,
} from "../core/time/server-date-clock";
import { PenumbraRenderer } from "../core/visual/renderer";
import { createAudioTuningPanel, type AudioTuningPanel } from "./audio-tuning-panel";
import { createFallbackStatusPanel, type FallbackStatusPanel } from "./fallback-status-panel";
import { LiveDataRuntime } from "./live-data-runtime";
import type { AppMode } from "./modes";
import { createStreamOperationalController, type StreamOperationalController } from "./stream-ops";

const CLOUD_ATLAS_FORECAST_REFRESH_MS = 10 * 60_000;
const SERVER_CLOCK_SYNC_REFRESH_MS = 10 * 60_000;
const SERVER_CLOCK_SYNC_TIMEOUT_MS = 1_500;
const SERVER_CLOCK_SYNC_SAMPLE_COUNT = 3;
const SERVER_CLOCK_SYNC_ENDPOINT = "/__penumbra-time";
const PRODUCTION_UI_IDLE_DELAY_MS = 8_000;
const PRODUCTION_ENTRY_FADE_MS = 900;
const LOGO_FONT_LOAD_TIMEOUT_MS = 1_800;
const LOGO_FONT_FACE = '500 30px "Cormorant SC"';

export class PenumbraApp {
  private readonly root: HTMLElement;
  private readonly mode: AppMode;
  private readonly runtimeStore = new RuntimeStore();
  private readonly audio: PenumbraAudioEngine;
  private readonly liveData = new LiveDataRuntime();
  private readonly canonicalClock = new ServerDateCanonicalClock();
  private readonly frameProfiler: RollingFrameProfiler;
  private renderer: PenumbraRenderer | undefined;
  private worldGrid: WorldGrid | undefined;
  private contactWorldGrid: WorldGrid | undefined;
  private tuningKernels: TuningKernelSet | undefined;
  private streamOperations: StreamOperationalController | undefined;
  private animationFrame = 0;
  private lastRenderMs = 0;
  private lastRenderedFrameMs: number | undefined;
  private renderedFrameCount = 0;
  private latestFrameStats: FrameProfilerStats | undefined;
  private lastCloudAtlasForecastRefreshMs = 0;
  private cloudAtlasForecastRefreshInFlight: Promise<void> | undefined;
  private cloudAtlasSequence: CloudAtlasSequence | undefined;
  private clockSyncInFlight: Promise<void> | undefined;
  private lastClockSyncProbePerformanceMs = Number.NEGATIVE_INFINITY;
  private audioTuningPanel: AudioTuningPanel | undefined;
  private captureScene: CaptureScene | undefined;
  private lastCloudAtlasForecastRejectKey: string | undefined;
  private productionUiIdleActive = false;
  private productionUiIdleTimeoutId: number | undefined;
  private fallbackStatusPanel: FallbackStatusPanel | undefined;
  private readonly fallbackStatuses = new Map<RuntimeFallbackStatusId, RuntimeFallbackStatus>();
  private audioButton: HTMLButtonElement | undefined;
  private capturePanel: CapturePanel | undefined;
  private entryOverlay: HTMLElement | undefined;
  private entryButton: HTMLButtonElement | undefined;
  private productionEntryReady = false;
  private productionEntryRequested = false;
  private productionEntryCompleted = false;
  private productionEntryRemovalTimeoutId: number | undefined;
  private logoFontReadyTimeoutId: number | undefined;
  private logoFontReadyRequestId = 0;
  private audioEnabled = false;
  private audioTransitioning = false;
  private readonly resizeHandler = (): void => this.renderer?.resize();
  private readonly productionUiActivityHandler = (): void => this.markProductionUiActive();
  private readonly productionEntryClickHandler = (): void => this.startProductionEntryFromGesture();
  private readonly captureClickHandler = (): void => this.captureVisualFromGesture();

  constructor(root: HTMLElement, mode: AppMode) {
    this.root = root;
    this.mode = mode;
    this.audio = new PenumbraAudioEngine({
      audioDebugMode: mode.audioDebug,
      debug: mode.debug || mode.earthRootWidget,
    });
    this.frameProfiler = new RollingFrameProfiler({ targetFps: mode.targetFps });
  }

  async start(): Promise<void> {
    const classes = ["penumbra"];
    if (this.mode.hideCursor) {
      classes.push("penumbra--stream");
    }
    if (this.mode.capture) {
      classes.push("penumbra--capture");
    }
    if (this.mode.performanceProfile !== "standard") {
      classes.push(`penumbra--perf-${this.mode.performanceProfile}`);
    }

    this.root.className = classes.join(" ");
    this.root.dataset.performanceProfile = this.mode.performanceProfile;
    this.root.dataset.targetFps = String(this.mode.targetFps);
    this.root.dataset.capture = this.mode.capture ? "on" : "off";
    this.root.dataset.captureScale = this.mode.capture ? String(this.mode.captureScale) : "off";
    this.root.dataset.audioDebug = this.mode.audioDebug;
    this.root.dataset.audioTuning = this.mode.audioTuning ? "on" : "off";
    this.root.dataset.debugHud = this.mode.debugHud ? "on" : "off";
    this.root.dataset.surfaceGrid = this.mode.surfaceGrid;
    this.root.dataset.contactGrid = this.mode.contactGrid;
    this.root.dataset.cloudAtlas = this.mode.cloudAtlas;
    this.root.dataset.cloudDiagnostic = this.mode.cloudDiagnostic ? "on" : "off";
    this.root.dataset.earthRootWidget = this.mode.earthRootWidget ? "on" : "off";
    this.root.dataset.clockSync = "local";
    this.root.innerHTML = "";
    this.productionEntryReady = false;
    this.productionEntryRequested = false;
    this.productionEntryCompleted = false;
    this.clearProductionEntryRemovalTimeout();
    this.prepareLogoFontReveal();

    const canvas = document.createElement("canvas");
    canvas.className = "penumbra__canvas";
    const audioButton = this.mode.capture ? undefined : document.createElement("button");
    if (audioButton) {
      audioButton.className = "penumbra__audio-button";
      audioButton.type = "button";
      audioButton.textContent = "Start audio";
    }
    this.audioButton = audioButton;
    this.audioEnabled = false;
    this.audioTransitioning = false;
    this.fallbackStatusPanel = createFallbackStatusPanel();

    this.root.append(canvas);
    if (audioButton) {
      this.root.append(audioButton);
    }
    this.root.append(this.fallbackStatusPanel.element);
    if (this.shouldUseProductionEntry()) {
      const entry = createProductionEntryElement();
      this.entryOverlay = entry.element;
      this.entryButton = entry.button;
      this.entryButton.addEventListener("click", this.productionEntryClickHandler);
      this.root.dataset.entryState = "idle";
      this.root.append(this.entryOverlay);
    } else {
      this.entryOverlay = undefined;
      this.entryButton = undefined;
      delete this.root.dataset.entryState;
    }
    this.applyFallbackDemoStatuses();
    if (this.mode.stream) {
      this.root.append(createStreamSafetyCopyElement(), createStreamTitleElement());
    }
    if (this.mode.audioTuning) {
      this.audioTuningPanel = createAudioTuningPanel({
        onChange: (overrides) => this.audio.setTuningOverrides(overrides),
        onDiagnosticsChange: (diagnostics) => this.audio.setPerfDiagnostics(diagnostics),
      });
      this.root.append(this.audioTuningPanel.element);
    }
    if (this.mode.capture) {
      this.capturePanel = createCapturePanel();
      this.capturePanel.button.addEventListener("click", this.captureClickHandler);
      this.root.append(this.capturePanel.element);
    } else {
      this.capturePanel = undefined;
    }

    this.streamOperations = createStreamOperationalController(this.root, this.mode.recovery);
    this.streamOperations.start();
    this.installProductionUiIdleHandlers();
    this.updateAudioButtonState();

    audioButton?.addEventListener("click", () =>
      this.requestAudioStateFromGesture(!this.audioEnabled),
    );
    const initialClockSync = this.syncCanonicalClock("initial");

    const [worldGridResult, tuningKernels, quakeFixture, captureScene] = await Promise.all([
      loadWorldGridResult(),
      loadTuningKernels(),
      loadJson<EarthquakeFixtureFile>("/data/fixtures/earthquakes.sample.json"),
      this.mode.capture
        ? loadCaptureScene(this.mode.captureSceneId ?? DEFAULT_CAPTURE_SCENE_ID)
        : Promise.resolve(undefined),
    ]);
    await initialClockSync;
    this.captureScene = captureScene;
    this.applyCaptureSceneMetadata(captureScene);
    const worldGrid = worldGridResult.grid;
    if (worldGridResult.source === "terrain-seed") {
      this.setFallbackStatus("worldgrid-production-fallback");
    } else if (worldGridResult.source === "fixture") {
      this.setFallbackStatus("worldgrid-fixture-fallback");
    }
    const contactWorldGrid =
      this.mode.contactGrid === "canonical" ? undefined : await loadContactWorldGrid();
    if (this.mode.contactGrid === "1deg" && contactWorldGrid === undefined) {
      console.warn("PENUMBRA requested 1deg contact grid, but the artifact was unavailable.");
    }
    if (this.mode.contactGrid !== "canonical" && contactWorldGrid === undefined) {
      this.setFallbackStatus("contact-grid-unavailable");
    }
    const visualSurfaceWorldGrid =
      this.mode.surfaceGrid === "canonical"
        ? undefined
        : contactWorldGrid ?? (await loadVisualSurfaceWorldGrid());
    if (this.mode.surfaceGrid === "1deg" && visualSurfaceWorldGrid === undefined) {
      console.warn("PENUMBRA requested 1deg visual surface, but the artifact was unavailable.");
    }
    if (this.mode.surfaceGrid !== "canonical" && visualSurfaceWorldGrid === undefined) {
      this.setFallbackStatus("visual-surface-grid-unavailable");
    }
    const cloudAtlas =
      this.mode.cloudAtlas === "fixture"
        ? await loadCloudAtlas(FIXTURE_CLOUD_ATLAS_URL)
        : this.mode.cloudAtlas === "atlas"
          ? await loadCloudAtlas(DEFAULT_CLOUD_ATLAS_URL)
          : undefined;
    if (
      (this.mode.cloudAtlas === "fixture" || this.mode.cloudAtlas === "atlas") &&
      cloudAtlas === undefined
    ) {
      this.setFallbackStatus("cloud-forecast-unavailable");
    }
    const cloudAtlasSequence =
      this.mode.cloudAtlas === "forecast"
        ? this.acceptCloudAtlasForecastSequence(
            await loadCloudAtlasSequence(this.captureCloudManifestUrl()),
            this.captureUtcMs() ?? this.canonicalClock.nowMs(),
            "initial",
          )
        : undefined;
    if (cloudAtlasSequence) {
      this.lastCloudAtlasForecastRefreshMs = this.canonicalClock.nowMs();
    }
    this.cloudAtlasSequence = cloudAtlasSequence;

    this.worldGrid = worldGrid;
    this.contactWorldGrid = contactWorldGrid;
    this.tuningKernels = tuningKernels;
    this.liveData.seedQuakes(quakeFixture.events);
    this.renderer = new PenumbraRenderer(canvas, worldGrid, {
      debug: this.mode.debug,
      debugHud: this.mode.debugHud,
      earthRootWidget: this.mode.earthRootWidget,
      performance: this.rendererPerformanceOptions(),
      surfaceWorldGrid: visualSurfaceWorldGrid,
      contactWorldGrid,
      cloudAtlas,
      cloudAtlasSequence,
      cloudDiagnostic: this.mode.cloudDiagnostic,
      staticVisualOnly: this.mode.capture,
      windShimmerTrail: this.mode.captureWindTrail,
    });
    this.renderer.resize();
    window.addEventListener("resize", this.resizeHandler);
    this.tick(performance.now());
    this.productionEntryReady = true;
    this.completeProductionEntryIfReady();
  }

  stop(): void {
    window.cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.resizeHandler);
    this.uninstallProductionUiIdleHandlers();
    this.streamOperations?.stop();
    this.audioTuningPanel?.dispose();
    this.audioTuningPanel = undefined;
    this.captureScene = undefined;
    this.capturePanel?.button.removeEventListener("click", this.captureClickHandler);
    this.capturePanel?.element.remove();
    this.capturePanel = undefined;
    this.entryButton?.removeEventListener("click", this.productionEntryClickHandler);
    this.entryOverlay?.remove();
    this.entryOverlay = undefined;
    this.entryButton = undefined;
    this.clearProductionEntryRemovalTimeout();
    this.cancelLogoFontReveal();
    delete this.root.dataset.logoFont;
    delete this.root.dataset.entryState;
    this.fallbackStatusPanel = undefined;
    this.audioButton = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.audio.dispose();
    delete window.__PENUMBRA_PERFORMANCE__;
  }

  private installProductionUiIdleHandlers(): void {
    if (!this.shouldUseProductionUiIdle()) {
      return;
    }

    window.addEventListener("pointermove", this.productionUiActivityHandler);
    window.addEventListener("pointerdown", this.productionUiActivityHandler);
    window.addEventListener("touchstart", this.productionUiActivityHandler);
    window.addEventListener("keydown", this.productionUiActivityHandler);
    this.root.dataset.uiIdle = "off";
  }

  private uninstallProductionUiIdleHandlers(): void {
    window.removeEventListener("pointermove", this.productionUiActivityHandler);
    window.removeEventListener("pointerdown", this.productionUiActivityHandler);
    window.removeEventListener("touchstart", this.productionUiActivityHandler);
    window.removeEventListener("keydown", this.productionUiActivityHandler);
    this.clearProductionUiIdleTimeout();
    this.productionUiIdleActive = false;
    delete this.root.dataset.uiIdle;
  }

  private shouldUseProductionUiIdle(): boolean {
    return !this.mode.debug && !this.mode.audioTuning && !this.mode.stream && !this.mode.capture;
  }

  private shouldUseProductionEntry(): boolean {
    return (
      !this.mode.debug &&
      !this.mode.audioTuning &&
      !this.mode.stream &&
      !this.mode.capture &&
      !this.mode.earthRootWidget
    );
  }

  private applyCaptureSceneMetadata(scene: CaptureScene | undefined): void {
    if (!this.mode.capture) {
      return;
    }

    this.root.dataset.captureScene = scene?.id ?? this.mode.captureSceneId ?? "manual";
    const utcMs = this.captureUtcMs();
    this.root.dataset.captureUtc = utcMs ? new Date(utcMs).toISOString() : "live";
    const size = this.captureSize();
    this.root.dataset.captureSize = size ? `${size.width}x${size.height}` : "viewport";
  }

  private captureUtcMs(): number | undefined {
    if (!this.mode.capture) {
      return undefined;
    }
    return this.mode.captureUtcMs ?? parseCaptureSceneUtcMs(this.captureScene);
  }

  private captureDate(fallback: Date): Date {
    const utcMs = this.captureUtcMs();
    return utcMs === undefined ? fallback : new Date(utcMs);
  }

  private captureSize(): { readonly width: number; readonly height: number } | undefined {
    if (!this.mode.capture) {
      return undefined;
    }
    return this.mode.captureSize ?? this.captureScene?.captureSize;
  }

  private captureCloudManifestUrl(): string {
    if (!this.mode.capture) {
      return DEFAULT_CLOUD_ATLAS_FORECAST_MANIFEST_URL;
    }
    return this.captureScene?.cloud?.manifestUrl ?? DEFAULT_CLOUD_ATLAS_FORECAST_MANIFEST_URL;
  }

  private rendererPerformanceOptions(): AppMode["renderer"] {
    const captureSize = this.captureSize();
    if (!captureSize) {
      return this.mode.renderer;
    }
    return {
      ...this.mode.renderer,
      pixelRatioOverride: 1,
      outputSize: captureSize,
    };
  }

  private shouldGateLogoFont(): boolean {
    return this.mode.stream || this.shouldUseProductionEntry();
  }

  private prepareLogoFontReveal(): void {
    this.cancelLogoFontReveal();
    if (!this.shouldGateLogoFont()) {
      delete this.root.dataset.logoFont;
      return;
    }

    const requestId = ++this.logoFontReadyRequestId;
    this.root.dataset.logoFont = "loading";
    const reveal = (): void => this.revealLogoFont(requestId);
    this.logoFontReadyTimeoutId = window.setTimeout(reveal, LOGO_FONT_LOAD_TIMEOUT_MS);
    void loadPenumbraLogoFont().then(reveal, reveal);
  }

  private revealLogoFont(requestId: number): void {
    if (requestId !== this.logoFontReadyRequestId) {
      return;
    }

    this.clearLogoFontReadyTimeout();
    this.root.dataset.logoFont = "ready";
  }

  private cancelLogoFontReveal(): void {
    this.logoFontReadyRequestId += 1;
    this.clearLogoFontReadyTimeout();
  }

  private clearLogoFontReadyTimeout(): void {
    if (this.logoFontReadyTimeoutId === undefined) {
      return;
    }

    window.clearTimeout(this.logoFontReadyTimeoutId);
    this.logoFontReadyTimeoutId = undefined;
  }

  private setProductionUiIdleActive(active: boolean): void {
    if (!this.shouldUseProductionUiIdle()) {
      return;
    }

    this.productionUiIdleActive = active;
    this.root.dataset.uiIdle = "off";
    this.clearProductionUiIdleTimeout();
    if (active) {
      this.scheduleProductionUiIdle();
    }
  }

  private markProductionUiActive(): void {
    if (!this.productionUiIdleActive) {
      return;
    }

    this.root.dataset.uiIdle = "off";
    this.scheduleProductionUiIdle();
  }

  private scheduleProductionUiIdle(): void {
    this.clearProductionUiIdleTimeout();
    this.productionUiIdleTimeoutId = window.setTimeout(() => {
      this.root.dataset.uiIdle = "on";
      this.productionUiIdleTimeoutId = undefined;
    }, PRODUCTION_UI_IDLE_DELAY_MS);
  }

  private clearProductionUiIdleTimeout(): void {
    if (this.productionUiIdleTimeoutId === undefined) {
      return;
    }

    window.clearTimeout(this.productionUiIdleTimeoutId);
    this.productionUiIdleTimeoutId = undefined;
  }

  private applyFallbackDemoStatuses(): void {
    for (const id of this.mode.fallbackDemo) {
      this.setFallbackStatus(id, { demo: true });
    }
  }

  private setFallbackStatus(
    id: RuntimeFallbackStatusId,
    options: { readonly demo?: boolean; readonly now?: Date } = {},
  ): void {
    if (this.fallbackStatuses.has(id)) {
      return;
    }
    this.fallbackStatuses.set(id, createRuntimeFallbackStatus(id, options));
    this.syncFallbackStatusPanel();
  }

  private clearFallbackStatus(id: RuntimeFallbackStatusId): void {
    const existing = this.fallbackStatuses.get(id);
    if (existing?.demo) {
      return;
    }
    if (!this.fallbackStatuses.delete(id)) {
      return;
    }
    this.syncFallbackStatusPanel();
  }

  private syncFallbackStatusPanel(): void {
    this.fallbackStatusPanel?.update([...this.fallbackStatuses.values()]);
    this.updateAudioButtonState();
    this.updateProductionEntryState();
  }

  private syncAudioFallbackStatuses(): void {
    const audioFallbackIds: readonly RuntimeFallbackStatusId[] = [
      "human-worklet-unavailable",
      "earth-texture-worklet-unavailable",
      "shared-reverb-unavailable",
    ];
    const activeIds = new Set(this.audio.getRuntimeFallbackStatusIds());
    for (const id of audioFallbackIds) {
      if (activeIds.has(id)) {
        this.setFallbackStatus(id);
      } else {
        this.clearFallbackStatus(id);
      }
    }
  }

  private syncLiveDataFallbackStatuses(
    date: Date,
    options: { readonly usingForecastWeather?: boolean } = {},
  ): void {
    const diagnostics = this.liveData.diagnostics(date);
    if (options.usingForecastWeather) {
      this.clearFallbackStatus("live-weather-fallback");
    } else if (diagnostics.lastWeatherError) {
      this.setFallbackStatus("live-weather-fallback", { now: date });
    } else {
      this.clearFallbackStatus("live-weather-fallback");
    }

    if (diagnostics.lastQuakeError) {
      this.setFallbackStatus("live-quake-fallback", { now: date });
    } else {
      this.clearFallbackStatus("live-quake-fallback");
    }
  }

  private hasAudioBlockingFallback(): boolean {
    return [...this.fallbackStatuses.values()].some(isAudioBlockingFallbackStatus);
  }

  private updateAudioButtonState(): void {
    if (!this.audioButton) {
      return;
    }

    if (this.hasAudioBlockingFallback()) {
      this.audioButton.textContent = "Audio paused";
      this.audioButton.disabled = true;
      this.audioButton.setAttribute("aria-pressed", "false");
      return;
    }

    if (this.audioTransitioning) {
      this.audioButton.textContent = this.audioEnabled ? "Stopping audio" : "Starting audio";
      this.audioButton.disabled = true;
      this.audioButton.setAttribute("aria-pressed", this.audioEnabled ? "true" : "false");
      return;
    }

    this.audioButton.textContent = this.audioEnabled ? "Audio on" : "Start audio";
    this.audioButton.disabled = false;
    this.audioButton.setAttribute("aria-pressed", this.audioEnabled ? "true" : "false");
  }

  private updateProductionEntryState(): void {
    if (!this.entryButton) {
      return;
    }

    const disabled =
      this.productionEntryCompleted || this.hasAudioBlockingFallback() || this.audioTransitioning;
    this.entryButton.disabled = disabled;
    this.entryButton.dataset.state =
      this.productionEntryRequested && !this.productionEntryCompleted ? "starting" : "idle";
  }

  private startProductionEntryFromGesture(): void {
    if (!this.shouldUseProductionEntry() || this.productionEntryCompleted) {
      return;
    }
    if (this.audioEnabled) {
      this.productionEntryRequested = true;
      this.completeProductionEntryIfReady();
      return;
    }

    this.productionEntryRequested = true;
    this.root.dataset.entryState = "starting";
    this.updateProductionEntryState();
    this.requestAudioStateFromGesture(true, { requestFullscreen: false });
  }

  private captureVisualFromGesture(): void {
    const panel = this.capturePanel;
    const renderer = this.renderer;
    if (!panel || !renderer) {
      if (panel) {
        panel.status.textContent = "Loading assets";
      }
      return;
    }

    const date = this.captureDate(this.canonicalClock.nowDate());
    this.renderNow(date);
    const pixelSize = renderer.capturePixelSize();
    panel.status.textContent = `Rendering ${pixelSize.width}x${pixelSize.height}`;
    void renderer
      .capturePngBlob()
      .then((blob) => {
        downloadBlob(blob, createCaptureFilename(date, pixelSize));
        panel.status.textContent = `Saved ${pixelSize.width}x${pixelSize.height}`;
      })
      .catch((error: unknown) => {
        console.error(error);
        panel.status.textContent = "Capture failed";
      });
  }

  private requestAudioStateFromGesture(
    nextAudioEnabled: boolean,
    options: { readonly requestFullscreen?: boolean } = {},
  ): void {
    if (this.audioTransitioning || this.hasAudioBlockingFallback()) {
      this.updateProductionEntryState();
      return;
    }

    this.audioTransitioning = true;
    this.updateAudioButtonState();
    this.updateProductionEntryState();
    if (nextAudioEnabled && options.requestFullscreen !== false) {
      void this.streamOperations?.requestFullscreenFromGesture().catch(() => undefined);
    }

    void (nextAudioEnabled ? this.audio.start() : this.audio.stopAudio())
      .then(async () => {
        if (nextAudioEnabled) {
          this.syncAudioFallbackStatuses();
        }
        if (nextAudioEnabled && this.hasAudioBlockingFallback()) {
          await this.audio.stopAudio();
          this.audioEnabled = false;
        } else {
          this.audioEnabled = nextAudioEnabled;
        }
        this.audioTransitioning = false;
        this.updateAudioButtonState();
        this.updateProductionEntryState();
        this.setProductionUiIdleActive(this.audioEnabled);
        this.completeProductionEntryIfReady();
      })
      .catch((error: unknown) => {
        this.audioTransitioning = false;
        if (this.audioButton) {
          this.audioButton.textContent = "Audio unavailable";
          this.audioButton.disabled = true;
          this.audioButton.setAttribute("aria-pressed", "false");
        }
        this.updateProductionEntryState();
        console.error(error);
      });
  }

  private completeProductionEntryIfReady(): void {
    if (
      !this.shouldUseProductionEntry() ||
      this.productionEntryCompleted ||
      !this.productionEntryRequested ||
      !this.productionEntryReady ||
      !this.audioEnabled ||
      this.hasAudioBlockingFallback()
    ) {
      return;
    }

    this.productionEntryCompleted = true;
    this.root.dataset.entryState = "entered";
    this.updateProductionEntryState();
    this.setProductionUiIdleActive(true);
    this.clearProductionEntryRemovalTimeout();
    this.productionEntryRemovalTimeoutId = window.setTimeout(() => {
      this.entryButton?.removeEventListener("click", this.productionEntryClickHandler);
      this.entryOverlay?.remove();
      this.entryOverlay = undefined;
      this.entryButton = undefined;
      delete this.root.dataset.entryState;
      this.productionEntryRemovalTimeoutId = undefined;
    }, PRODUCTION_ENTRY_FADE_MS);
  }

  private clearProductionEntryRemovalTimeout(): void {
    if (this.productionEntryRemovalTimeoutId === undefined) {
      return;
    }

    window.clearTimeout(this.productionEntryRemovalTimeoutId);
    this.productionEntryRemovalTimeoutId = undefined;
  }

  private tick = (nowMs: number): void => {
    const frameIntervalMs = 1000 / this.mode.targetFps;
    if (nowMs - this.lastRenderMs >= frameIntervalMs) {
      const frameElapsedMs =
        this.lastRenderedFrameMs === undefined ? frameIntervalMs : nowMs - this.lastRenderedFrameMs;
      this.lastRenderMs = nowMs;
      this.lastRenderedFrameMs = nowMs;
      this.streamOperations?.markFrame(nowMs);
      this.maybeRefreshCanonicalClock(nowMs);
      const renderStartedMs = performance.now();
      this.renderNow(this.canonicalClock.nowDate());
      this.renderedFrameCount += 1;
      this.latestFrameStats = this.frameProfiler.record({
        frameElapsedMs,
        renderElapsedMs: performance.now() - renderStartedMs,
        heapUsedBytes: readHeapUsedBytes(),
      });
      this.publishPerformanceProbe();
    }
    this.animationFrame = window.requestAnimationFrame(this.tick);
  };

  private maybeRefreshCanonicalClock(performanceMs: number): void {
    if (
      this.clockSyncInFlight ||
      performanceMs - this.lastClockSyncProbePerformanceMs < SERVER_CLOCK_SYNC_REFRESH_MS
    ) {
      return;
    }

    void this.syncCanonicalClock("refresh");
  }

  private syncCanonicalClock(phase: "initial" | "refresh"): Promise<void> {
    if (this.clockSyncInFlight) {
      return this.clockSyncInFlight;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), SERVER_CLOCK_SYNC_TIMEOUT_MS);
    this.root.dataset.clockSync = "syncing";
    this.lastClockSyncProbePerformanceMs = performance.now();

    this.clockSyncInFlight = estimateServerDateClockOffset({
      fetcher: window.fetch.bind(window),
      maxRoundTripMs: SERVER_CLOCK_SYNC_TIMEOUT_MS,
      nowMs: () => Date.now(),
      sampleCount: SERVER_CLOCK_SYNC_SAMPLE_COUNT,
      signal: controller.signal,
      url: this.createServerClockProbeUrl(),
    })
      .then((result) => this.applyCanonicalClockSyncResult(result, phase))
      .catch((error: unknown) => {
        console.warn("PENUMBRA server clock sync failed; using browser UTC.", error);
        this.root.dataset.clockSync = "local-fallback";
        this.root.dataset.clockSyncReason = "exception";
        this.setFallbackStatus("canonical-clock-local-fallback", {
          now: this.canonicalClock.nowDate(),
        });
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        this.clockSyncInFlight = undefined;
      });

    return this.clockSyncInFlight;
  }

  private applyCanonicalClockSyncResult(
    result: ServerDateClockSyncResult,
    phase: "initial" | "refresh",
  ): void {
    if (result.status === "synced") {
      this.canonicalClock.applySample(result.sample);
      this.root.dataset.clockSync = result.sample.source;
      this.root.dataset.clockOffsetMs = String(Math.round(result.sample.offsetMs));
      this.root.dataset.clockRoundTripMs = String(Math.round(result.sample.roundTripMs));
      delete this.root.dataset.clockSyncReason;
      this.clearFallbackStatus("canonical-clock-local-fallback");
      return;
    }

    if (phase === "refresh" && this.canonicalClock.getLastSample()) {
      this.root.dataset.clockSync = "server-date-stale";
      this.root.dataset.clockSyncReason = result.reason;
      return;
    }

    this.root.dataset.clockSync = "local-fallback";
    this.root.dataset.clockSyncReason = result.reason;
    delete this.root.dataset.clockOffsetMs;
    delete this.root.dataset.clockRoundTripMs;
    this.setFallbackStatus("canonical-clock-local-fallback", { now: this.canonicalClock.nowDate() });
  }

  private createServerClockProbeUrl(): string {
    return new URL(SERVER_CLOCK_SYNC_ENDPOINT, window.location.href).toString();
  }

  private renderNow(date: Date): void {
    if (!this.worldGrid || !this.tuningKernels || !this.renderer) {
      return;
    }

    const renderDate = this.captureDate(date);
    const scanlineState = createScanlineState(renderDate);
    if (!this.mode.capture) {
      void this.liveData.maybePollQuakes(renderDate);
      this.maybeRefreshCloudAtlasForecast(renderDate);
      this.expireCloudAtlasForecastIfNeeded(renderDate);
      if (!this.hasForecastWeather(renderDate)) {
        void this.liveData.maybeRefreshWeatherForScanline(scanlineState, this.worldGrid, renderDate);
      }
      this.syncLiveDataFallbackStatuses(renderDate, {
        usingForecastWeather: this.hasForecastWeather(renderDate),
      });
    }
    const samples = createCanonicalScanlineSamples({
      scanlineState,
      worldGrid: this.worldGrid,
      musicContactWorldGrid: this.contactWorldGrid,
      tuningKernels: this.tuningKernels,
      quakes: this.mode.capture ? [] : this.liveData.listQuakes(renderDate),
      weatherForCell: (cellId, cell) =>
        this.mode.capture ? undefined : this.weatherSampleForCell(cellId, cell, renderDate),
      tuningModeAtmosphereForCell: (cell) =>
        tuningModeAtmosphereFromCloudAtlasSequence({
          sequence: this.cloudAtlasSequence,
          utcMs: scanlineState.utc.epochMs,
          latitudeDeg: cell.latCenterDeg,
          longitudeDeg: cell.lonCenterDeg,
        }),
    });
    const precipitationBand = precipitationBandFieldFromCloudAtlasSequence({
      sequence: this.cloudAtlasSequence,
      scanlineState,
    });
    const audioFrame = deriveAudioFrameParams(samples, {
      precipitationOverride01: precipitationBand?.activity01,
    });
    if (!this.mode.capture) {
      this.audio.update(audioFrame);
    }
    const visualAudioFrame = this.mode.capture
      ? this.mode.captureWind
        ? audioFrame
        : undefined
      : audioFrame;
    const snapshot = { scanlineState, samples };
    this.runtimeStore.setSnapshot(snapshot);
    this.renderer.render(
      snapshot,
      visualAudioFrame,
      this.mode.capture ? undefined : precipitationBand,
      this.mode.capture ? undefined : this.audio.getEarthRootDebugMeter(),
    );
  }

  private hasForecastWeather(date: Date): boolean {
    if (!this.cloudAtlasSequence) {
      return false;
    }

    return cloudAtlasSequenceFreshness(this.cloudAtlasSequence, date.getTime()).usable;
  }

  private weatherSampleForCell(
    cellId: string,
    cell: WorldGridCell,
    date: Date,
  ): WeatherSample | undefined {
    const forecastWeather = weatherSampleFromCloudAtlasSequence({
      sequence: this.cloudAtlasSequence,
      utcMs: date.getTime(),
      latitudeDeg: cell.latCenterDeg,
      longitudeDeg: cell.lonCenterDeg,
    });
    return forecastWeather ?? this.liveData.getWeatherForCell(cellId, date);
  }

  private maybeRefreshCloudAtlasForecast(date: Date): void {
    if (this.mode.capture || this.mode.cloudAtlas !== "forecast" || !this.renderer) {
      return;
    }

    const utcMs = date.getTime();
    if (
      this.cloudAtlasForecastRefreshInFlight ||
      utcMs - this.lastCloudAtlasForecastRefreshMs < CLOUD_ATLAS_FORECAST_REFRESH_MS
    ) {
      return;
    }

    this.lastCloudAtlasForecastRefreshMs = utcMs;
    const cacheBust = String(Math.floor(utcMs / CLOUD_ATLAS_FORECAST_REFRESH_MS));
    this.cloudAtlasForecastRefreshInFlight = loadCloudAtlasSequence(
      DEFAULT_CLOUD_ATLAS_FORECAST_MANIFEST_URL,
      { cacheBust },
    )
      .then((sequence) => {
        if (!this.renderer) {
          return;
        }
        if (!sequence) {
          this.setFallbackStatus("cloud-forecast-unavailable");
          return;
        }
        const acceptedSequence = this.acceptCloudAtlasForecastSequence(sequence, utcMs, "refresh");
        if (!acceptedSequence) {
          return;
        }
        if (this.renderer.setCloudAtlasSequence(acceptedSequence, utcMs)) {
          this.cloudAtlasSequence = acceptedSequence;
        }
      })
      .catch((error: unknown) => {
        console.warn("Failed to refresh cloud atlas forecast manifest.", error);
        this.setFallbackStatus("cloud-forecast-unavailable");
      })
      .finally(() => {
        this.cloudAtlasForecastRefreshInFlight = undefined;
      });
  }

  private expireCloudAtlasForecastIfNeeded(date: Date): void {
    if (this.mode.cloudAtlas !== "forecast" || !this.cloudAtlasSequence) {
      return;
    }

    const freshness = cloudAtlasSequenceFreshness(this.cloudAtlasSequence, date.getTime());
    if (freshness.usable) {
      return;
    }

    console.warn(
      `PENUMBRA cloud atlas forecast expired; falling back to scanline-local clouds. ${freshness.message}`,
    );
    this.setFallbackStatus("cloud-forecast-unavailable");
    this.cloudAtlasSequence = undefined;
    this.renderer?.clearCloudAtlasSequence();
  }

  private acceptCloudAtlasForecastSequence(
    sequence: CloudAtlasSequence | undefined,
    utcMs: number,
    phase: "initial" | "refresh",
  ): CloudAtlasSequence | undefined {
    const freshness = cloudAtlasSequenceFreshness(sequence, utcMs);
    if (freshness.usable) {
      this.clearFallbackStatus("cloud-forecast-unavailable");
      return sequence;
    }

    const rejectKey = [
      phase,
      sequence?.manifest.generatedAtUtc ?? "none",
      freshness.status,
      freshness.lastValidAtUtc ?? "",
    ].join(":");
    if (this.lastCloudAtlasForecastRejectKey !== rejectKey) {
      this.lastCloudAtlasForecastRejectKey = rejectKey;
      console.warn(
        `PENUMBRA ignored ${phase} cloud atlas forecast; using scanline-local clouds. ${freshness.message}`,
      );
    }
    this.setFallbackStatus("cloud-forecast-unavailable");
    return undefined;
  }

  private publishPerformanceProbe(): void {
    window.__PENUMBRA_PERFORMANCE__ = {
      performanceProfile: this.mode.performanceProfile,
      targetFps: this.mode.targetFps,
      renderedFrameCount: this.renderedFrameCount,
      stats: this.latestFrameStats,
    };
  }
}

function createStreamSafetyCopyElement(): HTMLElement {
  const section = document.createElement("section");
  section.className = "penumbra__safety-copy";
  section.setAttribute("aria-label", "PENUMBRA live stream safety notice");
  section.textContent = LIVE_SAFETY_COPY;
  return section;
}

function createStreamTitleElement(): HTMLElement {
  const title = document.createElement("div");
  title.className = "penumbra__stream-title";
  title.setAttribute("aria-hidden", "true");
  title.textContent = "penumbra";
  return title;
}

function createProductionEntryElement(): {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;
} {
  const overlay = document.createElement("section");
  overlay.className = "penumbra__entry-overlay";
  overlay.setAttribute("aria-label", "PENUMBRA entry");

  const button = document.createElement("button");
  button.className = "penumbra__entry-button";
  button.type = "button";
  button.textContent = "penumbra";
  button.dataset.state = "idle";

  overlay.append(button);
  return { element: overlay, button };
}

interface CapturePanel {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly status: HTMLElement;
}

function createCapturePanel(): CapturePanel {
  const panel = document.createElement("section");
  panel.className = "penumbra__capture-panel";
  panel.setAttribute("aria-label", "PENUMBRA visual capture");

  const title = document.createElement("div");
  title.className = "penumbra__capture-title";
  title.textContent = "Capture";

  const button = document.createElement("button");
  button.className = "penumbra__capture-button";
  button.type = "button";
  button.textContent = "Save PNG";

  const status = document.createElement("div");
  status.className = "penumbra__capture-status";
  status.textContent = "Canvas only";

  panel.append(title, button, status);
  return { element: panel, button, status };
}

function createCaptureFilename(
  date: Date,
  pixelSize: { readonly width: number; readonly height: number },
): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return `penumbra-${timestamp}-${pixelSize.width}x${pixelSize.height}.png`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseCaptureSceneUtcMs(scene: CaptureScene | undefined): number | undefined {
  if (!scene) {
    return undefined;
  }

  const utcMs = Date.parse(scene.utc);
  return Number.isFinite(utcMs) ? utcMs : undefined;
}

function loadPenumbraLogoFont(): Promise<void> {
  if (!("fonts" in document)) {
    return Promise.resolve();
  }

  return document.fonts.load(LOGO_FONT_FACE, "penumbra").then(() => undefined);
}

interface PenumbraPerformanceProbe {
  readonly performanceProfile: AppMode["performanceProfile"];
  readonly targetFps: AppMode["targetFps"];
  readonly renderedFrameCount: number;
  readonly stats: FrameProfilerStats | undefined;
}

interface PerformanceMemory {
  readonly usedJSHeapSize: number;
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: PerformanceMemory;
}

function readHeapUsedBytes(): number | undefined {
  return (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
}

declare global {
  interface Window {
    __PENUMBRA_PERFORMANCE__?: PenumbraPerformanceProbe;
  }
}
