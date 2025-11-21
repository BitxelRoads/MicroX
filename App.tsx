import React, { useEffect, useRef, useReducer } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { AlertTriangle, Activity, Video, Mic, MicOff, StopCircle, PlayCircle, Eye, Zap } from 'lucide-react';
import { createPcmBlob } from './utils/audioUtils';
import { AnalysisFrame, ConnectionState, EmotionDataPoint } from './types';
import { EmotionTimeline, ActionUnitGraph } from './components/Charts';

// --- Constants & Tool Definition ---

const SYSTEM_INSTRUCTION = `
You are an advanced FACS (Facial Action Coding System) Expert.
Your task is to analyze the incoming video and audio stream in real-time.

**PROTOCOL:**
1. Continuously output 'report_analysis' tool calls.
2. DO NOT WAIT for user speech. Analyze the visual stream constantly.
3. If the face is neutral, report it. If there is silence, report it.
4. Focus on micro-expressions (<0.5s) and incongruence between face and probable tone.
`;

// Define the tool for structured data extraction
const analysisTool: FunctionDeclaration = {
  name: "report_analysis",
  description: "Report real-time facial analysis data to the dashboard.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      dominant_emotion: { 
        type: Type.STRING, 
        description: "The strongest emotion detected (e.g. Happy, Sad, Anger, Fear, Neutral)." 
      },
      confidence: { 
        type: Type.NUMBER, 
        description: "Confidence level 0-100." 
      },
      micro_expression: { 
        type: Type.STRING, 
        description: "Name of any fleeting expression detected, or null." 
      },
      active_aus: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING },
        description: "List of active FACS codes (e.g. AU4, AU12)."
      },
      incongruence: { 
        type: Type.BOOLEAN, 
        description: "True if face contradicts audio tone." 
      },
      baseline_deviation: { 
        type: Type.NUMBER, 
        description: "Deviation from subject's neutral state (0-100)." 
      },
      analysis_summary: { 
        type: Type.STRING, 
        description: "Short 5-word max observation." 
      }
    },
    required: ["dominant_emotion", "confidence", "active_aus", "baseline_deviation"]
  }
};

// --- Reducer for State Management ---

interface AppState {
  connectionState: ConnectionState;
  frames: AnalysisFrame[];
  currentFrame: AnalysisFrame | null;
  timelineData: EmotionDataPoint[];
  isMicOn: boolean;
}

type Action =
  | { type: 'SET_CONNECTION'; payload: ConnectionState }
  | { type: 'ADD_FRAME'; payload: AnalysisFrame }
  | { type: 'TOGGLE_MIC' }
  | { type: 'RESET' };

