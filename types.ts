export interface Language {
  code: string;
  name: string;
  flag: string;
}

export interface TranscriptionItem {
  id: string;
  originalText: string;
  translatedText: string;
  isFinal: boolean;
  timestamp: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Helper type for Audio Work
export interface AudioWorkletNode extends AudioNode {
  port: MessagePort;
  parameters: AudioParamMap;
}