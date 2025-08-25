// Meeting page JavaScript - handles lobby, WebRTC, and meeting room

class MetachatMeeting {
    constructor() {
        this.meetId = this.extractMeetIdFromUrl();
        this.socket = null;
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
        
        // Separate audio and video streams
        this.audioStream = null;
        this.videoStream = null;
        
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
            await this.updateAudioStream();
        });
        
        this.populateDeviceList('lobbyCamDevices', this.videoInputDevices, this.currentVideoDevice, async (deviceId) => {
            this.currentVideoDevice = deviceId;
            await this.updateVideoStream();
        });
        
        // Update meeting device lists
        this.populateDeviceList('meetingMicDevices', this.audioInputDevices, this.currentAudioDevice, async (deviceId) => {
            this.currentAudioDevice = deviceId;
            await this.updateAudioStream();
        });
        
        this.populateDeviceList('meetingCamDevices', this.videoInputDevices, this.currentVideoDevice, async (deviceId) => {
            this.currentVideoDevice = deviceId;
            await this.updateVideoStream();
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
    
    updateUIButtonStates(prefix) {
        // Update microphone button
        const micBtn = document.getElementById(`${prefix}MicBtn`);
        const micImg = micBtn.querySelector('img');
        
        if (this.isMicOn) {
            micBtn.className = 'control-btn mic-on';
            micImg.src = 'icons/mic-on.png';
        } else {
            micBtn.className = 'control-btn mic-off';
            micImg.src = 'icons/mic-off.png';
        }
        
        // Update camera button
        const camBtn = document.getElementById(`${prefix}CamBtn`);
        const camImg = camBtn.querySelector('img');
        
        if (this.isCamOn) {
            camBtn.className = 'control-btn cam-on';
            camImg.src = 'icons/cam-on.png';
        } else {
            camBtn.className = 'control-btn cam-off';
            camImg.src = 'icons/cam-off.png';
        }
        
        // Update screen share button (only in meeting)
        if (prefix === 'meeting') {
            this.updateScreenShareButton();
        }
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
        
        // Sync UI button states with internal state
        this.updateUIButtonStates('lobby');
        
        // Initialize with microphone only (camera off by default)
        this.updateAudioStream();
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
        
        // Disable the button
        const micBtn = document.getElementById(`${prefix}MicBtn`);
        micBtn.disabled = true;
        
        try {
            this.isMicOn = !this.isMicOn;
            console.log(`Toggling microphone to: ${this.isMicOn}`);
            
            const micImg = micBtn.querySelector('img');
            
            if (this.isMicOn) {
                micBtn.className = 'control-btn mic-on';
                micImg.src = 'icons/mic-on.png';
            } else {
                micBtn.className = 'control-btn mic-off';
                micImg.src = 'icons/mic-off.png';
            }
            
            await this.updateAudioStream();
            
            // Update local participant tile if in meeting
            if (this.isInMeeting) {
                this.updateLocalParticipantTile();
            }
            
        } finally {
            // Re-enable the button
            micBtn.disabled = false;
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
        
        // Disable the button
        const camBtn = document.getElementById(`${prefix}CamBtn`);
        camBtn.disabled = true;
        
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
            await this.updateVideoStream();
            
        } catch (error) {
            console.error('Error toggling camera:', error);
            // Revert UI state on error
            const camImg = camBtn.querySelector('img');
            
            if (this.isCamOn) {
                camBtn.className = 'control-btn cam-on';
                camImg.src = 'icons/cam-on.png';
            } else {
                camBtn.className = 'control-btn cam-off';
                camImg.src = 'icons/cam-off.png';
            }
        } finally {
            // Re-enable the button
            camBtn.disabled = false;
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
                
                // Update video tracks with screen sharing
                this.sendVideoStreamToPeers();
                
                // Update local participant tile
                this.updateLocalParticipantTile();
                
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
        
        // Update video tracks
        this.sendVideoStreamToPeers();
        
        // Update local participant tile
        this.updateLocalParticipantTile();
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
    
    updateLocalVideoDisplay() {
        if (this.localVideo) {
            if (this.isCamOn && this.videoStream) {
                this.localVideo.srcObject = this.videoStream;
                this.localVideo.style.display = 'block';
                this.localVideo.parentElement.style.background = '';
            } else {
                this.localVideo.srcObject = null;
                this.localVideo.style.display = 'none';
                this.localVideo.parentElement.style.background = '#90EE90';
            }
        }
    }
    
    async updateAudioStream() {
        try {
            console.log(`Updating audio stream - Mic: ${this.isMicOn}`);
            
            // Stop existing audio stream
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => {
                    track.stop();
                    console.log('Stopped audio track');
                });
                this.audioStream = null;
            }
            
            // Create new audio stream if microphone is on
            if (this.isMicOn) {
                const audioConstraints = {
                    audio: {
                        deviceId: this.currentAudioDevice ? { exact: this.currentAudioDevice } : undefined
                    }
                };
                
                this.audioStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
                console.log('Got new audio stream');
            }
            
            // Update peer connections with new audio stream
            this.sendAudioStreamToPeers();
            
            // Update local video display
            this.updateLocalVideoDisplay();
            
            // Update local participant tile if in meeting
            if (this.isInMeeting) {
                this.updateLocalParticipantTile();
            }
            
        } catch (error) {
            console.error('Error updating audio stream:', error);
        }
    }
    
    async updateVideoStream() {
        try {
            console.log(`Updating video stream - Camera: ${this.isCamOn}`);
            
            // Stop existing video stream
            if (this.videoStream) {
                this.videoStream.getTracks().forEach(track => {
                    track.stop();
                    console.log('Stopped video track');
                });
                this.videoStream = null;
            }
            
            // Create new video stream if camera is on
            if (this.isCamOn) {
                const videoConstraints = {
                    video: {
                        deviceId: this.currentVideoDevice ? { exact: this.currentVideoDevice } : undefined,
                        width: { ideal: 480 },
                        height: { ideal: 360 }
                    }
                };
                
                this.videoStream = await navigator.mediaDevices.getUserMedia(videoConstraints);
                console.log('Got new video stream');
            }
            
            // Update peer connections with new video stream
            this.sendVideoStreamToPeers();
            
            // Update local video display
            this.updateLocalVideoDisplay();
            
            // Update local participant tile if in meeting
            if (this.isInMeeting) {
                this.updateLocalParticipantTile();
            }
            
        } catch (error) {
            console.error('Error updating video stream:', error);
        }
    }
    
    sendAudioStreamToPeers() {
        this.updatePeerConnectionsWithNewStreams('audio');
    }
    
    sendVideoStreamToPeers() {
        this.updatePeerConnectionsWithNewStreams('video');
    }
    
    updatePeerConnectionsWithNewStreams(changedStreamType) {
        if (this.peers.size === 0) {
            console.log('No peer connections to update');
            return;
        }
        
        console.log(`Updating peer connections due to ${changedStreamType} stream change`);
        
        // Notify server about stream update so all participants can coordinate reconnection
        this.socket.emit('stream-update', {
            roomId: this.meetId,
            streamType: changedStreamType,
            enabled: changedStreamType === 'audio' ? this.isMicOn : this.isCamOn
        });
        
        // Store current peer info for recreation
        const peersToRecreate = new Map();
        
        for (const [peerId, peer] of this.peers) {
            const participant = this.participants.get(peerId);
            if (participant) {
                peersToRecreate.set(peerId, {
                    userName: participant.userName
                });
            }
            
            // Destroy old peer
            peer.destroy();
        }
        
        // Clear current peers
        this.peers.clear();
        
        // Wait a bit for all participants to destroy their connections
        setTimeout(() => {
            for (const [peerId, info] of peersToRecreate) {
                console.log(`Recreating connection to ${peerId} with updated streams`);
                this.connectToPeer(peerId, info.userName, true); // Always be initiator for stream updates
            }
        }, 150); // Longer delay to ensure coordination
    }
    

    async joinMeeting() {
        this.userName = document.getElementById('nameInput').value || 'Metabro';
        
        // Setup meeting controls
        this.setupMediaControls('meeting');
        
        // Sync UI button states with internal state
        this.updateUIButtonStates('meeting');
        
        // Connect to signaling server
        this.socket = io();
        this.setupSocketEvents();
        
        // Join the room
        this.socket.emit('join-room', {
            roomId: this.meetId,
            userName: this.userName
        });
        
        this.showMeetingScreen();
        
        // Add local participant tile
        this.addLocalParticipantTile();
        
        // Update grid layout after DOM is rendered
        setTimeout(() => {
            this.updateGridLayout();
        }, 100);
        
        // Add click handler to fullscreen video for exiting fullscreen
        const fullscreenVideo = document.getElementById('fullscreenVideo');
        fullscreenVideo.addEventListener('click', () => {
            if (this.isFullscreen) {
                this.toggleFullscreen(null, null);
            }
        });
        
        // Add resize listener for responsive grid
        window.addEventListener('resize', () => {
            if (this.isInMeeting) {
                this.updateGridLayout();
            }
        });
        
        // Add escape key listener for exiting fullscreen
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isFullscreen) {
                this.toggleFullscreen(null, null);
            }
        });
    }
    
    addLocalParticipantTile() {
        const participantsGrid = document.getElementById('participantsGrid');
        
        // Create local participant tile
        const tile = document.createElement('div');
        tile.className = 'participant-tile';
        tile.id = 'participant-local';
        
        if (this.isCamOn && this.videoStream) {
            // Video available - show video stream
            const video = document.createElement('video');
            video.className = 'participant-video';
            video.srcObject = this.videoStream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true; // Always mute local video to prevent feedback
            tile.appendChild(video);
            
            // Name overlay
            const nameOverlay = document.createElement('div');
            nameOverlay.className = 'participant-name-overlay';
            nameOverlay.textContent = this.userName + ' (Вы)';
            tile.appendChild(nameOverlay);
        } else if (this.isScreenSharing && this.screenStream) {
            // Screen sharing - show screen stream
            const video = document.createElement('video');
            video.className = 'participant-video';
            video.srcObject = this.screenStream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            tile.appendChild(video);
            
            // Name overlay
            const nameOverlay = document.createElement('div');
            nameOverlay.className = 'participant-name-overlay';
            nameOverlay.textContent = this.userName + ' (Вы)';
            tile.appendChild(nameOverlay);
        } else {
            // No video - show name only
            const nameDiv = document.createElement('div');
            nameDiv.className = 'participant-name-large';
            nameDiv.textContent = this.userName + ' (Вы)';
            tile.appendChild(nameDiv);
        }
        
        // Muted indicator if microphone is off
        if (!this.isMicOn) {
            const mutedIndicator = document.createElement('div');
            mutedIndicator.className = 'participant-muted';
            mutedIndicator.innerHTML = '<img src="icons/mic-off.png" alt="Muted">';
            tile.appendChild(mutedIndicator);
        }
        
        // Click handler for fullscreen
        tile.addEventListener('click', () => {
            if (this.isCamOn || this.isScreenSharing) {
                const stream = this.isScreenSharing ? this.screenStream : this.videoStream;
                this.toggleFullscreen('local', stream);
            }
        });
        
        participantsGrid.appendChild(tile);
        
        // Update grid layout
        this.updateGridLayout();
    }
    
    updateLocalParticipantTile() {
        const localTile = document.getElementById('participant-local');
        if (!localTile) {
            return; // Local tile doesn't exist yet
        }
        
        // Remove old content
        localTile.innerHTML = '';
        
        if (this.isCamOn && this.videoStream) {
            // Video available - show video stream
            const video = document.createElement('video');
            video.className = 'participant-video';
            video.srcObject = this.videoStream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            localTile.appendChild(video);
            
            // Name overlay
            const nameOverlay = document.createElement('div');
            nameOverlay.className = 'participant-name-overlay';
            nameOverlay.textContent = this.userName + ' (Вы)';
            localTile.appendChild(nameOverlay);
        } else if (this.isScreenSharing && this.screenStream) {
            // Screen sharing - show screen stream
            const video = document.createElement('video');
            video.className = 'participant-video';
            video.srcObject = this.screenStream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            localTile.appendChild(video);
            
            // Name overlay
            const nameOverlay = document.createElement('div');
            nameOverlay.className = 'participant-name-overlay';
            nameOverlay.textContent = this.userName + ' (Вы)';
            localTile.appendChild(nameOverlay);
        } else {
            // No video - show name only
            const nameDiv = document.createElement('div');
            nameDiv.className = 'participant-name-large';
            nameDiv.textContent = this.userName + ' (Вы)';
            localTile.appendChild(nameDiv);
        }
        
        // Muted indicator if microphone is off
        if (!this.isMicOn) {
            const mutedIndicator = document.createElement('div');
            mutedIndicator.className = 'participant-muted';
            mutedIndicator.innerHTML = '<img src="icons/mic-off.png" alt="Muted">';
            localTile.appendChild(mutedIndicator);
        }
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
        
        this.socket.on('stream-update-notification', ({ fromUserId, streamType, enabled }) => {
            console.log(`Received stream update notification from ${fromUserId}: ${streamType} ${enabled ? 'enabled' : 'disabled'}`);
            
            // Other participant has updated their stream, we need to prepare for reconnection
            const peer = this.peers.get(fromUserId);
            if (peer) {
                const participant = this.participants.get(fromUserId);
                console.log(`Preparing for reconnection with ${fromUserId}`);
                
                // Destroy our side of the connection
                peer.destroy();
                this.peers.delete(fromUserId);
                
                // Wait a bit, then prepare to receive new connection
                setTimeout(() => {
                    console.log(`Ready to receive new connection from ${fromUserId}`);
                    // The other side will initiate the new connection
                }, 100);
            }
        });
    }
    
    connectToPeer(peerId, userName, isInitiator) {
        console.log(`Connecting to peer ${peerId} (${userName}) as ${isInitiator ? 'initiator' : 'receiver'}`);
        
        // Create initial stream with current audio and video
        const initialStream = new MediaStream();
        
        // Add current audio track if available
        if (this.audioStream && this.audioStream.getAudioTracks().length > 0) {
            initialStream.addTrack(this.audioStream.getAudioTracks()[0]);
            console.log('Added audio track to initial stream');
        }
        
        // Add current video track if available
        if (this.isScreenSharing && this.screenStream && this.screenStream.getVideoTracks().length > 0) {
            initialStream.addTrack(this.screenStream.getVideoTracks()[0]);
            console.log('Added screen track to initial stream');
        } else if (this.videoStream && this.videoStream.getVideoTracks().length > 0) {
            initialStream.addTrack(this.videoStream.getVideoTracks()[0]);
            console.log('Added video track to initial stream');
        }
        
        console.log('Connecting with initial stream tracks:', initialStream.getTracks().map(t => `${t.kind}:${t.enabled}`));
        
        const peer = new SimplePeer({
            initiator: isInitiator,
            trickle: false,
            config: this.peerConfig,
            stream: initialStream
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
            console.log('Received stream from peer:', peerId, {
                audioTracks: stream.getAudioTracks().length,
                videoTracks: stream.getVideoTracks().length,
                audioEnabled: stream.getAudioTracks().length > 0 ? stream.getAudioTracks()[0].enabled : false,
                videoEnabled: stream.getVideoTracks().length > 0 ? stream.getVideoTracks()[0].enabled : false
            });
            this.addParticipant(peerId, userName, stream);
        });
        
        peer.on('error', (error) => {
            console.error('Peer error:', error);
            // Clean up on error
            this.peers.delete(peerId);
        });
        
        // Store peer info
        this.peers.set(peerId, peer);
        this.participants.set(peerId, { userName, stream: null });
        
        // Add placeholder participant tile if no stream yet
        if (!isInitiator) {
            this.addParticipant(peerId, userName, null);
        }
    }
    
    handleSignalReceived(signal, callerID) {
        console.log('Received signal from:', callerID);
        
        // Check if the peer still exists and is not destroyed
        const peer = this.peers.get(callerID);
        if (!peer) {
            console.log(`No peer found for ${callerID}, creating new connection`);
            this.connectToPeer(callerID, 'Unknown', false);
            // Wait for the new peer to be created before signaling
            setTimeout(() => {
                const newPeer = this.peers.get(callerID);
                if (newPeer && !newPeer.destroyed) {
                    try {
                        newPeer.signal(signal);
                    } catch (error) {
                        console.error('Error signaling new peer:', error);
                    }
                }
            }, 50);
            return;
        }
        
        if (peer.destroyed) {
            console.log(`Peer ${callerID} is destroyed, ignoring signal`);
            return;
        }
        
        try {
            peer.signal(signal);
        } catch (error) {
            console.error('Error handling signal from', callerID, ':', error);
            if (error.message.includes('destroyed') || error.message.includes('closed')) {
                console.log(`Cleaning up destroyed peer ${callerID}`);
                this.peers.delete(callerID);
                // Don't recreate here, let the other side initiate
            }
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
        
        // Always create audio element for remote participants (not muted)
        if (stream && stream.getAudioTracks().length > 0) {
            const audio = document.createElement('audio');
            audio.srcObject = stream;
            audio.autoplay = true;
            audio.style.display = 'none'; // Hidden but playing
            tile.appendChild(audio);
            console.log(`Added audio stream for participant ${userName}`);
        }
        
        // Handle video display
        const hasVideo = stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;
        
        if (hasVideo) {
            // Video available - show video stream
            const video = document.createElement('video');
            video.className = 'participant-video';
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true; // Mute video element since we have separate audio element
            tile.appendChild(video);
            
            // Name overlay
            const nameOverlay = document.createElement('div');
            nameOverlay.className = 'participant-name-overlay';
            nameOverlay.textContent = userName;
            tile.appendChild(nameOverlay);
        } else {
            // No video - show name only
            const nameDiv = document.createElement('div');
            nameDiv.className = 'participant-name-large';
            nameDiv.textContent = userName;
            tile.appendChild(nameDiv);
        }
        
        // Muted indicator for audio
        if (stream && stream.getAudioTracks().length > 0) {
            const audioTrack = stream.getAudioTracks()[0];
            if (!audioTrack.enabled) {
                const mutedIndicator = document.createElement('div');
                mutedIndicator.className = 'participant-muted';
                mutedIndicator.innerHTML = '<img src="icons/mic-off.png" alt="Muted">';
                tile.appendChild(mutedIndicator);
            }
        } else if (!stream || stream.getAudioTracks().length === 0) {
            // No audio stream at all
            const mutedIndicator = document.createElement('div');
            mutedIndicator.className = 'participant-muted';
            mutedIndicator.innerHTML = '<img src="icons/mic-off.png" alt="Muted">';
            tile.appendChild(mutedIndicator);
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
        if (this.isFullscreen && (this.fullscreenPeerId === peerId || this.fullscreenPeerId === 'local')) {
            this.toggleFullscreen(null, null);
        }
    }
    
    calculateOptimalGrid(participantCount, containerWidth, containerHeight) {
        if (participantCount === 0) return { cols: 1, rows: 1, tileSize: 0 };
        
        let bestConfig = { cols: 1, rows: 1, tileSize: 0 };
        
        // Try different grid configurations
        for (let cols = 1; cols <= participantCount; cols++) {
            const rows = Math.ceil(participantCount / cols);
            
            // Calculate maximum tile size for this configuration
            const maxTileWidth = (containerWidth - 16) / cols - 8; // Account for padding and gaps
            const maxTileHeight = (containerHeight - 16) / rows - 8;
            const tileSize = Math.min(maxTileWidth, maxTileHeight);
            
            // Skip if tiles would be too small or negative
            if (tileSize <= 0) continue;
            
            // This configuration is better if tiles are larger
            if (tileSize > bestConfig.tileSize) {
                bestConfig = { cols, rows, tileSize };
            }
        }
        
        return bestConfig;
    }
    
    updateGridLayout() {
        const participantsGrid = document.getElementById('participantsGrid');
        const participantCount = participantsGrid.children.length;
        
        if (participantCount === 0) return;
        
        // Get container dimensions
        const containerWidth = participantsGrid.clientWidth;
        const containerHeight = participantsGrid.clientHeight;
        
        // Calculate optimal grid
        const { cols, rows, tileSize } = this.calculateOptimalGrid(participantCount, containerWidth, containerHeight);
        
        // Remove all existing grid classes
        participantsGrid.className = 'participants-grid';
        
        // Apply dynamic grid styling
        participantsGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        participantsGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        participantsGrid.style.placeItems = 'center';
        
        // Apply tile size to all participant tiles
        const tiles = participantsGrid.querySelectorAll('.participant-tile');
        tiles.forEach(tile => {
            tile.style.width = `${tileSize}px`;
            tile.style.height = `${tileSize}px`;
            tile.style.maxWidth = `${tileSize}px`;
            tile.style.maxHeight = `${tileSize}px`;
        });
        
        console.log(`Grid: ${cols}×${rows}, tile size: ${Math.round(tileSize)}px, participants: ${participantCount}`);
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
            
            // Don't mute fullscreen video - we want to hear audio
            if (peerId === 'local') {
                videoElement.muted = true; // Keep local video muted to prevent feedback
            } else {
                videoElement.muted = false; // Allow audio from remote participants
            }
            
            const nameElement = fullscreenVideo.querySelector('.participant-name');
            
            // Handle local participant vs remote participant
            if (peerId === 'local') {
                nameElement.textContent = this.userName + ' (Вы)';
            } else {
                const participant = this.participants.get(peerId);
                nameElement.textContent = participant ? participant.userName : 'Unknown';
            }
            
            fullscreenVideo.classList.remove('hidden');
            participantsGrid.style.display = 'none';
        } else {
            // Exit fullscreen
            this.isFullscreen = false;
            this.fullscreenPeerId = null;
            
            // Stop the video element
            const videoElement = fullscreenVideo.querySelector('.fullscreen-video-element');
            videoElement.srcObject = null;
            
            fullscreenVideo.classList.add('hidden');
            participantsGrid.style.display = 'grid';
        }
    }
    
    leaveMeeting() {
        // Close all peer connections
        this.peers.forEach(peer => peer.destroy());
        this.peers.clear();
        this.participants.clear();
        
        // Remove local participant tile
        const localTile = document.getElementById('participant-local');
        if (localTile) {
            localTile.remove();
        }
        
        // Stop local streams
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
        }
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
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