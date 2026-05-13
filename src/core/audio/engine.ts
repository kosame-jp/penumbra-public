import { connect as connectTone, Convolver, setContext as setToneContext } from "tone";

import { HUMAN_LAYER_OUTPUT_GAIN, MASTER_OUTPUT_GAIN, type AudioFrameParams } from "./audio-params";
import {
  DEFAULT_AUDIO_TUNING_OVERRIDES,
  audioTuningGain,
  clampAudioPerfDiagnosticBypasses,
  clampAudioPerfDiagnostics,
  clampAudioTuningOverrides,
  createDefaultAudioPerfDiagnostics,
  type AudioPerfDiagnostics,
  type AudioPerfDiagnosticBypasses,
  type AudioTuningControlKey,
  type AudioTuningOverrides,
} from "./audio-tuning";
import { createAudioContextFromUserGesture } from "./context-gate";
import type { AudioDebugMode } from "./debug-mode";
import { deriveEarthFormantParams } from "./earth-formant";
import {
  createEarthRootDebugMeterSnapshotFromTimeDomain,
  smoothEarthRootDebugMeterRootHz,
  type EarthRootDebugMeterSnapshot,
} from "./earth-root-debug-meter";
import {
  EARTH_DRONE_GAIN_SUM_CAP,
  EARTH_DRONE_PARTIALS,
  deriveEarthAirTurbulence,
  earthDroneCompanionParams,
  earthDronePartialFrequencyHz,
  earthDronePartialGainRaw,
  earthDroneRootHz,
  type EarthAirTurbulence,
  type EarthDronePartialConfig,
} from "./earth-drone-spectrum";
import { deriveHumanPluckParams } from "./human-pluck-params";
import {
  createHumanWorkletDiagnosticsMessage,
  createHumanWorkletPluckMessage,
  HUMAN_LAYER_WORKLET_MODULE_URL,
  HUMAN_LAYER_WORKLET_PROCESSOR_NAME,
  HUMAN_WORKLET_SCHEDULE_AHEAD_SECONDS,
} from "./human-worklet-events";
import {
  derivePenumbraEarthTextureParams,
  penumbraDropletFrequencyForBand,
  type PenumbraDropletBand,
  type PenumbraEarthTextureParams,
  type PenumbraRainGranularParams,
  type PenumbraWaterTextureParams,
} from "./penumbra-earth-texture-params";
import type { RuntimeFallbackStatusId } from "../runtime/fallback-status";
import {
  createPenumbraEarthTextureContinuousMessage,
  createPenumbraRainGranularMessage,
  createPenumbraWaterDropletMessage,
  PENUMBRA_EARTH_TEXTURE_SCHEDULE_AHEAD_SECONDS,
  PENUMBRA_EARTH_TEXTURE_WORKLET_MODULE_URL,
  PENUMBRA_EARTH_TEXTURE_WORKLET_PROCESSOR_NAME,
} from "./penumbra-earth-texture-worklet-events";
import {
  hashUint32,
  hashUint32To01,
  utcSeededAudioEventsInWindow,
} from "./utc-event-field";
import {
  canonicalWaterDropletEventsInWindow,
} from "./water-droplet-events";
import {
  humanEnsembleDensityPeriodScale,
  nextHumanPulseEvent,
  type HumanPulseEvent,
} from "../fusion/human-pulse-scheduler";
import { nextQuakePulseEvent, type QuakePulseEvent } from "../fusion/quake-pulse-scheduler";

interface HumanVoiceRuntimeState {
  readonly previousUtcMs: number;
}

interface QuakeRuntimeState {
  readonly previousUtcMs: number;
}

interface PenumbraAudioEngineOptions {
  readonly audioDebugMode?: AudioDebugMode;
  readonly debug?: boolean;
}

interface EarthDronePartialNode {
  readonly config: EarthDronePartialConfig;
  readonly oscillator: OscillatorNode;
  readonly gain: GainNode;
}

interface EarthDroneCompanionNode {
  readonly oscillator: OscillatorNode;
  readonly gain: GainNode;
}

interface HumanReverbBus {
  readonly input: GainNode;
}

interface EarthTextureReverbBus {
  readonly input: GainNode;
  readonly textureSendGain: GainNode;
  readonly waterTextureSendGain: GainNode;
  readonly windTextureSendGain: GainNode;
  readonly humanSendGain: GainNode;
  readonly droneSendGain: GainNode;
  readonly quakeSendGain: GainNode;
  readonly returnGain: GainNode;
  readonly reverb: Convolver;
}

interface EarthFormantBandNode {
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
}

interface EarthFormantBus {
  readonly input: GainNode;
  readonly droneSendGain: GainNode;
  readonly windSendGain: GainNode;
  readonly noiseSendGain: GainNode;
  readonly outputGain: GainNode;
  readonly bands: readonly EarthFormantBandNode[];
}

interface EarthRootReverbDebugBranch {
  readonly oscillator: OscillatorNode;
  readonly inputGain: GainNode;
  readonly leftAnalyser: AnalyserNode;
  readonly rightAnalyser: AnalyserNode;
  readonly leftBuffer: Float32Array<ArrayBuffer>;
  readonly rightBuffer: Float32Array<ArrayBuffer>;
  readonly nodes: readonly AudioNode[];
}

const EARTH_TEXTURE_OLD_NOISE_BLEND = 0;
const EARTH_TEXTURE_OLD_SURFACE_BLEND = 0;
const EARTH_TEXTURE_DRY_OUTPUT_GAIN = 2.25;
const EARTH_TEXTURE_TONE_REVERB_SEND_GAIN = 3;
const HUMAN_TONE_REVERB_SEND_GAIN = 0.32;
const EARTH_DRONE_TONE_REVERB_SEND_GAIN = 0.22;
const QUAKE_TONE_REVERB_SEND_GAIN = 0.72;
const EARTH_TEXTURE_REVERB_DECAY_SECONDS = 8;
const EARTH_TEXTURE_REVERB_PREDELAY_SECONDS = 0.045;
const EARTH_TEXTURE_CONTINUOUS_UPDATE_INTERVAL_SECONDS = 1 / 8;
const CONTINUOUS_AUDIO_PARAM_UPDATE_INTERVAL_SECONDS = 1 / 10;
const AUDIO_START_MUTE_HOLD_SECONDS = 0.15;
const AUDIO_START_FADE_IN_SECONDS = 0.8;
const PRECIPITATION_GRAIN_TRIGGER_FLOOR = 0.000035;
const PENUMBRA_DROPLET_BANDS: readonly PenumbraDropletBand[] = ["low", "mid", "high"];
const AUDIO_EVENT_SCHEDULE_AHEAD_MS = 160;
const MASTER_SAFETY_LIMITER_THRESHOLD_DB = -0.3;
const MASTER_SAFETY_LIMITER_RATIO = 20;
const MASTER_SAFETY_LIMITER_ATTACK_SECONDS = 0.003;
const MASTER_SAFETY_LIMITER_RELEASE_SECONDS = 0.01;
const QUAKE_LAYER_BASE_GAIN = 0.28;
const QUAKE_LAYER_ENERGY_GAIN = 0.32;
const QUAKE_IMPACT_PEAK_FLOOR = 0.1;
const QUAKE_IMPACT_PEAK_RANGE = 0.38;
const LEGACY_LOOPING_NOISE_SECONDS = 16;
const LEGACY_LOOPING_NOISE_SEAM_FADE_SECONDS = 0.04;

export class PenumbraAudioEngine {
  private readonly audioDebugMode: AudioDebugMode;
  private readonly debug: boolean;
  private audioContext: AudioContext | undefined;
  private masterGain: GainNode | undefined;
  private masterSafetyLimiter: DynamicsCompressorNode | undefined;
  private earthGain: GainNode | undefined;
  private earthToneGain: GainNode | undefined;
  private earthToneDryGain: GainNode | undefined;
  private earthNoiseGain: GainNode | undefined;
  private earthBrownNoiseGain: GainNode | undefined;
  private earthPinkNoiseGain: GainNode | undefined;
  private earthWhiteNoiseGain: GainNode | undefined;
  private earthSurfaceTextureGain: GainNode | undefined;
  private earthSurfaceTextureFilter: BiquadFilterNode | undefined;
  private humanPluckGain: GainNode | undefined;
  private humanReverbBus: HumanReverbBus | undefined;
  private quakeGain: GainNode | undefined;
  private earthFilter: BiquadFilterNode | undefined;
  private earthDronePartials: EarthDronePartialNode[] = [];
  private earthDroneCompanion: EarthDroneCompanionNode | undefined;
  private earthNoiseSources: AudioBufferSourceNode[] = [];
  private earthTextureWorklet: AudioWorkletNode | undefined;
  private earthTextureDryGain: GainNode | undefined;
  private earthTextureWaterDryGain: GainNode | undefined;
  private earthTextureWindDryGain: GainNode | undefined;
  private earthTextureReverbBus: EarthTextureReverbBus | undefined;
  private earthFormantBus: EarthFormantBus | undefined;
  private earthRootReverbDebugBranch: EarthRootReverbDebugBranch | undefined;
  private humanWorklet: AudioWorkletNode | undefined;
  private humanVoiceStates = new Map<string, HumanVoiceRuntimeState>();
  private quakePulseStates = new Map<string, QuakeRuntimeState>();
  private lastScheduledPrecipitationGrainUtcMs: number | undefined;
  private lastScheduledEarthTextureDropletUtcMs: Partial<Record<PenumbraDropletBand, number>> = {};
  private lastScheduledRainGranularUtcMs: number | undefined;
  private lastEarthTextureContinuousMessageSeconds: number | undefined;
  private lastContinuousAudioParamUpdateSeconds: number | undefined;
  private masterStartupFadeUntilSeconds: number | undefined;
  private lastFrame: AudioFrameParams | undefined;
  private audioOutputEnabled = false;
  private audioOutputTransitionToken = 0;
  private earthRootDebugMeterDisplayGain = 8;
  private earthRootDebugMeterRootHz: number | undefined;
  private earthRootDebugMeterLastUpdateSeconds: number | undefined;
  private humanEventCapBucketUtcSecond: number | undefined;
  private humanEventCapBucketCount = 0;
  private tuningOverrides: AudioTuningOverrides = DEFAULT_AUDIO_TUNING_OVERRIDES;
  private perfDiagnostics: AudioPerfDiagnostics = createDefaultAudioPerfDiagnostics();
  private readonly runtimeFallbackIds = new Set<RuntimeFallbackStatusId>();

  constructor(options: PenumbraAudioEngineOptions = {}) {
    this.audioDebugMode = options.audioDebugMode ?? "off";
    this.debug = options.debug ?? false;
  }

  setTuningOverrides(overrides: Partial<AudioTuningOverrides>): void {
    this.tuningOverrides = clampAudioTuningOverrides(overrides);
  }

  setPerfDiagnosticBypasses(bypasses: Partial<AudioPerfDiagnosticBypasses>): void {
    this.setPerfDiagnostics({
      ...this.perfDiagnostics,
      bypasses: clampAudioPerfDiagnosticBypasses(bypasses),
    });
  }

  setPerfDiagnostics(diagnostics: Partial<AudioPerfDiagnostics>): void {
    this.perfDiagnostics = clampAudioPerfDiagnostics({
      ...this.perfDiagnostics,
      ...diagnostics,
    });
    if (this.perfDiagnostics.bypasses.humanWorklet) {
      this.humanVoiceStates.clear();
    }
    this.humanEventCapBucketUtcSecond = undefined;
    this.humanEventCapBucketCount = 0;
    if (this.perfDiagnostics.bypasses.rainGranular) {
      this.lastScheduledRainGranularUtcMs = undefined;
    }
    if (this.perfDiagnostics.bypasses.earthTextureWorklet) {
      this.lastScheduledEarthTextureDropletUtcMs = {};
      this.lastEarthTextureContinuousMessageSeconds = undefined;
    }
    this.postHumanWorkletDiagnostics();
  }

  getRuntimeFallbackStatusIds(): readonly RuntimeFallbackStatusId[] {
    return [...this.runtimeFallbackIds];
  }

