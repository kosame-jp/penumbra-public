/* global AudioWorkletProcessor, registerProcessor, currentFrame, sampleRate */

const MAX_WATER_DROPLET_VOICES = 192;
const TWO_PI = Math.PI * 2;
const WATER_LOW_CENTER_HZ = 197;
const WATER_MID_CENTER_HZ = 605;
const WATER_HIGH_CENTER_HZ = 2974;
const WATER_FLOOR_OUTPUT_GAIN = 1;
const WATER_DROPLET_OUTPUT_GAIN = 3.1;
const WATER_DROPLET_DISTANCE01 = 1;
const MAX_RAIN_GRANULAR_VOICES = 256;
const RAIN_GRANULAR_OUTPUT_GAIN = 1.2;
const RAIN_GRANULAR_BUFFER_SECONDS = 2.75;
const CONTINUOUS_PARAM_SMOOTH_COEFFICIENT = 0.0018;
const REVERB_SIZE_SMOOTH_COEFFICIENT = 0.0008;
const WIND_LEVEL_PARAM_KEYS = [
  "bodyLevel01",
  "midLevel01",
  "midHighLevel01",
  "highLevel01",
  "airLevel01",
  "dryLevelScale01",
  "formantSourceScale01",
];
const WIND_CENTER_PARAM_KEYS = ["bodyCenterHz", "midCenterHz", "midHighCenterHz", "highCenterHz", "airCenterHz"];
const WIND_Q_PARAM_KEYS = ["bodyQ", "midQ", "midHighQ", "highQ", "airQ"];
const WIND_LEVEL_SMOOTH_COEFFICIENT = smoothingCoefficientForSeconds(1);
const WIND_CENTER_SMOOTH_COEFFICIENT = smoothingCoefficientForSeconds(1.2);
const WIND_Q_SMOOTH_COEFFICIENT = smoothingCoefficientForSeconds(0.75);
const RAIN_GRANULAR_PROFILE_MATERIALS = [
  { gain: 0.78, lowpassScale: 1.35, playbackScale: 1.18, attackRatioScale: 0.82, attackCurveScale: 1.02, decayCurveScale: 0.92 },
  { gain: 0.92, lowpassScale: 0.86, playbackScale: 0.88, attackRatioScale: 1.18, attackCurveScale: 1.16, decayCurveScale: 0.68 },
  { gain: 1.2, lowpassScale: 1.48, playbackScale: 1.1, attackRatioScale: 0.46, attackCurveScale: 0.68, decayCurveScale: 1.72 },
  { gain: 1.06, lowpassScale: 0.58, playbackScale: 0.76, attackRatioScale: 0.9, attackCurveScale: 1.05, decayCurveScale: 1.08 },
];
const DEFAULT_ACOUSTIC = {
  reverbWet01: 0.9,
  reverbSize: 4.1,
  distance01: 0.45,
  airAbsorbHz: 9000,
};

class PenumbraEarthTextureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.target = createDefaultContinuousParams();
    this.current = createDefaultContinuousParams();
    this.waterVoices = [];
    this.rainVoices = [];
    this.rainBuffers = createRainGranularBuffers();
    this.rainGranularLeft = 0;
    this.rainGranularRight = 0;
    this.rainGranularMono = 0;
    this.noiseState = createNoiseState(137);
    this.filters = createFilterBank();
    this.reverbTank = createReverbTank(DEFAULT_ACOUSTIC.reverbSize);
    this.waterDistanceLowpassState = 0;
    this.windDistanceLowpassState = 0;
    this.dropletDistanceLowpassState = 0;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "set-continuous") {
        this.target = sanitizeContinuousParams(message.params);
        this.reverbTank.sizeTarget = clamp(this.target.acoustic.reverbSize, 0.3, 8);
      } else if (message?.type === "water-droplet") {
        this.enqueueWaterDroplet(message);
      } else if (message?.type === "rain-grain") {
        this.enqueueRainGranular(message);
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const windOnlyOutput = outputs[1];
    const waterDryOutput = outputs[2];
    const windDryOutput = outputs[3];
    const leftOutput = output?.[0];
    const rightOutput = output?.[1];
    const windOnlyLeftOutput = windOnlyOutput?.[0];
    const windOnlyRightOutput = windOnlyOutput?.[1];
    const waterDryLeftOutput = waterDryOutput?.[0];
    const waterDryRightOutput = waterDryOutput?.[1];
    const windDryLeftOutput = windDryOutput?.[0];
    const windDryRightOutput = windDryOutput?.[1];
    if (!leftOutput) {
      return true;
    }

    leftOutput.fill(0);
    rightOutput?.fill(0);
    windOnlyLeftOutput?.fill(0);
    windOnlyRightOutput?.fill(0);
    waterDryLeftOutput?.fill(0);
    waterDryRightOutput?.fill(0);
    windDryLeftOutput?.fill(0);
    windDryRightOutput?.fill(0);

    const blockSampleCount = leftOutput.length;
    smoothContinuousParamsForBlock(this.current, this.target, blockSampleCount);
    smoothReverbSizeForBlock(this.reverbTank, blockSampleCount);

    for (let sampleIndex = 0; sampleIndex < leftOutput.length; sampleIndex += 1) {
      const absoluteSample = currentFrame + sampleIndex;

      let waterTextureSample = 0;
      let windTextureSample = 0;
      if (this.current.active) {
        waterTextureSample = processWaterNoiseFloor(this);
        windTextureSample = processWindLayers(this);
      }
      const windDrySample = windTextureSample * this.current.wind.dryLevelScale01;
      const windFormantSample = windTextureSample * this.current.wind.formantSourceScale01;
      const textureSample = waterTextureSample + windDrySample;
      const dropletSample = this.current.active ? processWaterDroplets(this, absoluteSample) : 0;
      const rainSample = this.current.active ? processRainGranular(this, absoluteSample) : 0;
      const drySample = textureSample + dropletSample + rainSample;

      const acoustic = this.current.acoustic;
      const wet = processReverbTank(this.reverbTank, drySample * acoustic.reverbWet01);
      const dryGain = 1 - acoustic.reverbWet01 * 0.72;
      const wetGain = 0.72 + acoustic.reverbWet01 * 0.68;
      const waterTextureMixed = waterTextureSample * dryGain;
      const windTextureMixed = windDrySample * dryGain;
      const dropletMixed = dropletSample * dryGain;
      const distanceGain = 1 - acoustic.distance01 * 0.4;
      const lowpassHz = acoustic.airAbsorbHz * (1 - acoustic.distance01 * 0.7);
      const lowpassCoefficient = onePoleCoefficient(lowpassHz);
      this.waterDistanceLowpassState += lowpassCoefficient * (waterTextureMixed - this.waterDistanceLowpassState);
      this.windDistanceLowpassState += lowpassCoefficient * (windTextureMixed - this.windDistanceLowpassState);
      const dropletDistanceGain = 1 - WATER_DROPLET_DISTANCE01 * 0.4;
      const dropletLowpassHz = acoustic.airAbsorbHz * (1 - WATER_DROPLET_DISTANCE01 * 0.7);
      const dropletLowpassCoefficient = onePoleCoefficient(dropletLowpassHz);
      this.dropletDistanceLowpassState +=
        dropletLowpassCoefficient * (dropletMixed - this.dropletDistanceLowpassState);
      const waterDistanceMixed =
        this.waterDistanceLowpassState * distanceGain + this.dropletDistanceLowpassState * dropletDistanceGain;
      const windDistanceMixed = this.windDistanceLowpassState * distanceGain;
      const rainLeft = this.rainGranularLeft * dryGain;
      const rainRight = this.rainGranularRight * dryGain;
      const waterLeft = waterDistanceMixed + rainLeft;
      const waterRight = waterDistanceMixed + rainRight;
      const windLeft = windDistanceMixed;
      const windRight = windDistanceMixed;

      leftOutput[sampleIndex] = softClip(waterLeft + windLeft + wet.left * wetGain * distanceGain);
      if (rightOutput) {
        rightOutput[sampleIndex] = softClip(waterRight + windRight + wet.right * wetGain * distanceGain);
      }
      if (windOnlyLeftOutput) {
        const formantExciterSample = softClip(windFormantSample);
        windOnlyLeftOutput[sampleIndex] = formantExciterSample;
        if (windOnlyRightOutput) {
          windOnlyRightOutput[sampleIndex] = formantExciterSample;
        }
      }
      if (waterDryLeftOutput) {
        waterDryLeftOutput[sampleIndex] = softClip(waterLeft);
        if (waterDryRightOutput) {
          waterDryRightOutput[sampleIndex] = softClip(waterRight);
        }
      }
      if (windDryLeftOutput) {
        windDryLeftOutput[sampleIndex] = softClip(windLeft);
        if (windDryRightOutput) {
          windDryRightOutput[sampleIndex] = softClip(windRight);
        }
      }
    }

    mirrorLeftToExtraChannels(output, leftOutput);
    mirrorLeftToExtraChannels(windOnlyOutput, windOnlyLeftOutput);
    mirrorLeftToExtraChannels(waterDryOutput, waterDryLeftOutput);
    mirrorLeftToExtraChannels(windDryOutput, windDryLeftOutput);
    return true;
  }

  enqueueWaterDroplet(message) {
    const startSample = Math.max(currentFrame, Math.round(message.startTimeSeconds * sampleRate));
    const sweepSamples = Math.max(1, Math.round(clamp(message.sweepTimeSeconds, 0.002, 0.5) * sampleRate));
    const decaySamples = Math.max(1, Math.round(clamp(message.decaySeconds, 0.003, 1.2) * sampleRate));
    const tailSamples = Math.round(Math.min(0.28, message.decaySeconds * 0.42 + 0.04) * sampleRate);
    const endSample = startSample + decaySamples + tailSamples;

    const randomSeed = sanitizeSeed(message.randomSeed, startSample, message.frequencyHz);

    this.waterVoices.push({
      startSample,
      sweepSamples,
      decaySamples,
      tailSamples,
      endSample,
      phase: hash01(randomSeed + message.frequencyHz * 0.137) * TWO_PI,
      frequencyHz: clamp(message.frequencyHz, 20, sampleRate * 0.42),
      pitchSweep: clamp(message.pitchSweep, 0.5, 5),
      velocity01: clamp(message.velocity01, 0, 1),
      transient01: clamp(message.transient01 ?? 0, 0, 1),
      randomState: randomSeed,
      bandGain: waterBandGain(this.current.water, message.band),
    });

    if (this.waterVoices.length > MAX_WATER_DROPLET_VOICES) {
      this.waterVoices.sort((left, right) => left.endSample - right.endSample);
      this.waterVoices.splice(0, this.waterVoices.length - MAX_WATER_DROPLET_VOICES);
    }
  }

  enqueueRainGranular(message) {
    const bufferIndex = Math.max(0, Math.floor(message.bufferIndex)) % this.rainBuffers.length;
    const buffer = this.rainBuffers[bufferIndex] ?? this.rainBuffers[0];
    const material = rainGranularProfileMaterial(bufferIndex);
    const startSample = Math.max(currentFrame, Math.round(message.startTimeSeconds * sampleRate));
    const durationSamples = Math.max(1, Math.round(clamp(message.durationSeconds, 0.008, 0.25) * sampleRate));
    const randomSeed = sanitizeSeed(message.randomSeed, startSample, message.playbackRate * 1000);
    const offsetSample = Math.floor(clamp(message.offset01, 0, 0.999999) * buffer.length);
    const pan = clamp(message.pan01, -1, 1);
    const panPosition = (pan + 1) * 0.25 * Math.PI;

    this.rainVoices.push({
      startSample,
      durationSamples,
      endSample: startSample + durationSamples,
      bufferIndex,
      readIndex: offsetSample,
      readStep: clamp(message.playbackRate * material.playbackScale, 0.25, 2.5),
      velocity01: clamp(message.velocity01, 0, 1),
      leftGain: Math.cos(panPosition),
      rightGain: Math.sin(panPosition),
      filterState: 0,
      lowpassCoefficient: onePoleCoefficient(message.lowpassHz * material.lowpassScale),
      profileGain: material.gain,
      attackRatio: clamp((message.attackRatio ?? 0.42) * material.attackRatioScale, 0.035, 0.62),
      attackCurve: clamp((message.attackCurve ?? 1.35) * material.attackCurveScale, 0.35, 2.6),
      decayCurve: clamp((message.decayCurve ?? 1.35) * material.decayCurveScale, 0.65, 7.2),
      randomState: randomSeed,
    });

    if (this.rainVoices.length > MAX_RAIN_GRANULAR_VOICES) {
      this.rainVoices.sort((left, right) => left.endSample - right.endSample);
      this.rainVoices.splice(0, this.rainVoices.length - MAX_RAIN_GRANULAR_VOICES);
    }
  }
}

