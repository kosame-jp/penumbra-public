/* global AudioWorkletProcessor, registerProcessor, currentFrame, sampleRate */

const MAX_ACTIVE_VOICES = 56;
const TWO_PI = Math.PI * 2;
const WORKLET_REVERB_OUTPUT_GAIN = 1.6;
const DIAGNOSTIC_PROBE_PERIOD_SAMPLES = Math.round(sampleRate * 1.2);
const DIAGNOSTIC_PROBE_DURATION_SAMPLES = Math.round(sampleRate * 0.038);
const STEAL_FADE_SAMPLES = Math.max(1, Math.round(sampleRate * 0.024));
const ZERO_WET_SAMPLE = { left: 0, right: 0 };

class PenumbraHumanLayerProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.audioDebugMode = options.processorOptions?.audioDebugMode ?? "off";
    this.voices = [];
    this.reverbEnabled = false;
    this.maxActiveVoices = MAX_ACTIVE_VOICES;
    this.maxPartialsPerVoice = 4;
    this.reverbTank = createStereoReverbTank();
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "pluck") {
        this.enqueuePluck(message);
      } else if (message?.type === "diagnostics") {
        this.applyDiagnostics(message);
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const leftOutput = output?.[0];
    const rightOutput = output?.[1];
    if (!leftOutput) {
      return true;
    }

    leftOutput.fill(0);
    rightOutput?.fill(0);
    for (let sampleIndex = 0; sampleIndex < leftOutput.length; sampleIndex += 1) {
      const absoluteSample = currentFrame + sampleIndex;
      let drySampleValue = 0;
      let reverbInputValue = 0;
      const reverbEnabled = this.reverbEnabled;

      for (let voiceIndex = this.voices.length - 1; voiceIndex >= 0; voiceIndex -= 1) {
        const voice = this.voices[voiceIndex];
        const regularEndSample = reverbEnabled ? voice.endSample : voice.startSample + voice.drySamples;
        const effectiveEndSample = voice.stealFadeEndSample ?? regularEndSample;
        if (absoluteSample > effectiveEndSample) {
          this.voices.splice(voiceIndex, 1);
          continue;
        }

        if (absoluteSample < voice.startSample) {
          continue;
        }

        const localSample = absoluteSample - voice.startSample;
        const envelope = pluckEnvelopeAtSample(voice, localSample);
        const reverbEnvelope = reverbEnabled ? reverbEnvelopeAtSample(voice, localSample) : 0;
        const stealGain = stealFadeGainAtSample(voice, absoluteSample);
        if (
          envelope <= 0.000001 &&
          (!reverbEnabled ||
            (reverbEnvelope <= 0.000001 && Math.abs(voice.reverbDampingState) <= 0.000001))
        ) {
          continue;
        }

        let raw = 0;
        for (const partial of voice.partials) {
          raw += Math.sin(partial.phase) * partial.gain01 * partialEnvelopeAtSample(voice, partial, localSample);
          partial.phase += partial.phaseIncrement;
          if (partial.phase > TWO_PI) {
            partial.phase -= TWO_PI;
          }
        }

        if (voice.noiseGain01 > 0.0001) {
          const noiseEnvelope = Math.max(0, 1 - localSample / voice.noiseSamples);
          raw += (nextNoise(voice) * 2 - 1) * voice.noiseGain01 * noiseEnvelope;
        }

        voice.filterState += voice.lowpassCoefficient * (raw - voice.filterState);
        const drySample = voice.filterState * envelope * stealGain;
        drySampleValue += drySample;
        if (reverbEnabled && voice.reverbSend01 > 0.0001) {
          const wetExcitation = voice.filterState * reverbEnvelope;
          voice.reverbDampingState += voice.reverbDampingCoefficient * (wetExcitation - voice.reverbDampingState);
          reverbInputValue += voice.reverbDampingState * voice.reverbSend01 * stealGain;
        }
      }

      if (reverbEnabled && this.audioDebugMode === "human-reverb-solo") {
        reverbInputValue += diagnosticReverbProbeAtSample(absoluteSample);
      }

      const wet = reverbEnabled
        ? processStereoReverbTank(this.reverbTank, reverbInputValue)
        : ZERO_WET_SAMPLE;
      const dryForOutput = this.audioDebugMode === "human-reverb-solo" ? 0 : drySampleValue;
      leftOutput[sampleIndex] = Math.tanh(dryForOutput + wet.left * WORKLET_REVERB_OUTPUT_GAIN);
      if (rightOutput) {
        rightOutput[sampleIndex] = Math.tanh(dryForOutput + wet.right * WORKLET_REVERB_OUTPUT_GAIN);
      }
    }

    mirrorLeftToExtraChannels(output, leftOutput);

    return true;
  }

  enqueuePluck(message) {
    const startSample = Math.max(currentFrame, Math.round(message.startTimeSeconds * sampleRate));
    const attackSamples = Math.max(1, Math.round(message.attackSeconds * sampleRate));
    const decaySamples = Math.max(1, Math.round(message.decaySeconds * sampleRate));
    const releaseSamples = Math.round(0.08 * sampleRate);
    const reverbTailSamples = this.reverbEnabled
      ? Math.max(1, Math.round(clamp(message.reverbTailSeconds ?? 0.24, 0.08, 5) * sampleRate))
      : 0;
    const drySamples = attackSamples + decaySamples + releaseSamples;
    const endSample = startSample + drySamples + reverbTailSamples;
    const lowpassCoefficient = clamp(
      1 - Math.exp((-TWO_PI * clamp(message.lowpassHz, 40, sampleRate * 0.45)) / sampleRate),
      0.001,
      0.96,
    );
    const reverbDampingCoefficient = clamp(
      1 - Math.exp((-TWO_PI * clamp(message.reverbDampingHz ?? 3600, 120, sampleRate * 0.45)) / sampleRate),
      0.001,
      0.92,
    );
    const randomSeed = sanitizeSeed(message.randomSeed, startSample, message.frequencyHz);
    const partials = message.partials.slice(0, this.maxPartialsPerVoice).map((partial, partialIndex) => {
      const frequencyHz =
        message.frequencyHz * partial.ratio * 2 ** ((partial.detuneCents ?? 0) / 1200);
      return {
        phase: hash01(randomSeed + partialIndex * 1013) * TWO_PI,
        phaseIncrement: (TWO_PI * clamp(frequencyHz, 10, sampleRate * 0.45)) / sampleRate,
        gain01: clamp(partial.gain01, 0, 1.4),
        decayScale: clamp(partial.decayScale ?? 1, 0.08, 1),
      };
    });

    this.voices.push({
      startSample,
      attackSamples,
      decaySamples,
      drySamples,
      reverbTailSamples,
      endSample,
      peakGain01: clamp(message.peakGain01, 0, 0.18),
      lowpassCoefficient,
      filterState: 0,
      noiseGain01: clamp(message.noiseGain01, 0, 0.04),
      noiseSamples: Math.max(1, Math.round(0.08 * sampleRate)),
      randomState: randomSeed,
      reverbSend01: clamp(message.reverbSend01 ?? 0, 0, 1),
      reverbDampingCoefficient,
      reverbDampingState: 0,
      partials,
      stealFadeStartSample: undefined,
      stealFadeEndSample: undefined,
    });

    this.pruneVoicesToCap();
  }

  applyDiagnostics(message) {
    this.reverbEnabled = message.reverbEnabled !== false;
    this.maxActiveVoices = clamp(
      Math.floor(Number.isFinite(message.maxActiveVoices) ? message.maxActiveVoices : MAX_ACTIVE_VOICES),
      1,
      MAX_ACTIVE_VOICES,
    );
    this.maxPartialsPerVoice = clamp(
      Math.floor(Number.isFinite(message.maxPartialsPerVoice) ? message.maxPartialsPerVoice : 4),
      1,
      4,
    );
    this.pruneVoicesToCap();
  }

  pruneVoicesToCap() {
    const nonStealingVoices = this.voices.filter((voice) => voice.stealFadeEndSample === undefined);
    if (nonStealingVoices.length <= this.maxActiveVoices) {
      return;
    }

    const excessVoiceCount = nonStealingVoices.length - this.maxActiveVoices;
    const voicesToSteal = nonStealingVoices
      .slice()
      .sort((left, right) => left.endSample - right.endSample)
      .slice(0, excessVoiceCount);

    for (const voice of voicesToSteal) {
      if (voice.startSample > currentFrame) {
        const index = this.voices.indexOf(voice);
        if (index >= 0) {
          this.voices.splice(index, 1);
        }
        continue;
      }

      voice.stealFadeStartSample = currentFrame;
      voice.stealFadeEndSample = currentFrame + STEAL_FADE_SAMPLES;
    }
  }
}