  async start(): Promise<void> {
    this.audioOutputEnabled = true;
    const transitionToken = ++this.audioOutputTransitionToken;
    if (this.audioContext) {
      this.forceMasterGainSilent();
      await this.audioContext.resume();
      if (transitionToken === this.audioOutputTransitionToken) {
        this.scheduleMasterGainStartupFade();
      }
      return;
    }

    const audioContext = await createAudioContextFromUserGesture();
    const masterGain = audioContext.createGain();
    const masterSafetyLimiter = createMasterSafetyLimiter(audioContext);
    const earthGain = audioContext.createGain();
    const earthToneGain = audioContext.createGain();
    const earthToneDryGain = audioContext.createGain();
    const earthNoiseGain = audioContext.createGain();
    const earthBrownNoiseGain = audioContext.createGain();
    const earthPinkNoiseGain = audioContext.createGain();
    const earthWhiteNoiseGain = audioContext.createGain();
    const earthSurfaceTextureGain = audioContext.createGain();
    const humanPluckGain = audioContext.createGain();
    const quakeGain = audioContext.createGain();
    const humanWorklet = this.perfDiagnostics.bypasses.humanWorklet
      ? undefined
      : await createHumanLayerWorklet(audioContext, this.audioDebugMode);
    const earthTextureWorklet = this.perfDiagnostics.bypasses.earthTextureWorklet
      ? undefined
      : await createPenumbraEarthTextureWorklet(audioContext);
    const earthTextureDryGain = earthTextureWorklet ? audioContext.createGain() : undefined;
    const earthTextureWaterDryGain = earthTextureWorklet ? audioContext.createGain() : undefined;
    const earthTextureWindDryGain = earthTextureWorklet ? audioContext.createGain() : undefined;
    const earthTextureReverbBus = this.perfDiagnostics.bypasses.sharedReverb
      ? undefined
      : createEarthTextureReverbBus(audioContext);
    const earthFormantBus = this.perfDiagnostics.bypasses.formant
      ? undefined
      : createEarthFormantBus(audioContext, earthGain);
    const humanReverbBus = createHumanReverbBus(audioContext, humanPluckGain);
    const earthRootReverbDebugBranch = this.debug
      ? createEarthRootReverbDebugBranch(audioContext)
      : undefined;
    this.setRuntimeFallbackId(
      "human-worklet-unavailable",
      !this.perfDiagnostics.bypasses.humanWorklet && humanWorklet === undefined,
    );
    this.setRuntimeFallbackId(
      "earth-texture-worklet-unavailable",
      !this.perfDiagnostics.bypasses.earthTextureWorklet && earthTextureWorklet === undefined,
    );
    this.setRuntimeFallbackId(
      "shared-reverb-unavailable",
      !this.perfDiagnostics.bypasses.sharedReverb && earthTextureReverbBus === undefined,
    );

    masterGain.channelCount = 2;
    masterGain.channelCountMode = "explicit";
    masterSafetyLimiter.channelCount = 2;
    masterSafetyLimiter.channelCountMode = "explicit";
    humanPluckGain.channelCount = 2;
    humanPluckGain.channelCountMode = "explicit";

    masterGain.gain.value = 0;
    earthGain.gain.value = this.tuningGain("earthBusGainDb");
    earthToneGain.gain.value = 0;
    earthToneDryGain.gain.value = 1;
    earthNoiseGain.gain.value = 0;
    earthBrownNoiseGain.gain.value = 0;
    earthPinkNoiseGain.gain.value = 1;
    earthWhiteNoiseGain.gain.value = 0;
    earthSurfaceTextureGain.gain.value = 0;
    humanPluckGain.gain.value = HUMAN_LAYER_OUTPUT_GAIN * this.tuningGain("humanLayerGainDb");
    quakeGain.gain.value = 0;
    if (earthTextureDryGain) {
      earthTextureDryGain.gain.value =
        EARTH_TEXTURE_DRY_OUTPUT_GAIN * this.tuningGain("earthTextureDryGainDb");
    }
    if (earthTextureWaterDryGain) {
      earthTextureWaterDryGain.gain.value =
        EARTH_TEXTURE_DRY_OUTPUT_GAIN *
        this.tuningGain("earthTextureDryGainDb") *
        this.tuningGain("waterTextureDryGainDb");
    }
    if (earthTextureWindDryGain) {
      earthTextureWindDryGain.gain.value =
        EARTH_TEXTURE_DRY_OUTPUT_GAIN *
        this.tuningGain("earthTextureDryGainDb") *
        this.tuningGain("windTextureDryGainDb");
    }

    const brownNoise = createLoopingColoredNoise(audioContext, "brown");
    const pinkNoise = createLoopingColoredNoise(audioContext, "pink");
    const whiteNoise = createLoopingColoredNoise(audioContext, "white");
    const surfaceTextureNoise = createLoopingColoredNoise(audioContext, "white");
    const earthFilter = audioContext.createBiquadFilter();
    const earthSurfaceTextureFilter = audioContext.createBiquadFilter();
    earthFilter.type = "lowpass";
    earthFilter.frequency.value = 700;
    earthFilter.Q.value = 0.0001;
    earthSurfaceTextureFilter.type = "bandpass";
    earthSurfaceTextureFilter.frequency.value = 900;
    earthSurfaceTextureFilter.Q.value = 0.35;

    brownNoise.connect(earthBrownNoiseGain).connect(earthFilter);
    pinkNoise.connect(earthPinkNoiseGain).connect(earthFilter);
    whiteNoise.connect(earthWhiteNoiseGain).connect(earthFilter);
    earthFilter.connect(earthNoiseGain).connect(earthGain).connect(masterGain);
    if (earthFormantBus) {
      earthFilter.connect(earthFormantBus.noiseSendGain).connect(earthFormantBus.input);
    }
    surfaceTextureNoise.connect(earthSurfaceTextureFilter).connect(earthSurfaceTextureGain).connect(earthGain);
    const earthDronePartials = createEarthDronePartials(audioContext, earthToneGain);
    const earthDroneCompanion = this.perfDiagnostics.bypasses.droneCompanion
      ? undefined
      : createEarthDroneCompanion(audioContext, earthToneGain);
    earthToneGain.connect(earthToneDryGain).connect(earthGain);
    if (earthFormantBus) {
      earthToneGain.connect(earthFormantBus.droneSendGain).connect(earthFormantBus.input);
    }
    if (earthTextureReverbBus) {
      earthToneGain.connect(earthTextureReverbBus.droneSendGain).connect(earthTextureReverbBus.input);
      connectTone(earthTextureReverbBus.input, earthTextureReverbBus.reverb);
      connectTone(earthTextureReverbBus.reverb, earthTextureReverbBus.returnGain);
      earthTextureReverbBus.returnGain.connect(earthGain);
    }
    if (
      earthTextureWorklet &&
      earthTextureWaterDryGain &&
      earthTextureWindDryGain &&
      earthTextureReverbBus
    ) {
      earthTextureWorklet.connect(earthTextureWaterDryGain, 2, 0).connect(earthGain);
      earthTextureWorklet.connect(earthTextureWindDryGain, 3, 0).connect(earthGain);
      earthTextureWorklet
        .connect(earthTextureReverbBus.waterTextureSendGain, 2, 0)
        .connect(earthTextureReverbBus.input);
      earthTextureWorklet
        .connect(earthTextureReverbBus.windTextureSendGain, 3, 0)
        .connect(earthTextureReverbBus.input);
      if (earthFormantBus) {
        earthTextureWorklet.connect(earthFormantBus.windSendGain, 1, 0).connect(earthFormantBus.input);
      }
    } else if (earthTextureWorklet && earthTextureDryGain) {
      earthTextureWorklet.connect(earthTextureDryGain, 0, 0).connect(earthGain);
      if (earthFormantBus) {
        earthTextureWorklet.connect(earthFormantBus.windSendGain, 1, 0).connect(earthFormantBus.input);
      }
    } else {
      earthTextureWorklet?.connect(earthGain, 0, 0);
      if (earthFormantBus) {
        earthTextureWorklet?.connect(earthFormantBus.windSendGain, 1, 0).connect(earthFormantBus.input);
      }
    }
    humanWorklet?.connect(humanPluckGain, 0, 0);
    if (earthTextureReverbBus) {
      humanPluckGain.connect(earthTextureReverbBus.humanSendGain).connect(earthTextureReverbBus.input);
      quakeGain.connect(earthTextureReverbBus.quakeSendGain).connect(earthTextureReverbBus.input);
    }
    humanPluckGain.connect(masterGain);
    quakeGain.connect(masterGain);
    masterGain.connect(masterSafetyLimiter).connect(audioContext.destination);

    brownNoise.start();
    pinkNoise.start();
    whiteNoise.start();
    surfaceTextureNoise.start();

    this.audioContext = audioContext;
    this.masterGain = masterGain;
    this.masterSafetyLimiter = masterSafetyLimiter;
    this.earthGain = earthGain;
    this.earthToneGain = earthToneGain;
    this.earthToneDryGain = earthToneDryGain;
    this.earthNoiseGain = earthNoiseGain;
    this.earthBrownNoiseGain = earthBrownNoiseGain;
    this.earthPinkNoiseGain = earthPinkNoiseGain;
    this.earthWhiteNoiseGain = earthWhiteNoiseGain;
    this.earthSurfaceTextureGain = earthSurfaceTextureGain;
    this.earthSurfaceTextureFilter = earthSurfaceTextureFilter;
    this.humanPluckGain = humanPluckGain;
    this.humanReverbBus = humanReverbBus;
    this.quakeGain = quakeGain;
    this.earthFilter = earthFilter;
    this.earthDronePartials = earthDronePartials;
    this.earthDroneCompanion = earthDroneCompanion;
    this.earthNoiseSources = [brownNoise, pinkNoise, whiteNoise, surfaceTextureNoise];
    this.earthTextureWorklet = earthTextureWorklet;
    this.earthTextureDryGain = earthTextureDryGain;
    this.earthTextureWaterDryGain = earthTextureWaterDryGain;
    this.earthTextureWindDryGain = earthTextureWindDryGain;
    this.earthTextureReverbBus = earthTextureReverbBus;
    this.earthFormantBus = earthFormantBus;
    this.earthRootReverbDebugBranch = earthRootReverbDebugBranch;
    this.humanWorklet = humanWorklet;
    this.postHumanWorkletDiagnostics();
    if (transitionToken === this.audioOutputTransitionToken) {
      this.scheduleMasterGainStartupFade();
    }
  }

  async stopAudio(): Promise<void> {
    this.audioOutputEnabled = false;
    const transitionToken = ++this.audioOutputTransitionToken;
    const audioContext = this.audioContext;
    if (!audioContext || audioContext.state === "closed") {
      return;
    }

    if (this.masterGain) {
      this.masterStartupFadeUntilSeconds = undefined;
      const now = audioContext.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0, now, 0.035);
    }

