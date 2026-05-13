export interface StreamOperationalOptions {
  readonly enabled: boolean;
  readonly fullscreenPreference: boolean;
  readonly reloadOnRuntimeError: boolean;
  readonly stallReloadMs: number;
  readonly scheduledReloadMs: number;
  readonly checkIntervalMs: number;
}

export interface StreamOperationalController {
  readonly options: StreamOperationalOptions;
  start(): void;
  stop(): void;
  markFrame(nowMs: number): void;
  requestFullscreenFromGesture(): Promise<void>;
}

export const DEFAULT_STREAM_STALL_RELOAD_MS = 45_000;
export const DEFAULT_STREAM_SCHEDULED_RELOAD_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_STREAM_CHECK_INTERVAL_MS = 5_000;

export function createStreamOperationalController(
  root: HTMLElement,
  options: StreamOperationalOptions,
): StreamOperationalController {
  let lastFrameMs = performance.now();
  let intervalId: number | undefined;
  let scheduledReloadId: number | undefined;
  let hasStarted = false;

  const reload = (reason: string): void => {
    if (document.visibilityState === "hidden") {
      return;
    }

    console.warn(`PENUMBRA stream recovery reload: ${reason}`);
    window.location.reload();
  };

  const runtimeErrorHandler = (): void => reload("runtime error");
  const unhandledRejectionHandler = (): void => reload("unhandled promise rejection");

  return {
    options,
    start(): void {
      if (!options.enabled || hasStarted) {
        return;
      }

      hasStarted = true;
      if (options.reloadOnRuntimeError) {
        window.addEventListener("error", runtimeErrorHandler);
        window.addEventListener("unhandledrejection", unhandledRejectionHandler);
      }

      intervalId = window.setInterval(() => {
        const elapsedMs = performance.now() - lastFrameMs;
        if (elapsedMs > options.stallReloadMs) {
          reload(`render heartbeat stalled for ${Math.round(elapsedMs)}ms`);
        }
      }, options.checkIntervalMs);

      scheduledReloadId = window.setTimeout(() => {
        reload(`scheduled ${Math.round(options.scheduledReloadMs / 60_000)} minute refresh`);
      }, options.scheduledReloadMs);
    },
    stop(): void {
      if (!hasStarted) {
        return;
      }

      hasStarted = false;
      window.removeEventListener("error", runtimeErrorHandler);
      window.removeEventListener("unhandledrejection", unhandledRejectionHandler);

      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }

      if (scheduledReloadId !== undefined) {
        window.clearTimeout(scheduledReloadId);
        scheduledReloadId = undefined;
      }
    },
    markFrame(nowMs: number): void {
      lastFrameMs = nowMs;
    },
    async requestFullscreenFromGesture(): Promise<void> {
      if (!options.enabled || !options.fullscreenPreference || document.fullscreenElement) {
        return;
      }

      await root.requestFullscreen?.({ navigationUI: "hide" });
    },
  };
}