const initialState: AppState = {
  connectionState: ConnectionState.DISCONNECTED,
  frames: [],
  currentFrame: null,
  timelineData: [],
  isMicOn: true,
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CONNECTION':
      return { ...state, connectionState: action.payload };
    case 'ADD_FRAME':
      const newTimeline = [
        ...state.timelineData,
        { 
          time: new Date().toLocaleTimeString(), 
          intensity: action.payload.baseline_deviation, 
          emotion: action.payload.dominant_emotion 
        }
      ].slice(-60); // Keep last 60 points

      return {
        ...state,
        frames: [action.payload, ...state.frames].slice(0, 50), // Keep last 50 frames history
        currentFrame: action.payload,
        timelineData: newTimeline
      };
    case 'TOGGLE_MIC':
      return { ...state, isMicOn: !state.isMicOn };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// --- Main Component ---

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  
  // Refs for Media Handling
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  
  // GenAI Refs
  const sessionRef = useRef<any>(null); 
  const processingRef = useRef<boolean>(false); 

  // --- Connection Logic ---

  const connect = async () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("API_KEY is missing in environment variables.");
      return;
    }

    try {
      dispatch({ type: 'SET_CONNECTION', payload: ConnectionState.CONNECTING });

      // 1. Initialize Media Stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // 2. Initialize GenAI Client
      const client = new GoogleGenAI({ apiKey });
      
      // 3. Connect to Live API
      const sessionPromise = client.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO], 
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: [analysisTool] }]
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Opened");
            dispatch({ type: 'SET_CONNECTION', payload: ConnectionState.CONNECTED });
            
            sessionPromise.then(s => {
              startStreaming(s);
              // CRITICAL: Send an initial text to kickstart the model's analysis loop
              // otherwise it sits waiting for user audio.
              s.send({ parts: [{ text: "Begin continuous visual analysis." }] });
            });
          },
          onmessage: (msg: LiveServerMessage) => {
            // Handle Tool Call (Analysis Data)
            if (msg.toolCall) {
              msg.toolCall.functionCalls.forEach(fc => {
                if (fc.name === 'report_analysis') {
                  const data = fc.args as any;
                  
                  const frame: AnalysisFrame = {
                    timestamp: new Date().toISOString(),
                    dominant_emotion: data.dominant_emotion || 'Neutral',
                    confidence: data.confidence || 0,
                    micro_expression: data.micro_expression || null,
                    active_aus: data.active_aus || [],
                    incongruence: data.incongruence || false,
                    baseline_deviation: data.baseline_deviation || 0,
                    analysis_summary: data.analysis_summary || 'Processing...'
                  };

                  dispatch({ type: 'ADD_FRAME', payload: frame });

                  // Send tool response to acknowledge (keep session alive)
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: [{
                      id: fc.id,
                      name: fc.name,
                      response: { result: "ok" }
                    }]
                  }));
                }
              });
            }
          },
          onclose: () => {
            console.log("Session Closed");
            stopStreaming();
            dispatch({ type: 'SET_CONNECTION', payload: ConnectionState.DISCONNECTED });
          },
          onerror: (err) => {
            console.error("Session Error", err);
            dispatch({ type: 'SET_CONNECTION', payload: ConnectionState.ERROR });
            stopStreaming();
          }
        }
      });

      const session = await sessionPromise;
      sessionRef.current = session;

    } catch (error) {
      console.error("Connection failed:", error);
      dispatch({ type: 'SET_CONNECTION', payload: ConnectionState.ERROR });
      stopStreaming();
    }
  };

  const disconnect = () => {
    stopStreaming();
    dispatch({ type: 'SET_CONNECTION', payload: ConnectionState.DISCONNECTED });
  };

  // --- Streaming Logic ---

  const startStreaming = async (session: any) => {
    // Audio Streaming
    if (streamRef.current) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      // Browser policy: resume context if suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const source = audioContext.createMediaStreamSource(streamRef.current);
      sourceRef.current = source;
      
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!state.isMicOn) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createPcmBlob(inputData);
        session.sendRealtimeInput({ media: pcmBlob });
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    }

    // Video Streaming
    frameIntervalRef.current = window.setInterval(async () => {
      if (videoRef.current && canvasRef.current && !processingRef.current) {
        processingRef.current = true;
        
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        if (ctx && video.readyState === 4) {
          canvas.width = 320; // Efficiency
          canvas.height = 240;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
          
          try {
            await session.sendRealtimeInput({ 
              media: { 
                mimeType: 'image/jpeg', 
                data: base64 
              } 
            });
          } catch (e) {
            console.error("Frame send error", e);
          }
        }
        processingRef.current = false;
      }
    }, 500); // 2 FPS for stability
  };

  const stopStreaming = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    sessionRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, []);

  // --- UI Rendering ---

  const isConnected = state.connectionState === ConnectionState.CONNECTED;
  const latest = state.currentFrame;

  return (
    <div className="h-screen w-screen bg-[#0b1120] text-slate-200 flex flex-col overflow-hidden font-sans">
      {/* Header */}
      <header className="h-14 flex-none border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <Eye className="w-6 h-6 text-emerald-500" />
          <span className="font-bold tracking-wider text-lg">MICRO<span className="text-emerald-500">X</span> <span className="text-xs text-slate-500 font-mono bg-slate-800 px-2 py-0.5 rounded">V3.0 PRO</span></span>
        </div>
        <div className="flex items-center gap-4">
           <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono border ${
            isConnected ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 
            state.connectionState === ConnectionState.CONNECTING ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400' :
            'border-red-500/30 bg-red-500/10 text-red-400'
          }`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-current'}`}></div>
            {state.connectionState.toUpperCase()}
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
        
        {/* Left Column: Source & Controls (Fixed Width) */}
        <div className="flex-none w-full lg:w-[480px] flex flex-col gap-4 h-full overflow-y-auto custom-scrollbar">
          
          {/* Video Feed */}
          <div className="relative bg-black rounded-xl border border-slate-700 overflow-hidden aspect-video shadow-2xl shrink-0">
            <video 
              ref={videoRef} 
              className="w-full h-full object-cover transform scale-x-[-1]" 
              muted 
              playsInline 
            />
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute top-4 left-4 flex flex-col gap-2">
              <div className="bg-black/60 backdrop-blur text-[10px] font-mono px-2 py-1 rounded border-l-2 border-emerald-500">
                LIVE FEED :: {isConnected ? 'ANALYZING' : 'READY'}
              </div>
            </div>

            {/* Incongruence Alert Overlay */}
            {latest?.incongruence && (
               <div className="absolute bottom-4 right-4 animate-bounce z-20">
                 <div className="bg-red-600 text-white px-3 py-1.5 rounded shadow-lg border border-red-400 flex items-center gap-2 text-xs font-bold tracking-widest">
                   <AlertTriangle className="w-4 h-4" /> INCONGRUENCE DETECTED
                 </div>
               </div>
            )}
          </div>

          {/* Controls Panel */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 shrink-0">
             <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold text-slate-400 flex items-center gap-2">
                  <Zap className="w-4 h-4" /> CONTROL STATION
                </h3>
                <button onClick={() => dispatch({ type: 'TOGGLE_MIC' })} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                  {state.isMicOn ? <Mic className="w-4 h-4 text-emerald-400" /> : <MicOff className="w-4 h-4 text-red-400" />}
                </button>
             </div>
             
             {!isConnected ? (
               <div className="space-y-3">
                  {/* UI-less API Key: Using process.env directly */}
                  <div className="text-[10px] text-slate-500 font-mono text-center mb-2">
                    SYSTEM PRE-CONFIGURED
                  </div>
                  <button 
                    onClick={connect}
                    disabled={state.connectionState === ConnectionState.CONNECTING}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-all"
                  >
                    {state.connectionState === ConnectionState.CONNECTING ? <Activity className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                    INITIATE PROTOCOL
                  </button>
               </div>
             ) : (
               <button 
                 onClick={disconnect}
                 className="w-full bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 text-red-400 py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-all"
               >
                 <StopCircle className="w-4 h-4" /> TERMINATE SESSION
               </button>
             )}
          </div>

          {/* Log Terminal */}
          <div className="flex-1 bg-black rounded-xl border border-slate-800 p-4 font-mono text-xs overflow-y-auto min-h-[200px]">
            <div className="text-slate-500 mb-2 border-b border-slate-800 pb-1">System Logs</div>
            {state.frames.length === 0 && <div className="text-slate-600 italic">Waiting for data stream...</div>}
            {state.frames.map((f, i) => (
              <div key={i} className="mb-1.5 flex gap-2 opacity-80 hover:opacity-100">
                <span className="text-slate-600">[{f.timestamp.split('T')[1].split('.')[0]}]</span>
                <span className={f.incongruence ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                  {f.dominant_emotion}
                </span>
                <span className="text-slate-400">- {f.analysis_summary}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Analysis Dashboard (Fluid) */}
        <div className="flex-1 flex flex-col gap-4 h-full overflow-hidden">
          
          {/* Top Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0 h-24">
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest">Primary Emotion</span>
              <div className="text-xl font-bold text-emerald-400 truncate">{latest?.dominant_emotion || '--'}</div>
              <div className="text-xs text-slate-400">Confidence: {latest?.confidence || 0}%</div>
            </div>
            
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest">Micro-Expression</span>
              <div className="text-lg font-bold text-blue-400 truncate">{latest?.micro_expression || 'None'}</div>
              <div className="text-xs text-slate-400">Fleeting: &lt;500ms</div>
            </div>
            
            <div className={`bg-slate-900/50 border rounded-xl p-3 flex flex-col justify-between ${latest?.incongruence ? 'border-red-500/50 bg-red-500/10' : 'border-slate-800'}`}>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest">Congruence</span>
              <div className={`text-lg font-bold truncate ${latest?.incongruence ? 'text-red-400' : 'text-emerald-400'}`}>
                {latest?.incongruence ? 'MISMATCH' : 'ALIGNED'}
              </div>
              <div className="text-xs text-slate-400">Audio vs Visual</div>
            </div>
            
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest">Baseline Dev</span>
              <div className="text-xl font-bold text-purple-400">{latest?.baseline_deviation || 0}</div>
              <div className="w-full bg-slate-800 h-1 rounded-full mt-1">
                <div className="bg-purple-500 h-1 rounded-full transition-all" style={{width: `${latest?.baseline_deviation || 0}%`}}></div>
              </div>
            </div>
          </div>

          {/* Charts Grid - FLEXIBLE HEIGHT */}
          <div className="flex-1 min-h-0 grid grid-rows-2 gap-4">
            <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4">
              <EmotionTimeline data={state.timelineData} />
            </div>
            <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4">
               <ActionUnitGraph activeAus={latest?.active_aus || []} />
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}