    await delayMs(160);
    if (
      transitionToken === this.audioOutputTransitionToken &&
      this.audioContext === audioContext &&
      audioContext.state === "running"
    ) {
      await audioContext.suspend();
    }
  }

  private setRuntimeFallbackId(id: RuntimeFallbackStatusId, active: boolean): void {
    if (active) {
      this.runtimeFallbackIds.add(id);
      return;
    }
    this.runtimeFallbackIds.delete(id);
  }

  update(frame: AudioFrameParams): void {
    this.lastFrame = frame;

    if (
      !this.audioContext ||
      !this.earthGain ||
      !this.earthToneGain ||
      !this.earthToneDryGain ||
      !this.earthNoiseGain ||
      !this.earthBrownNoiseGain ||
      !this.earthPinkNoiseGain ||
      !this.earthWhiteNoiseGain ||
      !this.earthSurfaceTextureGain ||
      !this.earthSurfaceTextureFilter ||
      !this.humanPluckGain ||
      !this.quakeGain ||
      !this.earthFilter ||
      !this.masterGain
    ) {
      return;
    }

    if (!this.audioOutputEnabled || this.audioContext.state !== "running") {
      this.syncEventStateWithoutSound(frame);
      return;
    }

    const now = this.audioContext.currentTime;
    const surfaceTextureSolo = this.audioDebugMode === "surface-texture-solo";
    const earthTextureSolo =
      this.audioDebugMode === "earth-texture-solo" ||
      this.audioDebugMode === "earth-water-solo" ||
      this.audioDebugMode === "earth-wind-solo" ||
      this.audioDebugMode === "rain-granular-solo";
    const earthFormantSolo = this.audioDebugMode === "earth-formant-solo";
    const humanReverbSolo = this.audioDebugMode === "human-reverb-solo";
    const quakeSolo = this.audioDebugMode === "quake-solo";
    const earthTextureWorkletBypassed = this.perfDiagnostics.bypasses.earthTextureWorklet;
    const humanWorkletBypassed = this.perfDiagnostics.bypasses.humanWorklet;
    const rainGranularBypassed = this.perfDiagnostics.bypasses.rainGranular;
    const airTurbulence = deriveEarthAirTurbulence(frame);
    const earthTextureParams = earthTextureParamsForDebugMode(
      derivePenumbraEarthTextureParams(frame),
      this.audioDebugMode,
    );
    this.postEarthTextureContinuousParams(earthTextureParams, {
      muted: humanReverbSolo || surfaceTextureSolo || quakeSolo || earthTextureWorkletBypassed,
      now,
    });
    if (this.shouldUpdateContinuousAudioParams(now)) {
      this.updateContinuousAudioParams(frame, earthTextureParams, airTurbulence, {
        surfaceTextureSolo,
        earthTextureSolo,
        earthFormantSolo,
        humanReverbSolo,
        quakeSolo,
        now,
      });
    }

    if (!surfaceTextureSolo && !quakeSolo) {
      if (!humanReverbSolo) {
        if (this.earthTextureWorklet && !earthTextureWorkletBypassed) {
          this.triggerEarthTextureDroplets(frame, earthTextureParams.water, now);
          if (
            !rainGranularBypassed &&
            (this.audioDebugMode === "rain-granular-solo" ||
              this.audioDebugMode === "rain-granular-boost")
          ) {
            this.triggerRainGranular(frame, earthTextureParams.rainGranular, now);
          } else {
            this.lastScheduledRainGranularUtcMs = undefined;
          }
        } else if (!earthTextureWorkletBypassed) {
          this.triggerPrecipitationGrains(frame, now);
        } else {
          this.lastScheduledEarthTextureDropletUtcMs = {};
          this.lastScheduledRainGranularUtcMs = undefined;
        }
      }
      if (!earthTextureSolo && !earthFormantSolo && !humanWorkletBypassed) {
        this.triggerHumanPluckVoices(frame, now);
      } else if (humanWorkletBypassed) {
        this.humanVoiceStates.clear();
      }
    }

    if (!surfaceTextureSolo && !earthTextureSolo && !humanReverbSolo && !earthFormantSolo) {
      this.triggerQuakePulseVoices(frame, now);
    }
  }

  getDebugMeters(): AudioFrameParams["debugMeters"] | undefined {
    return this.lastFrame?.debugMeters;
  }

  getEarthRootDebugMeter(): EarthRootDebugMeterSnapshot | undefined {
    if (!this.earthRootReverbDebugBranch || !this.lastFrame) {
      return undefined;
    }

    const branch = this.earthRootReverbDebugBranch;
    branch.leftAnalyser.getFloatTimeDomainData(branch.leftBuffer);
    branch.rightAnalyser.getFloatTimeDomainData(branch.rightBuffer);
    const snapshot = createEarthRootDebugMeterSnapshotFromTimeDomain({
      rootHz: this.earthRootDebugMeterRootHz ?? earthDroneRootHz(this.lastFrame),
      left: branch.leftBuffer,
      right: branch.rightBuffer,
      displayGain: this.earthRootDebugMeterDisplayGain,
    });
    this.updateEarthRootDebugMeterDisplayGain(snapshot.peak01);
    return snapshot;
  }

  private shouldUpdateContinuousAudioParams(now: number): boolean {
    const previousUpdateSeconds = this.lastContinuousAudioParamUpdateSeconds;
    if (
      previousUpdateSeconds !== undefined &&
      now - previousUpdateSeconds < CONTINUOUS_AUDIO_PARAM_UPDATE_INTERVAL_SECONDS
    ) {
      return false;
    }

    this.lastContinuousAudioParamUpdateSeconds = now;
    return true;
  }

  private updateContinuousAudioParams(
    frame: AudioFrameParams,
    earthTextureParams: PenumbraEarthTextureParams,
    airTurbulence: EarthAirTurbulence,
    options: {
      readonly surfaceTextureSolo: boolean;
      readonly earthTextureSolo: boolean;
      readonly earthFormantSolo: boolean;
      readonly humanReverbSolo: boolean;
      readonly quakeSolo: boolean;
      readonly now: number;
    },
  ): void {
    if (
      !this.masterGain ||
      !this.earthGain ||
      !this.earthToneGain ||
      !this.earthToneDryGain ||
      !this.earthNoiseGain ||
      !this.earthBrownNoiseGain ||
      !this.earthPinkNoiseGain ||
      !this.earthWhiteNoiseGain ||
      !this.earthSurfaceTextureGain ||
      !this.earthSurfaceTextureFilter ||
      !this.humanPluckGain ||
      !this.quakeGain ||
      !this.earthFilter
    ) {
      return;
    }

    const {
      surfaceTextureSolo,
      earthTextureSolo,
      earthFormantSolo,
      humanReverbSolo,
      quakeSolo,
      now,
    } = options;
    const sharedReverbBypassed = this.perfDiagnostics.bypasses.sharedReverb;
    const formantBypassed = this.perfDiagnostics.bypasses.formant;
    const earthTextureWorkletBypassed = this.perfDiagnostics.bypasses.earthTextureWorklet;
    const humanWorkletBypassed = this.perfDiagnostics.bypasses.humanWorklet;

    this.updateEarthFormantBus(
      frame,
      airTurbulence,
      formantBypassed || surfaceTextureSolo || earthTextureSolo || humanReverbSolo || quakeSolo,
      now,
    );
    this.updateEarthRootReverbDebugBranch(frame, airTurbulence, now);
    if (!this.isMasterStartupFadeActive(now)) {
      this.masterGain.gain.setTargetAtTime(this.currentMasterGainTarget(), now, 0.2);
    }
    const textureReverbSendGain =
      earthTextureParams.acoustic.reverbWet01 *
      EARTH_TEXTURE_TONE_REVERB_SEND_GAIN *
      this.tuningGain("textureReverbSendDb");
    this.earthTextureReverbBus?.textureSendGain.gain.setTargetAtTime(
      sharedReverbBypassed || humanReverbSolo || surfaceTextureSolo || quakeSolo || earthFormantSolo
        ? 0
        : textureReverbSendGain,
      now,
      0.4,
    );
    this.earthTextureReverbBus?.waterTextureSendGain.gain.setTargetAtTime(
      sharedReverbBypassed || humanReverbSolo || surfaceTextureSolo || quakeSolo || earthFormantSolo
        ? 0
        : textureReverbSendGain * this.tuningGain("waterReverbSendDb"),
      now,
      0.4,
    );
    this.earthTextureReverbBus?.windTextureSendGain.gain.setTargetAtTime(
      sharedReverbBypassed || humanReverbSolo || surfaceTextureSolo || quakeSolo || earthFormantSolo
        ? 0
        : textureReverbSendGain * this.tuningGain("windReverbSendDb"),
      now,
      0.4,
    );
    this.earthTextureReverbBus?.humanSendGain.gain.setTargetAtTime(
      sharedReverbBypassed ||
        humanWorkletBypassed ||
        surfaceTextureSolo ||
        earthTextureSolo ||
        humanReverbSolo ||
        quakeSolo ||
        earthFormantSolo
        ? 0
        : HUMAN_TONE_REVERB_SEND_GAIN * this.tuningGain("humanReverbSendDb"),
      now,
      0.18,
    );
    this.earthTextureReverbBus?.droneSendGain.gain.setTargetAtTime(
      sharedReverbBypassed || surfaceTextureSolo || earthTextureSolo || humanReverbSolo || quakeSolo || earthFormantSolo
        ? 0
        : EARTH_DRONE_TONE_REVERB_SEND_GAIN * this.tuningGain("droneReverbSendDb"),
      now,
      0.5,
    );
    this.earthTextureReverbBus?.quakeSendGain.gain.setTargetAtTime(
      sharedReverbBypassed || surfaceTextureSolo || earthTextureSolo || humanReverbSolo || earthFormantSolo
        ? 0
        : QUAKE_TONE_REVERB_SEND_GAIN * this.tuningGain("quakeReverbSendDb"),
      now,
      0.18,
    );
    this.earthTextureReverbBus?.returnGain.gain.setTargetAtTime(
      sharedReverbBypassed ? 0 : 0.9 * this.tuningGain("sharedReverbReturnDb"),
      now,
      0.35,
    );
    this.earthTextureDryGain?.gain.setTargetAtTime(
      earthFormantSolo || earthTextureWorkletBypassed
        ? 0
        : EARTH_TEXTURE_DRY_OUTPUT_GAIN * this.tuningGain("earthTextureDryGainDb"),
      now,
      0.35,
    );
    this.earthTextureWaterDryGain?.gain.setTargetAtTime(
      earthFormantSolo || earthTextureWorkletBypassed
        ? 0
        : EARTH_TEXTURE_DRY_OUTPUT_GAIN *
          this.tuningGain("earthTextureDryGainDb") *
          this.tuningGain("waterTextureDryGainDb"),
      now,
      0.35,
    );
    this.earthTextureWindDryGain?.gain.setTargetAtTime(
      earthFormantSolo || earthTextureWorkletBypassed
        ? 0
        : EARTH_TEXTURE_DRY_OUTPUT_GAIN *
          this.tuningGain("earthTextureDryGainDb") *
          this.tuningGain("windTextureDryGainDb"),
      now,
      0.35,
    );
    this.earthGain.gain.setTargetAtTime(
      (frame.earth.active || quakeSolo) && !humanReverbSolo ? this.tuningGain("earthBusGainDb") : 0,
      now,
      0.2,
    );
    this.earthToneGain.gain.setTargetAtTime(
      surfaceTextureSolo || earthTextureSolo || humanReverbSolo || quakeSolo ? 0 : frame.earth.toneGain01,
      now,
      0.25,
    );
    this.earthToneDryGain.gain.setTargetAtTime(earthFormantSolo ? 0 : 1, now, 0.35);
    this.earthNoiseGain.gain.setTargetAtTime(
      surfaceTextureSolo || earthTextureSolo || humanReverbSolo || quakeSolo || earthFormantSolo
        ? 0
        : frame.earth.noiseGain01 *
          (this.earthTextureWorklet && !earthTextureWorkletBypassed ? EARTH_TEXTURE_OLD_NOISE_BLEND : 1),
      now,
      0.25,
    );
    const noiseColorMix = earthNoiseColorMix(
      clampNumber(frame.earth.noiseColor01 + airTurbulence.noiseColorOffset, 0.04, 0.94),
    );
    this.earthBrownNoiseGain.gain.setTargetAtTime(noiseColorMix.brown, now, 0.22);
    this.earthPinkNoiseGain.gain.setTargetAtTime(noiseColorMix.pink, now, 0.22);
    this.earthWhiteNoiseGain.gain.setTargetAtTime(noiseColorMix.white, now, 0.22);
    this.earthFilter.frequency.setTargetAtTime(
      clampNumber(frame.earth.noiseLowpassHz * (1 + airTurbulence.lowpassScale), 160, 7600),
      now,
      0.2,
    );
    this.earthSurfaceTextureGain.gain.setTargetAtTime(
      earthTextureSolo || humanReverbSolo || quakeSolo || earthFormantSolo ? 0 : this.surfaceTextureGainForFrame(frame),
      now,
      0.08,
    );
    this.earthSurfaceTextureFilter.frequency.setTargetAtTime(
      clampNumber(
        frame.earth.surfaceTextureFilterHz * (1 + airTurbulence.surfaceTextureFilterScale),
        120,
        6600,
      ),
      now,
      0.16,
    );
    this.earthSurfaceTextureFilter.Q.setTargetAtTime(
      clampNumber(frame.earth.surfaceTextureQ * (1 + airTurbulence.surfaceTextureQScale), 0.12, 4.2),
      now,
      0.16,
    );
    const quakeLayerGain = surfaceTextureSolo || earthTextureSolo || humanReverbSolo || earthFormantSolo
      ? 0
      : quakeSolo
        ? this.tuningGain("quakeLayerGainDb")
        : frame.quakes.length > 0
          ? (QUAKE_LAYER_BASE_GAIN + Math.sqrt(frame.debugMeters.quakeEnergy01) * QUAKE_LAYER_ENERGY_GAIN) *
            this.tuningGain("quakeLayerGainDb")
          : 0;
    this.quakeGain.gain.setTargetAtTime(quakeLayerGain, now, 0.05);
    this.updateEarthDronePartials(frame, airTurbulence, now);
    this.humanPluckGain.gain.setTargetAtTime(
      humanWorkletBypassed || surfaceTextureSolo || earthTextureSolo || quakeSolo
        ? 0
        : humanReverbSolo
          ? HUMAN_LAYER_OUTPUT_GAIN * 1.8 * this.tuningGain("humanLayerGainDb")
          : earthFormantSolo
            ? 0
            : HUMAN_LAYER_OUTPUT_GAIN * this.tuningGain("humanLayerGainDb"),
      now,
      0.05,
    );
  }

  dispose(): void {
    this.audioOutputEnabled = false;
    this.audioOutputTransitionToken += 1;
    this.masterStartupFadeUntilSeconds = undefined;
    for (const partial of this.earthDronePartials) {
      partial.oscillator.stop();
    }
    if (this.earthDroneCompanion) {
      this.earthDroneCompanion.oscillator.stop();
      this.earthDroneCompanion.gain.disconnect();
    }
    for (const source of this.earthNoiseSources) {
      source.stop();
    }
    this.earthTextureWorklet?.disconnect();
    this.earthTextureWorklet?.port.close();
    this.earthTextureDryGain?.disconnect();
    this.earthTextureWaterDryGain?.disconnect();
    this.earthTextureWindDryGain?.disconnect();
    this.earthToneDryGain?.disconnect();
    this.earthTextureReverbBus?.textureSendGain.disconnect();
    this.earthTextureReverbBus?.waterTextureSendGain.disconnect();
    this.earthTextureReverbBus?.windTextureSendGain.disconnect();
    this.earthTextureReverbBus?.humanSendGain.disconnect();
    this.earthTextureReverbBus?.droneSendGain.disconnect();
    this.earthTextureReverbBus?.quakeSendGain.disconnect();
    this.earthTextureReverbBus?.input.disconnect();
    this.earthTextureReverbBus?.returnGain.disconnect();
    this.earthTextureReverbBus?.reverb.dispose();
    this.earthFormantBus?.droneSendGain.disconnect();
    this.earthFormantBus?.windSendGain.disconnect();
    this.earthFormantBus?.noiseSendGain.disconnect();
    this.earthFormantBus?.input.disconnect();
    this.earthFormantBus?.outputGain.disconnect();
    for (const band of this.earthFormantBus?.bands ?? []) {
      band.filter.disconnect();
      band.gain.disconnect();
    }
    if (this.earthRootReverbDebugBranch) {
      this.earthRootReverbDebugBranch.oscillator.stop();
      for (const node of this.earthRootReverbDebugBranch.nodes) {
        node.disconnect();
      }
    }
    this.masterSafetyLimiter?.disconnect();
    this.humanWorklet?.disconnect();
    this.humanWorklet?.port.close();
    void this.audioContext?.close();
    this.audioContext = undefined;
    this.humanWorklet = undefined;
    this.masterSafetyLimiter = undefined;
    this.earthNoiseSources = [];
    this.earthDronePartials = [];
    this.earthDroneCompanion = undefined;
    this.earthTextureWorklet = undefined;
    this.earthTextureDryGain = undefined;
    this.earthTextureWaterDryGain = undefined;
    this.earthTextureWindDryGain = undefined;
    this.earthTextureReverbBus = undefined;
    this.earthFormantBus = undefined;
    this.earthRootReverbDebugBranch = undefined;
    this.earthToneDryGain = undefined;
    this.humanVoiceStates.clear();
    this.quakePulseStates.clear();
    this.lastScheduledPrecipitationGrainUtcMs = undefined;
    this.lastScheduledEarthTextureDropletUtcMs = {};
    this.lastScheduledRainGranularUtcMs = undefined;
    this.lastEarthTextureContinuousMessageSeconds = undefined;
    this.lastContinuousAudioParamUpdateSeconds = undefined;
    this.earthRootDebugMeterDisplayGain = 8;
    this.earthRootDebugMeterRootHz = undefined;
    this.earthRootDebugMeterLastUpdateSeconds = undefined;
  }

  private updateEarthRootDebugMeterDisplayGain(peak01: number): void {
    if (peak01 <= 0.00001) {
      return;
    }

    const targetGain = clampNumber(0.58 / peak01, 2.5, 80);
    const response = targetGain < this.earthRootDebugMeterDisplayGain ? 0.18 : 0.035;
    this.earthRootDebugMeterDisplayGain +=
      (targetGain - this.earthRootDebugMeterDisplayGain) * response;
  }

  private updateEarthDronePartials(
    frame: AudioFrameParams,
    airTurbulence: EarthAirTurbulence,
    now: number,
  ): void {
    const partialGains = this.earthDronePartials.map((partial) =>
      earthDronePartialGainRaw(partial.config, frame, airTurbulence),
    );
    const gainSum = partialGains.reduce((sum, gain01) => sum + gain01, 0);
    const gainNormalizer = gainSum > EARTH_DRONE_GAIN_SUM_CAP ? EARTH_DRONE_GAIN_SUM_CAP / gainSum : 1;

    for (const [index, partial] of this.earthDronePartials.entries()) {
      const frequencyHz = earthDronePartialFrequencyHz(partial.config, frame, airTurbulence);
      const gain01 = partialGains[index] * gainNormalizer;
      partial.oscillator.frequency.setTargetAtTime(frequencyHz, now, partial.config.responseSeconds);
      partial.gain.gain.setTargetAtTime(gain01, now, partial.config.responseSeconds);
    }
    this.updateEarthDroneCompanion(frame, airTurbulence, now);
  }

  private postEarthTextureContinuousParams(
    params: PenumbraEarthTextureParams,
    options: {
      readonly muted: boolean;
      readonly now: number;
    },
  ): void {
    const worklet = this.earthTextureWorklet;
    if (!worklet) {
      return;
    }

    const previousMessageSeconds = this.lastEarthTextureContinuousMessageSeconds;
    if (
      previousMessageSeconds !== undefined &&
      options.now - previousMessageSeconds < EARTH_TEXTURE_CONTINUOUS_UPDATE_INTERVAL_SECONDS
    ) {
      return;
    }

    const acoustic = this.earthTextureReverbBus || this.perfDiagnostics.bypasses.sharedReverb
      ? { ...params.acoustic, reverbWet01: 0 }
      : params.acoustic;
    worklet.port.postMessage(
      createPenumbraEarthTextureContinuousMessage({
        ...params,
        active: params.active && !options.muted,
        acoustic,
      }),
    );
    this.lastEarthTextureContinuousMessageSeconds = options.now;
  }

  private updateEarthDroneCompanion(
    frame: AudioFrameParams,
    airTurbulence: EarthAirTurbulence,
    now: number,
  ): void {
    if (!this.earthDroneCompanion) {
      return;
    }

    if (this.perfDiagnostics.bypasses.droneCompanion) {
      this.earthDroneCompanion.gain.gain.setTargetAtTime(0, now, 0.35);
      return;
    }

    const rootConfig = EARTH_DRONE_PARTIALS[0];
    const rootGain01 = rootConfig ? earthDronePartialGainRaw(rootConfig, frame, airTurbulence) : 0;
    const companion = earthDroneCompanionParams(frame, airTurbulence);
    this.earthDroneCompanion.oscillator.frequency.setTargetAtTime(
      companion.frequencyHz,
      now,
      companion.responseSeconds,
    );
    this.earthDroneCompanion.gain.gain.setTargetAtTime(
      rootGain01 * companion.relativeGain01,
      now,
      0.9,
    );
  }

  private updateEarthFormantBus(
    frame: AudioFrameParams,
    airTurbulence: EarthAirTurbulence,
    muted: boolean,
    now: number,
  ): void {
    if (!this.earthFormantBus) {
      return;
    }

    const params = deriveEarthFormantParams(frame, airTurbulence, { muted });
    this.earthFormantBus.droneSendGain.gain.setTargetAtTime(
      params.droneSendGain * this.tuningGain("formantDroneSendDb"),
      now,
      1,
    );
    this.earthFormantBus.windSendGain.gain.setTargetAtTime(
      params.windSendGain * this.tuningGain("formantWindSendDb"),
      now,
      1,
    );
    this.earthFormantBus.noiseSendGain.gain.setTargetAtTime(params.noiseSendGain, now, 1);
    this.earthFormantBus.outputGain.gain.setTargetAtTime(
      params.outputGain * this.tuningGain("formantReturnDb"),
      now,
      1.5,
    );

    for (const [index, band] of this.earthFormantBus.bands.entries()) {
      const target = params.bands[index];
      if (!target) {
        band.gain.gain.setTargetAtTime(0, now, 1);
        continue;
      }

      band.filter.frequency.setTargetAtTime(target.frequencyHz, now, 1.25);
      band.filter.Q.setTargetAtTime(target.q, now, 1);
      band.gain.gain.setTargetAtTime(target.gain01, now, 1);
    }
  }

  private updateEarthRootReverbDebugBranch(
    frame: AudioFrameParams,
    airTurbulence: EarthAirTurbulence,
    now: number,
  ): void {
    if (!this.earthRootReverbDebugBranch) {
      return;
    }

    const rootConfig = EARTH_DRONE_PARTIALS[0];
    const rootPartialGain01 = rootConfig
      ? earthDronePartialGainRaw(rootConfig, frame, airTurbulence)
      : 0;
    const targetGain = frame.earth.active
      ? frame.earth.toneGain01 * rootPartialGain01 * EARTH_DRONE_TONE_REVERB_SEND_GAIN
      : 0;
    const rootResponseSeconds = rootConfig?.responseSeconds ?? 0.9;
    this.updateEarthRootDebugMeterRootHz(earthDroneRootHz(frame), now, rootResponseSeconds);

    this.earthRootReverbDebugBranch.oscillator.frequency.setTargetAtTime(
      earthDroneRootHz(frame),
      now,
      rootResponseSeconds,
    );
    this.earthRootReverbDebugBranch.inputGain.gain.setTargetAtTime(targetGain, now, 0.25);
  }

  private updateEarthRootDebugMeterRootHz(
    targetHz: number,
    now: number,
    responseSeconds: number,
  ): void {
    const previousUpdateSeconds = this.earthRootDebugMeterLastUpdateSeconds;
    this.earthRootDebugMeterRootHz = smoothEarthRootDebugMeterRootHz({
      previousHz: this.earthRootDebugMeterRootHz,
      targetHz,
      elapsedSeconds: previousUpdateSeconds === undefined ? 0 : now - previousUpdateSeconds,
      timeConstantSeconds: responseSeconds,
    });
    this.earthRootDebugMeterLastUpdateSeconds = now;
  }

  private tuningGain(key: AudioTuningControlKey): number {
    return audioTuningGain(this.tuningOverrides, key);
  }

  private forceMasterGainSilent(): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const now = this.audioContext.currentTime;
    this.masterStartupFadeUntilSeconds = undefined;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
  }

  private scheduleMasterGainStartupFade(): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const now = this.audioContext.currentTime;
    const fadeStart = now + AUDIO_START_MUTE_HOLD_SECONDS;
    const fadeEnd = fadeStart + AUDIO_START_FADE_IN_SECONDS;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.setValueAtTime(0, fadeStart);
    this.masterGain.gain.linearRampToValueAtTime(this.currentMasterGainTarget(), fadeEnd);
    this.masterStartupFadeUntilSeconds = fadeEnd;
  }

  private isMasterStartupFadeActive(now: number): boolean {
    const fadeUntil = this.masterStartupFadeUntilSeconds;
    if (fadeUntil === undefined) {
      return false;
    }
    if (now < fadeUntil) {
      return true;
    }
    this.masterStartupFadeUntilSeconds = undefined;
    return false;
  }

  private currentMasterGainTarget(): number {
    return MASTER_OUTPUT_GAIN * this.tuningGain("masterGainDb");
  }

  private syncEventStateWithoutSound(frame: AudioFrameParams): void {
    if (this.perfDiagnostics.bypasses.humanWorklet) {
      this.humanVoiceStates.clear();
    } else {
      const activeVoiceIds = new Set<string>();
      const voices = this.humanWorklet ? frame.music.candidates : frame.music.voices;
      for (const voice of voices) {
        activeVoiceIds.add(voice.id);
        this.humanVoiceStates.set(voice.id, { previousUtcMs: frame.utcEpochMs });
      }
      for (const voiceId of this.humanVoiceStates.keys()) {
        if (!activeVoiceIds.has(voiceId)) {
          this.humanVoiceStates.delete(voiceId);
        }
      }
    }

    const activeQuakeIds = new Set<string>();
    for (const hit of frame.quakes) {
      activeQuakeIds.add(hit.id);
      this.quakePulseStates.set(hit.id, { previousUtcMs: frame.utcEpochMs });
    }
    for (const quakeId of this.quakePulseStates.keys()) {
      if (!activeQuakeIds.has(quakeId)) {
        this.quakePulseStates.delete(quakeId);
      }
    }
  }

  private postHumanWorkletDiagnostics(): void {
    this.humanWorklet?.port.postMessage(
      createHumanWorkletDiagnosticsMessage({
        reverbEnabled: !this.perfDiagnostics.bypasses.humanWorkletReverb,
        maxActiveVoices: this.perfDiagnostics.humanVoiceCap,
        maxPartialsPerVoice: this.perfDiagnostics.humanPartialCap,
      }),
    );
  }

  private surfaceTextureGainForFrame(frame: AudioFrameParams): number {
    if (this.audioDebugMode === "surface-texture-solo") {
      return Math.min(frame.earth.surfaceTextureGain01 * 8, 0.12);
    }

    if (this.audioDebugMode === "surface-texture-boost") {
      return Math.min(frame.earth.surfaceTextureGain01 * 4, 0.08);
    }

    return frame.earth.surfaceTextureGain01 * (this.earthTextureWorklet ? EARTH_TEXTURE_OLD_SURFACE_BLEND : 1);
  }

  private triggerPrecipitationGrains(frame: AudioFrameParams, now: number): void {
    if (!this.audioContext || !this.earthGain) {
      return;
    }

    const densityHz = frame.earth.precipitationGrainDensityHz;
    const gain01 = frame.earth.precipitationGrainGain01;
    if (!frame.earth.active || densityHz <= 0.05 || gain01 <= PRECIPITATION_GRAIN_TRIGGER_FLOOR) {
      this.lastScheduledPrecipitationGrainUtcMs = undefined;
      return;
    }

    const scheduleUntilUtcMs = frame.utcEpochMs + AUDIO_EVENT_SCHEDULE_AHEAD_MS;
    let scheduled = 0;
    for (const event of utcSeededAudioEventsInWindow("precip", densityHz, frame.utcEpochMs, scheduleUntilUtcMs)) {
      if (
        this.lastScheduledPrecipitationGrainUtcMs != null &&
        event.scheduledUtcMs <= this.lastScheduledPrecipitationGrainUtcMs
      ) {
        continue;
      }

      this.triggerPrecipitationGrain(
        frame,
        audioStartTimeForUtcEvent(frame, now, event.scheduledUtcMs, 0),
        event.slotIndex,
        event.randomSeed,
      );
      this.lastScheduledPrecipitationGrainUtcMs = event.scheduledUtcMs;
      scheduled += 1;
      if (scheduled >= 8) {
        break;
      }
    }
  }

  private triggerPrecipitationGrain(
    frame: AudioFrameParams,
    startTime: number,
    grainIndex: number,
    randomSeed: number,
  ): void {
    if (!this.audioContext || !this.earthGain) {
      return;
    }

    const audioContext = this.audioContext;
    const earthGain = this.earthGain;
    const brightness = frame.earth.precipitationGrainBrightness01;
    const jitter01 = hashUint32To01(randomSeed ^ 0x85ebca6b);
    const durationSeconds = 0.012 + (1 - brightness) * 0.018 + jitter01 * 0.018;
    const peakGain = frame.earth.precipitationGrainGain01 * (0.55 + jitter01 * 0.8);
    const endTime = startTime + durationSeconds + 0.018;
    const noise = createOneShotNoise(audioContext, durationSeconds + 0.02, randomSeed ^ 0xc2b2ae35);
    const filter = audioContext.createBiquadFilter();
    const envelope = audioContext.createGain();

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(760 + brightness * 4200 + jitter01 * 380, startTime);
    filter.Q.value = 0.55 + brightness * 0.72;
    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.linearRampToValueAtTime(peakGain, startTime + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds);
    noise.connect(filter).connect(envelope).connect(earthGain);
    noise.start(startTime);
    noise.stop(endTime);

    const cleanupDelayMs = Math.ceil(Math.max(0.1, endTime - audioContext.currentTime) * 1000) + 200;
    window.setTimeout(() => {
      noise.disconnect();
      filter.disconnect();
      envelope.disconnect();
    }, cleanupDelayMs);
  }

  private triggerEarthTextureDroplets(
    frame: AudioFrameParams,
    water: PenumbraWaterTextureParams,
    now: number,
  ): void {
    if (!this.earthTextureWorklet || this.perfDiagnostics.bypasses.earthTextureWorklet) {
      return;
    }

    const densityHz = water.dropletDensityHz;
    const gain01 = water.dropletGain01;
    if (!frame.earth.active || densityHz <= 0.05 || gain01 <= 0.0004) {
      this.lastScheduledEarthTextureDropletUtcMs = {};
      return;
    }

    const scheduleUntilUtcMs = frame.utcEpochMs + AUDIO_EVENT_SCHEDULE_AHEAD_MS;
    let scheduled = 0;
    for (const band of PENUMBRA_DROPLET_BANDS) {
      const bandLevel = waterBandLevel(water, band);
      const bandDensityHz = waterBandDensityHz(water, band);
      if (bandDensityHz <= 0.05) {
        delete this.lastScheduledEarthTextureDropletUtcMs[band];
        continue;
      }

      const lastScheduledUtcMs = this.lastScheduledEarthTextureDropletUtcMs[band];
      const windowStartUtcMs =
        lastScheduledUtcMs == null
          ? frame.utcEpochMs
          : Math.min(frame.utcEpochMs, lastScheduledUtcMs + 1);
      const events = canonicalWaterDropletEventsInWindow({
        band,
        densityHz: bandDensityHz,
        level01: bandLevel,
        windowStartUtcMs,
        windowEndUtcMs: scheduleUntilUtcMs,
      });

      for (const event of events) {
        if (
          lastScheduledUtcMs != null &&
          event.scheduledUtcMs <= lastScheduledUtcMs
        ) {
          continue;
        }

        const grainIndex = event.randomSeed;
        const frequencyHz = penumbraDropletFrequencyForBand(frame, band, grainIndex, {
          scheduledUtcMs: event.scheduledUtcMs,
        });
        this.earthTextureWorklet.port.postMessage(
          createPenumbraWaterDropletMessage({
            startTimeSeconds:
              audioStartTimeForUtcEvent(
                frame,
                now,
                event.scheduledUtcMs,
                PENUMBRA_EARTH_TEXTURE_SCHEDULE_AHEAD_SECONDS,
            ),
            randomSeed: event.randomSeed,
            frequencyHz,
            velocity01: event.velocity01,
            band,
          }),
        );
        this.lastScheduledEarthTextureDropletUtcMs[band] = event.scheduledUtcMs;
        scheduled += 1;
        if (scheduled >= 18) {
          break;
        }
      }
    }
  }

  private triggerRainGranular(
    frame: AudioFrameParams,
    rainGranular: PenumbraRainGranularParams,
    now: number,
  ): void {
    if (
      !this.earthTextureWorklet ||
      this.perfDiagnostics.bypasses.earthTextureWorklet ||
      this.perfDiagnostics.bypasses.rainGranular
    ) {
      return;
    }

    const densityHz = rainGranular.densityHz;
    const gain01 = rainGranular.gain01;
    if (!frame.earth.active || densityHz <= 0.1 || gain01 <= 0.00002) {
      this.lastScheduledRainGranularUtcMs = undefined;
      return;
    }

    const scheduleUntilUtcMs = frame.utcEpochMs + AUDIO_EVENT_SCHEDULE_AHEAD_MS;
    let scheduled = 0;
    for (const event of utcSeededAudioEventsInWindow(
      "rain-granular",
      densityHz,
      frame.utcEpochMs,
      scheduleUntilUtcMs,
    )) {
      if (
        this.lastScheduledRainGranularUtcMs != null &&
        event.scheduledUtcMs <= this.lastScheduledRainGranularUtcMs
      ) {
        continue;
      }

      const materialSeed = hashUint32(
        `rain:${event.randomSeed}:${frame.earth.airTurbulenceSeed01.toFixed(5)}:${Math.round(
          frame.earth.registerHz * 10,
        )}`,
      );
      const offsetJitter01 = hashUint32To01(materialSeed ^ 0x7f4a7c15);
      const durationJitter01 = hashUint32To01(materialSeed ^ 0x85ebca6b);
      const playbackJitter01 = hashUint32To01(materialSeed ^ 0xc2b2ae35);
      const velocityJitter01 = hashUint32To01(materialSeed ^ 0x27d4eb2d);
      const panJitter01 = hashUint32To01(materialSeed ^ 0x165667b1);
      const bufferJitter01 = hashUint32To01(materialSeed ^ 0xd3a2646c);
      const shapeJitter01 = hashUint32To01(materialSeed ^ 0x94d049bb);
      const attackJitter01 = hashUint32To01(materialSeed ^ 0x2545f491);
      const decayJitter01 = hashUint32To01(materialSeed ^ 0x9e3779b9);
      const offset01 = (offsetJitter01 + rainGranular.offsetDrift01 * 0.19) % 1;
      const durationSeconds = rainGranular.grainDurationSeconds * (0.58 + durationJitter01 * 0.92);
      const playbackRate = lerpNumber(0.62, 1.82, rainGranular.playbackRate01) * (0.86 + playbackJitter01 * 0.28);
      const headImpact01 = clampNumber(
        rainGranular.impact01 * (0.62 + shapeJitter01 * 0.58) +
          rainGranular.shapeVariance01 * Math.max(0, shapeJitter01 - 0.28) * 0.56 -
          rainGranular.softness01 * (0.24 + (1 - shapeJitter01) * 0.16),
        0,
        1,
      );
      const roundedness01 = clampNumber(
        rainGranular.softness01 * (0.72 + (1 - shapeJitter01) * 0.34) + (1 - headImpact01) * 0.18,
        0,
        1,
      );
      const attackRatio = clampNumber(
        lerpNumber(0.42, 0.058, headImpact01) * (0.9 + attackJitter01 * 0.22),
        0.048,
        0.48,
      );
      const attackCurve = clampNumber(
        lerpNumber(1.65, 0.48, headImpact01) * (0.9 + rainGranular.softness01 * 0.18),
        0.42,
        2.1,
      );
      const decayCurve = clampNumber(
        lerpNumber(1.18, 4.85, headImpact01) * (0.84 + decayJitter01 * 0.44) * (1 - roundedness01 * 0.16),
        0.82,
        5.8,
      );
      const densityCompensation = clampNumber(Math.sqrt(8 / Math.max(1, densityHz)), 0.34, 1.75);
      const velocity01 = clampNumber(
        (0.38 + velocityJitter01 * 0.62) * Math.sqrt(gain01 / 0.024) * densityCompensation,
        0,
        1,
      );
      const pan01 = (panJitter01 * 2 - 1) * rainGranular.stereoSpread01;
      const bufferIndex = selectRainGranularProfileIndex(frame, rainGranular, bufferJitter01);

      this.earthTextureWorklet.port.postMessage(
        createPenumbraRainGranularMessage({
          startTimeSeconds: audioStartTimeForUtcEvent(
            frame,
            now,
            event.scheduledUtcMs,
            PENUMBRA_EARTH_TEXTURE_SCHEDULE_AHEAD_SECONDS,
          ),
          randomSeed: materialSeed,
          bufferIndex,
          offset01,
          durationSeconds,
          playbackRate,
          velocity01,
          pan01,
          lowpassHz: rainGranular.airAbsorbHz,
          attackRatio,
          attackCurve,
          decayCurve,
        }),
      );
      this.lastScheduledRainGranularUtcMs = event.scheduledUtcMs;
      scheduled += 1;
      if (scheduled >= 28) {
        break;
      }
    }
  }

  private triggerHumanPluckVoices(frame: AudioFrameParams, now: number): void {
    if (this.perfDiagnostics.bypasses.humanWorklet) {
      this.humanVoiceStates.clear();
      return;
    }

    const activeVoiceIds = new Set<string>();
    const voices = this.humanWorklet ? frame.music.candidates : frame.music.voices;
    const ensembleDensityPeriodScale = this.humanWorklet
      ? humanEnsembleDensityPeriodScale(voices.length)
      : 1;

    for (const voice of voices) {
      activeVoiceIds.add(voice.id);
      const runtimeState = this.humanVoiceStates.get(voice.id);
      if (runtimeState) {
        const pulse = nextHumanPulseEvent({
          voice,
          previousUtcMs: runtimeState.previousUtcMs,
          currentUtcMs: frame.utcEpochMs,
          ensembleDensityPeriodScale,
        });
        if (pulse) {
          this.triggerHumanPluckIfAllowed(voice, pulse, now);
        }
      }

      this.humanVoiceStates.set(voice.id, {
        previousUtcMs: frame.utcEpochMs,
      });
    }

    for (const voiceId of this.humanVoiceStates.keys()) {
      if (!activeVoiceIds.has(voiceId)) {
        this.humanVoiceStates.delete(voiceId);
      }
    }
  }

  private triggerHumanPluckIfAllowed(
    voice: AudioFrameParams["music"]["voices"][number],
    pulse: HumanPulseEvent,
    now: number,
  ): void {
    if (!this.consumeHumanEventCapSlot(pulse)) {
      return;
    }

    this.triggerHumanPluck(voice, pulse, now);
  }

  private consumeHumanEventCapSlot(pulse: HumanPulseEvent): boolean {
    const cap = this.perfDiagnostics.humanEventCapPerSecond;
    if (cap <= 0) {
      return true;
    }

    const bucketUtcSecond = Math.floor(pulse.scheduledUtcMs / 1000);
    if (this.humanEventCapBucketUtcSecond !== bucketUtcSecond) {
      this.humanEventCapBucketUtcSecond = bucketUtcSecond;
      this.humanEventCapBucketCount = 0;
    }

    if (this.humanEventCapBucketCount >= cap) {
      return false;
    }

    this.humanEventCapBucketCount += 1;
    return true;
  }

  private triggerHumanPluck(
    voice: AudioFrameParams["music"]["voices"][number],
    pulse: HumanPulseEvent,
    now: number,
  ): void {
    if (
      this.perfDiagnostics.bypasses.humanWorklet ||
      !this.audioContext ||
      !this.humanPluckGain ||
      !this.humanReverbBus
    ) {
      return;
    }

    const params = deriveHumanPluckParams(voice, pulse);
    if (this.humanWorklet) {
      this.humanWorklet.port.postMessage(
        createHumanWorkletPluckMessage(params, now + HUMAN_WORKLET_SCHEDULE_AHEAD_SECONDS, {
          randomSeed: hashUint32(`${voice.id}:pulse:${pulse.scheduledUtcMs}:${pulse.pulseIndex}:worklet`),
        }),
      );
      return;
    }

    const filter = this.audioContext.createBiquadFilter();
    const envelope = this.audioContext.createGain();
    const endTime = now + params.attackSeconds + params.decaySeconds + 0.08;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(params.lowpassHz, now);
    filter.Q.value = 0.0001;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(params.peakGain01, now + params.attackSeconds);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + params.attackSeconds + params.decaySeconds);
    filter.connect(envelope);
    envelope.connect(this.humanPluckGain);
    if (params.reverbSend01 > 0.0001) {
      const reverbFilter = this.audioContext.createBiquadFilter();
      const reverbSend = this.audioContext.createGain();
      reverbFilter.type = "lowpass";
      reverbFilter.frequency.setValueAtTime(params.reverbDampingHz, now);
      reverbFilter.Q.value = 0.0001;
      reverbSend.gain.setValueAtTime(params.reverbSend01, now);
      envelope.connect(reverbFilter).connect(reverbSend).connect(this.humanReverbBus.input);

      window.setTimeout(() => {
        reverbFilter.disconnect();
        reverbSend.disconnect();
      }, Math.ceil((endTime - now + params.reverbTailSeconds) * 1000) + 400);
    }

    for (const partial of params.partials) {
      const oscillator = this.audioContext.createOscillator();
      const partialGain = this.audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(params.frequencyHz * partial.ratio, now);
      oscillator.detune.setValueAtTime(partial.detuneCents, now);
      partialGain.gain.setValueAtTime(partial.gain01, now);
      if (partial.decayScale < 0.98) {
        partialGain.gain.setValueAtTime(partial.gain01, now + params.attackSeconds);
        partialGain.gain.exponentialRampToValueAtTime(
          Math.max(0.0001, partial.gain01 * 0.08),
          now + params.attackSeconds + params.decaySeconds * partial.decayScale,
        );
      }
      oscillator.connect(partialGain).connect(filter);
      oscillator.start(now);
      oscillator.stop(endTime);
    }

    if (params.noiseGain01 > 0.0001) {
      const noise = createOneShotNoise(
        this.audioContext,
        0.08,
        hashUint32(`${voice.id}:pulse:${pulse.scheduledUtcMs}:${pulse.pulseIndex}:fallback-noise`),
      );
      const noiseGain = this.audioContext.createGain();
      noiseGain.gain.setValueAtTime(params.noiseGain01, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      noise.connect(noiseGain).connect(filter);
      noise.start(now);
      noise.stop(now + 0.085);
    }

    window.setTimeout(() => {
      filter.disconnect();
      envelope.disconnect();
    }, Math.ceil((endTime - now) * 1000) + 250);
  }

  private triggerQuakePulseVoices(frame: AudioFrameParams, now: number): void {
    const activeQuakeIds = new Set<string>();

    for (const hit of frame.quakes) {
      activeQuakeIds.add(hit.id);
      const runtimeState = this.quakePulseStates.get(hit.id);
      if (runtimeState) {
        const pulse = nextQuakePulseEvent({
          contact: hit,
          previousUtcMs: runtimeState.previousUtcMs,
          currentUtcMs: frame.utcEpochMs,
        });
        if (pulse) {
          this.triggerQuakeHit(frame, hit, pulse, now);
        }
      }

      this.quakePulseStates.set(hit.id, {
        previousUtcMs: frame.utcEpochMs,
      });
    }

    for (const quakeId of this.quakePulseStates.keys()) {
      if (!activeQuakeIds.has(quakeId)) {
        this.quakePulseStates.delete(quakeId);
      }
    }
  }

  private triggerQuakeHit(
    frame: AudioFrameParams,
    hit: AudioFrameParams["quakes"][number],
    pulse: QuakePulseEvent,
    now: number,
  ): void {
    if (!this.audioContext || !this.quakeGain) {
      return;
    }

    const rootHz = earthDroneRootHz(frame);
    const bodyFrequencyHz = quakeBodyFrequencyHz(rootHz, hit.depthDarkness01);
    const resonanceConfig =
      EARTH_DRONE_PARTIALS[pulse.resonancePartialIndex] ?? EARTH_DRONE_PARTIALS[1] ?? EARTH_DRONE_PARTIALS[0];
    const resonanceFrequencyHz = resonanceConfig
      ? foldFrequencyIntoRange(
          earthDronePartialFrequencyHz(resonanceConfig, frame, deriveEarthAirTurbulence(frame)),
          70,
          1800,
        )
      : foldFrequencyIntoRange(rootHz * 2, 70, 1800);
    const contactGain01 = Math.sqrt(clampNumber(hit.gain01, 0, 1));
    const peakGain =
      (QUAKE_IMPACT_PEAK_FLOOR + contactGain01 * QUAKE_IMPACT_PEAK_RANGE) *
      clampNumber(pulse.gainScale01, 0.12, 1.2);
    const endTime = now + pulse.attackSeconds + pulse.decaySeconds + 0.08;
    const bodyOscillator = this.audioContext.createOscillator();
    const resonanceOscillator = this.audioContext.createOscillator();
    const filter = this.audioContext.createBiquadFilter();
    const envelope = this.audioContext.createGain();
    const bodyGain = this.audioContext.createGain();
    const resonanceGainNode = this.audioContext.createGain();
    bodyOscillator.type = "sine";
    bodyOscillator.frequency.value = bodyFrequencyHz;
    resonanceOscillator.type = "sine";
    resonanceOscillator.frequency.value = resonanceFrequencyHz;
    bodyGain.gain.value = 1;
    resonanceGainNode.gain.setValueAtTime(pulse.resonanceGainScale01, now);
    resonanceGainNode.gain.exponentialRampToValueAtTime(0.0001, now + pulse.attackSeconds + pulse.decaySeconds * 0.42);
    filter.type = "lowpass";
    filter.frequency.value = hit.lowpassHz;
    filter.Q.value = 0.0001;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(peakGain, now + pulse.attackSeconds);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + pulse.attackSeconds + pulse.decaySeconds);
    bodyOscillator.connect(bodyGain).connect(filter);
    resonanceOscillator.connect(resonanceGainNode).connect(filter);

    const noise = createOneShotNoise(
      this.audioContext,
      Math.min(0.08, pulse.attackSeconds + 0.035),
      hashUint32(`${hit.id}:${pulse.scheduledUtcMs}:${pulse.pulseIndex}:quake-noise`),
    );
    const noiseFilter = this.audioContext.createBiquadFilter();
    const noiseGainNode = this.audioContext.createGain();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = foldFrequencyIntoRange(resonanceFrequencyHz * 1.7, 140, 2600);
    noiseFilter.Q.value = 0.7 + (1 - hit.depthDarkness01) * 1.4;
    noiseGainNode.gain.setValueAtTime(pulse.noiseGainScale01, now);
    noiseGainNode.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(0.12, pulse.decaySeconds * 0.28));
    noise.connect(noiseFilter).connect(noiseGainNode).connect(filter);

    filter.connect(envelope).connect(this.quakeGain);
    bodyOscillator.start(now);
    resonanceOscillator.start(now);
    noise.start(now);
    bodyOscillator.stop(endTime);
    resonanceOscillator.stop(endTime);
    noise.stop(now + Math.min(0.12, pulse.attackSeconds + 0.055));

    const cleanupDelayMs = Math.ceil(Math.max(0.1, endTime - this.audioContext.currentTime) * 1000) + 250;
    window.setTimeout(() => {
      bodyOscillator.disconnect();
      resonanceOscillator.disconnect();
      bodyGain.disconnect();
      resonanceGainNode.disconnect();
      noise.disconnect();
      noiseFilter.disconnect();
      noiseGainNode.disconnect();
      filter.disconnect();
      envelope.disconnect();
    }, cleanupDelayMs);
  }
}

