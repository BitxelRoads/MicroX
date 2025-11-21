export interface AnalysisFrame {
  timestamp: string;
  dominant_emotion: string;
  confidence: number;
  micro_expression: string | null; // Detects fleeting expressions < 0.5s
  active_aus: string[]; // FACS Action Units e.g., "AU4", "AU12"
  incongruence: boolean; // Mismatch between audio tone and face
  baseline_deviation: number; // 0-100 scale
  analysis_summary: string;
}

export interface SessionMetrics {
  totalFrames: number;
  incongruenceCount: number;
  dominantCluster: string;
  baselineStress: number;
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

// Chart data types
export interface EmotionDataPoint {
  time: string;
  intensity: number;
  emotion: string;
}

export interface AUDataPoint {
  au: string;
  value: number; // Frequency or Intensity
}