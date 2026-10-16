// Browser-only: streams microphone audio to OpenAI live transcription and reports words as they arrive.

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

export interface LiveSession {
  /** Stop listening and return the final transcript. */
  stop(): Promise<string>;
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

export async function startLive(
  stream: MediaStream,
  ctx: AudioContext,
  key: string,
  onText: (text: string) => void,
): Promise<LiveSession> {
  const ws = new WebSocket("wss://api.openai.com/v1/realtime", ["realtime", `openai-insecure-api-key.${key}`]);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Live transcription timed out")), 6000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error("Live transcription unavailable"));
    };
  });

  let text = "";
  let finish: ((t: string) => void) | null = null;
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "conversation.item.input_audio_transcription.delta") {
      text += ev.delta;
      onText(text.trim());
    } else if (ev.type === "conversation.item.input_audio_transcription.completed") {
      finish?.(ev.transcript?.trim() || text.trim());
    } else if (ev.type === "error") {
      // e.g. committing an empty buffer when nothing was said
      finish?.(text.trim());
    }
  };

  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "capture");
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute).connect(ctx.destination); // keeps the graph pulling audio on every browser

  let pending = new Float32Array(0);
  const send = (samples: Float32Array) => {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: toBase64(pcm) }));
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
    if (ws.readyState <= WebSocket.OPEN) ws.close();
  };

  return {
    async stop() {
      node.port.onmessage = null;
      if (pending.length) send(pending);
      const final = await new Promise<string>((resolve) => {
        const t = setTimeout(() => resolve(text.trim()), 4000);
        finish = (s) => {
          clearTimeout(t);
          resolve(s);
        };
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      });
      teardown();
      return final;
    },
    cancel: teardown,
  };
}