function selectRainGranularProfileIndex(
  frame: AudioFrameParams,
  rainGranular: PenumbraRainGranularParams,
  selector01: number,
): number {
  const rainPresence01 = clampNumber(rainGranular.densityHz / 32, 0, 1);
  const mistWeight = Math.max(
    0.03,
    0.2 +
      frame.earth.wind01 * 0.34 +
      frame.earth.openness01 * 0.2 +
      rainGranular.shapeVariance01 * 0.16 -
      rainGranular.softness01 * 0.12,
  );
  const sheetWeight = Math.max(
    0.03,
    0.16 + rainPresence01 * 0.58 + rainGranular.softness01 * 0.18 + frame.earth.humidity01 * 0.08,
  );
  const beadWeight = Math.max(
    0.03,
    0.14 +
      rainGranular.impact01 * 0.6 +
      frame.earth.surfaceHardness01 * 0.22 +
      frame.earth.scanlineSpatialChange01 * 0.1 -
      rainGranular.softness01 * 0.16,
  );
  const surfaceWeight = Math.max(
    0.03,
    0.14 +
      frame.earth.waterRatio01 * 0.34 +
      frame.earth.humidity01 * 0.16 +
      rainGranular.softness01 * 0.18 +
      frame.earth.surfaceRoughness01 * 0.1,
  );
  const totalWeight = mistWeight + sheetWeight + beadWeight + surfaceWeight;
  const target = clampNumber(selector01, 0, 0.999999) * totalWeight;

  if (target < mistWeight) {
    return 0;
  }
  if (target < mistWeight + sheetWeight) {
    return 1;
  }
  if (target < mistWeight + sheetWeight + beadWeight) {
    return 2;
  }
  return 3;
}