function processWaterNoiseFloor(processor) {
  const water = processor.current.water;
  const source = nextPinkNoise(processor.noiseState.water);
  const rumbleSource = nextPinkNoise(processor.noiseState.waterRumble);
  const rumble = processWaterRumble(processor.filters.waterRumble, rumbleSource) * water.lowLevel01;
  const body = processBandpass(processor.filters.waterBody, source + rumble * 0.36, WATER_LOW_CENTER_HZ * 0.72, 1.05) *
    water.lowLevel01;
  const low = processBandpass(processor.filters.waterLow, source, WATER_LOW_CENTER_HZ, 0.62) * water.lowLevel01;
  const mid = processBandpass(processor.filters.waterMid, source, WATER_MID_CENTER_HZ, 0.72) * water.midLevel01;
  const high = processBandpass(processor.filters.waterHigh, source - rumble * 0.18, WATER_HIGH_CENTER_HZ, 0.88) *
    water.highLevel01;
  return (
    (rumble * 1.9 + body * 1.25 + low + mid * 0.82 + high * 0.58) *
    water.noiseFloorGain01 *
    WATER_FLOOR_OUTPUT_GAIN
  );
}

function processWindLayers(processor) {
  const wind = processor.current.wind;
  const pink = nextPinkNoise(processor.noiseState.wind);
  const white = nextWhiteNoise(processor.noiseState.wind);
  const body = processBandpass(processor.filters.windBody, pink, wind.bodyCenterHz, wind.bodyQ) * wind.bodyLevel01;
  const mid = processBandpass(processor.filters.windMid, pink, wind.midCenterHz, wind.midQ) * wind.midLevel01;
  const midHighSource = pink * 0.45 + white * 0.55;
  const midHigh =
    processBandpass(processor.filters.windMidHigh, midHighSource, wind.midHighCenterHz, wind.midHighQ) *
    wind.midHighLevel01;
  const high = processBandpass(processor.filters.windHigh, white, wind.highCenterHz, wind.highQ) * wind.highLevel01;
  const air = processBandpass(processor.filters.windAir, white, wind.airCenterHz, wind.airQ) * wind.airLevel01;
  return body + mid + midHigh + high + air;
}

