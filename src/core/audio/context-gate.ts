export async function createAudioContextFromUserGesture(): Promise<AudioContext> {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Web Audio is not available in this browser.");
  }

  const audioContext = new AudioContextConstructor();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  return audioContext;
}
