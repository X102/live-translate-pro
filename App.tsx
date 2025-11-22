import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Language, ConnectionStatus, TranscriptionItem } from './types';
import { createPCM16Blob, decodeAudioData, base64ToUint8Array } from './utils/audioUtils';
import TranscriptCard from './components/TranscriptCard';

// Available Source Languages
const LANGUAGES: Language[] = [
  { code: 'English', name: 'English', flag: '🇺🇸' },
  { code: 'Russian', name: 'Russian', flag: '🇷🇺' },
  { code: 'Korean', name: 'Korean', flag: '🇰🇷' },
  { code: 'Chinese', name: 'Chinese', flag: '🇨🇳' },
  { code: 'Japanese', name: 'Japanese', flag: '🇯🇵' },
];

const App: React.FC = () => {
  // State
  const [selectedLang, setSelectedLang] = useState<Language>(LANGUAGES[0]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [volume, setVolume] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Gemini Session Ref
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const currentSessionRef = useRef<any>(null); // To track active session for cleanup

  // Transcription Buffers
  const currentOriginalRef = useRef<string>('');
  const currentTranslatedRef = useRef<string>('');
  const currentIdRef = useRef<string>(crypto.randomUUID());

  // Initialize Audio Contexts
  const ensureAudioContexts = () => {
    if (!inputAudioContextRef.current) {
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }
    if (!outputAudioContextRef.current) {
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  };

  // Cleanup Function
  const disconnect = useCallback(async () => {
    setStatus('disconnected');

    // Close Gemini Session
    if (currentSessionRef.current) {
      // Try to close if method exists, mostly relying on cutting the stream
      try {
        // @ts-ignore - Close might not be strictly typed in all versions but good practice
        currentSessionRef.current.close?.(); 
      } catch (e) {
        // ignore
      }
      currentSessionRef.current = null;
      sessionPromiseRef.current = null;
    }

    // Stop Microphone Stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Disconnect Audio Nodes
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    // Stop Playing Audio
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setVolume(0);
  }, []);

  const connect = async () => {
    if (!process.env.API_KEY) {
        setErrorMessage("API Key is missing.");
        return;
    }
    setErrorMessage(null);
    ensureAudioContexts();
    setStatus('connecting');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // System Instruction: The Core Logic
      const systemInstruction = `You are a professional, simultaneous interpreter. 
      Your task is to listen to the user speaking in ${selectedLang.name} and immediately translate it into Vietnamese.
      
      Rules:
      1. Output the Vietnamese translation as audio.
      2. Provide text transcriptions for both the original ${selectedLang.name} input and the Vietnamese output.
      3. Do not answer the user's questions. Do not engage in conversation. JUST TRANSLATE.
      4. Keep the tone natural and accurate to the original context.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
            onopen: async () => {
                setStatus('connected');
                console.log("Session opened");
                
                // Start Microphone
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    streamRef.current = stream;
                    
                    const ctx = inputAudioContextRef.current!;
                    const source = ctx.createMediaStreamSource(stream);
                    sourceRef.current = source;
                    
                    const processor = ctx.createScriptProcessor(4096, 1, 1);
                    processorRef.current = processor;

                    processor.onaudioprocess = (e) => {
                        const inputData = e.inputBuffer.getChannelData(0);
                        
                        // Simple volume meter visualization
                        let sum = 0;
                        for (let i = 0; i < inputData.length; i++) {
                            sum += inputData[i] * inputData[i];
                        }
                        setVolume(Math.sqrt(sum / inputData.length));

                        const pcmBlob = createPCM16Blob(inputData);
                        
                        if (sessionPromiseRef.current) {
                             sessionPromiseRef.current.then(session => {
                                session.sendRealtimeInput({ media: pcmBlob });
                             });
                        }
                    };

                    source.connect(processor);
                    processor.connect(ctx.destination);
                } catch (err) {
                    console.error("Mic error:", err);
                    setErrorMessage("Microphone access denied.");
                    disconnect();
                }
            },
            onmessage: async (message: LiveServerMessage) => {
                // 1. Handle Audio Output (The translation spoken by Gemini)
                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio && outputAudioContextRef.current) {
                    const ctx = outputAudioContextRef.current;
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                    
                    try {
                        const audioBuffer = await decodeAudioData(
                            base64ToUint8Array(base64Audio),
                            ctx,
                            24000,
                            1
                        );
                        
                        const source = ctx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(ctx.destination);
                        
                        source.addEventListener('ended', () => {
                            audioSourcesRef.current.delete(source);
                        });
                        
                        source.start(nextStartTimeRef.current);
                        audioSourcesRef.current.add(source);
                        nextStartTimeRef.current += audioBuffer.duration;
                    } catch (e) {
                        console.error("Audio decode error", e);
                    }
                }

                // 2. Handle Transcriptions
                const outputTranscription = message.serverContent?.outputTranscription?.text;
                const inputTranscription = message.serverContent?.inputTranscription?.text;
                const turnComplete = message.serverContent?.turnComplete;

                // Update accumulators
                if (inputTranscription) {
                    currentOriginalRef.current += inputTranscription;
                }
                if (outputTranscription) {
                    currentTranslatedRef.current += outputTranscription;
                }

                // Update UI with streaming text
                if (inputTranscription || outputTranscription) {
                    setTranscriptions(prev => {
                        const existingIndex = prev.findIndex(t => t.id === currentIdRef.current);
                        const updatedItem: TranscriptionItem = {
                            id: currentIdRef.current,
                            originalText: currentOriginalRef.current.trim(),
                            translatedText: currentTranslatedRef.current.trim(),
                            isFinal: false,
                            timestamp: Date.now()
                        };

                        if (existingIndex >= 0) {
                            const newArr = [...prev];
                            newArr[existingIndex] = updatedItem;
                            return newArr;
                        } else {
                            // Only add if there is content
                            if(updatedItem.originalText || updatedItem.translatedText) {
                                return [updatedItem, ...prev];
                            }
                            return prev;
                        }
                    });
                }

                // Handle Turn Completion (Finalize the bubble)
                if (turnComplete) {
                    setTranscriptions(prev => {
                        const existingIndex = prev.findIndex(t => t.id === currentIdRef.current);
                        if (existingIndex >= 0) {
                             const newArr = [...prev];
                             newArr[existingIndex] = { ...newArr[existingIndex], isFinal: true };
                             return newArr;
                        }
                        return prev;
                    });

                    // Reset for next turn
                    currentOriginalRef.current = '';
                    currentTranslatedRef.current = '';
                    currentIdRef.current = crypto.randomUUID();
                }
            },
            onclose: () => {
                setStatus('disconnected');
            },
            onerror: (err) => {
                console.error("Gemini Error:", err);
                setErrorMessage("Connection error. Please try again.");
                setStatus('error');
            }
        }
      });

      sessionPromiseRef.current = sessionPromise;
      sessionPromise.then(session => {
          currentSessionRef.current = session;
      });

    } catch (err) {
      console.error("Connection failed", err);
      setErrorMessage("Failed to initiate connection.");
      setStatus('error');
    }
  };

  // Restart session when language changes
  useEffect(() => {
    if (status === 'connected') {
      disconnect().then(() => {
         // Optional: Auto-reconnect could be annoying, let user click Start
         // But if we want seamless, we might auto connect. Let's keep it manual for safety.
      });
    }
  }, [selectedLang, disconnect]);


  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
             <div className="bg-blue-600 text-white p-1.5 rounded-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
             </div>
             <h1 className="font-bold text-xl text-slate-800 tracking-tight">LiveTranslate <span className="text-blue-600">Pro</span></h1>
          </div>
          
          <div className="flex items-center gap-2">
             <span className="text-xs font-semibold uppercase text-slate-400 bg-slate-100 px-2 py-1 rounded">Gemini 2.5 Live</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-3xl mx-auto w-full p-4 flex flex-col">
        
        {/* Controls Area */}
        <div className="mb-6 bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
             {errorMessage && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    {errorMessage}
                </div>
             )}

             <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                {/* Language Select */}
                <div className="flex-1 w-full sm:w-auto">
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Translate From</label>
                    <div className="relative">
                        <select 
                            value={selectedLang.code}
                            onChange={(e) => {
                                const lang = LANGUAGES.find(l => l.code === e.target.value);
                                if(lang) setSelectedLang(lang);
                            }}
                            className="w-full appearance-none bg-slate-50 border border-slate-200 text-slate-700 py-3 px-4 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium text-lg cursor-pointer"
                            disabled={status === 'connected'}
                        >
                            {LANGUAGES.map(lang => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.flag} {lang.name}
                                </option>
                            ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-700">
                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                        </div>
                    </div>
                </div>

                {/* Arrow */}
                <div className="hidden sm:block text-slate-300 pt-6">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                </div>

                 {/* Target Language (Fixed) */}
                 <div className="flex-1 w-full sm:w-auto">
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Translate To</label>
                    <div className="w-full bg-blue-50 border border-blue-100 text-blue-800 py-3 px-4 rounded-xl font-medium text-lg flex items-center gap-2 cursor-default">
                        <span>🇻🇳</span> Vietnamese
                    </div>
                </div>
             </div>
             
             {/* Mic Button & Status */}
             <div className="mt-8 flex flex-col items-center justify-center relative">
                 {status === 'connected' && (
                     <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-24 h-24 rounded-full border-4 border-blue-100 animate-pulse-ring"></div>
                        <div className="w-24 h-24 rounded-full border-4 border-blue-200 animate-pulse-ring" style={{animationDelay: '0.5s'}}></div>
                     </div>
                 )}
                 
                 <button
                    onClick={status === 'connected' || status === 'connecting' ? disconnect : connect}
                    disabled={status === 'connecting'}
                    className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg focus:outline-none focus:ring-4 focus:ring-offset-2 ${
                        status === 'connected' 
                            ? 'bg-red-500 hover:bg-red-600 text-white focus:ring-red-200 scale-100'
                            : status === 'connecting'
                                ? 'bg-slate-200 text-slate-400 cursor-wait'
                                : 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-200 hover:scale-105'
                    }`}
                 >
                    {status === 'connecting' ? (
                        <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : status === 'connected' ? (
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                    ) : (
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                    )}
                 </button>

                 <div className="mt-4 h-6 flex items-center justify-center">
                    {status === 'connected' ? (
                        <div className="flex items-center gap-2">
                            <div className="flex items-end gap-1 h-4">
                                {[...Array(5)].map((_, i) => (
                                    <div key={i} 
                                         className="w-1 bg-blue-500 rounded-full transition-all duration-75"
                                         style={{ height: `${Math.max(20, Math.min(100, volume * 500 * (Math.random() + 0.5)))}%` }}
                                    />
                                ))}
                            </div>
                            <span className="text-sm font-medium text-blue-600 animate-pulse">Listening...</span>
                        </div>
                    ) : (
                        <span className="text-sm font-medium text-slate-400">Tap mic to start translating</span>
                    )}
                 </div>
             </div>
        </div>

        {/* Transcript List */}
        <div className="flex-1 overflow-y-auto px-1">
            {transcriptions.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 pb-20">
                    <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p>Conversation history will appear here</p>
                </div>
            )}
            
            {transcriptions.map((item) => (
                <TranscriptCard key={item.id} item={item} />
            ))}
            
            {/* Spacer for bottom visibility */}
            <div className="h-4"></div>
        </div>
      </main>
    </div>
  );
};

export default App;