function processWaterDroplets(processor, absoluteSample) {
  let output = 0;
  for (let voiceIndex = processor.waterVoices.length - 1; voiceIndex >= 0; voiceIndex -= 1) {
    const voice = processor.waterVoices[voiceIndex];
    if (absoluteSample < voice.startSample) {
      continue;
    }

    if (absoluteSample > voice.endSample) {
      processor.waterVoices.splice(voiceIndex, 1);
      continue;
    }

    const localSample = absoluteSample - voice.startSample;
    const envelope = dropletEnvelopeAtSample(voice, localSample);
    if (envelope <= 0.000001) {
      continue;
    }

    const sweepPosition = Math.min(1, localSample / voice.sweepSamples);
    const sweepFrequency = voice.frequencyHz * Math.exp(Math.log(voice.pitchSweep) * smoothstep(sweepPosition));
    const settle = localSample > voice.sweepSamples
      ? 1 + Math.sin(localSample * 0.0017 + voice.frequencyHz * 0.013) * 0.018 * envelope
      : 1;
    const frequency = clamp(sweepFrequency * settle, 20, sampleRate * 0.42);
    voice.phase += (TWO_PI * frequency) / sampleRate;
    if (voice.phase > TWO_PI) {
      voice.phase -= TWO_PI;
    }

    const peakGain =
      processor.current.water.dropletGain01 *
      voice.velocity01 *
      (0.24 + voice.bandGain * 0.76) *
      WATER_DROPLET_OUTPUT_GAIN;
    let sample = Math.sin(voice.phase) * envelope * peakGain;
    if (voice.transient01 > 0.0001 && localSample < sampleRate * 0.018) {
      const transientEnvelope = Math.exp(-localSample / (sampleRate * 0.004));
      sample += nextSignedVoiceNoise(voice) * transientEnvelope * peakGain * voice.transient01 * 0.55;
    }
    output += sample;
  }

  return output;
}

function processRainGranular(processor, absoluteSample) {
  let left = 0;
  let right = 0;
  let mono = 0;
  const rain = processor.current.rainGranular;
  if (rain.gain01 <= 0.000001) {
    processor.rainGranularLeft = 0;
    processor.rainGranularRight = 0;
    processor.rainGranularMono = 0;
    return 0;
  }

  for (let voiceIndex = processor.rainVoices.length - 1; voiceIndex >= 0; voiceIndex -= 1) {
    const voice = processor.rainVoices[voiceIndex];
    if (absoluteSample < voice.startSample) {
      continue;
    }

    if (absoluteSample > voice.endSample) {
      processor.rainVoices.splice(voiceIndex, 1);
      continue;
    }

    const buffer = processor.rainBuffers[voice.bufferIndex] ?? processor.rainBuffers[0];
    const localSample = absoluteSample - voice.startSample;
    const age01 = clamp(localSample / Math.max(1, voice.durationSamples), 0, 1);
    const envelope = rainGranularEnvelopeAtAge(age01, voice);
    const source = readCircularInterpolated(buffer, voice.readIndex);
    voice.readIndex = (voice.readIndex + voice.readStep) % buffer.length;
    voice.filterState += voice.lowpassCoefficient * (source - voice.filterState);

    const grain =
      voice.filterState *
      envelope *
      voice.velocity01 *
      voice.profileGain *
      rain.gain01 *
      (0.52 + rain.brightness01 * 0.48) *
      RAIN_GRANULAR_OUTPUT_GAIN;
    left += grain * voice.leftGain;
    right += grain * voice.rightGain;
    mono += grain * 0.5 * (voice.leftGain + voice.rightGain);
  }

  processor.rainGranularLeft = left;
  processor.rainGranularRight = right;
  processor.rainGranularMono = mono;
  return mono;
}

function rainGranularEnvelopeAtAge(age01, voice) {
  const attackRatio = clamp(voice.attackRatio, 0.035, 0.62);
  if (age01 < attackRatio) {
    const attackAge = age01 / Math.max(0.000001, attackRatio);
    return Math.sin(attackAge * Math.PI * 0.5) ** voice.attackCurve;
  }

  const decayAge = (age01 - attackRatio) / Math.max(0.000001, 1 - attackRatio);
  return Math.max(0, 1 - decayAge) ** voice.decayCurve;
}

function dropletEnvelopeAtSample(voice, localSample) {
  const attackSamples = Math.max(1, Math.round(sampleRate * 0.001));
  if (localSample < attackSamples) {
    return localSample / attackSamples;
  }

  const age = (localSample - attackSamples) / voice.decaySamples;
  if (age <= 1) {
    return Math.exp(-6.9 * age);
  }

  const tailAge = (localSample - attackSamples - voice.decaySamples) / Math.max(1, voice.tailSamples);
  return Math.exp(-6.9) * Math.exp(-8 * Math.max(0, tailAge));
}

