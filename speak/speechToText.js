/**
 * Deepgram Speech-to-Text Streaming Client
 * 
 * This class provides real-time speech-to-text transcription using Deepgram's WebSocket API.
 * 
 * Usage Example:
 * 
 * // Initialize the client
 * const deepgram = new DeepgramSpeechToText('YOUR_API_KEY', {
 *     model: 'nova-2',
 *     language: 'en',
 *     punctuate: true,
 *     interim_results: true,
 *     smart_format: true
 * });
 * 
 * // Set event handlers
 * deepgram.setEventHandlers({
 *     onTranscript: (result) => {
 *         console.log('Final:', result.transcript);
 *         // Handle final transcription
 *     },
 *     onInterimResult: (result) => {
 *         console.log('Interim:', result.transcript);
 *         // Handle interim results
 *     },
 *     onError: (error) => {
 *         console.error('Error:', error);
 *     },
 *     onOpen: () => {
 *         console.log('Connected to Deepgram');
 *     },
 *     onClose: (event) => {
 *         console.log('Disconnected from Deepgram');
 *     }
 * });
 * 
 * // Start streaming
 * deepgram.startStreaming().then(() => {
 *     console.log('Streaming started successfully');
 * }).catch(error => {
 *     console.error('Failed to start streaming:', error);
 * });
 * 
 * // Stop streaming
 * deepgram.stopStreaming().then(() => {
 *     console.log('Streaming stopped successfully');
 * });
 * 
 * // Check if streaming
 * if (deepgram.isCurrentlyStreaming()) {
 *     console.log('Currently streaming');
 * }
 * 
 * // Clean up when done
 * deepgram.cleanup();
 */
class DeepgramSpeechToText {
    constructor(apiKey, options = {}) {
        this.apiKey = apiKey;
        this.socket = null;
        this.mediaRecorder = null;
        this.stream = null;
        this.isStreaming = false;
        
        // Default options
        this.options = {
            model: 'nova-2',
            language: 'en',
            punctuate: true,
            interim_results: true,
            endpointing: 10,
            sample_rate: 16000,
            encoding: 'linear16',
            channels: 1,
            filler_words: false,
            diarize: false,
            smart_format: true,
            vad_events: false,
            ...options
        };
        
        // Event callbacks
        this.onTranscript = null;
        this.onInterimResult = null;
        this.onError = null;
        this.onOpen = null;
        this.onClose = null;
        this.onMetadata = null;
    }
    
