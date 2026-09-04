import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SAMPLE_RATE = 44100;
const outputDir = resolve('assets/sounds');
mkdirSync(outputDir, { recursive: true });

function envelope(position, length, attack = 0.015, release = 0.06) {
  const attackSamples = Math.max(1, Math.floor(attack * SAMPLE_RATE));
  const releaseSamples = Math.max(1, Math.floor(release * SAMPLE_RATE));
  if (position < attackSamples) return position / attackSamples;
  if (position > length - releaseSamples) return Math.max(0, (length - position) / releaseSamples);
  return 1;
}

function sine(frequency, seconds, amplitude = 0.35, options = {}) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const samples = new Float32Array(length);
  const endFrequency = options.endFrequency ?? frequency;
  for (let index = 0; index < length; index += 1) {
    const progress = index / Math.max(1, length - 1);
    const currentFrequency = frequency + (endFrequency - frequency) * progress;
    const phase = 2 * Math.PI * currentFrequency * index / SAMPLE_RATE;
    samples[index] = Math.sin(phase) * amplitude * envelope(index, length, options.attack, options.release);
  }
  return samples;
}

function mix(duration, layers) {
  const output = new Float32Array(Math.floor(duration * SAMPLE_RATE));
  for (const { at, samples } of layers) {
    const offset = Math.floor(at * SAMPLE_RATE);
    samples.forEach((sample, index) => {
      if (offset + index < output.length) output[offset + index] += sample;
    });
  }
  return output;
}

function writeWav(fileName, samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm.writeInt16LE(Math.round(clamped * 32767), index * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(resolve(outputDir, fileName), Buffer.concat([header, pcm]));
}

writeWav('select.wav', sine(740, 0.10, 0.28, { endFrequency: 890, attack: 0.005, release: 0.05 }));
writeWav('connect.wav', mix(0.22, [
  { at: 0, samples: sine(370, 0.20, 0.25, { endFrequency: 660, attack: 0.005, release: 0.08 }) },
  { at: 0.05, samples: sine(990, 0.12, 0.10, { attack: 0.005, release: 0.06 }) },
]));
writeWav('claim.wav', mix(0.42, [
  { at: 0, samples: sine(523.25, 0.25, 0.22, { attack: 0.004, release: 0.09 }) },
  { at: 0.08, samples: sine(659.25, 0.25, 0.22, { attack: 0.004, release: 0.09 }) },
  { at: 0.16, samples: sine(783.99, 0.24, 0.21, { attack: 0.004, release: 0.09 }) },
]));
writeWav('rival.wav', mix(0.20, [
  { at: 0, samples: sine(330, 0.19, 0.24, { endFrequency: 245, attack: 0.006, release: 0.08 }) },
  { at: 0.02, samples: sine(165, 0.17, 0.10, { attack: 0.004, release: 0.08 }) },
]));
writeWav('invalid.wav', sine(185, 0.16, 0.22, { endFrequency: 150, attack: 0.004, release: 0.08 }));
writeWav('victory.wav', mix(0.78, [
  { at: 0, samples: sine(523.25, 0.28, 0.20, { attack: 0.004, release: 0.08 }) },
  { at: 0.12, samples: sine(659.25, 0.28, 0.20, { attack: 0.004, release: 0.08 }) },
  { at: 0.24, samples: sine(783.99, 0.28, 0.20, { attack: 0.004, release: 0.08 }) },
  { at: 0.38, samples: sine(1046.5, 0.36, 0.23, { attack: 0.004, release: 0.14 }) },
]));
writeWav('defeat.wav', mix(0.42, [
  { at: 0, samples: sine(330, 0.27, 0.20, { attack: 0.004, release: 0.10 }) },
  { at: 0.12, samples: sine(247, 0.28, 0.20, { attack: 0.004, release: 0.11 }) },
]));

console.log(`Generated sound assets in ${dirname(resolve(outputDir, 'select.wav'))}`);