function createEarthDronePartials(
  audioContext: AudioContext,
  output: AudioNode,
): EarthDronePartialNode[] {
  return EARTH_DRONE_PARTIALS.map((config) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 80 * config.integerRatio;
    gain.gain.value = 0;
    oscillator.connect(gain).connect(output);
    oscillator.start();
    return { config, oscillator, gain };
  });
}

function createEarthDroneCompanion(
  audioContext: AudioContext,
  output: AudioNode,
): EarthDroneCompanionNode {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 80;
  gain.gain.value = 0;
  oscillator.connect(gain).connect(output);
  oscillator.start();
  return { oscillator, gain };
}

function createEarthFormantBus(audioContext: AudioContext, output: AudioNode): EarthFormantBus {
  const input = audioContext.createGain();
  const droneSendGain = audioContext.createGain();
  const windSendGain = audioContext.createGain();
  const noiseSendGain = audioContext.createGain();
  const outputGain = audioContext.createGain();
  const initialFrequenciesHz = [360, 1200, 3200];
  const bands = initialFrequenciesHz.map((frequencyHz) => {
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = "bandpass";
    filter.frequency.value = frequencyHz;
    filter.Q.value = 1;
    gain.gain.value = 0;
    input.connect(filter).connect(gain).connect(outputGain);
    return { filter, gain };
  });

  input.gain.value = 1;
  droneSendGain.gain.value = 0;
  windSendGain.gain.value = 0;
  noiseSendGain.gain.value = 0;
  outputGain.gain.value = 0;
  outputGain.connect(output);

  return {
    input,
    droneSendGain,
    windSendGain,
    noiseSendGain,
    outputGain,
    bands,
  };
}