function smoothContinuousParamsForBlock(current, target, blockSampleCount) {
  const continuousCoefficient = coefficientForBlock(CONTINUOUS_PARAM_SMOOTH_COEFFICIENT, blockSampleCount);
  current.active = target.active;
  smoothObject(current.water, target.water, continuousCoefficient);
  smoothWindObjectForBlock(current.wind, target.wind, blockSampleCount);
  smoothObject(
    current.rainGranular,
    target.rainGranular,
    coefficientForBlock(CONTINUOUS_PARAM_SMOOTH_COEFFICIENT * 1.35, blockSampleCount),
  );
  smoothObject(
    current.acoustic,
    target.acoustic,
    coefficientForBlock(CONTINUOUS_PARAM_SMOOTH_COEFFICIENT * 0.42, blockSampleCount),
  );
}

function smoothObject(current, target, coefficient) {
  for (const key of Object.keys(current)) {
    current[key] += (target[key] - current[key]) * coefficient;
  }
}

function smoothWindObjectForBlock(current, target, blockSampleCount) {
  smoothObjectKeys(
    current,
    target,
    WIND_LEVEL_PARAM_KEYS,
    coefficientForBlock(WIND_LEVEL_SMOOTH_COEFFICIENT, blockSampleCount),
  );
  smoothObjectKeys(
    current,
    target,
    WIND_CENTER_PARAM_KEYS,
    coefficientForBlock(WIND_CENTER_SMOOTH_COEFFICIENT, blockSampleCount),
  );
  smoothObjectKeys(
    current,
    target,
    WIND_Q_PARAM_KEYS,
    coefficientForBlock(WIND_Q_SMOOTH_COEFFICIENT, blockSampleCount),
  );
}

function smoothObjectKeys(current, target, keys, coefficient) {
  for (const key of keys) {
    current[key] += (target[key] - current[key]) * coefficient;
  }
}

function coefficientForBlock(sampleCoefficient, blockSampleCount) {
  return clamp(1 - (1 - sampleCoefficient) ** Math.max(1, blockSampleCount), 0.000001, 0.94);
}

function sanitizeContinuousParams(params) {
  const fallback = createDefaultContinuousParams();
  const source = params ?? fallback;
  return {
    active: Boolean(source.active),
    water: {
      noiseFloorGain01: clampNumberOr(source.water?.noiseFloorGain01, fallback.water.noiseFloorGain01, 0, 0.72),
      dropletDensityHz: clampNumberOr(source.water?.dropletDensityHz, fallback.water.dropletDensityHz, 0, 80),
      lowDensityHz: clampNumberOr(source.water?.lowDensityHz, fallback.water.lowDensityHz, 0, 80),
      midDensityHz: clampNumberOr(source.water?.midDensityHz, fallback.water.midDensityHz, 0, 80),
      highDensityHz: clampNumberOr(source.water?.highDensityHz, fallback.water.highDensityHz, 0, 80),
      dropletGain01: clampNumberOr(source.water?.dropletGain01, fallback.water.dropletGain01, 0, 0.32),
      brightness01: clampNumberOr(source.water?.brightness01, fallback.water.brightness01, 0, 1),
      lowLevel01: clampNumberOr(source.water?.lowLevel01, fallback.water.lowLevel01, 0, 1),
      midLevel01: clampNumberOr(source.water?.midLevel01, fallback.water.midLevel01, 0, 1),
      highLevel01: clampNumberOr(source.water?.highLevel01, fallback.water.highLevel01, 0, 1),
    },
    wind: {
      bodyLevel01: clampNumberOr(source.wind?.bodyLevel01, fallback.wind.bodyLevel01, 0, 0.22),
      midLevel01: clampNumberOr(source.wind?.midLevel01, fallback.wind.midLevel01, 0, 0.22),
      midHighLevel01: clampNumberOr(source.wind?.midHighLevel01, fallback.wind.midHighLevel01, 0, 0.18),
      highLevel01: clampNumberOr(source.wind?.highLevel01, fallback.wind.highLevel01, 0, 0.2),
      airLevel01: clampNumberOr(source.wind?.airLevel01, fallback.wind.airLevel01, 0, 0.16),
      dryLevelScale01: clampNumberOr(source.wind?.dryLevelScale01, fallback.wind.dryLevelScale01, 0, 1),
      formantSourceScale01: clampNumberOr(
        source.wind?.formantSourceScale01,
        fallback.wind.formantSourceScale01,
        0,
        2,
      ),
      bodyCenterHz: clampNumberOr(source.wind?.bodyCenterHz, fallback.wind.bodyCenterHz, 40, sampleRate * 0.42),
      midCenterHz: clampNumberOr(source.wind?.midCenterHz, fallback.wind.midCenterHz, 80, sampleRate * 0.42),
      midHighCenterHz: clampNumberOr(source.wind?.midHighCenterHz, fallback.wind.midHighCenterHz, 120, sampleRate * 0.42),
      highCenterHz: clampNumberOr(source.wind?.highCenterHz, fallback.wind.highCenterHz, 160, sampleRate * 0.42),
      airCenterHz: clampNumberOr(source.wind?.airCenterHz, fallback.wind.airCenterHz, 240, sampleRate * 0.42),
      bodyQ: clampNumberOr(source.wind?.bodyQ, fallback.wind.bodyQ, 0.2, 24),
      midQ: clampNumberOr(source.wind?.midQ, fallback.wind.midQ, 0.2, 24),
      midHighQ: clampNumberOr(source.wind?.midHighQ, fallback.wind.midHighQ, 0.2, 30),
      highQ: clampNumberOr(source.wind?.highQ, fallback.wind.highQ, 0.2, 30),
      airQ: clampNumberOr(source.wind?.airQ, fallback.wind.airQ, 0.2, 30),
    },
    rainGranular: {
      densityHz: clampNumberOr(source.rainGranular?.densityHz, fallback.rainGranular.densityHz, 0, 96),
      gain01: clampNumberOr(source.rainGranular?.gain01, fallback.rainGranular.gain01, 0, 0.24),
      brightness01: clampNumberOr(source.rainGranular?.brightness01, fallback.rainGranular.brightness01, 0, 1),
      grainDurationSeconds: clampNumberOr(
        source.rainGranular?.grainDurationSeconds,
        fallback.rainGranular.grainDurationSeconds,
        0.008,
        0.25,
      ),
      playbackRate01: clampNumberOr(source.rainGranular?.playbackRate01, fallback.rainGranular.playbackRate01, 0, 1),
      stereoSpread01: clampNumberOr(source.rainGranular?.stereoSpread01, fallback.rainGranular.stereoSpread01, 0, 1),
      offsetDrift01: clampNumberOr(source.rainGranular?.offsetDrift01, fallback.rainGranular.offsetDrift01, 0, 1),
      airAbsorbHz: clampNumberOr(
        source.rainGranular?.airAbsorbHz,
        fallback.rainGranular.airAbsorbHz,
        500,
        sampleRate * 0.45,
      ),
    },
    acoustic: {
      reverbWet01: clampNumberOr(source.acoustic?.reverbWet01, DEFAULT_ACOUSTIC.reverbWet01, 0, 1),
      reverbSize: clampNumberOr(source.acoustic?.reverbSize, DEFAULT_ACOUSTIC.reverbSize, 0.3, 8),
      distance01: clampNumberOr(source.acoustic?.distance01, DEFAULT_ACOUSTIC.distance01, 0, 1),
      airAbsorbHz: clampNumberOr(source.acoustic?.airAbsorbHz, DEFAULT_ACOUSTIC.airAbsorbHz, 500, sampleRate * 0.45),
    },
  };
}