function pluckEnvelopeAtSample(voice, localSample) {
  if (localSample > voice.drySamples) {
    return 0;
  }

  if (localSample < voice.attackSamples) {
    return voice.peakGain01 * (localSample / voice.attackSamples);
  }

  const decayPosition = (localSample - voice.attackSamples) / voice.decaySamples;
  return voice.peakGain01 * Math.exp(-6.9 * Math.max(0, decayPosition));
}

function reverbEnvelopeAtSample(voice, localSample) {
  if (localSample > voice.drySamples + voice.reverbTailSamples) {
    return 0;
  }

  if (localSample < voice.attackSamples) {
    return voice.peakGain01 * (localSample / voice.attackSamples);
  }

  const decaySamples = Math.max(1, voice.decaySamples + voice.reverbTailSamples * 0.72);
  const decayPosition = (localSample - voice.attackSamples) / decaySamples;
  return voice.peakGain01 * Math.exp(-6.9 * Math.max(0, decayPosition));
}

function stealFadeGainAtSample(voice, absoluteSample) {
  if (voice.stealFadeStartSample === undefined || voice.stealFadeEndSample === undefined) {
    return 1;
  }

  if (absoluteSample <= voice.stealFadeStartSample) {
    return 1;
  }

  if (absoluteSample >= voice.stealFadeEndSample) {
    return 0;
  }

  const position =
    (absoluteSample - voice.stealFadeStartSample) /
    Math.max(1, voice.stealFadeEndSample - voice.stealFadeStartSample);
  return 1 - position * position * (3 - 2 * position);
}