function createEarthRootReverbDebugBranch(audioContext: AudioContext): EarthRootReverbDebugBranch {
  const oscillator = audioContext.createOscillator();
  const inputGain = audioContext.createGain();
  const input = audioContext.createGain();
  const merger = audioContext.createChannelMerger(2);
  const wetGain = audioContext.createGain();
  const splitter = audioContext.createChannelSplitter(2);
  const leftAnalyser = audioContext.createAnalyser();
  const rightAnalyser = audioContext.createAnalyser();
  const silentOutput = audioContext.createGain();
  const nodes: AudioNode[] = [inputGain, input, merger, wetGain, splitter, leftAnalyser, rightAnalyser, silentOutput];

  oscillator.type = "sine";
  oscillator.frequency.value = 80;
  inputGain.gain.value = 0;
  input.gain.value = 1;
  wetGain.gain.value = 1;
  leftAnalyser.fftSize = 4096;
  rightAnalyser.fftSize = 4096;
  leftAnalyser.smoothingTimeConstant = 0;
  rightAnalyser.smoothingTimeConstant = 0;
  silentOutput.gain.value = 0;

  oscillator.connect(inputGain).connect(input);
  nodes.push(
    ...connectEarthRootReverbDebugBranch(audioContext, {
      input,
      merger,
      outputChannel: 0,
      inputGain: 1,
      predelaySeconds: 0.033,
      diffuserSeconds: 0.19,
      feedbackGain: 0.38,
      dampingHz: 6800,
    }),
    ...connectEarthRootReverbDebugBranch(audioContext, {
      input,
      merger,
      outputChannel: 1,
      inputGain: 0.94,
      predelaySeconds: 0.057,
      diffuserSeconds: 0.29,
      feedbackGain: 0.33,
      dampingHz: 4200,
    }),
  );
  merger.connect(wetGain).connect(splitter);
  splitter.connect(leftAnalyser, 0);
  splitter.connect(rightAnalyser, 1);
  wetGain.connect(silentOutput).connect(audioContext.destination);
  oscillator.start();

  return {
    oscillator,
    inputGain,
    leftAnalyser,
    rightAnalyser,
    leftBuffer: createAnalyserBuffer(leftAnalyser.fftSize),
    rightBuffer: createAnalyserBuffer(rightAnalyser.fftSize),
    nodes,
  };
}