function createDefaultContinuousParams() {
  return {
    active: false,
    water: {
      noiseFloorGain01: 0,
      dropletDensityHz: 0,
      lowDensityHz: 0,
      midDensityHz: 0,
      highDensityHz: 0,
      dropletGain01: 0,
      brightness01: 0,
      lowLevel01: 0,
      midLevel01: 0,
      highLevel01: 0,
    },
    wind: {
      bodyLevel01: 0,
      midLevel01: 0,
      midHighLevel01: 0,
      highLevel01: 0,
      airLevel01: 0,
      dryLevelScale01: 0.34,
      formantSourceScale01: 0.58,
      bodyCenterHz: 180,
      midCenterHz: 900,
      midHighCenterHz: 1800,
      highCenterHz: 3200,
      airCenterHz: 6400,
      bodyQ: 0.7,
      midQ: 1.2,
      midHighQ: 4,
      highQ: 3,
      airQ: 6,
    },
    rainGranular: {
      densityHz: 0,
      gain01: 0,
      brightness01: 0,
      grainDurationSeconds: 0.045,
      playbackRate01: 0.45,
      stereoSpread01: 0,
      offsetDrift01: 0,
      airAbsorbHz: 7000,
    },
    acoustic: { ...DEFAULT_ACOUSTIC },
  };
}

function createNoiseState(seed) {
  return {
    water: createPinkNoiseState(seed + 13),
    waterRumble: createPinkNoiseState(seed + 31),
    wind: createPinkNoiseState(seed + 97),
  };
}

function createRainGranularBuffers() {
  return [
    createRainGranularBuffer(0x9e3779b9, 0),
    createRainGranularBuffer(0x85ebca6b, 1),
    createRainGranularBuffer(0xc2b2ae35, 2),
    createRainGranularBuffer(0x27d4eb2d, 3),
  ];
}

function createRainGranularBuffer(seed, profile) {
  const buffer = new Float32Array(Math.max(1, Math.round(RAIN_GRANULAR_BUFFER_SECONDS * sampleRate)));
  const state = { randomState: seed >>> 0 };
  let low = 0;
  let mid = 0;
  let sheen = 0;
  let slow = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const white = nextWhiteNoise(state);
    low += 0.0016 * (white - low);
    mid += 0.018 * (white - mid);
    sheen += 0.19 * (white - sheen);
    slow += 0.00042 * (white - slow);
    const high = white - mid;
    const air = sheen - low * 0.18;
    const sheet = white - slow;

    if (profile === 0) {
      const mist = high * 0.74 + air * 0.38 + (white - sheen) * 0.12;
      buffer[index] = mist;
    } else if (profile === 1) {
      const rainSheet = sheet * 0.68 + mid * 0.24 + air * 0.1;
      buffer[index] = rainSheet;
    } else if (profile === 2) {
      const bead = Math.tanh((high * 1.9 + Math.sin(index * 0.037 + low * 5.2) * 0.28) * 1.55);
      buffer[index] = bead * 0.72 + air * 0.2 + high * 0.14;
    } else {
      const surface = mid * 0.46 + slow * 0.28 + sheet * 0.18 + high * 0.12;
      buffer[index] = surface;
    }
  }

  normalizeRainBuffer(buffer, rainGranularProfileRms(profile));
  return buffer;
}

