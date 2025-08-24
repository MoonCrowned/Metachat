// Meeting page JavaScript - handles lobby, WebRTC, and meeting room

class MetachatMeeting {
    constructor() {
        this.meetId = this.extractMeetIdFromUrl();
        this.socket = null;
        this.localStream = null;
        this.localVideo = null;
        this.peers = new Map(); // Map of peer connections
        this.participants = new Map(); // Map of participant info
        this.userName = 'Metabro';
        this.isInMeeting = false;
        this.isFullscreen = false;
        this.fullscreenPeerId = null;
        
        // Media states
        this.isMicOn = true;
        this.isCamOn = false;
        this.isScreenSharing = false;
        this.screenStream = null;
        this.isUpdatingCamera = false;
        this.isUpdatingMicrophone = false;
        
        // Device lists
        this.audioInputDevices = [];
        this.videoInputDevices = [];
        this.currentAudioDevice = null;
        this.currentVideoDevice = null;
        
        // WebRTC configuration
        this.peerConfig = {
            iceServers: [
                { urls: 'stun:metachat.rockypaper.com:3478' },
                { urls: 'turn:metachat.rockypaper.com:3478', username: 'metaway', credential: 'metachat' },
                { urls: 'turns:metachat.rockypaper.com:5349', username: 'metaway', credential: 'metachat' }
            ]
        };
        
        this.init();
    }
    
    extractMeetIdFromUrl() {
        const path = window.location.pathname;
        return path.substring(1); // Remove leading slash
    }
    
    async init() {
        try {
            // Check if meeting exists
            const response = await fetch(`/api/meet/check/${this.meetId}`);
            
            if (!response.ok) {
                this.showNotFoundScreen();
                return;
            }
            
            // Get available devices
            await this.getDevices();
            
            // Setup lobby
            this.showLobbyScreen();
            await this.setupLobbyEvents();
            
        } catch (error) {
            console.error('Error initializing:', error);
            this.showNotFoundScreen();
        }
    }
    
    showNotFoundScreen() {
        document.getElementById('notFoundScreen').classList.remove('hidden');
        document.getElementById('createNewMeetingBtn').addEventListener('click', () => {
            window.location.href = '/newmeet';
        });
    }
    
    showLobbyScreen() {
        document.getElementById('lobbyScreen').classList.remove('hidden');
        this.localVideo = document.getElementById('localPreview');
    }
    
    showMeetingScreen() {
        document.getElementById('lobbyScreen').classList.add('hidden');
        document.getElementById('meetingScreen').classList.remove('hidden');
        this.isInMeeting = true;
    }
    