    // Build WebSocket URL with query parameters
    buildWebSocketUrl() {
        const baseUrl = 'wss://api.deepgram.com/v1/listen';
        const params = new URLSearchParams();
        
        // Add authorization token
        params.append('token', this.apiKey);
        
        // Add all options as query parameters
        Object.entries(this.options).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                params.append(key, value.toString());
            }
        });
        
        return `${baseUrl}?${params.toString()}`;
    }
    
    // Initialize WebSocket connection
    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                const url = this.buildWebSocketUrl();
                
                // Create WebSocket connection (token is included in URL query params)
                this.socket = new WebSocket(url);
                
                this.socket.addEventListener('open', () => {
                    console.log('Deepgram WebSocket connected');
                    if (this.onOpen) this.onOpen();
                    resolve();
                });
                
                this.socket.onmessage = (event) => {
                    this.handleWebSocketMessage(event);
                };
                
                this.socket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    if (this.onError) this.onError(error);
                    reject(error);
                };
                
                this.socket.onclose = (event) => {
                    console.log('WebSocket closed:', event.code, event.reason);
                    if (this.onClose) this.onClose(event);
                    this.isStreaming = false;
                };
                
            } catch (error) {
                console.error('Failed to connect to Deepgram:', error);
                reject(error);
            }
        });
    }
    
    // Handle incoming WebSocket messages
    handleWebSocketMessage(event) {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'Results':
                    this.handleTranscriptionResult(data);
                    break;
                case 'Metadata':
                    console.log('Metadata received:', data);
                    if (this.onMetadata) this.onMetadata(data);
                    break;
                case 'SpeechStarted':
                    console.log('Speech started');
                    break;
                case 'UtteranceEnd':
                    console.log('Utterance ended');
                    break;
                case 'Error':
                    console.error('Deepgram error:', data);
                    if (this.onError) this.onError(data);
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    }
    
    // Handle transcription results
    handleTranscriptionResult(data) {
        if (data.channel && data.channel.alternatives && data.channel.alternatives.length > 0) {
            const alternative = data.channel.alternatives[0];
            const transcript = alternative.transcript;
            const confidence = alternative.confidence;
            const words = alternative.words || [];
            
            const result = {
                transcript,
                confidence,
                words,
                is_final: data.is_final,
                speech_final: data.speech_final,
                duration: data.duration,
                start: data.start,
                metadata: data.metadata
            };
            
            if (data.is_final) {
                console.log('Final transcript:', transcript);
                if (this.onTranscript) this.onTranscript(result);
            } else {
                console.log('Interim transcript:', transcript);
                if (this.onInterimResult) this.onInterimResult(result);
            }
        }
    }
    
    // Initialize microphone access
    async initializeMicrophone() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: this.options.sample_rate,
                    channelCount: this.options.channels,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            return this.stream;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            throw error;
        }
    }
    
    // Start streaming audio
    async startStreaming() {
        if (this.isStreaming) {
            console.warn('Already streaming');
            return;
        }
        
        try {
            // Connect to WebSocket
            await this.connectWebSocket();
            
            // Initialize microphone
            const stream = await this.initializeMicrophone();
            
            // Create MediaRecorder
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            // Handle audio data
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && this.socket && this.socket.readyState === WebSocket.OPEN) {
                    // Send binary audio data
                    this.socket.send(event.data);
                }
            };
            
            this.mediaRecorder.onerror = (error) => {
                console.error('MediaRecorder error:', error);
                if (this.onError) this.onError(error);
            };
            
            // Start recording
            this.mediaRecorder.start(100); // Send data every 100ms
            this.isStreaming = true;
            
            console.log('Streaming started');
            
        } catch (error) {
            console.error('Failed to start streaming:', error);
            if (this.onError) this.onError(error);
            throw error;
        }
    }
    
    // Stop streaming audio
    async stopStreaming() {
        if (!this.isStreaming) {
            console.warn('Not currently streaming');
            return;
        }
        
        try {
            this.isStreaming = false;
            
            // Stop media recorder
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            
            // Stop media stream
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }
            
            // Send finalize message and close WebSocket
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'Finalize' }));
                setTimeout(() => {
                    if (this.socket) {
                        this.socket.close();
                        this.socket = null;
                    }
                }, 100);
            }
            
            console.log('Streaming stopped');
            
        } catch (error) {
            console.error('Error stopping streaming:', error);
            if (this.onError) this.onError(error);
        }
    }
    
    // Check if currently streaming
    isCurrentlyStreaming() {
        return this.isStreaming;
    }
    
    // Update streaming options
    updateOptions(newOptions) {
        if (this.isStreaming) {
            console.warn('Cannot update options while streaming. Stop streaming first.');
            return;
        }
        
        this.options = { ...this.options, ...newOptions };
    }
    
    // Set event handlers
    setEventHandlers({
        onTranscript,
        onInterimResult,
        onError,
        onOpen,
        onClose,
        onMetadata
    }) {
        this.onTranscript = onTranscript;
        this.onInterimResult = onInterimResult;
        this.onError = onError;
        this.onOpen = onOpen;
        this.onClose = onClose;
        this.onMetadata = onMetadata;
    }
    
    // Clean up resources
    cleanup() {
        this.stopStreaming();
        this.mediaRecorder = null;
        this.stream = null;
        this.socket = null;
    }
}

// Export the class
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeepgramSpeechToText;
} else {
    window.DeepgramSpeechToText = DeepgramSpeechToText;
}