function rainGranularProfileMaterial(profile) {
  return RAIN_GRANULAR_PROFILE_MATERIALS[profile] ?? RAIN_GRANULAR_PROFILE_MATERIALS[0];
}

function rainGranularProfileRms(profile) {
  if (profile === 0) {
    return 0.22;
  }
  if (profile === 1) {
    return 0.3;
  }
  if (profile === 2) {
    return 0.25;
  }
  return 0.32;
}

function normalizeRainBuffer(buffer, targetRms) {
  let sumSquares = 0;
  for (const sample of buffer) {
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, buffer.length)) || 1;
  const gain = targetRms / rms;
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = clamp(buffer[index] * gain, -1, 1);
  }
}

function createPinkNoiseState(seed) {
  return {
    randomState: seed >>> 0,
    b0: 0,
    b1: 0,
    b2: 0,
    b3: 0,
    b4: 0,
    b5: 0,
    b6: 0,
  };
}

function nextWhiteNoise(state) {
  state.randomState = (1664525 * state.randomState + 1013904223) >>> 0;
  return state.randomState / 2147483647 - 1;
}

function nextPinkNoise(state) {
  const white = nextWhiteNoise(state);
  state.b0 = 0.99886 * state.b0 + white * 0.0555179;
  state.b1 = 0.99332 * state.b1 + white * 0.0750759;
  state.b2 = 0.969 * state.b2 + white * 0.153852;
  state.b3 = 0.8665 * state.b3 + white * 0.3104856;
  state.b4 = 0.55 * state.b4 + white * 0.5329522;
  state.b5 = -0.7616 * state.b5 - white * 0.016898;
  const value = state.b0 + state.b1 + state.b2 + state.b3 + state.b4 + state.b5 + state.b6 + white * 0.5362;
  state.b6 = white * 0.115926;
  return clamp(value * 0.12, -1, 1);
}

function createFilterBank() {
  return {
    waterRumble: {
      slow: 0,
      fast: 0,
    },
    waterBody: createSvfState(),
    waterLow: createSvfState(),
    waterMid: createSvfState(),
    waterHigh: createSvfState(),
    windBody: createSvfState(),
    windMid: createSvfState(),
    windMidHigh: createSvfState(),
    windHigh: createSvfState(),
    windAir: createSvfState(),
  };
}

function processWaterRumble(state, input) {
  state.slow += 0.0012 * (input - state.slow);
  state.fast += 0.0095 * (input - state.fast);
  return clamp((state.fast - state.slow) * 2.7 + state.slow * 0.35, -1, 1);
}

function createSvfState() {
  return {
    ic1eq: 0,
    ic2eq: 0,
  };
}

function processBandpass(state, input, frequencyHz, q) {
  const frequency = clamp(frequencyHz, 20, sampleRate * 0.45);
  const safeQ = clamp(q, 0.2, 30);
  const g = Math.tan(Math.PI * frequency / sampleRate);
  const k = 1 / safeQ;
  const denominator = 1 + g * (g + k);
  const highpass = (input - (g + k) * state.ic1eq - state.ic2eq) / denominator;
  const bandpass = g * highpass + state.ic1eq;
  const lowpass = g * bandpass + state.ic2eq;
  state.ic1eq = g * highpass + bandpass;
  state.ic2eq = g * bandpass + lowpass;
  return clamp(bandpass, -1, 1);
}

function waterBandGain(water, band) {
  if (band === "low") {
    return water.lowLevel01;
  }
  if (band === "mid") {
    return water.midLevel01;
  }
  return water.highLevel01;
}

function createReverbTank(size) {
  const tank = {
    size: clamp(size, 0.3, 8),
    sizeTarget: clamp(size, 0.3, 8),
    inputDiffusers: [
      createAllpassDiffuser(0.0089, 0.62),
      createAllpassDiffuser(0.0137, 0.56),
    ],
    leftCombs: [
      createDampedComb(0.041, 0.52, 7600, 0.28),
      createDampedComb(0.057, 0.48, 5200, 0.24),
      createDampedComb(0.073, 0.43, 3600, 0.22),
      createDampedComb(0.091, 0.38, 2500, 0.18),
    ],
    rightCombs: [
      createDampedComb(0.047, 0.5, 6900, 0.27),
      createDampedComb(0.063, 0.46, 4700, 0.24),
      createDampedComb(0.081, 0.41, 3200, 0.21),
      createDampedComb(0.099, 0.36, 2300, 0.18),
    ],
    leftDiffuser: createAllpassDiffuser(0.019, 0.42),
    rightDiffuser: createAllpassDiffuser(0.023, 0.39),
  };
  updateReverbCombFeedback(tank);
  return tank;
}