function createAnalyserBuffer(sampleCount: number): Float32Array<ArrayBuffer> {
  return new Float32Array(new ArrayBuffer(sampleCount * Float32Array.BYTES_PER_ELEMENT));
}

function connectEarthRootReverbDebugBranch(
  audioContext: AudioContext,
  options: StereoFeedbackReverbBranchOptions,
): readonly AudioNode[] {
  const trim = audioContext.createGain();
  const predelay = audioContext.createDelay(0.6);
  const diffuserDelay = audioContext.createDelay(1.2);
  const feedback = audioContext.createGain();
  const damping = audioContext.createBiquadFilter();
  const outputGain = audioContext.createGain();

  trim.gain.value = options.inputGain;
  predelay.delayTime.value = options.predelaySeconds;
  diffuserDelay.delayTime.value = options.diffuserSeconds;
  feedback.gain.value = options.feedbackGain;
  damping.type = "lowpass";
  damping.frequency.value = options.dampingHz;
  damping.Q.value = 0.0001;
  outputGain.gain.value = 1;

  options.input.connect(trim).connect(predelay).connect(damping);
  damping.connect(outputGain).connect(options.merger, 0, options.outputChannel);
  damping.connect(diffuserDelay).connect(feedback).connect(damping);

  return [trim, predelay, diffuserDelay, feedback, damping, outputGain];
}

function earthTextureParamsForDebugMode(
  params: PenumbraEarthTextureParams,
  audioDebugMode: AudioDebugMode,
): PenumbraEarthTextureParams {
  if (audioDebugMode === "earth-water-solo") {
    return {
      ...params,
      water: {
        ...params.water,
        noiseFloorGain01: 0,
        dropletDensityHz: Math.max(params.water.dropletDensityHz, 10),
        lowDensityHz: Math.max(params.water.lowDensityHz, 4.2),
        midDensityHz: Math.max(params.water.midDensityHz, 3.4),
        highDensityHz: Math.max(params.water.highDensityHz, 2.4),
        dropletGain01: Math.max(params.water.dropletGain01, 0.18),
        brightness01: Math.max(params.water.brightness01, 0.54),
        lowLevel01: 1,
        midLevel01: 1,
        highLevel01: 0.72,
      },
      wind: {
        ...params.wind,
        bodyLevel01: 0,
        midLevel01: 0,
        midHighLevel01: 0,
        highLevel01: 0,
        airLevel01: 0,
      },
      rainGranular: {
        ...params.rainGranular,
        densityHz: 0,
        gain01: 0,
      },
    };
  }

  if (audioDebugMode === "earth-wind-solo") {
    return {
      ...params,
      water: {
        ...params.water,
        noiseFloorGain01: 0,
        dropletDensityHz: 0,
        lowDensityHz: 0,
        midDensityHz: 0,
        highDensityHz: 0,
        dropletGain01: 0,
      },
      rainGranular: {
        ...params.rainGranular,
        densityHz: 0,
        gain01: 0,
      },
    };
  }

  if (audioDebugMode === "rain-granular-solo") {
    return {
      ...params,
      water: {
        ...params.water,
        noiseFloorGain01: 0,
        dropletDensityHz: 0,
        lowDensityHz: 0,
        midDensityHz: 0,
        highDensityHz: 0,
        dropletGain01: 0,
      },
      wind: {
        ...params.wind,
        bodyLevel01: 0,
        midLevel01: 0,
        midHighLevel01: 0,
        highLevel01: 0,
        airLevel01: 0,
      },
    };
  }

  if (audioDebugMode === "rain-granular-boost") {
    return {
      ...params,
      rainGranular: {
        ...params.rainGranular,
        densityHz: Math.max(params.rainGranular.densityHz, 18),
        gain01: Math.max(params.rainGranular.gain01, 0.026),
        brightness01: Math.max(params.rainGranular.brightness01, 0.54),
        grainDurationSeconds: Math.max(params.rainGranular.grainDurationSeconds, 0.018),
        playbackRate01: Math.max(params.rainGranular.playbackRate01, 0.62),
        stereoSpread01: Math.max(params.rainGranular.stereoSpread01, 0.72),
        offsetDrift01: Math.max(params.rainGranular.offsetDrift01, 0.58),
        airAbsorbHz: Math.max(params.rainGranular.airAbsorbHz, 7600),
      },
    };
  }

  if (audioDebugMode === "earth-texture-solo") {
    return {
      ...params,
      water: {
        ...params.water,
        noiseFloorGain01: 0,
        lowLevel01: clampNumber(params.water.lowLevel01 * 1.35 + 0.18, 0, 1),
        midLevel01: clampNumber(params.water.midLevel01 * 1.55 + 0.16, 0, 1),
        highLevel01: clampNumber(params.water.highLevel01 * 1.65 + 0.08, 0, 1),
      },
      wind: {
        ...params.wind,
        bodyLevel01: params.wind.bodyLevel01 * 0.58,
        midLevel01: params.wind.midLevel01 * 0.62,
        midHighLevel01: params.wind.midHighLevel01 * 0.65,
        highLevel01: params.wind.highLevel01 * 0.68,
        airLevel01: params.wind.airLevel01 * 0.7,
      },
    };
  }

  return params;
}

function createHumanReverbBus(audioContext: AudioContext, output: AudioNode): HumanReverbBus {
  const input = audioContext.createGain();
  const merger = audioContext.createChannelMerger(2);
  const wetGain = audioContext.createGain();

  input.gain.value = 1;
  wetGain.gain.value = 3.2;

  connectHumanReverbBranch(audioContext, {
    input,
    merger,
    outputChannel: 0,
    inputGain: 1.2,
    predelaySeconds: 0.037,
    diffuserSeconds: 0.183,
    feedbackGain: 0.58,
    dampingHz: 7600,
  });
  connectHumanReverbBranch(audioContext, {
    input,
    merger,
    outputChannel: 1,
    inputGain: 1.08,
    predelaySeconds: 0.071,
    diffuserSeconds: 0.267,
    feedbackGain: 0.51,
    dampingHz: 3100,
  });

  merger.connect(wetGain).connect(output);

  return { input };
}

