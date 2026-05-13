import * as THREE from "three";

import type { AudioFrameParams } from "../audio/audio-params";
import { deriveEarthFormantParams } from "../audio/earth-formant";
import type { EarthRootDebugMeterSnapshot } from "../audio/earth-root-debug-meter";
import {
  deriveEarthAirTurbulence,
  EARTH_DRONE_PARTIALS,
  earthDroneCompanionParams,
  earthDronePartialRatio,
  earthDroneRootHz,
  type EarthDroneCompanionParams,
} from "../audio/earth-drone-spectrum";
import { derivePenumbraEarthTextureParams } from "../audio/penumbra-earth-texture-params";
import type { RuntimeSnapshot } from "../app-state/runtime-store";
import {
  activeMusicSampleCount,
  activeQuakeCount,
  maxMusicGain,
  maxNightLightNorm,
  scaleModeDistribution,
} from "../app-state/selectors";
import { normalizeNightLight } from "../fusion/nightlight";
import { nextNightLightForecast, type NightLightForecast } from "../fusion/nightlight-contacts";
import {
  humanEnsembleDensityPeriodScale,
  nextHumanPulseEvent,
} from "../fusion/human-pulse-scheduler";
import type { PrecipitationBandField } from "../fusion/precipitation-band";
import { nextQuakePulseEvent } from "../fusion/quake-pulse-scheduler";
import type { EarthquakeEvent } from "../live-data/quake-store";
import { clamp, degToRad } from "../scanline/geometry";
import {
  cloudAtlasDistributionStats,
  cloudAtlasOpticalDensityDistributionStats,
  cloudAtlasPrecipitationDistributionStats,
  type CloudAtlas,
  type CloudAtlasSequence,
  type LoadedCloudAtlasFrame,
} from "../static-data/cloud-atlas-loader";
import { terrainColorForCell } from "../static-data/terrain-color";
import { findNearestWorldGridCell, type WorldGrid, type WorldGridCell } from "../static-data/worldgrid-loader";
import { PENUMBRA_VISUAL_PALETTE } from "../visual-palette";
import {
  HUMAN_PRESENCE_NIGHT_FADE_END,
  HUMAN_PRESENCE_NIGHT_FADE_START,
  terrainHeight01ForCell,
  terrainRadiusForCell,
  terrainRegisterColorForCell,
} from "./visual-params";
import {
  precipitationVisualDensityHzForWater,
  precipitationVisualParticles,
} from "./precipitation-visual";
import {
  waterTextureVisualParticles,
  type WaterTextureVisualParticle,
} from "./water-texture-visual";
import {
  createEarthDetuneBeatEnvelope,
  earthRootHzFromDroneRootHz,
} from "./earth-root-waveform";

export interface PenumbraRendererOptions {
  readonly debug: boolean;
  readonly debugHud?: boolean;
  readonly earthRootWidget?: boolean;
  readonly surfaceWorldGrid?: WorldGrid;
  readonly contactWorldGrid?: WorldGrid;
  readonly cloudAtlas?: CloudAtlas;
  readonly cloudAtlasSequence?: CloudAtlasSequence;
  readonly cloudDiagnostic?: boolean;
  readonly staticVisualOnly?: boolean;
  readonly windShimmerTrail?: boolean;
  readonly performance: {
    readonly pixelRatioCap: number;
    readonly pixelRatioOverride?: number;
    readonly outputSize?: { readonly width: number; readonly height: number };
    readonly preserveDrawingBuffer: boolean;
    readonly terrainMarkerSegments: number;
  };
}

interface PointCloudInput {
  readonly position: THREE.Vector3;
  readonly color: THREE.Color;
}

interface WaterTextureRippleInput {
  readonly normal: THREE.Vector3;
  readonly color: THREE.Color;
  readonly alpha01: number;
  readonly maxAngleRad: number;
  readonly age01: number;
}

interface WindShimmerInput {
  readonly strength01: number;
  readonly focus01: number;
  readonly flowCycles: number;
  readonly flowHz: number;
  readonly detail01: number;
}

interface WindShimmerFlowState {
  readonly previousUtcMs: number;
  readonly flowCycles: number;
  readonly flowHz: number;
}

interface HumanPresenceContact {
  readonly cellId: string;
  readonly position: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly color: THREE.Color;
  readonly baseAlpha01: number;
  readonly sizeScale01: number;
}

interface HumanVoiceVisualState {
  readonly previousUtcMs: number;
  readonly pulseUtcMs?: number;
  readonly pulseStrength01: number;
}

interface QuakeContactVisualState {
  readonly previousUtcMs: number;
  readonly pulseUtcMs?: number;
  readonly pulseStrength01: number;
}

interface DebugDetuneBeatVisualState {
  readonly previousUtcMs: number;
  readonly companionHz: number;
  readonly detuneCents: number;
  readonly amount01: number;
  readonly beatPhase01: number;
}

interface DebugDetuneBeatVisualParams extends EarthDroneCompanionParams {
  readonly beatPhase01: number;
}

interface CloudAtlasTextureFrame {
  readonly atlas: CloudAtlas;
  readonly ref?: LoadedCloudAtlasFrame;
  readonly texture: THREE.DataTexture;
  readonly validAtMs: number;
}

interface CloudAtlasFrameSelection {
  readonly left: CloudAtlasTextureFrame;
  readonly right: CloudAtlasTextureFrame;
  readonly mix01: number;
}

interface CloudAtlasTextureFrameSet {
  readonly frames: readonly CloudAtlasTextureFrame[];
  readonly sourceKind: string;
  readonly signature: string;
  readonly transitionDurationMs: number;
}

const SURFACE_CONTACT_RADIUS = 1.006;
const NIGHT_LIGHT_SURFACE_RADIUS = 1.004;
const CLOUD_ATLAS_SHELL_RADIUS = 1.007;
const NIGHT_LIGHT_POINT_SIZE_PX = 30;
const NIGHT_LIGHT_POINT_REFERENCE_SHORT_SIDE_PX = 760;
const NIGHT_LIGHT_POINT_MIN_VIEWPORT_SCALE = 0.62;
const CAPTURE_NIGHT_LIGHT_POINT_REFERENCE_SHORT_SIDE_PX = 1024;
const CAPTURE_NIGHT_LIGHT_POINT_MAX_OUTPUT_SCALE = 6;
const VISUAL_TERMINATOR_SOFTNESS_SCALE = 2.65;
const CLOUD_TERMINATOR_SOFTNESS_SCALE = 1.85;
const SOLAR_DECLINATION_MAX_DEG = 23.44;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const HUMAN_PULSE_VISUAL_DECAY_MS = 920;
const HUMAN_PULSE_VISUAL_MIN_LEVEL = 0.015;
const HUMAN_PULSE_CORE_FLOOR_MIN = 0.006;
const HUMAN_PULSE_CORE_FLOOR_FULL = 0.055;
const HUMAN_PULSE_CORE_FLOOR_ALPHA = 0.035;
const HUMAN_PULSE_PRESENCE_FLOOR = 0.22;
const QUAKE_PULSE_VISUAL_DECAY_MS = 1180;
const QUAKE_PULSE_VISUAL_MIN_LEVEL = 0.003;
const DEFAULT_CLOUD_ATLAS_TRANSITION_DURATION_MS = 20 * 60_000;
const DEBUG_DETUNE_BEAT_VISUAL_MAX_STEP_SECONDS = 0.25;
const DEBUG_DETUNE_BEAT_ENVELOPE_WINDOW_SECONDS = 1;
const SURFACE_WATER_RIPPLE_MAX_COUNT = 48;
const SURFACE_WATER_RIPPLE_LOW_MAX_ANGLE_DEG = 7.8;
const SURFACE_WATER_RIPPLE_MID_MAX_ANGLE_DEG = 4.6;
const WIND_SHIMMER_PHASE_MIN_HZ = 0.28;
const WIND_SHIMMER_PHASE_MAX_HZ = 1.08;

class DynamicPointCloudLayer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;
  readonly object: THREE.Points;
  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private capacity = 0;

  constructor(size: number, opacity: number) {
    this.material = new THREE.PointsMaterial({
      size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.visible = false;
    this.object.frustumCulled = false;
  }

  update(points: readonly PointCloudInput[]): void {
    if (points.length === 0) {
      this.object.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }

    this.ensureCapacity(points.length);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (!point) {
        continue;
      }

      const offset = index * 3;
      this.positions[offset] = point.position.x;
      this.positions[offset + 1] = point.position.y;
      this.positions[offset + 2] = point.position.z;
      this.colors[offset] = point.color.r;
      this.colors[offset + 1] = point.color.g;
      this.colors[offset + 2] = point.color.b;
    }

    this.geometry.setDrawRange(0, points.length);
    this.geometry.getAttribute("position").needsUpdate = true;
    this.geometry.getAttribute("color").needsUpdate = true;
    this.object.visible = true;
  }

  private ensureCapacity(pointCount: number): void {
    if (pointCount <= this.capacity) {
      return;
    }

    let nextCapacity = Math.max(1, this.capacity);
    while (nextCapacity < pointCount) {
      nextCapacity *= 2;
    }

    this.capacity = nextCapacity;
    this.positions = new Float32Array(nextCapacity * 3);
    this.colors = new Float32Array(nextCapacity * 3);

    const positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    const colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", positionAttribute);
    this.geometry.setAttribute("color", colorAttribute);
  }
}

class DynamicNightLightGlowLayer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  readonly object: THREE.Points;
  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private normals = new Float32Array(0);
  private alphas = new Float32Array(0);
  private sizeScales = new Float32Array(0);
  private pulses = new Float32Array(0);
  private capacity = 0;

  constructor(pointSizePx: number) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        pointSizePx: { value: pointSizePx },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float pointSizePx;
        uniform vec3 sunDirection;
        attribute vec3 color;
        attribute vec3 contactNormal;
        attribute float alpha;
        attribute float sizeScale;
        attribute float pulse;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vPulse;
        varying float vFacing;
        varying float vNightSide;

        void main() {
          vColor = color;
          vAlpha = alpha;
          vPulse = pulse;
          vec3 worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 worldNormal = normalize(mat3(modelMatrix) * contactNormal);
          vec3 earthLocalNormal = normalize(contactNormal);
          vec3 viewDirection = normalize(cameraPosition - worldPosition);
          vFacing = dot(worldNormal, viewDirection);
          float sunlight = dot(earthLocalNormal, normalize(sunDirection));
          vNightSide = 1.0 - smoothstep(${HUMAN_PRESENCE_NIGHT_FADE_START.toFixed(3)}, ${HUMAN_PRESENCE_NIGHT_FADE_END.toFixed(3)}, sunlight);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = pointSizePx * sizeScale * (1.0 + pulse * 0.46);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vPulse;
        varying float vFacing;
        varying float vNightSide;

        void main() {
          float visibleSide = smoothstep(-0.025, 0.08, vFacing);
          if (visibleSide <= 0.001) {
            discard;
          }

          vec2 centered = gl_PointCoord * 2.0 - 1.0;
          float radius = length(centered);
          if (radius > 1.0) {
            discard;
          }

          float core = 1.0 - smoothstep(0.0, 0.32, radius);
          float halo = 1.0 - smoothstep(0.12, 1.0, radius);
          float pulseCoreFloor = smoothstep(${HUMAN_PULSE_CORE_FLOOR_MIN.toFixed(3)}, ${HUMAN_PULSE_CORE_FLOOR_FULL.toFixed(3)}, vPulse);
          float pulsePresence = max(
            smoothstep(0.02, 0.72, vPulse),
            pulseCoreFloor * ${HUMAN_PULSE_PRESENCE_FLOOR.toFixed(2)}
          );
          float presenceMask = max(vNightSide, pulsePresence);
          float presenceAlpha = vAlpha * presenceMask;
          float pulseBloom = (1.0 - smoothstep(0.28, 1.0, radius)) * vPulse * 0.12;
          float alpha = clamp(
            presenceAlpha * (halo * 0.16 + core * 1.2) +
              core * pulseCoreFloor * ${HUMAN_PULSE_CORE_FLOOR_ALPHA.toFixed(3)} +
              pulseBloom,
            0.0,
            0.95
          ) * visibleSide;
          if (alpha <= 0.001) {
            discard;
          }
          vec3 color = vColor * (0.56 + core * 0.82 + vPulse * 0.58);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
  }

  setSunDirection(sunDirection: THREE.Vector3): void {
    this.material.uniforms.sunDirection.value.copy(sunDirection);
  }

  setPointSize(pointSizePx: number): void {
    this.material.uniforms.pointSizePx.value = pointSizePx;
  }

  updateHumanPresence(
    contacts: readonly HumanPresenceContact[],
    pulseLevelsByCellId: ReadonlyMap<string, number>,
    densityScale01: number,
  ): void {
    if (contacts.length === 0) {
      this.object.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }

    const stableDensityScale = clamp(densityScale01, 0.16, 1);
    const pulseDensityScale = clamp(Math.sqrt(stableDensityScale), 0.4, 1);
    this.ensureCapacity(contacts.length);
    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index];
      if (!contact) {
        continue;
      }

      const pulse01 = pulseLevelsByCellId.get(contact.cellId) ?? 0;
      const offset = index * 3;
      this.positions[offset] = contact.position.x;
      this.positions[offset + 1] = contact.position.y;
      this.positions[offset + 2] = contact.position.z;
      this.colors[offset] = contact.color.r;
      this.colors[offset + 1] = contact.color.g;
      this.colors[offset + 2] = contact.color.b;
      this.normals[offset] = contact.normal.x;
      this.normals[offset + 1] = contact.normal.y;
      this.normals[offset + 2] = contact.normal.z;
      this.alphas[index] = clamp(
        contact.baseAlpha01 * stableDensityScale + pulse01 * 0.24 * pulseDensityScale,
        0,
        0.72,
      );
      this.sizeScales[index] = clamp(
        contact.sizeScale01 * (0.64 + stableDensityScale * 0.36) + pulse01 * 0.18 * pulseDensityScale,
        0.18,
        1.28,
      );
      this.pulses[index] = pulse01;
    }

    this.geometry.setDrawRange(0, contacts.length);
    this.geometry.getAttribute("position").needsUpdate = true;
    this.geometry.getAttribute("color").needsUpdate = true;
    this.geometry.getAttribute("contactNormal").needsUpdate = true;
    this.geometry.getAttribute("alpha").needsUpdate = true;
    this.geometry.getAttribute("sizeScale").needsUpdate = true;
    this.geometry.getAttribute("pulse").needsUpdate = true;
    this.object.visible = true;
  }

  private ensureCapacity(pointCount: number): void {
    if (pointCount <= this.capacity) {
      return;
    }

    let nextCapacity = Math.max(1, this.capacity);
    while (nextCapacity < pointCount) {
      nextCapacity *= 2;
    }

    this.capacity = nextCapacity;
    this.positions = new Float32Array(nextCapacity * 3);
    this.colors = new Float32Array(nextCapacity * 3);
    this.normals = new Float32Array(nextCapacity * 3);
    this.alphas = new Float32Array(nextCapacity);
    this.sizeScales = new Float32Array(nextCapacity);
    this.pulses = new Float32Array(nextCapacity);

    const positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    const colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    const normalAttribute = new THREE.BufferAttribute(this.normals, 3);
    const alphaAttribute = new THREE.BufferAttribute(this.alphas, 1);
    const sizeScaleAttribute = new THREE.BufferAttribute(this.sizeScales, 1);
    const pulseAttribute = new THREE.BufferAttribute(this.pulses, 1);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    normalAttribute.setUsage(THREE.DynamicDrawUsage);
    alphaAttribute.setUsage(THREE.DynamicDrawUsage);
    sizeScaleAttribute.setUsage(THREE.DynamicDrawUsage);
    pulseAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", positionAttribute);
    this.geometry.setAttribute("color", colorAttribute);
    this.geometry.setAttribute("contactNormal", normalAttribute);
    this.geometry.setAttribute("alpha", alphaAttribute);
    this.geometry.setAttribute("sizeScale", sizeScaleAttribute);
    this.geometry.setAttribute("pulse", pulseAttribute);
  }
}