function smoothReverbSizeForBlock(tank, blockSampleCount) {
  const smoothCoefficient = coefficientForBlock(REVERB_SIZE_SMOOTH_COEFFICIENT, blockSampleCount);
  const nextSize = tank.size + (tank.sizeTarget - tank.size) * smoothCoefficient;
  if (Math.abs(nextSize - tank.size) > 0.00001) {
    tank.size = nextSize;
    updateReverbCombFeedback(tank);
  }
}

function updateReverbCombFeedback(tank) {
  const sizeNorm = clamp((tank.size - 0.3) / 7.7, 0, 1);
  for (const comb of tank.leftCombs) {
    comb.feedbackGain = clamp(comb.baseFeedbackGain + sizeNorm * 0.24, 0.12, 0.86);
  }
  for (const comb of tank.rightCombs) {
    comb.feedbackGain = clamp(comb.baseFeedbackGain + sizeNorm * 0.24, 0.12, 0.86);
  }
}

function processReverbTank(tank, input) {
  let diffused = input;
  for (const diffuser of tank.inputDiffusers) {
    diffused = processAllpassDiffuser(diffuser, diffused);
  }

  let left = 0;
  for (const comb of tank.leftCombs) {
    left += processDampedComb(comb, diffused);
  }

  let right = 0;
  for (const comb of tank.rightCombs) {
    right += processDampedComb(comb, diffused);
  }

  return {
    left: processAllpassDiffuser(tank.leftDiffuser, left),
    right: processAllpassDiffuser(tank.rightDiffuser, right),
  };
}

function createAllpassDiffuser(delaySeconds, feedbackGain) {
  return {
    buffer: new Float32Array(Math.max(1, Math.round(delaySeconds * sampleRate))),
    index: 0,
    feedbackGain,
  };
}

function processAllpassDiffuser(diffuser, input) {
  const delayed = diffuser.buffer[diffuser.index] ?? 0;
  const output = delayed - diffuser.feedbackGain * input;
  diffuser.buffer[diffuser.index] = input + diffuser.feedbackGain * output;
  diffuser.index = (diffuser.index + 1) % diffuser.buffer.length;
  return output;
}

function createDampedComb(delaySeconds, feedbackGain, dampingHz, outputGain) {
  return {
    buffer: new Float32Array(Math.max(1, Math.round(delaySeconds * sampleRate))),
    index: 0,
    baseFeedbackGain: feedbackGain,
    feedbackGain,
    outputGain,
    dampingCoefficient: onePoleCoefficient(dampingHz),
    filterState: 0,
  };
}

function processDampedComb(comb, input) {
  const delayed = comb.buffer[comb.index] ?? 0;
  comb.filterState += comb.dampingCoefficient * (delayed - comb.filterState);
  comb.buffer[comb.index] = input + comb.filterState * comb.feedbackGain;
  comb.index = (comb.index + 1) % comb.buffer.length;
  return comb.filterState * comb.outputGain;
}

function nextSignedVoiceNoise(voice) {
  voice.randomState = (1664525 * voice.randomState + 1013904223) >>> 0;
  return voice.randomState / 2147483647 - 1;
}

function readCircularInterpolated(buffer, index) {
  const floorIndex = Math.floor(index);
  const nextIndex = (floorIndex + 1) % buffer.length;
  const amount = index - floorIndex;
  return buffer[floorIndex] * (1 - amount) + buffer[nextIndex] * amount;
}

function onePoleCoefficient(frequencyHz) {
  return clamp(1 - Math.exp((-TWO_PI * clamp(frequencyHz, 20, sampleRate * 0.45)) / sampleRate), 0.0001, 0.94);
}

function smoothingCoefficientForSeconds(seconds) {
  return clamp(1 - Math.exp(-1 / (Math.max(1, sampleRate) * Math.max(0.001, seconds))), 0.000001, 0.5);
}

function sanitizeSeed(seed, startSample, frequencyHz) {
  if (Number.isFinite(seed) && seed > 0) {
    return Math.floor(seed) >>> 0;
  }
  return (Math.imul(startSample, 1664525) ^ Math.floor(frequencyHz * 1009) ^ 0x9e3779b9) >>> 0;
}

function hash01(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function softClip(value) {
  return Math.tanh(value);
}

function clampNumberOr(value, fallback, min, max) {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mirrorLeftToExtraChannels(output, leftOutput) {
  if (!output || !leftOutput) {
    return;
  }

  for (let channelIndex = 1; channelIndex < output.length; channelIndex += 1) {
    if (output[channelIndex] !== leftOutput && output[channelIndex]?.every((sample) => sample === 0)) {
      output[channelIndex]?.set(leftOutput);
    }
  }
}

registerProcessor("penumbra-earth-texture", PenumbraEarthTextureProcessor);