function createEarthTextureReverbBus(audioContext: AudioContext): EarthTextureReverbBus | undefined {
  try {
    setToneContext(audioContext);
    const input = audioContext.createGain();
    const textureSendGain = audioContext.createGain();
    const waterTextureSendGain = audioContext.createGain();
    const windTextureSendGain = audioContext.createGain();
    const humanSendGain = audioContext.createGain();
    const droneSendGain = audioContext.createGain();
    const quakeSendGain = audioContext.createGain();
    const returnGain = audioContext.createGain();
    const reverb = new Convolver({
      normalize: true,
      url: createDeterministicReverbImpulse(audioContext, {
        decaySeconds: EARTH_TEXTURE_REVERB_DECAY_SECONDS,
        preDelaySeconds: EARTH_TEXTURE_REVERB_PREDELAY_SECONDS,
        seed: "earth-texture-tone-convolver:v1",
      }),
    });

    input.gain.value = 1;
    textureSendGain.gain.value = 0;
    waterTextureSendGain.gain.value = 0;
    windTextureSendGain.gain.value = 0;
    humanSendGain.gain.value = 0;
    droneSendGain.gain.value = 0;
    quakeSendGain.gain.value = 0;
    returnGain.gain.value = 0.9;

    return {
      input,
      textureSendGain,
      waterTextureSendGain,
      windTextureSendGain,
      humanSendGain,
      droneSendGain,
      quakeSendGain,
      returnGain,
      reverb,
    };
  } catch (error) {
    console.warn("PENUMBRA earth texture Tone.js reverb failed to initialize; using dry texture.", error);
    return undefined;
  }
}

function createMasterSafetyLimiter(audioContext: AudioContext): DynamicsCompressorNode {
  const limiter = audioContext.createDynamicsCompressor();
  limiter.threshold.value = MASTER_SAFETY_LIMITER_THRESHOLD_DB;
  limiter.knee.value = 0;
  limiter.ratio.value = MASTER_SAFETY_LIMITER_RATIO;
  limiter.attack.value = MASTER_SAFETY_LIMITER_ATTACK_SECONDS;
  limiter.release.value = MASTER_SAFETY_LIMITER_RELEASE_SECONDS;
  return limiter;
}

interface StereoFeedbackReverbBranchOptions {
  readonly input: AudioNode;
  readonly merger: ChannelMergerNode;
  readonly outputChannel: number;
  readonly inputGain: number;
  readonly predelaySeconds: number;
  readonly diffuserSeconds: number;
  readonly feedbackGain: number;
  readonly dampingHz: number;
}

function connectHumanReverbBranch(
  audioContext: AudioContext,
  options: StereoFeedbackReverbBranchOptions,
): void {
  const trim = audioContext.createGain();
  const predelay = audioContext.createDelay(0.8);
  const diffuserDelay = audioContext.createDelay(1.4);
  const feedback = audioContext.createGain();
  const damping = audioContext.createBiquadFilter();
  const outputGain = audioContext.createGain();

  trim.gain.value = options.inputGain;
  predelay.delayTime.value = options.predelaySeconds;
  diffuserDelay.delayTime.value = options.diffuserSeconds;
  feedback.gain.value = options.feedbackGain;
  damping.type = "lowpass";
  damping.frequency.value = options.dampingHz;
  damping.Q.value = 0.0001;
  outputGain.gain.value = 1;

  options.input.connect(trim).connect(predelay).connect(damping);
  damping.connect(outputGain).connect(options.merger, 0, options.outputChannel);
  damping.connect(diffuserDelay).connect(feedback).connect(damping);
}

function createLoopingColoredNoise(
  audioContext: AudioContext,
  color: "brown" | "pink" | "white",
): AudioBufferSourceNode {
  const sampleCount = Math.max(1, Math.floor(audioContext.sampleRate * LEGACY_LOOPING_NOISE_SECONDS));
  const buffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
  const channel = buffer.getChannelData(0);
  let randomState = hashUint32(`earth-looping-${color}-noise:v1:${audioContext.sampleRate}`);
  let brownState = 0;
  let pinkB0 = 0;
  let pinkB1 = 0;
  let pinkB2 = 0;
  let pinkB3 = 0;
  let pinkB4 = 0;
  let pinkB5 = 0;
  let pinkB6 = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const white = nextSignedSeededNoise(() => {
      randomState = nextSeedUint32(randomState);
      return randomState;
    });
    if (color === "white") {
      channel[index] = white;
      continue;
    }

    if (color === "brown") {
      brownState = (brownState + white * 0.02) / 1.02;
      channel[index] = brownState;
      continue;
    }

    pinkB0 = 0.99886 * pinkB0 + white * 0.0555179;
    pinkB1 = 0.99332 * pinkB1 + white * 0.0750759;
    pinkB2 = 0.969 * pinkB2 + white * 0.153852;
    pinkB3 = 0.8665 * pinkB3 + white * 0.3104856;
    pinkB4 = 0.55 * pinkB4 + white * 0.5329522;
    pinkB5 = -0.7616 * pinkB5 - white * 0.016898;
    channel[index] = pinkB0 + pinkB1 + pinkB2 + pinkB3 + pinkB4 + pinkB5 + pinkB6 + white * 0.5362;
    pinkB6 = white * 0.115926;
  }

  makeLoopingNoiseBufferClickSafe(channel, audioContext.sampleRate);
  normalizeNoiseBuffer(channel);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

function makeLoopingNoiseBufferClickSafe(channel: Float32Array, sampleRate: number): void {
  if (channel.length < 2) {
    return;
  }

  const endpointDelta = channel[channel.length - 1] - channel[0];
  for (let index = 0; index < channel.length; index += 1) {
    const progress01 = index / (channel.length - 1);
    const smoothProgress01 = progress01 * progress01 * (3 - 2 * progress01);
    channel[index] -= endpointDelta * smoothProgress01;
  }

  const fadeSamples = Math.min(
    Math.floor(sampleRate * LEGACY_LOOPING_NOISE_SEAM_FADE_SECONDS),
    Math.floor(channel.length / 8),
  );
  if (fadeSamples < 2) {
    return;
  }

  const loopTarget = channel[0];
  for (let offset = 0; offset < fadeSamples; offset += 1) {
    const index = channel.length - fadeSamples + offset;
    const progress01 = (offset + 1) / fadeSamples;
    const smoothProgress01 = progress01 * progress01 * (3 - 2 * progress01);
    channel[index] = channel[index] * (1 - smoothProgress01) + loopTarget * smoothProgress01;
  }
}

function normalizeNoiseBuffer(channel: Float32Array): void {
  let sumSquares = 0;
  for (const sample of channel) {
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, channel.length)) || 1;
  const gain = 0.32 / rms;
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = Math.max(-1, Math.min(1, channel[index] * gain));
  }
}

function earthNoiseColorMix(color01: number): { brown: number; pink: number; white: number } {
  const color = Math.max(0, Math.min(1, color01));
  const brown = Math.max(0, 1 - color * 2);
  const white = Math.max(0, color * 2 - 1);
  const pink = 1 - brown - white;

  return {
    brown: Math.sqrt(brown),
    pink: Math.sqrt(pink),
    white: Math.sqrt(white),
  };
}

function audioStartTimeForUtcEvent(
  frame: AudioFrameParams,
  now: number,
  scheduledUtcMs: number,
  scheduleAheadSeconds: number,
): number {
  return now + Math.max(0, scheduledUtcMs - frame.utcEpochMs) / 1000 + scheduleAheadSeconds;
}

function quakeBodyFrequencyHz(rootHz: number, depthDarkness01: number): number {
  const depth = clampNumber(depthDarkness01, 0, 1);
  const subharmonicRatio = depth > 0.66 ? 0.25 : depth > 0.32 ? 0.5 : 1;
  return foldFrequencyIntoRange(rootHz * subharmonicRatio, 18, 220);
}

function foldFrequencyIntoRange(frequencyHz: number, minHz: number, maxHz: number): number {
  let folded = Math.max(0.001, frequencyHz);
  while (folded < minHz) {
    folded *= 2;
  }
  while (folded > maxHz) {
    folded *= 0.5;
  }
  return clampNumber(folded, minHz, maxHz);
}

function waterBandLevel(water: PenumbraWaterTextureParams, band: PenumbraDropletBand): number {
  if (band === "low") {
    return water.lowLevel01;
  }
  if (band === "mid") {
    return water.midLevel01;
  }
  return water.highLevel01;
}

function waterBandDensityHz(water: PenumbraWaterTextureParams, band: PenumbraDropletBand): number {
  if (band === "low") {
    return water.lowDensityHz;
  }
  if (band === "mid") {
    return water.midDensityHz;
  }
  return water.highDensityHz;
}

function lerpNumber(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nextSeedUint32(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

function nextSignedSeededNoise(nextSeed: () => number): number {
  return hashUint32To01(nextSeed()) * 2 - 1;
}

function createDeterministicReverbImpulse(
  audioContext: AudioContext,
  options: { readonly decaySeconds: number; readonly preDelaySeconds: number; readonly seed: string },
): AudioBuffer {
  const sampleRate = audioContext.sampleRate;
  const preDelaySamples = Math.max(0, Math.round(options.preDelaySeconds * sampleRate));
  const decaySamples = Math.max(1, Math.round(options.decaySeconds * sampleRate));
  const sampleCount = preDelaySamples + decaySamples;
  const buffer = audioContext.createBuffer(2, sampleCount, sampleRate);

  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    let randomState = hashUint32(`${options.seed}:channel:${channelIndex}`);
    let diffuserState = 0;
    for (let index = preDelaySamples; index < sampleCount; index += 1) {
      randomState = nextSeedUint32(randomState);
      const age01 = (index - preDelaySamples) / decaySamples;
      const envelope = Math.exp(-6.9 * age01);
      const signedNoise = hashUint32To01(randomState) * 2 - 1;
      diffuserState += 0.34 * (signedNoise - diffuserState);
      channel[index] = (signedNoise * 0.68 + diffuserState * 0.32) * envelope;
    }
  }

  return buffer;
}

async function createPenumbraEarthTextureWorklet(
  audioContext: AudioContext,
): Promise<AudioWorkletNode | undefined> {
  if (!audioContext.audioWorklet || typeof AudioWorkletNode === "undefined") {
    console.warn("PENUMBRA earth texture AudioWorklet is unavailable; using node fallback.");
    return undefined;
  }

  try {
    await audioContext.audioWorklet.addModule(PENUMBRA_EARTH_TEXTURE_WORKLET_MODULE_URL);
    return new AudioWorkletNode(audioContext, PENUMBRA_EARTH_TEXTURE_WORKLET_PROCESSOR_NAME, {
      channelCount: 2,
      channelCountMode: "explicit",
      numberOfInputs: 0,
      numberOfOutputs: 4,
      outputChannelCount: [2, 2, 2, 2],
    });
  } catch (error) {
    console.warn("PENUMBRA earth texture AudioWorklet failed to initialize; using node fallback.", error);
    return undefined;
  }
}

function delayMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

async function createHumanLayerWorklet(
  audioContext: AudioContext,
  audioDebugMode: AudioDebugMode,
): Promise<AudioWorkletNode | undefined> {
  if (!audioContext.audioWorklet || typeof AudioWorkletNode === "undefined") {
    console.warn("PENUMBRA human layer AudioWorklet is unavailable; using node fallback.");
    return undefined;
  }

  try {
    await audioContext.audioWorklet.addModule(HUMAN_LAYER_WORKLET_MODULE_URL);
    return new AudioWorkletNode(audioContext, HUMAN_LAYER_WORKLET_PROCESSOR_NAME, {
      channelCount: 2,
      channelCountMode: "explicit",
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { audioDebugMode },
    });
  } catch (error) {
    console.warn("PENUMBRA human layer AudioWorklet failed to initialize; using node fallback.", error);
    return undefined;
  }
}

function createOneShotNoise(
  audioContext: AudioContext,
  durationSeconds: number,
  randomSeed: number,
): AudioBufferSourceNode {
  const sampleCount = Math.max(1, Math.floor(audioContext.sampleRate * durationSeconds));
  const buffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
  const channel = buffer.getChannelData(0);
  let seed = Math.max(1, Math.floor(randomSeed)) >>> 0;
  for (let index = 0; index < sampleCount; index += 1) {
    seed = nextSeedUint32(seed);
    const fade = 1 - index / sampleCount;
    channel[index] = (hashUint32To01(seed) * 2 - 1) * fade;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  return source;
}