function partialEnvelopeAtSample(voice, partial, localSample) {
  if (partial.decayScale >= 0.98 || localSample < voice.attackSamples) {
    return 1;
  }

  const normalizedAge = (localSample - voice.attackSamples) / voice.decaySamples;
  const shapedAge = Math.max(0, normalizedAge / partial.decayScale);
  return 1 / (1 + shapedAge ** 1.4 * 2.4);
}

function nextNoise(voice) {
  voice.randomState = (1664525 * voice.randomState + 1013904223) >>> 0;
  return voice.randomState / 4294967295;
}

function createStereoReverbTank() {
  return {
    inputDiffusers: [
      createAllpassDiffuser(0.0067, 0.62),
      createAllpassDiffuser(0.0113, 0.54),
    ],
    leftCombs: [
      createDampedComb(0.0297, 0.34, 6800, 0.32),
      createDampedComb(0.0371, 0.29, 4700, 0.25),
      createDampedComb(0.0519, 0.22, 3300, 0.2),
    ],
    rightCombs: [
      createDampedComb(0.0329, 0.32, 5900, 0.3),
      createDampedComb(0.0443, 0.27, 3900, 0.24),
      createDampedComb(0.0617, 0.2, 2800, 0.19),
    ],
    leftDiffuser: createAllpassDiffuser(0.0129, 0.42),
    rightDiffuser: createAllpassDiffuser(0.0171, 0.39),
  };
}

function processStereoReverbTank(tank, input) {
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
    feedbackGain,
    outputGain,
    dampingCoefficient: clamp(
      1 - Math.exp((-TWO_PI * clamp(dampingHz, 120, sampleRate * 0.45)) / sampleRate),
      0.001,
      0.92,
    ),
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

function diagnosticReverbProbeAtSample(absoluteSample) {
  const position = absoluteSample % DIAGNOSTIC_PROBE_PERIOD_SAMPLES;
  if (position >= DIAGNOSTIC_PROBE_DURATION_SAMPLES) {
    return 0;
  }

  const envelope = 1 - position / DIAGNOSTIC_PROBE_DURATION_SAMPLES;
  const tone = Math.sin((TWO_PI * position * 740) / sampleRate);
  const click = position < 12 ? 1 - position / 12 : 0;
  return (tone * 0.42 + click * 0.78) * envelope * 0.24;
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

function sanitizeSeed(seed, startSample, frequencyHz) {
  if (Number.isFinite(seed) && seed > 0) {
    return Math.floor(seed) >>> 0;
  }
  const mixed = Math.floor(startSample ^ Math.floor(frequencyHz * 1000));
  return (mixed * 2654435761) >>> 0;
}

function hash01(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

registerProcessor("penumbra-human-layer", PenumbraHumanLayerProcessor);