export class PenumbraRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly worldGrid: WorldGrid;
  private readonly debug: boolean;
  private readonly pixelRatioCap: number;
  private readonly pixelRatioOverride: number | undefined;
  private readonly outputSize: { readonly width: number; readonly height: number } | undefined;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly surfaceWorldGrid: WorldGrid;
  private readonly contactWorldGrid: WorldGrid;
  private readonly staticVisualOnly: boolean;
  private readonly windShimmerTrail: boolean;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  private readonly globeGroup = new THREE.Group();
  private readonly dynamicGroup = new THREE.Group();
  private readonly quakeGroup = new THREE.Group();
  private readonly nightLightLayer = new DynamicNightLightGlowLayer(NIGHT_LIGHT_POINT_SIZE_PX);
  private readonly humanPresenceContacts: readonly HumanPresenceContact[];
  private readonly terrainContactsLayer = new DynamicPointCloudLayer(0.018, 0.78);
  private readonly cloudsLayer = new DynamicPointCloudLayer(0.026, 0.36);
  private readonly precipitationLayer = new DynamicPointCloudLayer(0.017, 0.74);
  private readonly globeMaterial: THREE.ShaderMaterial;
  private readonly cloudShellMaterial: THREE.ShaderMaterial;
  private readonly surfaceTexture: THREE.DataTexture;
  private readonly waterMaskTexture: THREE.DataTexture;
  private cloudAtlasFrameSet: CloudAtlasTextureFrameSet;
  private previousCloudAtlasFrameSet: CloudAtlasTextureFrameSet | undefined;
  private cloudAtlasTransitionStartMs = 0;
  private cloudAtlasTransitionDurationMs = 0;
  private readonly sunLight = new THREE.DirectionalLight(PENUMBRA_VISUAL_PALETTE.atmosphere.sun, 0.82);
  private readonly hudElement: HTMLElement;
  private readonly utcElement: HTMLElement;
  private readonly longitudeElement: HTMLElement;
  private readonly declinationElement: HTMLElement;
  private readonly declinationValueElement: HTMLElement;
  private readonly debugElement: HTMLElement | undefined;
  private readonly debugRootElement: HTMLElement | undefined;
  private readonly debugEarthRootValueElement: HTMLElement | undefined;
  private readonly debugDroneValueElement: HTMLElement | undefined;
  private readonly debugEarthBeatValueElement: HTMLElement | undefined;
  private readonly debugRootWaveformTraceElement: SVGPolylineElement | undefined;
  private readonly humanVoiceVisualStates = new Map<string, HumanVoiceVisualState>();
  private readonly quakeContactVisualStates = new Map<string, QuakeContactVisualState>();
  private nightLightForecastBucket: number | undefined;
  private nightLightForecastText = "next music none 24h";
  private previousAudioDebugUtcMs: number | undefined;
  private previousDroneDebugRootHz: number | undefined;
  private debugDetuneBeatVisualState: DebugDetuneBeatVisualState | undefined;
  private lastAudioFrameGapDebugText = "last gap none";
  private lastDroneRootJumpDebugText = "last root jump none";
  private lastPrecipitationVisualDebugText = "rain visual n/a";
  private lastWaterTextureVisualDebugText = "water visual n/a";
  private lastWindShimmerDebugText = "wind shimmer n/a";
  private windShimmerFlowState: WindShimmerFlowState | undefined;

  constructor(canvas: HTMLCanvasElement, worldGrid: WorldGrid, options: PenumbraRendererOptions) {
    this.canvas = canvas;
    this.worldGrid = worldGrid;
    this.surfaceWorldGrid = options.surfaceWorldGrid ?? worldGrid;
    this.contactWorldGrid = options.contactWorldGrid ?? worldGrid;
    this.humanPresenceContacts = createHumanPresenceContacts(this.contactWorldGrid);
    this.staticVisualOnly = options.staticVisualOnly === true;
    this.windShimmerTrail = options.windShimmerTrail === true;
    this.debug = options.debug;
    this.pixelRatioCap = options.performance.pixelRatioCap;
    this.pixelRatioOverride = options.performance.pixelRatioOverride;
    this.outputSize = options.performance.outputSize;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: options.performance.preserveDrawingBuffer,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(PENUMBRA_VISUAL_PALETTE.scene.space, 1);

    this.camera.position.set(0, 0.08, 3.8);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(
      new THREE.HemisphereLight(
        PENUMBRA_VISUAL_PALETTE.atmosphere.hemisphereSky,
        PENUMBRA_VISUAL_PALETTE.atmosphere.hemisphereGround,
        0.46,
      ),
    );
    this.scene.add(this.sunLight);
    this.scene.add(this.globeGroup);
    this.scene.add(this.dynamicGroup);

    this.surfaceTexture = createWorldGridSurfaceTexture(this.surfaceWorldGrid);
    this.waterMaskTexture = createWorldGridWaterMaskTexture(this.surfaceWorldGrid);
    this.cloudAtlasFrameSet = createCloudAtlasTextureFrameSet(
      options.cloudAtlas,
      options.cloudAtlasSequence,
    );
    const initialCloudAtlasTexture = this.cloudAtlasFrameSet.frames[0]?.texture;
    this.globeMaterial = createGlobeMaterial(this.surfaceTexture, this.waterMaskTexture);
    this.cloudShellMaterial = createCloudShellMaterial(
      this.surfaceTexture,
      initialCloudAtlasTexture,
      options.cloudDiagnostic === true,
    );
    this.globeGroup.add(createBaseGlobe(this.globeMaterial));
    this.globeGroup.add(createCloudShell(this.cloudShellMaterial));
    if (shouldRenderStaticTerrainMarkers(worldGrid)) {
      this.globeGroup.add(createTerrainReliefMarkers(worldGrid, options.performance.terrainMarkerSegments));
    }
    this.cloudsLayer.object.renderOrder = 1;
    this.nightLightLayer.object.renderOrder = 3;
    this.dynamicGroup.add(
      this.terrainContactsLayer.object,
      this.cloudsLayer.object,
      this.nightLightLayer.object,
      this.precipitationLayer.object,
      this.quakeGroup,
    );

    const hud = createHud(canvas, {
      debug: options.debugHud ?? options.debug,
      earthRootWidget: options.earthRootWidget === true,
    });
    this.hudElement = hud.root;
    this.utcElement = hud.utc;
    this.longitudeElement = hud.longitude;
    this.declinationElement = hud.declination;
    this.declinationValueElement = hud.declinationValue;
    this.debugElement = hud.debugPanel;
    this.debugRootElement = hud.debugRoot?.root;
    this.debugEarthRootValueElement = hud.debugRoot?.earthRootValue;
    this.debugDroneValueElement = hud.debugRoot?.droneValue;
    this.debugEarthBeatValueElement = hud.debugRoot?.earthBeatValue;
    this.debugRootWaveformTraceElement = hud.debugRoot?.waveformTrace;
  }

  resize(): void {
    const pixelRatio =
      this.pixelRatioOverride ?? Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
    const rect = this.canvas.getBoundingClientRect();
    const width = this.outputSize?.width ?? Math.max(1, Math.floor(rect.width));
    const height = this.outputSize?.height ?? Math.max(1, Math.floor(rect.height));

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.updateCanvasDisplaySize(width, height);
    this.camera.aspect = width / height;
    this.camera.position.z = cameraDistanceForAspect(this.camera.aspect, this.camera.fov);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.nightLightLayer.setPointSize(
      this.outputSize
        ? nightLightPointSizeForCaptureOutput(width, height)
        : nightLightPointSizeForViewport(width, height),
    );
  }

  capturePngBlob(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("PENUMBRA capture failed: canvas did not produce a PNG blob."));
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  }

  capturePixelSize(): { readonly width: number; readonly height: number } {
    return {
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  render(
    snapshot: RuntimeSnapshot,
    audioFrame?: AudioFrameParams,
    precipitationBand?: PrecipitationBandField,
    earthRootDebugMeter?: EarthRootDebugMeterSnapshot,
  ): void {
    const sunDirection = pointOnSphere(
      snapshot.scanlineState.solar.solarDeclinationDeg,
      snapshot.scanlineState.solar.subsolarLongitudeDeg,
      1,
    ).normalize();
    this.updateCloudAtlasUniforms(snapshot.scanlineState.utc.epochMs);
    this.globeMaterial.uniforms.sunDirection.value.copy(sunDirection);
    this.cloudShellMaterial.uniforms.sunDirection.value.copy(sunDirection);
    this.nightLightLayer.setSunDirection(sunDirection);
    this.globeMaterial.uniforms.terminatorSoftness.value =
      Math.sin(degToRad(snapshot.scanlineState.sigmaDeg)) * VISUAL_TERMINATOR_SOFTNESS_SCALE;
    this.cloudShellMaterial.uniforms.terminatorSoftness.value =
      Math.sin(degToRad(snapshot.scanlineState.sigmaDeg)) * CLOUD_TERMINATOR_SOFTNESS_SCALE;
    this.sunLight.position.copy(sunDirection.clone().multiplyScalar(4));

    this.globeGroup.rotation.set(
      degToRad(-7),
      -degToRad(snapshot.scanlineState.equatorLongitudeDeg),
      0,
    );
    this.dynamicGroup.rotation.copy(this.globeGroup.rotation);
    this.updateDynamicVisuals(snapshot, audioFrame, precipitationBand);
    this.updateHud(snapshot, audioFrame, precipitationBand, earthRootDebugMeter);

    this.renderer.render(this.scene, this.camera);
  }

  setCloudAtlasSequence(sequence: CloudAtlasSequence, utcMs: number): boolean {
    const nextFrameSet = createCloudAtlasTextureFrameSet(undefined, sequence);
    if (nextFrameSet.frames.length === 0) {
      disposeCloudAtlasTextureFrameSet(nextFrameSet);
      return false;
    }

    if (nextFrameSet.signature === this.cloudAtlasFrameSet.signature) {
      disposeCloudAtlasTextureFrameSet(nextFrameSet);
      return false;
    }

    disposeCloudAtlasTextureFrameSet(this.previousCloudAtlasFrameSet);
    this.previousCloudAtlasFrameSet = undefined;

    if (this.cloudAtlasFrameSet.frames.length === 0) {
      disposeCloudAtlasTextureFrameSet(this.cloudAtlasFrameSet);
      this.cloudAtlasFrameSet = nextFrameSet;
      this.cloudAtlasTransitionStartMs = utcMs;
      this.cloudAtlasTransitionDurationMs = 0;
      return true;
    }

    this.previousCloudAtlasFrameSet = this.cloudAtlasFrameSet;
    this.cloudAtlasFrameSet = nextFrameSet;
    this.cloudAtlasTransitionStartMs = utcMs;
    this.cloudAtlasTransitionDurationMs = nextFrameSet.transitionDurationMs;
    return true;
  }

  clearCloudAtlasSequence(): boolean {
    if (this.cloudAtlasFrameSet.frames.length === 0) {
      return false;
    }

    disposeCloudAtlasTextureFrameSet(this.previousCloudAtlasFrameSet);
    this.previousCloudAtlasFrameSet = undefined;
    disposeCloudAtlasTextureFrameSet(this.cloudAtlasFrameSet);
    this.cloudAtlasFrameSet = createCloudAtlasTextureFrameSet(undefined, undefined);
    this.cloudAtlasTransitionDurationMs = 0;
    this.cloudShellMaterial.uniforms.cloudAtlasActive.value = 0;
    return true;
  }

  private updateCloudAtlasUniforms(utcMs: number): void {
    const nextSelection = selectCloudAtlasFrames(this.cloudAtlasFrameSet.frames, utcMs);
    if (!nextSelection) {
      this.cloudShellMaterial.uniforms.cloudAtlasActive.value = 0;
      return;
    }

    let baseSelection = nextSelection;
    let transitionMix = 0;
    const previousFrameSet = this.previousCloudAtlasFrameSet;
    if (previousFrameSet && this.cloudAtlasTransitionDurationMs > 0) {
      const transition01 = clamp(
        (utcMs - this.cloudAtlasTransitionStartMs) / this.cloudAtlasTransitionDurationMs,
        0,
        1,
      );
      if (transition01 >= 1) {
        disposeCloudAtlasTextureFrameSet(previousFrameSet);
        this.previousCloudAtlasFrameSet = undefined;
        this.cloudAtlasTransitionDurationMs = 0;
      } else {
        const previousSelection = selectCloudAtlasFrames(previousFrameSet.frames, utcMs);
        if (previousSelection) {
          baseSelection = previousSelection;
          transitionMix = smoothstep01(transition01);
        }
      }
    }

    this.cloudShellMaterial.uniforms.cloudAtlasTextureA.value = baseSelection.left.texture;
    this.cloudShellMaterial.uniforms.cloudAtlasTextureB.value = baseSelection.right.texture;
    this.cloudShellMaterial.uniforms.cloudAtlasMix.value = baseSelection.mix01;
    this.cloudShellMaterial.uniforms.cloudAtlasTextureC.value = nextSelection.left.texture;
    this.cloudShellMaterial.uniforms.cloudAtlasTextureD.value = nextSelection.right.texture;
    this.cloudShellMaterial.uniforms.cloudAtlasNextMix.value = nextSelection.mix01;
    this.cloudShellMaterial.uniforms.cloudAtlasTransitionMix.value = transitionMix;
    this.cloudShellMaterial.uniforms.cloudAtlasActive.value = 1;
  }

  dispose(): void {
    disposeObject3D(this.globeGroup);
    disposeObject3D(this.dynamicGroup);
    this.surfaceTexture.dispose();
    this.waterMaskTexture.dispose();
    disposeCloudAtlasTextureFrameSet(this.cloudAtlasFrameSet);
    disposeCloudAtlasTextureFrameSet(this.previousCloudAtlasFrameSet);
    this.renderer.dispose();
    this.hudElement.remove();
    this.debugElement?.remove();
    this.debugRootElement?.remove();
    this.humanVoiceVisualStates.clear();
    this.quakeContactVisualStates.clear();
  }

  private updateDynamicVisuals(
    snapshot: RuntimeSnapshot,
    audioFrame: AudioFrameParams | undefined,
    precipitationBand: PrecipitationBandField | undefined,
  ): void {
    disposeObject3D(this.quakeGroup);
    this.quakeGroup.clear();

    const clouds: PointCloudInput[] = [];
    const precipitation: PointCloudInput[] = [];
    let waterRipples: WaterTextureRippleInput[] = [];
    const dynamicAudioFrame = this.staticVisualOnly ? undefined : audioFrame;
    const musicPulseLevelsByCellId = this.updateHumanPulseVisuals(dynamicAudioFrame);
    const quakePulseLevelsById = this.updateQuakePulseVisuals(dynamicAudioFrame);
    const nightLightDensityScale = humanPresenceDensityScale(this.humanPresenceContacts.length);
    const earthTexture = audioFrame ? derivePenumbraEarthTextureParams(audioFrame) : undefined;
    const waterTexture = this.staticVisualOnly ? undefined : earthTexture?.water;
    const renderedQuakeIds = new Set<string>();

    snapshot.samples.forEach((sample) => {
      for (const quake of sample.layers.quakes) {
        if (renderedQuakeIds.has(quake.id)) {
          continue;
        }

        const quakePulse01 = quakePulseLevelsById.get(quake.id) ?? 0;
        if (quakePulse01 <= QUAKE_PULSE_VISUAL_MIN_LEVEL) {
          continue;
        }

        renderedQuakeIds.add(quake.id);
        const quakeCell = findNearestWorldGridCell(
          this.worldGrid,
          quake.latitudeDeg,
          quake.longitudeDeg,
        );
        this.quakeGroup.add(createQuakePoint(quake, terrainRegisterColorForCell(quakeCell), quakePulse01));
      }
    });

    if (waterTexture) {
      const waterVisual = waterTextureVisualParticles({
        worldGrid: this.surfaceWorldGrid,
        scanlineState: snapshot.scanlineState,
        water: waterTexture,
      });
      waterRipples = waterVisual.particles.map((particle) => waterRippleInputForParticle(particle));
      this.lastWaterTextureVisualDebugText = [
        `water visual low ${waterVisual.summary.lowCount}`,
        `mid ${waterVisual.summary.midCount}`,
        `candidates ${waterVisual.summary.lowCandidateCount}/${waterVisual.summary.midCandidateCount}`,
      ].join(" ");

      const precipitationParticles = precipitationVisualParticles({
        samples: snapshot.samples,
        epochMs: snapshot.scanlineState.utc.epochMs,
        water: waterTexture,
        precipitationBand,
      });
      this.lastPrecipitationVisualDebugText = [
        `rain visual ${precipitationParticles.length} dots`,
        `src water:high ${waterTexture.highDensityHz.toFixed(2)}hz`,
        `vis ${precipitationVisualDensityHzForWater(waterTexture).toFixed(2)}hz`,
        "events utc-canonical",
      ].join(" ");
      for (const particle of precipitationParticles) {
        precipitation.push({
          position: pointOnSphere(particle.latitudeDeg, particle.longitudeDeg, particle.radius),
          color: new THREE.Color(PENUMBRA_VISUAL_PALETTE.weather.precipitation).multiplyScalar(
            0.42 + particle.strength01 * 0.88,
          ),
        });
      }
    } else {
      this.lastPrecipitationVisualDebugText = "rain visual n/a";
      this.lastWaterTextureVisualDebugText = "water visual n/a";
    }

    const windShimmerTarget = audioFrame && earthTexture
      ? windShimmerInputForAudioFrame(audioFrame, earthTexture.wind)
      : undefined;
    const windShimmer = windShimmerTarget && audioFrame
      ? this.updateWindShimmerFlow(windShimmerTarget, audioFrame.utcEpochMs)
      : undefined;
    if (!windShimmer) {
      this.windShimmerFlowState = undefined;
    }
    this.lastWindShimmerDebugText = windShimmer
      ? [
          `wind shimmer ${windShimmer.strength01.toFixed(3)}`,
          `focus ${windShimmer.focus01.toFixed(2)}`,
          `detail ${windShimmer.detail01.toFixed(2)}`,
          `flow ${windShimmer.flowHz.toFixed(3)}hz`,
        ].join(" ")
      : "wind shimmer n/a";

    // When the cached cloud atlas is unavailable, do not render the old
    // scanline-local point fallback. The fallback samples remain valid for
    // audio/rain drivers, but visually the dot chain reads as a debug artifact.
    this.terrainContactsLayer.update([]);
    this.cloudsLayer.update(clouds);
    updateGlobeWaterRippleUniforms(this.globeMaterial, waterRipples);
    updateGlobeWindShimmerUniforms(this.globeMaterial, windShimmer, this.windShimmerTrail ? 1 : 0);
    this.nightLightLayer.updateHumanPresence(
      this.humanPresenceContacts,
      musicPulseLevelsByCellId,
      this.staticVisualOnly ? Math.max(nightLightDensityScale, 0.82) : nightLightDensityScale,
    );
    this.precipitationLayer.update(precipitation);
  }

  private updateWindShimmerFlow(target: WindShimmerInput, utcEpochMs: number): WindShimmerInput {
    const previous = this.windShimmerFlowState;
    if (!previous) {
      this.windShimmerFlowState = {
        previousUtcMs: utcEpochMs,
        flowCycles: target.flowCycles,
        flowHz: target.flowHz,
      };
      return target;
    }

    const rawDtSeconds = (utcEpochMs - previous.previousUtcMs) / 1000;
    const dtSeconds = clamp(rawDtSeconds, 0, 0.25);
    const flowSmoothing = dtSeconds <= 0 ? 0 : 1 - Math.exp(-dtSeconds / 1.0);
    const flowHz = previous.flowHz + (target.flowHz - previous.flowHz) * flowSmoothing;
    const flowCycles = previous.flowCycles + flowHz * dtSeconds;
    this.windShimmerFlowState = {
      previousUtcMs: utcEpochMs,
      flowCycles,
      flowHz,
    };

    return {
      ...target,
      flowCycles,
      flowHz,
    };
  }

  private updateCanvasDisplaySize(width: number, height: number): void {
    if (!this.outputSize) {
      this.canvas.style.width = "";
      this.canvas.style.height = "";
      return;
    }

    const outputAspect = width / Math.max(1, height);
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    let displayWidth = viewportWidth;
    let displayHeight = displayWidth / outputAspect;

    if (displayHeight > viewportHeight) {
      displayHeight = viewportHeight;
      displayWidth = displayHeight * outputAspect;
    }

    this.canvas.style.width = `${Math.floor(displayWidth)}px`;
    this.canvas.style.height = `${Math.floor(displayHeight)}px`;
  }

  private updateHumanPulseVisuals(audioFrame: AudioFrameParams | undefined): Map<string, number> {
    const pulseLevelsByCellId = new Map<string, number>();
    if (!audioFrame) {
      return pulseLevelsByCellId;
    }

    const ensembleDensityPeriodScale = humanEnsembleDensityPeriodScale(
      audioFrame.music.candidates.length,
    );
    const activeVoiceIds = new Set<string>();
    for (const voice of audioFrame.music.candidates) {
      activeVoiceIds.add(voice.id);
      const runtimeState = this.humanVoiceVisualStates.get(voice.id);
      let pulseUtcMs = runtimeState?.pulseUtcMs;
      let pulseStrength01 = runtimeState?.pulseStrength01 ?? 0;

      if (runtimeState) {
        const pulse = nextHumanPulseEvent({
          voice,
          previousUtcMs: runtimeState.previousUtcMs,
          currentUtcMs: audioFrame.utcEpochMs,
          ensembleDensityPeriodScale,
        });
        if (pulse) {
          pulseUtcMs = pulse.scheduledUtcMs;
          pulseStrength01 = clamp(0.48 + voice.gain01 * 0.28 + pulse.gainScale01 * 0.2, 0.5, 1);
        }
      }

      const pulseLevel = humanPulseVisualLevel(audioFrame.utcEpochMs, pulseUtcMs, pulseStrength01);
      if (pulseLevel > HUMAN_PULSE_VISUAL_MIN_LEVEL) {
        const existingLevel = pulseLevelsByCellId.get(voice.cellId) ?? 0;
        pulseLevelsByCellId.set(voice.cellId, Math.max(existingLevel, pulseLevel));
      }

      this.humanVoiceVisualStates.set(voice.id, {
        previousUtcMs: audioFrame.utcEpochMs,
        pulseUtcMs,
        pulseStrength01,
      });
    }

    for (const voiceId of this.humanVoiceVisualStates.keys()) {
      if (!activeVoiceIds.has(voiceId)) {
        this.humanVoiceVisualStates.delete(voiceId);
      }
    }

    return pulseLevelsByCellId;
  }

  private updateQuakePulseVisuals(audioFrame: AudioFrameParams | undefined): Map<string, number> {
    const pulseLevelsByQuakeId = new Map<string, number>();
    if (!audioFrame) {
      return pulseLevelsByQuakeId;
    }

    const activeQuakeIds = new Set<string>();
    for (const hit of audioFrame.quakes) {
      activeQuakeIds.add(hit.id);
      const runtimeState = this.quakeContactVisualStates.get(hit.id);
      let pulseUtcMs = runtimeState?.pulseUtcMs;
      let pulseStrength01 = runtimeState?.pulseStrength01 ?? 0;

      if (runtimeState) {
        const pulse = nextQuakePulseEvent({
          contact: hit,
          previousUtcMs: runtimeState.previousUtcMs,
          currentUtcMs: audioFrame.utcEpochMs,
        });
        if (pulse) {
          pulseUtcMs = pulse.scheduledUtcMs;
          pulseStrength01 = clamp(
            0.44 + hit.gain01 * 0.28 + pulse.gainScale01 * 0.22 + pulse.noiseGainScale01 * 0.1,
            0.42,
            1,
          );
        }
      }

      const pulseLevel = quakePulseVisualLevel(audioFrame.utcEpochMs, pulseUtcMs, pulseStrength01);
      if (pulseLevel > QUAKE_PULSE_VISUAL_MIN_LEVEL) {
        const existingLevel = pulseLevelsByQuakeId.get(hit.id) ?? 0;
        pulseLevelsByQuakeId.set(hit.id, Math.max(existingLevel, pulseLevel));
      }

      this.quakeContactVisualStates.set(hit.id, {
        previousUtcMs: audioFrame.utcEpochMs,
        pulseUtcMs,
        pulseStrength01,
      });
    }

    for (const quakeId of this.quakeContactVisualStates.keys()) {
      if (!activeQuakeIds.has(quakeId)) {
        this.quakeContactVisualStates.delete(quakeId);
      }
    }

    return pulseLevelsByQuakeId;
  }

  private updateHud(
    snapshot: RuntimeSnapshot,
    audioFrame: AudioFrameParams | undefined,
    precipitationBand: PrecipitationBandField | undefined,
    earthRootDebugMeter: EarthRootDebugMeterSnapshot | undefined,
  ): void {
    const solarDeclinationDeg = snapshot.scanlineState.solar.solarDeclinationDeg;
    this.utcElement.textContent = formatUtcReadout(snapshot.scanlineState.utc.iso);
    this.longitudeElement.textContent = formatLongitude(snapshot.scanlineState.equatorLongitudeDeg);
    this.declinationValueElement.textContent = formatSolarDeclination(solarDeclinationDeg);
    this.declinationElement.style.setProperty(
      "--penumbra-dec-y",
      `${(solarDeclinationGaugeY(solarDeclinationDeg) * 100).toFixed(2)}%`,
    );
    this.updateDebugRootMeter(audioFrame, earthRootDebugMeter);

    if (this.debugElement) {
      this.debugElement.textContent = [
        `samples ${snapshot.samples.length}`,
        formatMusicVoiceLine(snapshot, audioFrame),
        formatScaleModeDistributionLine(snapshot),
        `max nightlight ${maxNightLightNorm(snapshot).toFixed(3)}`,
        `max music gain ${maxMusicGain(snapshot).toFixed(3)}`,
        formatAudioGainLine(audioFrame),
        formatRainGranularLine(audioFrame),
        formatWaterDropletLine(audioFrame),
        this.lastWaterTextureVisualDebugText,
        this.lastPrecipitationVisualDebugText,
        this.lastWindShimmerDebugText,
        formatPrecipitationBandLine(precipitationBand),
        formatDroneDebugLine(audioFrame),
        formatEarthFormantDebugLine(audioFrame),
        this.formatAudioStabilityDebugLine(audioFrame),
        this.formatSurfaceGridDebugLine(),
        this.formatContactGridDebugLine(),
        this.formatCloudAtlasDebugLine(snapshot.scanlineState.utc.epochMs),
        this.formatCloudAtlasDistributionDebugLine(snapshot.scanlineState.utc.epochMs),
        this.formatCloudAtlasOpticalDensityDebugLine(snapshot.scanlineState.utc.epochMs),
        this.formatCloudAtlasPrecipitationDebugLine(snapshot.scanlineState.utc.epochMs),
        this.nightLightForecastLine(snapshot),
        `quake contacts ${activeQuakeCount(snapshot)}`,
        `sigma ${snapshot.scanlineState.sigmaDeg.toFixed(1)} deg`,
        `reach +/-${snapshot.scanlineState.activeReachDeg.toFixed(1)} deg`,
      ].join("\n");
    }
  }

  private updateDebugRootMeter(
    audioFrame: AudioFrameParams | undefined,
    earthRootDebugMeter: EarthRootDebugMeterSnapshot | undefined,
  ): void {
    if (
      !this.debugRootElement ||
      !this.debugEarthRootValueElement ||
      !this.debugDroneValueElement ||
      !this.debugEarthBeatValueElement ||
      !this.debugRootWaveformTraceElement
    ) {
      return;
    }

    if (this.debugElement) {
      this.debugRootElement.style.bottom = `${Math.ceil(this.debugElement.offsetHeight + 30)}px`;
    }

    if (!audioFrame) {
      this.debugEarthRootValueElement.textContent = "n/a";
      this.debugDroneValueElement.textContent = "n/a";
      this.debugEarthBeatValueElement.textContent = "n/a";
      this.debugRootWaveformTraceElement.setAttribute("points", "");
      this.debugDetuneBeatVisualState = undefined;
      return;
    }

    const droneRootHz = earthRootDebugMeter?.rootHz ?? earthDroneRootHz(audioFrame);
    const earthRootHz = earthRootHzFromDroneRootHz(droneRootHz);
    const companion = this.smoothedDebugDetuneCompanion(
      audioFrame.utcEpochMs,
      droneRootHz,
      earthDroneCompanionParams(audioFrame, deriveEarthAirTurbulence(audioFrame)),
    );
    const beatHz = Math.abs(companion.frequencyHz - droneRootHz);
    this.debugEarthRootValueElement.textContent = `${earthRootHz.toFixed(2)} Hz`;
    this.debugDroneValueElement.textContent = `${droneRootHz.toFixed(2)} Hz`;
    this.debugEarthBeatValueElement.textContent = `${beatHz.toFixed(2)} Hz`;
    this.debugRootWaveformTraceElement.setAttribute(
      "points",
      formatSvgPoints(
        createEarthDetuneBeatEnvelope({
          droneRootHz,
          companionHz: companion.frequencyHz,
          detuneAmount01: companion.amount01,
          beatPhase01: companion.beatPhase01,
          windowSeconds: DEBUG_DETUNE_BEAT_ENVELOPE_WINDOW_SECONDS,
        }),
      ),
    );
  }

  private smoothedDebugDetuneCompanion(
    utcEpochMs: number,
    droneRootHz: number,
    target: EarthDroneCompanionParams,
  ): DebugDetuneBeatVisualParams {
    const previous = this.debugDetuneBeatVisualState;
    const targetBeatHz = Math.abs(target.frequencyHz - droneRootHz);
    if (!previous || utcEpochMs <= previous.previousUtcMs) {
      const beatPhase01 = beatPhaseFromUtc(utcEpochMs, targetBeatHz);
      this.debugDetuneBeatVisualState = {
        previousUtcMs: utcEpochMs,
        companionHz: target.frequencyHz,
        detuneCents: target.detuneCents,
        amount01: target.amount01,
        beatPhase01,
      };
      return { ...target, beatPhase01 };
    }

    const rawDtSeconds = Math.max(0, (utcEpochMs - previous.previousUtcMs) / 1000);
    const smoothingDtSeconds = clamp(rawDtSeconds, 0, DEBUG_DETUNE_BEAT_VISUAL_MAX_STEP_SECONDS);
    const alpha = 1 - Math.exp(-smoothingDtSeconds / Math.max(0.001, target.responseSeconds));
    const nextCompanionHz =
      previous.companionHz + (target.frequencyHz - previous.companionHz) * alpha;
    const nextBeatHz = Math.abs(nextCompanionHz - droneRootHz);
    const next: DebugDetuneBeatVisualState = {
      previousUtcMs: utcEpochMs,
      companionHz: nextCompanionHz,
      detuneCents: previous.detuneCents + (target.detuneCents - previous.detuneCents) * alpha,
      amount01: previous.amount01 + (target.amount01 - previous.amount01) * alpha,
      beatPhase01: positiveModulo(previous.beatPhase01 + nextBeatHz * rawDtSeconds, 1),
    };
    this.debugDetuneBeatVisualState = next;

    return {
      ...target,
      frequencyHz: next.companionHz,
      detuneCents: next.detuneCents,
      amount01: next.amount01,
      beatPhase01: next.beatPhase01,
    };
  }

  private nightLightForecastLine(snapshot: RuntimeSnapshot): string {
    const bucket = Math.floor(snapshot.scanlineState.utc.epochMs / (10 * 60_000));
    if (this.nightLightForecastBucket !== bucket) {
      this.nightLightForecastBucket = bucket;
      this.nightLightForecastText = formatNightLightForecast(
        nextNightLightForecast({
          startDate: snapshot.scanlineState.utc.date,
          worldGrid: this.contactWorldGrid,
        }),
      );
    }

    return this.nightLightForecastText;
  }

  private formatAudioStabilityDebugLine(audioFrame: AudioFrameParams | undefined): string {
    if (!audioFrame) {
      return "audio stability n/a";
    }

    const rootHz = earthDroneRootHz(audioFrame);
    const previousRootHz = this.previousDroneDebugRootHz;
    const previousUtcMs = this.previousAudioDebugUtcMs;
    this.previousDroneDebugRootHz = rootHz;
    this.previousAudioDebugUtcMs = audioFrame.utcEpochMs;

    const frameGapMs = previousUtcMs == null ? 0 : audioFrame.utcEpochMs - previousUtcMs;
    if (frameGapMs > 250) {
      this.lastAudioFrameGapDebugText = `last gap ${audioFrame.utcIso.slice(11, 19)}Z ${frameGapMs.toFixed(0)}ms`;
    }

    if (previousRootHz == null || previousRootHz <= 0) {
      return `audio stability rootΔ n/a gap ${frameGapMs.toFixed(0)}ms ${this.lastAudioFrameGapDebugText}`;
    }

    const rootDeltaHz = rootHz - previousRootHz;
    const rootDeltaCents = 1200 * Math.log2(rootHz / previousRootHz);
    if (Math.abs(rootDeltaHz) >= 4 || Math.abs(rootDeltaCents) >= 35) {
      this.lastDroneRootJumpDebugText = [
        `last root jump ${audioFrame.utcIso.slice(11, 19)}Z`,
        `${formatSignedNumber(rootDeltaHz, 1)}hz`,
        `${formatSignedNumber(rootDeltaCents, 0)}c`,
      ].join(" ");
    }

    return [
      `audio stability rootΔ ${formatSignedNumber(rootDeltaHz, 2)}hz/${formatSignedNumber(rootDeltaCents, 0)}c`,
      `gap ${frameGapMs.toFixed(0)}ms`,
      this.lastDroneRootJumpDebugText,
      this.lastAudioFrameGapDebugText,
    ].join(" ");
  }

  private formatSurfaceGridDebugLine(): string {
    return `surface grid ${this.surfaceWorldGrid.cellSizeDegrees.toFixed(2)}deg ${this.surfaceWorldGrid.cells.length} cells`;
  }

  private formatContactGridDebugLine(): string {
    return `contact grid ${this.contactWorldGrid.cellSizeDegrees.toFixed(2)}deg ${this.contactWorldGrid.cells.length} cells`;
  }

  private formatCloudAtlasDebugLine(utcMs: number): string {
    if (this.cloudAtlasFrameSet.frames.length === 0) {
      return "cloud atlas scanline-local";
    }

    const selection = selectCloudAtlasFrames(this.cloudAtlasFrameSet.frames, utcMs);
    const transition01 =
      this.previousCloudAtlasFrameSet && this.cloudAtlasTransitionDurationMs > 0
        ? clamp((utcMs - this.cloudAtlasTransitionStartMs) / this.cloudAtlasTransitionDurationMs, 0, 1)
        : undefined;
    const transitionText =
      transition01 === undefined ? undefined : `update ${transition01.toFixed(2)}`;
    if (selection && selection.left !== selection.right) {
      return [
        `cloud atlas ${this.cloudAtlasFrameSet.sourceKind}`,
        `${this.cloudAtlasFrameSet.frames.length} frames`,
        `mix ${selection.mix01.toFixed(2)}`,
        `from ${selection.left.atlas.validAtUtc.slice(11, 16)}Z`,
        `to ${selection.right.atlas.validAtUtc.slice(11, 16)}Z`,
        transitionText,
      ].filter(Boolean).join(" ");
    }

    const atlas = selection?.left.atlas ?? this.cloudAtlasFrameSet.frames[0]?.atlas;
    if (!atlas) {
      return "cloud atlas scanline-local";
    }

    if (this.cloudAtlasFrameSet.frames.length > 1) {
      return [
        `cloud atlas ${this.cloudAtlasFrameSet.sourceKind}`,
        `${this.cloudAtlasFrameSet.frames.length} frames`,
        `hold ${atlas.validAtUtc.slice(11, 16)}Z`,
        transitionText,
      ].filter(Boolean).join(" ");
    }

    return [
      `cloud atlas ${this.cloudAtlasFrameSet.sourceKind}`,
      `${atlas.width}x${atlas.height}`,
      `${atlas.resolutionDeg.toFixed(2)}deg`,
      `valid ${atlas.validAtUtc.slice(0, 16)}Z`,
      transitionText,
    ].filter(Boolean).join(" ");
  }

  private formatCloudAtlasDistributionDebugLine(utcMs: number): string {
    if (this.cloudAtlasFrameSet.frames.length === 0) {
      return "cloud pct n/a";
    }

    const selection = selectCloudAtlasFrames(this.cloudAtlasFrameSet.frames, utcMs);
    const atlas = selection?.left.atlas ?? this.cloudAtlasFrameSet.frames[0]?.atlas;
    if (!atlas) {
      return "cloud pct n/a";
    }

    const stats = cloudAtlasDistributionStats(atlas);
    return [
      "cloud pct p50/75/90/95/99/max",
      [
        stats.p50Pct,
        stats.p75Pct,
        stats.p90Pct,
        stats.p95Pct,
        stats.p99Pct,
        stats.maxPct,
      ].join("/"),
      ">=95/98/99/100",
      [
        formatPercent(stats.atLeast95Pct),
        formatPercent(stats.atLeast98Pct),
        formatPercent(stats.atLeast99Pct),
        formatPercent(stats.fullCoverPct),
      ].join("/"),
    ].join(" ");
  }

  private formatCloudAtlasOpticalDensityDebugLine(utcMs: number): string {
    if (this.cloudAtlasFrameSet.frames.length === 0) {
      return "cloud water n/a";
    }

    const selection = selectCloudAtlasFrames(this.cloudAtlasFrameSet.frames, utcMs);
    const atlas = selection?.left.atlas ?? this.cloudAtlasFrameSet.frames[0]?.atlas;
    if (!atlas) {
      return "cloud water n/a";
    }

    const stats = cloudAtlasOpticalDensityDistributionStats(atlas);
    if (!stats) {
      return "cloud water n/a";
    }

    return [
      "cloud water p50/75/90/95/99/max",
      [
        stats.p50Pct,
        stats.p75Pct,
        stats.p90Pct,
        stats.p95Pct,
        stats.p99Pct,
        stats.maxPct,
      ].join("/"),
    ].join(" ");
  }

  private formatCloudAtlasPrecipitationDebugLine(utcMs: number): string {
    if (this.cloudAtlasFrameSet.frames.length === 0) {
      return "atlas precip n/a";
    }

    const selection = selectCloudAtlasFrames(this.cloudAtlasFrameSet.frames, utcMs);
    const atlas = selection?.left.atlas ?? this.cloudAtlasFrameSet.frames[0]?.atlas;
    if (!atlas) {
      return "atlas precip n/a";
    }

    const stats = cloudAtlasPrecipitationDistributionStats(atlas);
    if (!stats) {
      return "atlas precip n/a";
    }

    return [
      "atlas precip p75/90/95/99/max",
      [
        stats.p75Pct,
        stats.p90Pct,
        stats.p95Pct,
        stats.p99Pct,
        stats.maxPct,
      ].join("/"),
      ">=95/99",
      [formatPercent(stats.atLeast95Pct), formatPercent(stats.atLeast99Pct)].join("/"),
    ].join(" ");
  }
}

function formatAudioGainLine(audioFrame: AudioFrameParams | undefined): string {
  if (!audioFrame) {
    return "music pulse env n/a";
  }

  return [
    `music pulse env ${audioFrame.debugMeters.musicPulseEnvelope01.toFixed(4)}`,
    `precip grains ${audioFrame.debugMeters.precipitationGrainDensityHz.toFixed(1)}hz`,
    `g ${audioFrame.debugMeters.precipitationGrainGain01.toFixed(4)}`,
    `surface tex ${audioFrame.debugMeters.surfaceTextureGain01.toFixed(4)}`,
    `r ${audioFrame.debugMeters.surfaceRoughness01.toFixed(3)}`,
    `air ${audioFrame.debugMeters.airTurbulenceDepth01.toFixed(3)}@${audioFrame.debugMeters.airTurbulenceRateHz.toFixed(2)}hz`,
    `spatial ${audioFrame.debugMeters.scanlineSpatialChange01.toFixed(3)}/${audioFrame.debugMeters.scanlineSpatialVariance01.toFixed(3)}`,
    `drone d ${audioFrame.debugMeters.droneDispersion01.toFixed(3)} tilt ${audioFrame.debugMeters.droneSpectralTilt01.toFixed(3)}`,
  ].join(" ");
}

function formatRainGranularLine(audioFrame: AudioFrameParams | undefined): string {
  if (!audioFrame) {
    return "rain granular n/a";
  }

  const rainGranular = derivePenumbraEarthTextureParams(audioFrame).rainGranular;

  return [
    `rain granular ${rainGranular.densityHz.toFixed(1)}hz`,
    `g ${rainGranular.gain01.toFixed(4)}`,
    `dur ${(rainGranular.grainDurationSeconds * 1000).toFixed(0)}ms`,
    `bright ${rainGranular.brightness01.toFixed(2)}`,
  ].join(" ");
}

function formatWaterDropletLine(audioFrame: AudioFrameParams | undefined): string {
  if (!audioFrame) {
    return "water droplet n/a";
  }

  const water = derivePenumbraEarthTextureParams(audioFrame).water;
  const highPeriodMs = water.highDensityHz > 0 ? 1000 / water.highDensityHz : 0;

  return [
    `water high drop ${water.highDensityHz.toFixed(2)}hz`,
    highPeriodMs > 0 ? `${highPeriodMs.toFixed(0)}ms` : "off",
    `all ${water.dropletDensityHz.toFixed(2)}hz`,
    `g ${water.dropletGain01.toFixed(4)}`,
    `lvl ${water.highLevel01.toFixed(2)}`,
  ].join(" ");
}

function formatPrecipitationBandLine(precipitationBand: PrecipitationBandField | undefined): string {
  if (!precipitationBand) {
    return "rain band scanline-local";
  }

  return [
    "rain band atlas",
    `a ${precipitationBand.activity01.toFixed(3)}`,
    `cov ${precipitationBand.coverage01.toFixed(2)}`,
    `int ${precipitationBand.intensity01.toFixed(2)}`,
    `max ${precipitationBand.maxPrecipitation01.toFixed(2)}`,
    `rain ${precipitationBand.rainySampleCount}/${precipitationBand.sampleCount}`,
    `mix ${precipitationBand.frameMix01.toFixed(2)}`,
  ].join(" ");
}

function formatDroneDebugLine(audioFrame: AudioFrameParams | undefined): string {
  if (!audioFrame) {
    return "earth root n/a";
  }

  const airTurbulence = deriveEarthAirTurbulence(audioFrame);
  const companion = earthDroneCompanionParams(audioFrame, airTurbulence);
  const ratios = EARTH_DRONE_PARTIALS.map((partial) =>
    earthDronePartialRatio(partial, audioFrame, airTurbulence).toFixed(2),
  );

  return [
    `earth root ${earthDroneRootHz(audioFrame).toFixed(2)}hz`,
    `companion ${companion.frequencyHz.toFixed(2)}hz`,
    `${formatSignedNumber(companion.detuneCents, 1)}c`,
    `a ${companion.amount01.toFixed(3)}`,
    `partial ratios ${ratios.join("/")}`,
  ].join(" ");
}

function formatEarthFormantDebugLine(audioFrame: AudioFrameParams | undefined): string {
  if (!audioFrame) {
    return "earth formant n/a";
  }

  const airTurbulence = deriveEarthAirTurbulence(audioFrame);
  const params = deriveEarthFormantParams(audioFrame, airTurbulence);
  const frequencies = params.bands.map((band) => band.frequencyHz.toFixed(0)).join("/");
  const qs = params.bands.map((band) => band.q.toFixed(1)).join("/");
  const gains = params.bands.map((band) => band.gain01.toFixed(3)).join("/");

  return `earth formant ${params.amount01.toFixed(3)} f ${frequencies} q ${qs} g ${gains}`;
}

function formatSignedNumber(value: number, fractionDigits: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(fractionDigits)}`;
}

function formatPercent(value01: number): string {
  return `${(clamp(value01, 0, 1) * 100).toFixed(0)}%`;
}

function formatMusicVoiceLine(
  snapshot: RuntimeSnapshot,
  audioFrame: AudioFrameParams | undefined,
): string {
  if (!audioFrame) {
    return `music contacts ${activeMusicSampleCount(snapshot)}`;
  }

  return `music contacts ${audioFrame.debugMeters.musicCandidateCount} selected ${audioFrame.debugMeters.musicVoiceCount}`;
}

function formatScaleModeDistributionLine(snapshot: RuntimeSnapshot): string {
  const distribution = scaleModeDistribution(snapshot);
  if (distribution.length === 0) {
    return "scale modes none";
  }

  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  const entries = distribution
    .slice(0, 6)
    .map(
      (item) =>
        `${shortModeLabel(item.scaleKernelId, item.modeId)} ${item.count}/${formatPercent(item.fraction01)}`,
    );
  const hiddenCount = Math.max(0, distribution.length - entries.length);
  if (hiddenCount > 0) {
    entries.push(`+${hiddenCount}`);
  }

  return `scale modes ${total}: ${entries.join("  ")}`;
}

function shortModeLabel(scaleKernelId: string, modeId: string): string {
  const scaleLabel = scaleKernelId.replace(/_?(pentatonic|modes|scale)$/u, "");
  return `${scaleLabel}/${modeId}`.replaceAll("_", "-");
}

function formatNightLightForecast(forecast: NightLightForecast | undefined): string {
  if (!forecast) {
    return "next music none 24h";
  }

  const utcMinute = forecast.utcIso.slice(11, 16);
  return `next music ${utcMinute}Z +${forecast.minutesFromNow}m g ${forecast.contact.musicGain01.toFixed(3)}`;
}

function createGlobeMaterial(
  surfaceTexture: THREE.DataTexture,
  waterMaskTexture: THREE.DataTexture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      dayColor: { value: new THREE.Color(PENUMBRA_VISUAL_PALETTE.globe.dayTint) },
      nightColor: { value: new THREE.Color(PENUMBRA_VISUAL_PALETTE.globe.nightTint) },
      horizonColor: { value: new THREE.Color(PENUMBRA_VISUAL_PALETTE.globe.horizonTint) },
      limbGlowColor: { value: new THREE.Color(PENUMBRA_VISUAL_PALETTE.globe.limbGlow) },
      windShimmerColor: { value: new THREE.Color(PENUMBRA_VISUAL_PALETTE.weather.windShimmer) },
      terminatorSoftness: { value: Math.sin(degToRad(15)) * VISUAL_TERMINATOR_SOFTNESS_SCALE },
      surfaceTexture: { value: surfaceTexture },
      waterMaskTexture: { value: waterMaskTexture },
      surfaceTexelSize: {
        value: new THREE.Vector2(1 / surfaceTexture.image.width, 1 / surfaceTexture.image.height),
      },
      surfaceStrength: { value: 0.68 },
      terrainReliefStrength: { value: 0.615 },
      waterRippleCount: { value: 0 },
      waterRippleCenters: {
        value: Array.from({ length: SURFACE_WATER_RIPPLE_MAX_COUNT }, () => new THREE.Vector4()),
      },
      waterRippleColors: {
        value: Array.from({ length: SURFACE_WATER_RIPPLE_MAX_COUNT }, () => new THREE.Vector4()),
      },
      waterRippleParams: {
        value: Array.from({ length: SURFACE_WATER_RIPPLE_MAX_COUNT }, () => new THREE.Vector4()),
      },
      windShimmerParams: { value: new THREE.Vector4(0, 0, 0, 0) },
      windShimmerTrail: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewNormal;

      void main() {
        vNormal = normalize(normal);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewNormal;
      uniform vec3 sunDirection;
      uniform vec3 dayColor;
      uniform vec3 nightColor;
      uniform vec3 horizonColor;
      uniform vec3 limbGlowColor;
      uniform vec3 windShimmerColor;
      uniform float terminatorSoftness;
      uniform sampler2D surfaceTexture;
      uniform sampler2D waterMaskTexture;
      uniform vec2 surfaceTexelSize;
      uniform float surfaceStrength;
      uniform float terrainReliefStrength;
      uniform int waterRippleCount;
      uniform vec4 waterRippleCenters[${SURFACE_WATER_RIPPLE_MAX_COUNT}];
      uniform vec4 waterRippleColors[${SURFACE_WATER_RIPPLE_MAX_COUNT}];
      uniform vec4 waterRippleParams[${SURFACE_WATER_RIPPLE_MAX_COUNT}];
      uniform vec4 windShimmerParams;
      uniform float windShimmerTrail;

      float windHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float windParticleLayer(
        vec2 uv,
        float cellScale,
        float gate,
        float baseRadius,
        float seed,
        float stretchX
      ) {
        vec2 p = uv * cellScale;
        vec2 baseCell = floor(p);
        vec2 local = fract(p);
        float field = 0.0;

        for (int xi = 0; xi < 3; xi += 1) {
          for (int yi = 0; yi < 3; yi += 1) {
            vec2 offset = vec2(float(xi) - 1.0, float(yi) - 1.0);
            vec2 cell = baseCell + offset;
            float existence = windHash(cell + vec2(seed, seed * 1.37));
            float particleGate = smoothstep(gate, 1.0, existence);
            vec2 center = offset + vec2(
              windHash(cell + vec2(seed * 2.11, seed * 3.17)),
              windHash(cell + vec2(seed * 4.23, seed * 5.29))
            );
            vec2 delta = local - center;
            float radius = baseRadius * mix(0.62, 1.58, windHash(cell + vec2(seed * 6.31, seed * 7.43)));
            vec2 particleDelta = vec2(delta.x / max(1.0, stretchX), delta.y);
            float particle = exp(-dot(particleDelta, particleDelta) / max(0.0004, radius * radius * 2.0));
            field = max(field, particle * particleGate);
          }
        }

        return clamp(field, 0.0, 1.0);
      }

      float windParticleTexture(
        vec2 windBaseUv,
        float windFlowCycles,
        float windDetail,
        float windFocus,
        float windStrength,
        float windStreak
      ) {
        vec2 windLargeUv = windBaseUv + vec2(
          windFlowCycles * 1.72,
          windFlowCycles * mix(0.010, 0.026, windDetail)
        );
        vec2 windFineUv = windBaseUv + vec2(
          windFlowCycles * 2.48,
          windFlowCycles * mix(0.018, 0.042, windDetail) + 0.137
        );
        float windLarge = windParticleLayer(
          windLargeUv,
          mix(16.0, 26.0, windDetail),
          mix(0.64, 0.54, windStrength),
          mix(0.125, 0.074, windFocus),
          13.0,
          mix(1.0, mix(4.8, 3.5, windFocus), windStreak)
        );
        float windFine = windParticleLayer(
          windFineUv,
          mix(38.0, 82.0, windDetail),
          mix(0.74, 0.62, windStrength),
          mix(0.070, 0.035, windFocus),
          47.0,
          mix(1.0, mix(3.2, 2.2, windFocus), windStreak)
        );
        float windLargePresence = smoothstep(0.32, 0.88, windStrength);
        float windLargeWeight = mix(0.54, 0.98, windLargePresence);
        float windFineWeight = mix(0.88, 1.04, windDetail);
        float windTexture = clamp(windLarge * windLargeWeight + windFine * windFineWeight, 0.0, 1.0);
        float windHalo = pow(clamp(windLarge, 0.0, 1.0), 0.42) * mix(0.11, 0.24, windLargePresence);
        return clamp(windTexture + windHalo, 0.0, 1.0);
      }

      void main() {
        vec3 sphereNormal = normalize(vNormal);
        float limb = 1.0 - smoothstep(0.08, 0.86, abs(vViewNormal.z));
        float longitude = atan(sphereNormal.x, sphereNormal.z);
        float latitude = asin(clamp(sphereNormal.y, -1.0, 1.0));
        vec2 surfaceUv = vec2(fract(longitude / 6.28318530718 + 0.5), latitude / 3.14159265359 + 0.5);
        vec4 surfaceSample = texture2D(surfaceTexture, surfaceUv);
        float waterRatio = texture2D(waterMaskTexture, surfaceUv).r;
        vec3 surfaceColor = surfaceSample.rgb;
        float heightEast = texture2D(surfaceTexture, surfaceUv + vec2(surfaceTexelSize.x, 0.0)).a;
        float heightWest = texture2D(surfaceTexture, surfaceUv - vec2(surfaceTexelSize.x, 0.0)).a;
        float heightNorth = texture2D(surfaceTexture, surfaceUv + vec2(0.0, surfaceTexelSize.y)).a;
        float heightSouth = texture2D(surfaceTexture, surfaceUv - vec2(0.0, surfaceTexelSize.y)).a;
        vec3 tangentEast = normalize(vec3(sphereNormal.z, 0.0, -sphereNormal.x) + vec3(0.00001, 0.0, 0.0));
        vec3 tangentNorth = normalize(cross(sphereNormal, tangentEast));
        float polarReliefFade = clamp(1.0 - abs(sphereNormal.y) * 0.72, 0.22, 1.0);
        vec3 reliefNormal = normalize(
          sphereNormal -
          tangentEast * (heightEast - heightWest) * terrainReliefStrength * polarReliefFade -
          tangentNorth * (heightNorth - heightSouth) * terrainReliefStrength
        );
        vec3 sun = normalize(sunDirection);
        float sphereSunlight = dot(sphereNormal, sun);
        float reliefSunlight = dot(reliefNormal, sun);
        float dayMixRaw = clamp((sphereSunlight + terminatorSoftness) / (terminatorSoftness * 2.0), 0.0, 1.0);
        float dayMixSmooth = dayMixRaw * dayMixRaw * (3.0 - 2.0 * dayMixRaw);
        float dayMix = mix(dayMixRaw, dayMixSmooth, 0.34);
        float diffuse = pow(max(reliefSunlight, 0.0), 0.72);
        float reliefShade = clamp(0.82 + (reliefSunlight - sphereSunlight) * 1.62, 0.5, 1.44);
        vec3 litDay = mix(dayColor, surfaceColor, surfaceStrength) * (0.76 + diffuse * 0.88);
        litDay *= reliefShade;
        vec3 terrainNight = mix(nightColor, surfaceColor * 0.14, surfaceStrength * 0.42);
        vec3 base = mix(terrainNight, litDay, dayMix);
        float windStrength = clamp(windShimmerParams.x, 0.0, 1.0);
        float windFocus = clamp(windShimmerParams.y, 0.0, 1.0);
        float windDetail = clamp(windShimmerParams.z, 0.0, 1.0);
        float windFlowCycles = windShimmerParams.w;
        float windOffset = abs(sphereSunlight);
        float windTailWidth = max(terminatorSoftness * mix(0.34, 0.26, windFocus), 0.075);
        float windRidgeWidth = max(terminatorSoftness * mix(0.064, 0.045, windFocus), 0.018);
        float windTail = exp(-(windOffset * windOffset) / (2.0 * windTailWidth * windTailWidth));
        float windRidge = exp(-(windOffset * windOffset) / (2.0 * windRidgeWidth * windRidgeWidth));
        float windBand = windTail * (0.18 + 0.82 * windRidge);
        vec2 windBaseUv = vec2(
          longitude / 6.28318530718 + 0.5,
          latitude / 3.14159265359 + 0.5
        );
        float windStreakAmount = clamp(windShimmerTrail, 0.0, 1.0);
        float windTexture = windParticleTexture(
          windBaseUv,
          windFlowCycles,
          windDetail,
          windFocus,
          windStrength,
          windStreakAmount
        );
        float windVisibility = windStrength * windBand * (0.18 + dayMix * 0.82) *
          (0.58 + limb * 0.30 + diffuse * 0.24);
        windVisibility *= mix(1.0, 3.45, windStreakAmount);
        float waterMask = smoothstep(0.28, 0.74, waterRatio);
        vec3 rippleColor = vec3(0.0);
        if (waterMask > 0.001) {
          for (int index = 0; index < ${SURFACE_WATER_RIPPLE_MAX_COUNT}; index += 1) {
            if (index >= waterRippleCount) {
              break;
            }

            vec4 centerAge = waterRippleCenters[index];
            vec4 colorAlpha = waterRippleColors[index];
            vec4 params = waterRippleParams[index];
            vec3 rippleCenter = normalize(centerAge.xyz);
            float age = clamp(centerAge.w, 0.0, 1.0);
            float maxAngle = max(params.x, 0.0001);
            float angle = acos(clamp(dot(sphereNormal, rippleCenter), -1.0, 1.0));
            float radius = angle / maxAngle;
            if (radius > 1.18) {
              continue;
            }

            float expansion = 1.0 - pow(1.0 - age, 0.74);
            float lifeFade = pow(1.0 - smoothstep(0.72, 0.995, age), 1.35);
            float birthPoint = 1.0 - smoothstep(0.0, 0.24, age);
            float ringCenter = mix(0.010, 0.86, expansion);
            float innerWidth = mix(0.016, 0.045, expansion);
            float outerWidth = mix(0.075, 0.185, expansion);
            float innerEdge = smoothstep(ringCenter - innerWidth, ringCenter, radius);
            float outerEdge = 1.0 - smoothstep(ringCenter, ringCenter + outerWidth, radius);
            float ring = innerEdge * outerEdge;
            float wakeLimit = clamp(ringCenter + outerWidth * 0.7, 0.12, 0.96);
            float wake = (1.0 - smoothstep(0.0, wakeLimit, radius)) *
              (1.0 - smoothstep(0.14, 0.86, age));
            float core = (1.0 - smoothstep(0.0, 0.18, radius)) * birthPoint;
            float alpha = colorAlpha.a * (ring * 0.72 + wake * 0.12 + core * 0.42) * lifeFade * waterMask * 0.60;
            rippleColor += colorAlpha.rgb * alpha * (0.56 + ring * 0.54 + core * 0.34);
          }
        }
        float sunFacing = clamp(sphereSunlight, 0.0, 1.0);
        float attachedGlow = pow(clamp(limb, 0.0, 1.0), 1.72) * dayMix * (0.55 + sunFacing * 0.54);
        vec3 horizon = mix(base, horizonColor, limb * 0.14 * dayMix);
        vec3 windColor = windShimmerColor * windTexture * windVisibility * (0.88 + windDetail * 0.48);
        vec3 color = horizon + windColor + rippleColor * (0.72 + dayMix * 0.22) + limbGlowColor * attachedGlow * 0.36;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function createCloudShellMaterial(
  surfaceTexture: THREE.DataTexture,
  cloudAtlasTexture: THREE.DataTexture | undefined,
  cloudDiagnostic: boolean,
): THREE.ShaderMaterial {
  const fallbackCloudTexture = cloudAtlasTexture ?? surfaceTexture;
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      cloudShellColor: { value: new THREE.Color(PENUMBRA_VISUAL_PALETTE.weather.cloudShell) },
      terminatorSoftness: { value: Math.sin(degToRad(15)) * CLOUD_TERMINATOR_SOFTNESS_SCALE },
      cloudAtlasTextureA: { value: fallbackCloudTexture },
      cloudAtlasTextureB: { value: fallbackCloudTexture },
      cloudAtlasTextureC: { value: fallbackCloudTexture },
      cloudAtlasTextureD: { value: fallbackCloudTexture },
      cloudAtlasMix: { value: 0 },
      cloudAtlasNextMix: { value: 0 },
      cloudAtlasTransitionMix: { value: 0 },
      cloudAtlasActive: { value: cloudAtlasTexture ? 1 : 0 },
      cloudDiagnosticMode: { value: cloudDiagnostic ? 1 : 0 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewNormal;

      void main() {
        vNormal = normalize(normal);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewNormal;
      uniform vec3 sunDirection;
      uniform vec3 cloudShellColor;
      uniform float terminatorSoftness;
      uniform sampler2D cloudAtlasTextureA;
      uniform sampler2D cloudAtlasTextureB;
      uniform sampler2D cloudAtlasTextureC;
      uniform sampler2D cloudAtlasTextureD;
      uniform float cloudAtlasMix;
      uniform float cloudAtlasNextMix;
      uniform float cloudAtlasTransitionMix;
      uniform float cloudAtlasActive;
      uniform float cloudDiagnosticMode;

      void main() {
        vec3 sphereNormal = normalize(vNormal);
        float longitude = atan(sphereNormal.x, sphereNormal.z);
        float latitude = asin(clamp(sphereNormal.y, -1.0, 1.0));
        vec2 surfaceUv = vec2(fract(longitude / 6.28318530718 + 0.5), latitude / 3.14159265359 + 0.5);
        vec2 cloudBase = mix(
          texture2D(cloudAtlasTextureA, surfaceUv).rg,
          texture2D(cloudAtlasTextureB, surfaceUv).rg,
          cloudAtlasMix
        );
        vec2 cloudNext = mix(
          texture2D(cloudAtlasTextureC, surfaceUv).rg,
          texture2D(cloudAtlasTextureD, surfaceUv).rg,
          cloudAtlasNextMix
        );
        vec2 cloudSample = mix(cloudBase, cloudNext, cloudAtlasTransitionMix);
        float cloudCover = cloudSample.r;
        float cloudDensity = cloudSample.g;
        float cloudCoverShaped = clamp((cloudCover - 0.90) / 0.10, 0.0, 1.0);
        float coverGate = pow(cloudCoverShaped, 2.55);
        float densityGate = pow(clamp(cloudDensity, 0.0, 1.0), 0.20);
        float saturatedCoverGate = smoothstep(0.985, 1.0, cloudCover);
        float densityPresence = max(mix(0.08, 1.0, densityGate), saturatedCoverGate * 0.5);
        float cloudOpacity = coverGate * densityPresence * 0.96;
        float sphereSunlight = dot(sphereNormal, normalize(sunDirection));
        float dayMix = smoothstep(-terminatorSoftness, terminatorSoftness, sphereSunlight);
        float nightAlphaGate = 1.0;
        if (sphereSunlight < 0.0) {
          nightAlphaGate = mix(
            0.08,
            1.0,
            smoothstep(-terminatorSoftness * 0.45, 0.0, sphereSunlight)
          );
        }
        float limb = 1.0 - smoothstep(0.04, 0.92, abs(vViewNormal.z));
        float visibleCloudFade = 1.0 - limb * 0.46;
        float cloudPresence = cloudAtlasActive *
          dayMix *
          nightAlphaGate *
          visibleCloudFade *
          cloudOpacity;
        float diagnosticMidCover = smoothstep(0.22, 0.48, cloudCover);
        float diagnosticOpacity = cloudDiagnosticMode *
          diagnosticMidCover *
          (0.18 + densityGate * 0.62);
        float diagnosticPresence = cloudAtlasActive *
          visibleCloudFade *
          diagnosticOpacity;
        float alpha = clamp(max(cloudPresence, diagnosticPresence), 0.0, 0.96);
        if (alpha <= 0.001) {
          discard;
        }
        float sunFacing = clamp(sphereSunlight, 0.0, 1.0);
        float solarBrightness = 0.58 + pow(sunFacing, 0.58) * 0.34;
        float limbBrightness = 1.0 - limb * 0.12;
        float coverBrightness = 0.88 + densityGate * 0.12;
        float opacityBrightness = 0.94 + alpha * 0.06;
        vec3 color = cloudShellColor *
          solarBrightness *
          limbBrightness *
          coverBrightness *
          opacityBrightness;
        vec3 diagnosticColor = vec3(1.0, 0.04, 0.015) *
          (0.82 + sunFacing * 0.18);
        float diagnosticMix = clamp(diagnosticPresence / max(alpha, 0.001), 0.0, 1.0);
        color = mix(color, diagnosticColor, diagnosticMix);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

function createCloudAtlasTexture(cloudAtlas: CloudAtlas): THREE.DataTexture {
  const data = new Uint8Array(cloudAtlas.width * cloudAtlas.height * 4);
  for (let index = 0; index < cloudAtlas.values.length; index += 1) {
    const value = Math.round(clamp((cloudAtlas.values[index] ?? 0) / 100, 0, 1) * 255);
    const density = Math.round(
      clamp(((cloudAtlas.opticalDensityValues?.[index] ?? cloudAtlas.values[index]) ?? 0) / 100, 0, 1) * 255,
    );
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = density;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, cloudAtlas.width, cloudAtlas.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createCloudAtlasTextureFrameSet(
  cloudAtlas: CloudAtlas | undefined,
  sequence: CloudAtlasSequence | undefined,
): CloudAtlasTextureFrameSet {
  const frames = createCloudAtlasTextureFrames(cloudAtlas, sequence);
  return {
    frames,
    sourceKind: sequence?.manifest.source.kind ?? cloudAtlas?.source.kind ?? "none",
    signature: cloudAtlasSignature(cloudAtlas, sequence),
    transitionDurationMs: cloudAtlasTransitionDurationMs(sequence),
  };
}

function createCloudAtlasTextureFrames(
  cloudAtlas: CloudAtlas | undefined,
  sequence: CloudAtlasSequence | undefined,
): readonly CloudAtlasTextureFrame[] {
  const frames = sequence
    ? sequence.frames.map((frame) => ({
        atlas: frame.atlas,
        ref: frame,
        texture: createCloudAtlasTexture(frame.atlas),
        validAtMs: frame.validAtMs,
      }))
    : cloudAtlas
      ? [
          {
            atlas: cloudAtlas,
            texture: createCloudAtlasTexture(cloudAtlas),
            validAtMs: Date.parse(cloudAtlas.validAtUtc),
          },
        ]
      : [];

  return frames
    .filter((frame) => Number.isFinite(frame.validAtMs))
    .sort((left, right) => left.validAtMs - right.validAtMs);
}

function cloudAtlasSignature(
  cloudAtlas: CloudAtlas | undefined,
  sequence: CloudAtlasSequence | undefined,
): string {
  if (sequence) {
    return [
      "sequence",
      sequence.manifest.version,
      sequence.manifest.generatedAtUtc,
      sequence.manifest.activeCycleUtc ?? "",
      sequence.frames
        .map((frame) =>
          [
            frame.url,
            frame.validAtUtc,
            frame.cycleUtc ?? "",
            frame.forecastHour ?? "",
            frame.atlas.generatedAtUtc,
            frame.atlas.validAtUtc,
          ].join(":"),
        )
        .join("|"),
    ].join("::");
  }

  if (cloudAtlas) {
    return [
      "atlas",
      cloudAtlas.version,
      cloudAtlas.generatedAtUtc,
      cloudAtlas.validAtUtc,
      cloudAtlas.source.kind,
    ].join("::");
  }

  return "none";
}

function cloudAtlasTransitionDurationMs(sequence: CloudAtlasSequence | undefined): number {
  if (!sequence?.manifest.transitionDurationMinutes) {
    return DEFAULT_CLOUD_ATLAS_TRANSITION_DURATION_MS;
  }

  return Math.max(0, sequence.manifest.transitionDurationMinutes * 60_000);
}

function disposeCloudAtlasTextureFrameSet(frameSet: CloudAtlasTextureFrameSet | undefined): void {
  frameSet?.frames.forEach((frame) => frame.texture.dispose());
}

function selectCloudAtlasFrames(
  frames: readonly CloudAtlasTextureFrame[],
  utcMs: number,
): CloudAtlasFrameSelection | undefined {
  if (frames.length === 0) {
    return undefined;
  }

  const first = frames[0];
  const last = frames.at(-1);
  if (!first || !last || utcMs <= first.validAtMs) {
    return first ? { left: first, right: first, mix01: 0 } : undefined;
  }
  if (utcMs >= last.validAtMs) {
    return { left: last, right: last, mix01: 0 };
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const left = frames[index];
    const right = frames[index + 1];
    if (!left || !right) {
      continue;
    }
    if (utcMs >= left.validAtMs && utcMs <= right.validAtMs) {
      const spanMs = Math.max(1, right.validAtMs - left.validAtMs);
      return {
        left,
        right,
        mix01: clamp((utcMs - left.validAtMs) / spanMs, 0, 1),
      };
    }
  }

  return { left: last, right: last, mix01: 0 };
}

function smoothstep01(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function createWorldGridSurfaceTexture(worldGrid: WorldGrid): THREE.DataTexture {
  const width = Math.max(2, Math.round(360 / worldGrid.cellSizeDegrees));
  const height = Math.max(2, Math.round(180 / worldGrid.cellSizeDegrees));
  const data = new Uint8Array(width * height * 4);
  const cellIndex = indexWorldGridCells(worldGrid, width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const longitudeDeg = -180 + ((x + 0.5) / width) * 360;
      const latitudeDeg = -90 + ((y + 0.5) / height) * 180;
      const cell =
        cellIndex.get(gridCellKey(x, y)) ??
        findNearestWorldGridCell(worldGrid, latitudeDeg, longitudeDeg);
      const [red, green, blue] = hexColorToRgbBytes(terrainColorForCell(cell));
      const offset = (y * width + x) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = Math.round(terrainHeight01ForCell(cell) * 255);
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createWorldGridWaterMaskTexture(worldGrid: WorldGrid): THREE.DataTexture {
  const width = Math.max(2, Math.round(360 / worldGrid.cellSizeDegrees));
  const height = Math.max(2, Math.round(180 / worldGrid.cellSizeDegrees));
  const data = new Uint8Array(width * height * 4);
  const cellIndex = indexWorldGridCells(worldGrid, width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const longitudeDeg = -180 + ((x + 0.5) / width) * 360;
      const latitudeDeg = -90 + ((y + 0.5) / height) * 180;
      const cell =
        cellIndex.get(gridCellKey(x, y)) ??
        findNearestWorldGridCell(worldGrid, latitudeDeg, longitudeDeg);
      const waterRatioByte = Math.round(clamp(cell.waterRatio, 0, 1) * 255);
      const offset = (y * width + x) * 4;
      data[offset] = waterRatioByte;
      data[offset + 1] = waterRatioByte;
      data[offset + 2] = waterRatioByte;
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function indexWorldGridCells(
  worldGrid: WorldGrid,
  textureWidth: number,
  textureHeight: number,
): Map<string, WorldGridCell> {
  const index = new Map<string, WorldGridCell>();

  for (const cell of worldGrid.cells) {
    const x = wrapTextureX(
      Math.floor(((cell.lonCenterDeg + 180) / 360) * textureWidth),
      textureWidth,
    );
    const y = Math.max(
      0,
      Math.min(
        textureHeight - 1,
        Math.floor(((cell.latCenterDeg + 90) / 180) * textureHeight),
      ),
    );
    index.set(gridCellKey(x, y), cell);
  }

  return index;
}

function gridCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function wrapTextureX(x: number, width: number): number {
  return ((x % width) + width) % width;
}

function hexColorToRgbBytes(hexColor: string): readonly [number, number, number] {
  const value = Number.parseInt(hexColor.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function createBaseGlobe(material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1, 96, 48);
  return new THREE.Mesh(geometry, material);
}

function createCloudShell(material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(CLOUD_ATLAS_SHELL_RADIUS, 96, 48);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

function createTerrainReliefMarkers(worldGrid: WorldGrid, markerSegments: number): THREE.Group {
  const group = new THREE.Group();

  for (const cell of worldGrid.cells) {
    group.add(createTerrainCellMarker(cell, markerRadiusForWorldGrid(worldGrid), markerSegments));
  }

  return group;
}

function shouldRenderStaticTerrainMarkers(worldGrid: WorldGrid): boolean {
  return worldGrid.cells.length <= 512;
}

function createTerrainCellMarker(
  cell: WorldGridCell,
  markerRadius: number,
  markerSegments: number,
): THREE.Mesh {
  const normal = pointOnSphere(cell.latCenterDeg, cell.lonCenterDeg, 1).normalize();
  const geometry = new THREE.CircleGeometry(markerRadius, markerSegments);
  const material = new THREE.MeshBasicMaterial({
    color: terrainRegisterColorForCell(cell),
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(pointOnSphere(cell.latCenterDeg, cell.lonCenterDeg, terrainRadiusForCell(cell)));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  return mesh;
}

function markerRadiusForWorldGrid(worldGrid: WorldGrid): number {
  if (worldGrid.cells.length < 64) {
    return 0.09;
  }

  return Math.max(0.018, Math.min(0.07, Math.sin(degToRad(worldGrid.cellSizeDegrees)) * 2.2));
}

function createQuakePoint(
  quake: EarthquakeEvent,
  terrainColor: string,
  pulse01: number,
): THREE.Mesh {
  const magnitude01 = clamp(quake.magnitude / 8, 0, 1);
  const pulseShape = Math.sqrt(pulse01);
  const baseRadius = 0.012 + magnitude01 * 0.008;
  const displayRadius = baseRadius * (0.18 + pulseShape * 1.46);
  const displayAlpha = clamp(Math.pow(pulse01, 1.08) * 0.84, 0, 0.86);
  const color = new THREE.Color(PENUMBRA_VISUAL_PALETTE.quake.core)
    .lerp(new THREE.Color(PENUMBRA_VISUAL_PALETTE.quake.peak), pulseShape * 0.62)
    .lerp(new THREE.Color(terrainColor), 0.12)
    .multiplyScalar(0.72 + pulseShape * 0.46);
  const geometry = new THREE.SphereGeometry(displayRadius, 12, 8);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: displayAlpha,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(pointOnSphere(quake.latitudeDeg, quake.longitudeDeg, SURFACE_CONTACT_RADIUS));
  return mesh;
}

function waterRippleInputForParticle(particle: WaterTextureVisualParticle): WaterTextureRippleInput {
  const normal = pointOnSphere(particle.latitudeDeg, particle.longitudeDeg, 1).normalize();
  const baseColor =
    particle.band === "low"
      ? new THREE.Color(PENUMBRA_VISUAL_PALETTE.terrain.shallowOcean).lerp(
          new THREE.Color("#b7eaff"),
          0.38,
        )
      : new THREE.Color("#7fd7ff").lerp(new THREE.Color(PENUMBRA_VISUAL_PALETTE.globe.limbGlow), 0.44);
  const alphaBase = particle.band === "low" ? 0.52 : 0.62;

  return {
    normal,
    color: baseColor.multiplyScalar(0.74 + particle.strength01 * 0.62),
    alpha01: clamp(alphaBase * (0.5 + particle.strength01 * 0.96), 0, 0.86),
    maxAngleRad: degToRad(
      particle.band === "low"
        ? SURFACE_WATER_RIPPLE_LOW_MAX_ANGLE_DEG
        : SURFACE_WATER_RIPPLE_MID_MAX_ANGLE_DEG,
    ),
    age01: particle.age01,
  };
}

function updateGlobeWaterRippleUniforms(
  material: THREE.ShaderMaterial,
  ripples: readonly WaterTextureRippleInput[],
): void {
  const rippleCount = Math.min(ripples.length, SURFACE_WATER_RIPPLE_MAX_COUNT);
  const centers = material.uniforms.waterRippleCenters.value as THREE.Vector4[];
  const colors = material.uniforms.waterRippleColors.value as THREE.Vector4[];
  const params = material.uniforms.waterRippleParams.value as THREE.Vector4[];

  material.uniforms.waterRippleCount.value = rippleCount;
  for (let index = 0; index < SURFACE_WATER_RIPPLE_MAX_COUNT; index += 1) {
    const center = centers[index];
    const color = colors[index];
    const param = params[index];
    if (!center || !color || !param) {
      continue;
    }

    const ripple = ripples[index];
    if (index >= rippleCount || !ripple) {
      center.set(0, 0, 1, 1);
      color.set(0, 0, 0, 0);
      param.set(0, 0, 0, 0);
      continue;
    }

    center.set(ripple.normal.x, ripple.normal.y, ripple.normal.z, ripple.age01);
    color.set(ripple.color.r, ripple.color.g, ripple.color.b, ripple.alpha01);
    param.set(ripple.maxAngleRad, 0, 0, 0);
  }

  material.uniformsNeedUpdate = true;
}

function windShimmerInputForAudioFrame(
  audioFrame: AudioFrameParams,
  wind: ReturnType<typeof derivePenumbraEarthTextureParams>["wind"],
): WindShimmerInput {
  const windLevelSum =
    wind.bodyLevel01 +
    wind.midLevel01 +
    wind.midHighLevel01 +
    wind.highLevel01 +
    wind.airLevel01;
  const upperWindShare = (wind.midHighLevel01 + wind.highLevel01 + wind.airLevel01) /
    Math.max(0.0001, windLevelSum);
  const qFocus = clamp(
    (wind.midQ + wind.midHighQ + wind.highQ + wind.airQ - 10.4) / (40 - 10.4),
    0,
    1,
  );
  const windPresence01 = clamp(
    windLevelSum / 0.16 +
      audioFrame.earth.wind01 * 0.34 +
      audioFrame.earth.airTurbulenceDepth01 * 0.26,
    0,
    1,
  );
  const exposure01 = clamp(
    audioFrame.earth.wind01 * 0.46 +
      audioFrame.earth.openness01 * 0.24 +
      audioFrame.earth.surfaceRoughness01 * 0.22 +
      audioFrame.earth.scanlineSpatialChange01 * 0.14 -
      audioFrame.earth.cloudCover01 * 0.08 -
      audioFrame.earth.humidity01 * 0.05,
    0,
    1,
  );
  const phaseRateHz = clamp(
    WIND_SHIMMER_PHASE_MIN_HZ +
      audioFrame.earth.wind01 * 0.46 +
      audioFrame.earth.airTurbulenceDepth01 * 0.22 +
      audioFrame.earth.scanlineSpatialChange01 * 0.12,
    WIND_SHIMMER_PHASE_MIN_HZ,
    WIND_SHIMMER_PHASE_MAX_HZ,
  );

  return {
    strength01: clamp(windPresence01 * (0.36 + exposure01 * 0.78), 0, 1),
    focus01: clamp(0.24 + qFocus * 0.56 + audioFrame.earth.surfaceRoughness01 * 0.16, 0, 1),
    flowCycles: beatPhaseFromUtc(audioFrame.utcEpochMs, phaseRateHz),
    flowHz: phaseRateHz,
    detail01: clamp(upperWindShare * 0.74 + audioFrame.earth.airTurbulenceDepth01 * 0.26, 0, 1),
  };
}

function updateGlobeWindShimmerUniforms(
  material: THREE.ShaderMaterial,
  wind: WindShimmerInput | undefined,
  trail01 = 0,
): void {
  const params = material.uniforms.windShimmerParams.value as THREE.Vector4;
  material.uniforms.windShimmerTrail.value = 0;
  if (!wind || wind.strength01 <= 0.001) {
    params.set(0, 0, 0, 0);
    material.uniformsNeedUpdate = true;
    return;
  }

  params.set(wind.strength01, wind.focus01, wind.detail01, wind.flowCycles);
  material.uniforms.windShimmerTrail.value = clamp(trail01, 0, 1);
  material.uniformsNeedUpdate = true;
}

function createHumanPresenceContacts(worldGrid: WorldGrid): readonly HumanPresenceContact[] {
  return worldGrid.cells
    .filter((cell) => cell.nightLightMean > 0)
    .map((cell) => {
      const nightLightNorm = normalizeNightLight(cell.nightLightMean, worldGrid.stats.nightLight);
      const presenceStrength = Math.pow(nightLightNorm, 0.72);
      const normal = pointOnSphere(cell.latCenterDeg, cell.lonCenterDeg, 1).normalize();
      const color = new THREE.Color(PENUMBRA_VISUAL_PALETTE.human.core).lerp(
        new THREE.Color(PENUMBRA_VISUAL_PALETTE.human.peak),
        Math.pow(nightLightNorm, 0.9) * 0.42,
      );

      return {
        cellId: cell.id,
        position: pointOnSphere(cell.latCenterDeg, cell.lonCenterDeg, NIGHT_LIGHT_SURFACE_RADIUS),
        normal,
        color,
        baseAlpha01: clamp(0.16 + presenceStrength * 0.5, 0, 0.85),
        sizeScale01: clamp(0.22 + Math.sqrt(nightLightNorm) * 0.48, 0.2, 0.82),
      };
    })
    .filter((contact) => contact.baseAlpha01 > 0)
    .sort((left, right) => left.cellId.localeCompare(right.cellId));
}

function humanPresenceDensityScale(contactCount: number): number {
  if (contactCount <= 220) {
    return 1;
  }

  return clamp(Math.sqrt(1800 / contactCount), 0.5, 1);
}

function humanPulseVisualLevel(
  currentUtcMs: number,
  pulseUtcMs: number | undefined,
  pulseStrength01: number,
): number {
  if (pulseUtcMs === undefined) {
    return 0;
  }

  const ageMs = currentUtcMs - pulseUtcMs;
  if (ageMs < 0 || ageMs > HUMAN_PULSE_VISUAL_DECAY_MS) {
    return 0;
  }

  return clamp(pulseStrength01 * Math.exp(-ageMs / 360), 0, 1);
}

function quakePulseVisualLevel(
  currentUtcMs: number,
  pulseUtcMs: number | undefined,
  pulseStrength01: number,
): number {
  if (pulseUtcMs === undefined) {
    return 0;
  }

  const ageMs = currentUtcMs - pulseUtcMs;
  if (ageMs < 0 || ageMs > QUAKE_PULSE_VISUAL_DECAY_MS) {
    return 0;
  }

  return clamp(pulseStrength01 * Math.exp(-ageMs / 430), 0, 1);
}

function pointOnSphere(latitudeDeg: number, longitudeDeg: number, radius: number): THREE.Vector3 {
  const latitudeRad = degToRad(latitudeDeg);
  const longitudeRad = degToRad(longitudeDeg);
  const cosLatitude = Math.cos(latitudeRad);

  return new THREE.Vector3(
    radius * cosLatitude * Math.sin(longitudeRad),
    radius * Math.sin(latitudeRad),
    radius * cosLatitude * Math.cos(longitudeRad),
  );
}

function cameraDistanceForAspect(aspect: number, verticalFovDeg: number): number {
  const visibleRadius = 1.44;
  const verticalDistance = visibleRadius / Math.tan(degToRad(verticalFovDeg) / 2);
  const horizontalDistance =
    visibleRadius / (Math.tan(degToRad(verticalFovDeg) / 2) * Math.max(0.32, aspect));

  return Math.max(verticalDistance, horizontalDistance) + 0.46;
}

function nightLightPointSizeForViewport(width: number, height: number): number {
  const shortSide = Math.max(1, Math.min(width, height));
  const scale = clamp(
    Math.sqrt(shortSide / NIGHT_LIGHT_POINT_REFERENCE_SHORT_SIDE_PX),
    NIGHT_LIGHT_POINT_MIN_VIEWPORT_SCALE,
    1,
  );
  return NIGHT_LIGHT_POINT_SIZE_PX * scale;
}

function nightLightPointSizeForCaptureOutput(width: number, height: number): number {
  const shortSide = Math.max(1, Math.min(width, height));
  const outputScale = clamp(
    shortSide / CAPTURE_NIGHT_LIGHT_POINT_REFERENCE_SHORT_SIDE_PX,
    NIGHT_LIGHT_POINT_MIN_VIEWPORT_SCALE,
    CAPTURE_NIGHT_LIGHT_POINT_MAX_OUTPUT_SCALE,
  );
  return NIGHT_LIGHT_POINT_SIZE_PX * outputScale;
}

function createHud(
  canvas: HTMLCanvasElement,
  options: {
    readonly debug: boolean;
    readonly earthRootWidget: boolean;
  },
): {
  readonly root: HTMLElement;
  readonly utc: HTMLElement;
  readonly longitude: HTMLElement;
  readonly declination: HTMLElement;
  readonly declinationValue: HTMLElement;
  readonly debugPanel: HTMLElement | undefined;
  readonly debugRoot: EarthRootDebugWidget | undefined;
} {
  const parent = canvas.parentElement;
  if (!parent) {
    throw new Error("Penumbra renderer requires the canvas to be attached before construction.");
  }

  const root = document.createElement("div");
  root.className = "penumbra__hud";

  const leftCluster = document.createElement("div");
  leftCluster.className = "penumbra__hud-cluster penumbra__hud-cluster--left";

  const rightCluster = document.createElement("div");
  rightCluster.className = "penumbra__hud-cluster penumbra__hud-cluster--right";

  const utcReadout = createHudReadout("UTC");
  const longitudeReadout = createLongitudeReadout();
  const declinationReadout = createDeclinationReadout();

  leftCluster.append(utcReadout.root);
  rightCluster.append(longitudeReadout.root, declinationReadout.root);
  root.append(leftCluster, rightCluster);
  parent.append(root);

  let debugPanel: HTMLElement | undefined;
  let debugRoot: EarthRootDebugWidget | undefined;
  if (options.earthRootWidget) {
    debugRoot = createEarthRootDebugWidget();
    if (!options.debug) {
      debugRoot.root.classList.add("penumbra__debug-root--standalone");
    }
    parent.append(debugRoot.root);
  }

  if (options.debug) {
    debugPanel = document.createElement("pre");
    debugPanel.className = "penumbra__debug-panel";
    parent.append(debugPanel);
  }

  return {
    root,
    utc: utcReadout.value,
    longitude: longitudeReadout.value,
    declination: declinationReadout.root,
    declinationValue: declinationReadout.value,
    debugPanel,
    debugRoot,
  };
}

interface EarthRootDebugWidget {
  readonly root: HTMLElement;
  readonly earthRootValue: HTMLElement;
  readonly droneValue: HTMLElement;
  readonly earthBeatValue: HTMLElement;
  readonly waveformTrace: SVGPolylineElement;
}

function createEarthRootDebugWidget(): EarthRootDebugWidget {
  const root = document.createElement("div");
  root.className = "penumbra__debug-root";

  const copy = document.createElement("div");
  copy.className = "penumbra__debug-root-copy";

  const earthRoot = createDebugRootMetric("EARTH ROOT");
  const drone = createDebugRootMetric("DRONE");
  const earthBeat = createDebugRootMetric("EARTH BEAT");

  const waveform = document.createElementNS(SVG_NAMESPACE, "svg");
  waveform.classList.add("penumbra__debug-root-waveform");
  waveform.setAttribute("viewBox", "-1 -1 2 2");
  waveform.setAttribute("preserveAspectRatio", "none");
  waveform.setAttribute("aria-hidden", "true");

  const waveformZero = document.createElementNS(SVG_NAMESPACE, "line");
  waveformZero.classList.add("penumbra__debug-root-waveform-zero");
  waveformZero.setAttribute("x1", "-1");
  waveformZero.setAttribute("y1", "0.82");
  waveformZero.setAttribute("x2", "1");
  waveformZero.setAttribute("y2", "0.82");

  const waveformTrace = document.createElementNS(SVG_NAMESPACE, "polyline");
  waveformTrace.classList.add("penumbra__debug-root-waveform-trace");

  waveform.append(waveformZero, waveformTrace);
  copy.append(earthRoot.root, drone.root, earthBeat.root, waveform);

  root.append(copy);

  return {
    root,
    earthRootValue: earthRoot.value,
    droneValue: drone.value,
    earthBeatValue: earthBeat.value,
    waveformTrace,
  };
}

function createDebugRootMetric(label: string): {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
} {
  const root = document.createElement("div");
  root.className = "penumbra__debug-root-metric";

  const labelElement = document.createElement("div");
  labelElement.className = "penumbra__debug-root-label";
  labelElement.textContent = label;

  const value = document.createElement("div");
  value.className = "penumbra__debug-root-value";
  value.textContent = "n/a";

  root.append(labelElement, value);
  return { root, value };
}

function createLongitudeReadout(): {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
} {
  const readout = createHudReadout("LON", "penumbra__hud-readout--right");
  const gaugeSlot = document.createElement("span");
  gaugeSlot.className = "penumbra__hud-gauge-slot";
  gaugeSlot.setAttribute("aria-hidden", "true");
  const label = readout.root.querySelector(".penumbra__hud-label");
  if (label) {
    label.after(gaugeSlot);
  }
  return readout;
}

function formatSvgPoints(points: readonly { readonly x: number; readonly y: number }[]): string {
  return points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(" ");
}

function createHudReadout(
  label: string,
  className?: string,
): {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
} {
  const root = document.createElement("div");
  root.className = ["penumbra__hud-readout", className].filter(Boolean).join(" ");

  const labelElement = document.createElement("span");
  labelElement.className = "penumbra__hud-label";
  labelElement.textContent = `${label} `;

  const value = document.createElement("span");
  value.className = "penumbra__hud-value";

  root.append(labelElement, value);
  return { root, value };
}

function createDeclinationReadout(): {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
} {
  const readout = createHudReadout("DEC", "penumbra__hud-readout--right penumbra__hud-readout--declination");
  const gauge = document.createElement("span");
  gauge.className = "penumbra__declination-gauge";
  const label = readout.root.querySelector(".penumbra__hud-label");
  if (label) {
    label.after(gauge);
  }
  return readout;
}

function formatUtcReadout(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function formatLongitude(longitudeDeg: number): string {
  const hemisphere = longitudeDeg < 0 ? "W" : "E";
  return `${Math.abs(longitudeDeg).toFixed(2).padStart(6, "0")}°${hemisphere}`;
}

function formatSolarDeclination(declinationDeg: number): string {
  const hemisphere = declinationDeg < 0 ? "S" : "N";
  const sign = declinationDeg < 0 ? "-" : "+";
  return `${sign}${Math.abs(declinationDeg).toFixed(1)}°${hemisphere}`;
}

function solarDeclinationGaugeY(declinationDeg: number): number {
  return clamp(
    (SOLAR_DECLINATION_MAX_DEG - declinationDeg) / (SOLAR_DECLINATION_MAX_DEG * 2),
    0,
    1,
  );
}

function beatPhaseFromUtc(utcEpochMs: number, beatHz: number): number {
  if (!Number.isFinite(utcEpochMs) || !Number.isFinite(beatHz) || beatHz <= 0.000001) {
    return 0;
  }

  const periodMs = 1000 / beatHz;
  return positiveModulo(utcEpochMs, periodMs) / periodMs;
}

function positiveModulo(value: number, modulo: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(modulo) || modulo <= 0) {
    return 0;
  }

  return ((value % modulo) + modulo) % modulo;
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }

  material.dispose();
}
