document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const videoElement = document.getElementById('live-video');
    const viewerCountElement = document.getElementById('viewer-count');
    const chatMessages = document.getElementById('chat-messages');
    const streamOverlay = document.getElementById('stream-overlay');
    const placeholder = document.getElementById('placeholder');
    const copyNotification = document.getElementById('copy-notification');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const controlsContainer = document.getElementById('controls-container');
    const micIcon = document.getElementById('mic-icon');
    const viewerVolumeControl = document.getElementById('viewer-volume-control');
    const viewerMuteIcon = document.getElementById('viewer-mute-icon');

    let localStream;
    let peer;
    let isStreamer = false;
    let streamerId;
    let connections = {}; // key: peerId, value: { data: DataConnection, media: MediaConnection, username: string }
    let myUsername = '';
    let isMuted = true;

    const PEER_CONFIG = {
        // debug: 3, // Uncomment for verbose logging
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ]
        }
    };

    const init = () => {
        const urlParams = new URLSearchParams(window.location.search);
        streamerId = urlParams.get('view');

        if (streamerId) {
            isStreamer = false;
            setupViewer();
        } else {
            isStreamer = true;
            myUsername = 'Streamer';
            setupStreamer();
        }

        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    };

    const setupStreamer = () => {
        peer = new Peer(undefined, PEER_CONFIG);
        peer.on('open', (id) => {
            console.log('My PeerJS ID is:', id);
        });

        peer.on('connection', (conn) => {
            console.log(`New viewer connected: ${conn.peer}`);
            connections[conn.peer] = { data: conn };
            conn.on('data', (data) => handleIncomingData(conn.peer, data));
            conn.on('close', () => handleViewerDisconnect(conn.peer));
            
            // If stream is already live, call the new viewer immediately.
            if (localStream && localStream.active) {
                console.log(`Stream is active, calling new viewer ${conn.peer}`);
                const call = peer.call(conn.peer, localStream);
                if (call) {
                    connections[conn.peer].media = call; // Store the media connection
                    call.on('error', err => console.error(`Call error with ${conn.peer}:`, err));
                }
            }
        });

        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            alert('A connection error occurred. Please refresh the page.');
        });
        
        startBtn.addEventListener('click', startLive);
        stopBtn.addEventListener('click', stopLive);
        copyLinkBtn.addEventListener('click', copyStreamerLink);
    };

    const setupViewer = () => {
        // Hide streamer controls for viewer
        startBtn.classList.add('hidden');
        stopBtn.classList.add('hidden');
        copyLinkBtn.classList.add('hidden');

        placeholder.querySelector('i').className = 'fas fa-spinner fa-spin';
        placeholder.querySelector('p').textContent = 'Connecting to stream...';

        myUsername = 'Viewer-' + Math.random().toString(36).substr(2, 4);
        peer = new Peer(undefined, PEER_CONFIG);

        peer.on('open', (id) => {
            console.log('My PeerJS ID is:', id);
            const conn = peer.connect(streamerId, { reliable: true });
            connections[streamerId] = { data: conn }; // Store connection early

            conn.on('open', () => {
                console.log('Connected to streamer');
                conn.send({ type: 'user-join', username: myUsername });
                chatInput.disabled = false;
                sendBtn.disabled = false;
            });
            conn.on('data', (data) => handleIncomingData(streamerId, data));
            conn.on('close', () => {
                console.log('Connection to streamer closed.');
                handleStreamEnd();
            });
            conn.on('error', err => console.error("Connection error:", err));
        });

        peer.on('call', (call) => {
            console.log('Receiving stream from streamer');
            call.answer(); // Answer the call with no stream
            connections[streamerId].media = call;
            call.on('stream', (remoteStream) => {
                console.log('Stream received from streamer');
                videoElement.srcObject = remoteStream;
                videoElement.muted = true; // Start muted for autoplay
                videoElement.play().catch(e => console.error("Error playing stream:", e));
                streamOverlay.classList.remove('hidden');
                placeholder.classList.add('hidden');
                
                // Show viewer-specific volume control and make video clickable
                viewerVolumeControl.classList.remove('hidden');
                updateViewerMuteIcon();

                const toggleMute = () => {
                    videoElement.muted = !videoElement.muted;
                    updateViewerMuteIcon();
                };

                viewerVolumeControl.onclick = (e) => {
                    e.stopPropagation(); // Prevent video click from firing too
                    toggleMute();
                };
                videoElement.onclick = toggleMute;

                // Add Picture-in-Picture functionality for viewers
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') {
                        // Check if video is playing, PiP is supported, and not already active
                        if (videoElement.srcObject && !videoElement.paused && document.pictureInPictureEnabled && !document.pictureInPictureElement) {
                            videoElement.requestPictureInPicture().catch(error => {
                                console.error('Failed to enter Picture-in-Picture mode:', error);
                            });
                        }
                    }
                });
            });
             call.on('close', () => {
                console.log('Streamer call ended.');
                handleStreamEnd();
             });
             call.on('error', err => console.error("Call error:", err));
        });

        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            if (err.type === 'peer-unavailable') {
                placeholder.querySelector('i').className = 'fas fa-video-slash';
                placeholder.querySelector('p').textContent = 'Streamer is offline or the link is invalid.';
            } else {
                 alert('A connection error occurred.');
            }
        });
    };
    
    const startLive = async () => {
        try {
            const streamConstraints = {
                video: {
                    width: { ideal: 960 },
                    height: { ideal: 540 },
                    frameRate: { ideal: 24 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };
            localStream = await navigator.mediaDevices.getUserMedia(streamConstraints);
            videoElement.srcObject = localStream;
            videoElement.muted = true; // Mute local playback to prevent echo
            await videoElement.play();
            
            isMuted = false;
            updateMicIcon();
            
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            streamOverlay.classList.remove('hidden');
            placeholder.classList.add('hidden');
            chatInput.disabled = false;
            sendBtn.disabled = false;

            // Call existing viewers
            Object.entries(connections).forEach(([peerId, connData]) => {
                if (connData.data?.open) { // Check if data connection is open
                    console.log(`Calling viewer ${peerId}`);
                    const call = peer.call(peerId, localStream);
                    if(call) {
                        connData.media = call;
                        call.on('error', err => console.error('Call error:', err));
                    }
                }
            });

        } catch (error) {
            console.error('Error accessing media devices.', error);
            alert('Could not access your camera and microphone. Please check permissions.');
        }
    };

    const stopLive = () => {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        videoElement.srcObject = null;
        
        isMuted = true;
        updateMicIcon();

        stopBtn.classList.add('hidden');
        startBtn.classList.remove('hidden');
        streamOverlay.classList.add('hidden');
        placeholder.classList.remove('hidden');
        chatInput.disabled = true;
        sendBtn.disabled = true;
        
        broadcastMessage({ type: 'stream-ended' });
        viewerCountElement.textContent = '0';
        // chatMessages.innerHTML = ''; // Keep chat history for now
        Object.values(connections).forEach(connData => {
            if (connData.media) connData.media.close();
            if (connData.data) connData.data.close();
        });
        connections = {};
    };

    const addChatMessage = (username, message, isYou = false) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message');
        
        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('username');
        if (isYou) {
            usernameSpan.classList.add('you');
        }
        usernameSpan.textContent = username;

        const textSpan = document.createElement('span');
        textSpan.classList.add('text');
        textSpan.textContent = message;

        messageElement.appendChild(usernameSpan);
        messageElement.appendChild(textSpan);
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll
    };

    const addSystemMessage = (message) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('system-message');
        messageElement.textContent = message;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    const sendMessage = () => {
        const message = chatInput.value.trim();
        if (message) {
            addChatMessage(myUsername, message, true);
            const chatData = { type: 'chat', username: myUsername, message: message };
            broadcastMessage(chatData);
            chatInput.value = '';
        }
    };

    const broadcastMessage = (data) => {
         Object.values(connections).forEach(connData => {
            if (connData.data && connData.data.open) {
                connData.data.send(data);
            }
        });
    };

    const handleIncomingData = (peerId, data) => {
        switch(data.type) {
            case 'user-join':
                if(isStreamer) {
                    connections[peerId].username = data.username;
                    addSystemMessage(`${data.username} has joined.`);
                    broadcastMessage({type: 'system-message', message: `${data.username} has joined.`});
                    updateViewerCount();
                }
                break;
            case 'system-message':
                addSystemMessage(data.message);
                break;
            case 'chat':
                addChatMessage(data.username, data.message, false);
                // If streamer receives a message, relay it to other viewers
                if (isStreamer) {
                    Object.entries(connections).forEach(([id, connData]) => {
                        if (id !== peerId && connData.data.open) {
                            connData.data.send(data);
                        }
                    });
                }
                break;
            case 'stream-ended':
                 handleStreamEnd();
                 if(connections[streamerId]) {
                    if (connections[streamerId].data) connections[streamerId].data.close();
                    if (connections[streamerId].media) connections[streamerId].media.close();
                    delete connections[streamerId];
                 }
                break;
            case 'viewer-count':
                 viewerCountElement.textContent = data.count;
                 break;
        }
    };
    
    const handleStreamEnd = () => {
        videoElement.srcObject = null;
        streamOverlay.classList.add('hidden');
        viewerVolumeControl.classList.add('hidden');
        placeholder.classList.remove('hidden');
        placeholder.querySelector('i').className = 'fas fa-video-slash';
        placeholder.querySelector('p').textContent = 'The stream has ended.';
        chatInput.disabled = true;
        sendBtn.disabled = true;
    };

    const handleViewerDisconnect = (peerId) => {
        const username = connections[peerId]?.username || 'A viewer';
        console.log(`Viewer ${peerId} (${username}) disconnected.`);
        if (connections[peerId]) {
            connections[peerId].media?.close();
            delete connections[peerId];
        }
        addSystemMessage(`${username} has left.`);
        broadcastMessage({type: 'system-message', message: `${username} has left.`});
        updateViewerCount();
    };

    const updateViewerCount = () => {
        const count = Object.keys(connections).length;
        // The streamer is not a "viewer"
        viewerCountElement.textContent = count;
        if(isStreamer) {
            broadcastMessage({ type: 'viewer-count', count: count });
        }
    };

    const updateMicIcon = () => {
        if(isMuted) {
            micIcon.classList.add('fa-microphone-slash', 'muted');
            micIcon.classList.remove('fa-microphone');
        } else {
            micIcon.classList.add('fa-microphone');
            micIcon.classList.remove('fa-microphone-slash', 'muted');
        }
    };

    const updateViewerMuteIcon = () => {
        if (videoElement.muted) {
            viewerMuteIcon.className = 'fas fa-volume-mute';
        } else {
            viewerMuteIcon.className = 'fas fa-volume-up';
        }
    };

    const copyStreamerLink = () => {
        if (!peer || !peer.id) {
            alert('Peer connection not yet established. Please wait a moment.');
            return;
        }
        const streamUrl = `${window.location.origin}${window.location.pathname}?view=${peer.id}`;
        navigator.clipboard.writeText(streamUrl).then(() => {
            copyNotification.classList.add('visible');
            setTimeout(() => {
                copyNotification.classList.remove('visible');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            alert('Failed to copy link.');
        });
    };

    init();
});