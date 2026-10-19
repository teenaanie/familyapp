// Browser-only: captures the microphone and streams it to OpenAI live transcription,
// reporting words as they arrive. Capture starts immediately; audio spoken before the
// connection is ready is queued and sent once it opens. A WAV copy is kept so the
// recording can still be transcribed the slow way if the live connection fails.

const RATE = 24000; // what the transcription session expects (16-bit mono PCM)
const CHUNK = RATE / 10; // send every 100 ms

// Copies raw microphone samples off the audio thread.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("capture", Capture);
`;

export interface LiveResult {
  /** Final transcript from the live connection, or null if it never worked. */
  text: string | null;
  /** The recording as WAV, for transcribing another way when live failed. */
  audio: Blob;
}

export interface LiveSession {
  stop(): Promise<LiveResult>;
  cancel(): void;
}

function toBase64(int16: Int16Array) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Linear resample from the context's rate to 24 kHz (a no-op when it's already 24 kHz). */
function resample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === RATE) return input;
  const ratio = fromRate / RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (input[j] ?? 0) * (1 - f) + (input[j + 1] ?? input[j] ?? 0) * f;
  }
  return out;
}

function toWav(chunks: Int16Array[]): Blob {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const header = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => header.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  header.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, RATE, true);
  header.setUint32(28, RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  str(36, "data");
  header.setUint32(40, samples * 2, true);
  return new Blob([header.buffer, ...chunks.map((c) => c.buffer as ArrayBuffer)], { type: "audio/wav" });
}

let workletUrl: string | null = null;

export async function startLive(
  stream: MediaStream,
  ctx: AudioContext,
  key: Promise<string>,
  onText: (text: string) => void,
): Promise<LiveSession> {
  workletUrl ??= URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(workletUrl);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "capture");
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute).connect(ctx.destination); // keeps the graph pulling audio on every browser

  const recorded: Int16Array[] = [];
  const queue: string[] = []; // messages waiting for the connection
  let ws: WebSocket | null = null;
  let liveFailed = false;
  let text = "";
  // Set by stop(); called when the final transcript (or a failure) arrives.
  const done: { finish: ((t: string | null) => void) | null } = { finish: null };

  const sendOrQueue = (msg: string) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
    else if (!liveFailed) queue.push(msg);
  };

  // Connect in the background while the person is already speaking.
  void (async () => {
    try {
      const k = await key;
      const socket = new WebSocket("wss://api.openai.com/v1/realtime", ["realtime", `openai-insecure-api-key.${k}`]);
      ws = socket;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 6000);
        socket.onopen = () => (clearTimeout(t), resolve());
        socket.onerror = () => (clearTimeout(t), reject(new Error("error")));
      });
      socket.onmessage = (e) => {
        const ev = JSON.parse(e.data);
        if (ev.type === "conversation.item.input_audio_transcription.delta") {
          text += ev.delta;
          onText(text.trim());
        } else if (ev.type === "conversation.item.input_audio_transcription.completed") {
          done.finish?.(ev.transcript?.trim() || text.trim());
        } else if (ev.type === "error") {
          done.finish?.(text.trim() || null);
        }
      };
      socket.onclose = () => done.finish?.(text.trim() || null);
      for (const m of queue.splice(0)) socket.send(m);
    } catch {
      liveFailed = true;
      queue.length = 0;
      done.finish?.(null);
    }
  })();

  let pending = new Float32Array(0);
  const send = (samples: Float32Array) => {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
    recorded.push(pcm);
    sendOrQueue(JSON.stringify({ type: "input_audio_buffer.append", audio: toBase64(pcm) }));
  };
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const chunk = resample(e.data, ctx.sampleRate);
    const merged = new Float32Array(pending.length + chunk.length);
    merged.set(pending);
    merged.set(chunk, pending.length);
    pending = merged;
    while (pending.length >= CHUNK) {
      send(pending.subarray(0, CHUNK));
      pending = pending.slice(CHUNK);
    }
  };

  const teardown = () => {
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  };

  return {
    async stop() {
      node.port.onmessage = null;
      if (pending.length) send(pending);
      const final = liveFailed
        ? null
        : await new Promise<string | null>((resolve) => {
            // If the connection is still opening, give it a moment to catch up on the queue.
            const t = setTimeout(() => resolve(text.trim() || null), 5000);
            done.finish = (s) => {
              clearTimeout(t);
              resolve(s);
            };
            sendOrQueue(JSON.stringify({ type: "input_audio_buffer.commit" }));
          });
      teardown();
      return { text: final, audio: toWav(recorded) };
    },
    cancel: teardown,
  };
}
