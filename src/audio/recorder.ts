import { RecorderStatus } from '../types.js';

export interface AudioRecorder {
  startSystemAudio(): Promise<NodeJS.ReadableStream>;
  startMicrophone(): Promise<NodeJS.ReadableStream>;
  stop(): Promise<void>;
  getStatus(): RecorderStatus;
}