    async getDevices() {
        try {
            // Request only audio permissions initially to avoid camera flash
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            // Stop the temporary stream immediately
            tempStream.getTracks().forEach(track => track.stop());
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            this.audioInputDevices = devices.filter(device => device.kind === 'audioinput');
            this.videoInputDevices = devices.filter(device => device.kind === 'videoinput');
            
            if (this.audioInputDevices.length > 0) {
                this.currentAudioDevice = this.audioInputDevices[0].deviceId;
            }
            if (this.videoInputDevices.length > 0) {
                this.currentVideoDevice = this.videoInputDevices[0].deviceId;
            }
            
            this.updateDeviceLists();
            
        } catch (error) {
            console.error('Error getting devices:', error);
            // If audio permission fails, try to enumerate devices without permissions
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                this.audioInputDevices = devices.filter(device => device.kind === 'audioinput');
                this.videoInputDevices = devices.filter(device => device.kind === 'videoinput');
                this.updateDeviceLists();
            } catch (enumError) {
                console.error('Error enumerating devices:', enumError);
            }
        }
    }
    
    updateDeviceLists() {
        // Update lobby device lists
        this.populateDeviceList('lobbyMicDevices', this.audioInputDevices, this.currentAudioDevice, async (deviceId) => {
            this.currentAudioDevice = deviceId;
            await this.updateLocalStream();
        });
        
        this.populateDeviceList('lobbyCamDevices', this.videoInputDevices, this.currentVideoDevice, async (deviceId) => {
            this.currentVideoDevice = deviceId;
            await this.updateLocalStream();
        });
        
        // Update meeting device lists
        this.populateDeviceList('meetingMicDevices', this.audioInputDevices, this.currentAudioDevice, async (deviceId) => {
            this.currentAudioDevice = deviceId;
            await this.updateLocalStream();
        });
        
        this.populateDeviceList('meetingCamDevices', this.videoInputDevices, this.currentVideoDevice, async (deviceId) => {
            this.currentVideoDevice = deviceId;
            await this.updateLocalStream();
        });
    }
    
    populateDeviceList(elementId, devices, currentDevice, onSelect) {
        const container = document.getElementById(elementId);
        container.innerHTML = '';
        
        devices.forEach(device => {
            const deviceItem = document.createElement('div');
            deviceItem.className = 'device-item';
            if (device.deviceId === currentDevice) {
                deviceItem.classList.add('selected');
            }
            deviceItem.textContent = device.label || `Device ${device.deviceId.substr(0, 8)}`;
            deviceItem.addEventListener('click', () => {
                onSelect(device.deviceId);
                container.classList.add('hidden');
                this.updateDeviceLists();
            });
            container.appendChild(deviceItem);
        });
    }
    
    async setupLobbyEvents() {
        // Name input
        const nameInput = document.getElementById('nameInput');
        nameInput.addEventListener('input', (e) => {
            this.userName = e.target.value || 'Metabro';
        });
        
        // Join meeting button
        document.getElementById('joinMeetingBtn').addEventListener('click', () => {
            this.joinMeeting();
        });
        
        // Media controls in lobby
        this.setupMediaControls('lobby');
        
        // Initialize with microphone only (camera off by default)
        this.updateLocalStream();
    }
    
    setupMediaControls(prefix) {
        // Microphone toggle
        const micBtn = document.getElementById(`${prefix}MicBtn`);
        const micDeviceBtn = document.getElementById(`${prefix}MicDeviceBtn`);
        const micDevices = document.getElementById(`${prefix}MicDevices`);
        
        micBtn.addEventListener('click', () => {
            this.toggleMicrophone(prefix);
        });
        
        micDeviceBtn.addEventListener('click', () => {
            micDevices.classList.toggle('hidden');
        });
        
        // Camera toggle
        const camBtn = document.getElementById(`${prefix}CamBtn`);
        const camDeviceBtn = document.getElementById(`${prefix}CamDeviceBtn`);
        const camDevices = document.getElementById(`${prefix}CamDevices`);
        
        camBtn.addEventListener('click', () => {
            this.toggleCamera(prefix);
        });
        
        camDeviceBtn.addEventListener('click', () => {
            camDevices.classList.toggle('hidden');
        });
        
        // Screen share (only in meeting)
        if (prefix === 'meeting') {
            const screenBtn = document.getElementById('screenShareBtn');
            screenBtn.addEventListener('click', () => {
                this.toggleScreenShare();
            });
            
            const leaveBtn = document.getElementById('leaveMeetingBtn');
            leaveBtn.addEventListener('click', () => {
                this.leaveMeeting();
            });
        }
        
        // Close device lists when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.control-group')) {
                micDevices.classList.add('hidden');
                camDevices.classList.add('hidden');
            }
        });
    }
    
    async toggleMicrophone(prefix) {
        // Prevent rapid clicking
        if (this.isUpdatingMicrophone) {
            console.log('Microphone is already being updated, ignoring click');
            return;
        }
        
        this.isUpdatingMicrophone = true;
        
        try {
            this.isMicOn = !this.isMicOn;
            
            const micBtn = document.getElementById(`${prefix}MicBtn`);
            const micImg = micBtn.querySelector('img');
            
            if (this.isMicOn) {
                micBtn.className = 'control-btn mic-on';
                micImg.src = 'icons/mic-on.png';
            } else {
                micBtn.className = 'control-btn mic-off';
                micImg.src = 'icons/mic-off.png';
            }
            
            await this.updateLocalStream();
            
        } finally {
            this.isUpdatingMicrophone = false;
        }
    }
    
    async requestVideoPermissionIfNeeded() {
        // Check if we already have video permissions
        try {
            const permissions = await navigator.permissions.query({ name: 'camera' });
            if (permissions.state === 'granted') {
                return true;
            }
        } catch (error) {
            // Permissions API not supported, continue with stream request
        }
        
        // Request video permission by getting a temporary stream
        try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
            tempStream.getTracks().forEach(track => track.stop());
            
            // Update device list with video devices now that we have permission
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.videoInputDevices = devices.filter(device => device.kind === 'videoinput');
            if (this.videoInputDevices.length > 0 && !this.currentVideoDevice) {
                this.currentVideoDevice = this.videoInputDevices[0].deviceId;
            }
            this.updateDeviceLists();
            
            return true;
        } catch (error) {
            console.error('Error requesting video permission:', error);
            return false;
        }
    }
    
    async toggleCamera(prefix) {
        // Prevent rapid clicking
        if (this.isUpdatingCamera) {
            console.log('Camera is already being updated, ignoring click');
            return;
        }
        
        this.isUpdatingCamera = true;
        
        try {
            const newCamState = !this.isCamOn;
            console.log(`Toggling camera from ${this.isCamOn} to ${newCamState}`);
            
            // If turning camera on, request permission first
            if (newCamState && !this.isCamOn) {
                const hasPermission = await this.requestVideoPermissionIfNeeded();
                if (!hasPermission) {
                    console.log('Video permission denied, keeping camera off');
                    return;
                }
            }
            
            const camBtn = document.getElementById(`${prefix}CamBtn`);
            const camImg = camBtn.querySelector('img');
            
            // Update UI first
            if (newCamState) {
                camBtn.className = 'control-btn cam-on';
                camImg.src = 'icons/cam-on.png';
            } else {
                camBtn.className = 'control-btn cam-off';
                camImg.src = 'icons/cam-off.png';
            }
            
            // Update state
            this.isCamOn = newCamState;
            
            // Update stream
            await this.updateLocalStream();
            
        } catch (error) {
            console.error('Error toggling camera:', error);
            // Revert UI state on error
            const camBtn = document.getElementById(`${prefix}CamBtn`);
            const camImg = camBtn.querySelector('img');
            
            if (this.isCamOn) {
                camBtn.className = 'control-btn cam-on';
                camImg.src = 'icons/cam-on.png';
            } else {
                camBtn.className = 'control-btn cam-off';
                camImg.src = 'icons/cam-off.png';
            }
        } finally {
            this.isUpdatingCamera = false;
        }
    }
    
    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: { ideal: 10, max: 15 }
                    },
                    audio: true
                });
                
                this.isScreenSharing = true;
                this.updateScreenShareButton();
                
                // Replace video track in all peer connections
                this.replaceVideoTrack(this.screenStream.getVideoTracks()[0]);
                
                // Listen for screen share end
                this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
                    this.stopScreenShare();
                });
                
            } catch (error) {
                console.error('Error starting screen share:', error);
            }
        } else {
            this.stopScreenShare();
        }
    }
    
    stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }
        
        this.isScreenSharing = false;
        this.updateScreenShareButton();
        
        // Replace with camera track if camera is on
        if (this.isCamOn && this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                this.replaceVideoTrack(videoTrack);
            }
        } else {
            this.replaceVideoTrack(null);
        }
    }
    
    updateScreenShareButton() {
        const screenBtn = document.getElementById('screenShareBtn');
        const screenImg = screenBtn.querySelector('img');
        
        if (this.isScreenSharing) {
            screenBtn.className = 'control-btn screen-on';
            screenImg.src = 'icons/screen-on.png';
        } else {
            screenBtn.className = 'control-btn screen-off';
            screenImg.src = 'icons/screen-off.png';
        }
    }
    
    async replaceVideoTrack(newTrack) {
        for (const [peerId, peer] of this.peers) {
            try {
                const sender = peer.peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                
                if (sender) {
                    await sender.replaceTrack(newTrack);
                }
            } catch (error) {
                console.error('Error replacing video track for peer:', peerId, error);
            }
        }
    }
    
    updateLocalVideoDisplay() {
        if (this.localVideo) {
            if (this.isCamOn && this.localStream) {
                this.localVideo.srcObject = this.localStream;
                this.localVideo.style.display = 'block';
                this.localVideo.parentElement.style.background = '';
            } else {
                this.localVideo.srcObject = null;
                this.localVideo.style.display = 'none';
                this.localVideo.parentElement.style.background = '#90EE90';
            }
        }
    }
    
    async updateLocalStream() {
        try {
            console.log(`Updating local stream - Mic: ${this.isMicOn}, Camera: ${this.isCamOn}`);
            
            // Stop existing stream tracks carefully
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    track.stop();
                    console.log(`Stopped ${track.kind} track`);
                });
                this.localStream = null;
            }
            
            // Build constraints based on current state
            const constraints = {};
            
            // Audio constraints
            if (this.isMicOn) {
                constraints.audio = {
                    deviceId: this.currentAudioDevice ? { exact: this.currentAudioDevice } : undefined
                };
            } else {
                constraints.audio = false;
            }
            
            // Video constraints
            if (this.isCamOn) {
                constraints.video = {
                    deviceId: this.currentVideoDevice ? { exact: this.currentVideoDevice } : undefined,
                    width: { ideal: 480 },
                    height: { ideal: 360 }
                };
            } else {
                constraints.video = false;
            }
            
            console.log('Getting user media with constraints:', constraints);
            
            // Get new stream only if we need audio or video
            if (constraints.audio || constraints.video) {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                console.log('Got new stream with tracks:', this.localStream.getTracks().map(t => t.kind));
            }
            
            // Update local video display
            this.updateLocalVideoDisplay();
            
        } catch (error) {
            console.error('Error updating local stream:', error);
            // Ensure video display is updated even on error
            this.updateLocalVideoDisplay();
        }
    }
    
    async joinMeeting() {
        this.userName = document.getElementById('nameInput').value || 'Metabro';
        
        // Setup meeting controls
        this.setupMediaControls('meeting');
        
        // Connect to signaling server
        this.socket = io();
        this.setupSocketEvents();
        
        // Join the room
        this.socket.emit('join-room', {
            roomId: this.meetId,
            userName: this.userName
        });
        
        this.showMeetingScreen();
    }
    
    setupSocketEvents() {
        this.socket.on('all-users', (users) => {
            console.log('All users:', users);
            users.forEach(user => {
                this.connectToPeer(user.id, user.userName, true);
            });
        });
        
        this.socket.on('user-joined', (user) => {
            console.log('User joined:', user);
            this.connectToPeer(user.id, user.userName, false);
        });
        
        this.socket.on('signal-received', ({ signal, callerID }) => {
            console.log('Signal received from:', callerID);
            this.handleSignalReceived(signal, callerID);
        });
        
        this.socket.on('signal-returned', ({ signal, id }) => {
            console.log('Signal returned from:', id);
            const peer = this.peers.get(id);
            if (peer) {
                peer.signal(signal);
            }
        });
        
        this.socket.on('user-left', ({ id }) => {
            console.log('User left:', id);
            this.removePeer(id);
        });
    }
    
    connectToPeer(peerId, userName, isInitiator) {
        console.log(`Connecting to peer ${peerId} (${userName}) as ${isInitiator ? 'initiator' : 'receiver'}`);
        
        const peer = new SimplePeer({
            initiator: isInitiator,
            trickle: false,
            config: this.peerConfig,
            stream: this.localStream
        });
        
        peer.on('signal', (signal) => {
            console.log('Sending signal to:', peerId);
            if (isInitiator) {
                this.socket.emit('send-signal', {
                    userToSignal: peerId,
                    callerID: this.socket.id,
                    signal
                });
            } else {
                this.socket.emit('return-signal', {
                    callerID: peerId,
                    signal
                });
            }
        });
        
        peer.on('connect', () => {
            console.log('Connected to peer:', peerId);
        });
        
        peer.on('stream', (stream) => {
            console.log('Received stream from peer:', peerId);
            this.addParticipant(peerId, userName, stream);
        });
        
        peer.on('error', (error) => {
            console.error('Peer error:', error);
        });
        
        // Store peer info
        this.peers.set(peerId, peer);
        this.participants.set(peerId, { userName, stream: null });
        
        // Add placeholder participant tile
        this.addParticipant(peerId, userName, null);
    }
    
    handleSignalReceived(signal, callerID) {
        if (!this.peers.has(callerID)) {
            // This is a new connection
            this.connectToPeer(callerID, 'Unknown', false);
        }
        
        const peer = this.peers.get(callerID);
        if (peer) {
            peer.signal(signal);
        }
    }
    
    addParticipant(peerId, userName, stream) {
        const participantsGrid = document.getElementById('participantsGrid');
        
        // Remove existing tile if it exists
        const existingTile = document.getElementById(`participant-${peerId}`);
        if (existingTile) {
            existingTile.remove();
        }
        
        // Create participant tile
        const tile = document.createElement('div');
        tile.className = 'participant-tile';
        tile.id = `participant-${peerId}`;
        
        if (stream && stream.getVideoTracks().length > 0) {
            // Video available
            const video = document.createElement('video');
            video.className = 'participant-video';
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            tile.appendChild(video);
            
            // Name overlay
            const nameOverlay = document.createElement('div');
            nameOverlay.className = 'participant-name-overlay';
            nameOverlay.textContent = userName;
            tile.appendChild(nameOverlay);
        } else {
            // No video - show name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'participant-name-large';
            nameDiv.textContent = userName;
            tile.appendChild(nameDiv);
        }
        
        // Muted indicator
        if (stream && stream.getAudioTracks().length > 0) {
            const audioTrack = stream.getAudioTracks()[0];
            if (!audioTrack.enabled) {
                const mutedIndicator = document.createElement('div');
                mutedIndicator.className = 'participant-muted';
                mutedIndicator.innerHTML = '<img src="icons/mic-off.png" alt="Muted">';
                tile.appendChild(mutedIndicator);
            }
        }
        
        // Click handler for fullscreen
        tile.addEventListener('click', () => {
            this.toggleFullscreen(peerId, stream);
        });
        
        participantsGrid.appendChild(tile);
        
        // Update participant info
        this.participants.set(peerId, { userName, stream });
        
        // Update grid layout
        this.updateGridLayout();
    }
    
    removePeer(peerId) {
        // Remove peer connection
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.destroy();
            this.peers.delete(peerId);
        }
        
        // Remove participant
        this.participants.delete(peerId);
        
        // Remove tile
        const tile = document.getElementById(`participant-${peerId}`);
        if (tile) {
            tile.remove();
        }
        
        // Update grid layout
        this.updateGridLayout();
        
        // Exit fullscreen if this was the fullscreen participant
        if (this.isFullscreen && this.fullscreenPeerId === peerId) {
            this.toggleFullscreen(null, null);
        }
    }
    
    updateGridLayout() {
        const participantsGrid = document.getElementById('participantsGrid');
        const participantCount = participantsGrid.children.length;
        
        // Remove all grid classes
        participantsGrid.className = 'participants-grid';
        
        // Add appropriate grid class
        if (participantCount <= 9) {
            participantsGrid.classList.add(`grid-${participantCount}`);
        } else {
            participantsGrid.classList.add('grid-9');
        }
    }
    
    toggleFullscreen(peerId, stream) {
        const fullscreenVideo = document.getElementById('fullscreenVideo');
        const participantsGrid = document.getElementById('participantsGrid');
        
        if (!this.isFullscreen && peerId && stream) {
            // Enter fullscreen
            this.isFullscreen = true;
            this.fullscreenPeerId = peerId;
            
            const videoElement = fullscreenVideo.querySelector('.fullscreen-video-element');
            videoElement.srcObject = stream;
            
            const participant = this.participants.get(peerId);
            const nameElement = fullscreenVideo.querySelector('.participant-name');
            nameElement.textContent = participant ? participant.userName : 'Unknown';
            
            fullscreenVideo.classList.remove('hidden');
            participantsGrid.style.display = 'none';
        } else {
            // Exit fullscreen
            this.isFullscreen = false;
            this.fullscreenPeerId = null;
            
            fullscreenVideo.classList.add('hidden');
            participantsGrid.style.display = 'grid';
        }
    }
    
    leaveMeeting() {
        // Close all peer connections
        this.peers.forEach(peer => peer.destroy());
        this.peers.clear();
        this.participants.clear();
        
        // Stop local streams
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
        }
        
        // Disconnect socket
        if (this.socket) {
            this.socket.disconnect();
        }
        
        // Redirect to main page
        window.location.href = '/newmeet';
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MetachatMeeting();
});