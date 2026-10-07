// Records a captured tab track (plus an optional microphone track) into a standard,
// non-fragmented H.264 MP4. Frames are redrawn onto a fixed-size canvas, so the video
// size never changes mid-recording, even when the page resizes.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';

const AVC_CODECS = ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.4D0034', 'avc1.42003E'];
// AAC first: QuickTime does not play Opus inside MP4.
const AUDIO_CODECS = [
  { codec: 'mp4a.40.2', mux: 'aac' },
  { codec: 'opus', mux: 'opus' },
];
const KEYFRAME_EVERY_S = 2;
const MAX_QUEUE = 4;
const AUDIO_BITRATE = 160_000;

async function pickVideoConfig(width, height, fps, bitrate) {
  for (const codec of AVC_CODECS) {
    const config = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      // try the next profile
    }
  }
  throw new Error(`Chrome cannot encode a ${width}×${height} video`);
}

async function pickAudioConfig(sampleRate, numberOfChannels) {
  for (const { codec, mux } of AUDIO_CODECS) {
    const config = { codec, sampleRate, numberOfChannels, bitrate: AUDIO_BITRATE };
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) return { config, mux };
    } catch {
      // try the next codec
    }
  }
  return null;
}

/**
 * render(ctx, frame) draws the latest captured VideoFrame onto the output canvas.
 * bitsPerPixel scales the video bitrate (quality preset).
 */
export async function createRecorder({ track, audioTrack, width, height, fps, bitsPerPixel, render }) {
  const bitrate = Math.min(50e6, Math.max(4e6, width * height * fps * bitsPerPixel));
  const videoConfig = await pickVideoConfig(width, height, fps, bitrate);

  let audio = null;
  if (audioTrack) {
    const { sampleRate = 48000, channelCount = 1 } = audioTrack.getSettings();
    const channels = Math.min(2, channelCount || 1);
    const picked = await pickAudioConfig(sampleRate, channels);
    if (picked) audio = { ...picked, sampleRate, channels };
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(audio && { audio: { codec: audio.mux, sampleRate: audio.sampleRate, numberOfChannels: audio.channels } }),
    fastStart: 'in-memory',
    // Both tracks are stamped on the same clock (µs since start).
    firstTimestampBehavior: 'cross-track-offset',
  });

  let failure = null;
  const fail = (err) => (failure ??= err);
  const videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail });
  videoEncoder.configure(videoConfig);

  const start = performance.now();
  const sinceStart = () => Math.round((performance.now() - start) * 1000);
  let stopped = false;
  const readers = [];

  // --- video: keep the newest captured frame, encode at a steady rate ---
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const videoReader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  readers.push(videoReader);
  let latest = null;
  (async () => {
    while (!stopped) {
      const { value, done } = await videoReader.read();
      if (done) break;
      latest?.close();
      latest = value;
    }
  })().catch(fail);

  let count = 0;
  const timer = setInterval(() => {
    if (stopped || !latest || failure || videoEncoder.encodeQueueSize > MAX_QUEUE) return;
    let frame = null;
    try {
      render(ctx, latest);
      frame = new VideoFrame(canvas, { timestamp: sinceStart() });
      videoEncoder.encode(frame, { keyFrame: count % (fps * KEYFRAME_EVERY_S) === 0 });
      count++;
    } catch (err) {
      fail(err);
    } finally {
      frame?.close();
    }
  }, 1000 / fps);

  // --- audio: re-stamp microphone samples onto the video clock ---
  let audioEncoder = null;
  if (audio) {
    audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: fail });
    audioEncoder.configure(audio.config);
    const audioReader = new MediaStreamTrackProcessor({ track: audioTrack }).readable.getReader();
    readers.push(audioReader);
    (async () => {
      let base = null;
      let samples = 0;
      while (!stopped) {
        const { value, done } = await audioReader.read();
        if (done) break;
        if (failure) {
          value.close();
          continue;
        }
        base ??= sinceStart();
        const frames = value.numberOfFrames;
        const data = new Float32Array(frames * audio.channels);
        try {
          value.copyTo(data, { planeIndex: 0, format: 'f32' });
        } finally {
          value.close();
        }
        const stamped = new AudioData({
          format: 'f32',
          sampleRate: audio.sampleRate,
          numberOfFrames: frames,
          numberOfChannels: audio.channels,
          timestamp: base + Math.round((samples / audio.sampleRate) * 1e6),
          data,
        });
        samples += frames;
        try {
          audioEncoder.encode(stamped);
        } finally {
          stamped.close();
        }
      }
    })().catch(fail);
  }

  const closeEncoder = (enc) => enc && enc.state !== 'closed' && enc.close();
  let stopping = null;

  return {
    hasAudio: !!audio,
    // Safe to call more than once; encoders are released on every path.
    stop() {
      stopping ??= (async () => {
        stopped = true;
        clearInterval(timer);
        await Promise.all(readers.map((r) => r.cancel().catch(() => {
          // The stream already ended: nothing left to cancel.
        })));
        latest?.close();
        latest = null;
        try {
          if (failure) throw failure;
          await videoEncoder.flush();
          if (audioEncoder) await audioEncoder.flush();
          if (failure) throw failure;
          if (!count) throw new Error('No video frames were captured');
          muxer.finalize();
          return new Blob([muxer.target.buffer], { type: 'video/mp4' });
        } finally {
          closeEncoder(videoEncoder);
          closeEncoder(audioEncoder);
        }
      })();
      return stopping;
    },
  };
}
