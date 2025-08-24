const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;
const MEETINGS_FILE = path.join(__dirname, 'meetings.json');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Utility functions
async function loadMeetings() {
    try {
        const data = await fs.readFile(MEETINGS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

async function saveMeetings(meetings) {
    await fs.writeFile(MEETINGS_FILE, JSON.stringify(meetings, null, 2));
}

function generateMeetId() {
    return crypto.randomBytes(16).toString('hex');
}

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.redirect('/newmeet');
});

app.get('/newmeet', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve meeting pages
app.get('/:meetId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'meet.html'));
});

// API Routes

// Create new meeting
app.post('/api/meet/create', async (req, res) => {
    try {
        const meetId = generateMeetId();
        const meetings = await loadMeetings();
        
        meetings[meetId] = {
            lastAccess: new Date().toISOString()
        };
        
        await saveMeetings(meetings);
        
        res.json({ meetId });
    } catch (error) {
        console.error('Error creating meeting:', error);
        res.status(500).json({ error: 'Failed to create meeting' });
    }
});

// Check if meeting exists
app.get('/api/meet/check/:meetId', async (req, res) => {
    try {
        const { meetId } = req.params;
        const meetings = await loadMeetings();
        
        if (meetings[meetId]) {
            // Update last access time
            meetings[meetId].lastAccess = new Date().toISOString();
            await saveMeetings(meetings);
            
            res.json({ exists: true });
        } else {
            res.status(404).json({ exists: false });
        }
    } catch (error) {
        console.error('Error checking meeting:', error);
        res.status(500).json({ error: 'Failed to check meeting' });
    }
});

// Socket.IO handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle joining a room
    socket.on('join-room', ({ roomId, userName }) => {
        console.log(`${userName} (${socket.id}) joining room ${roomId}`);
        
        // Get all users currently in the room
        const roomSockets = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        const usersInRoom = roomSockets
            .filter(id => id !== socket.id)
            .map(id => {
                const userSocket = io.sockets.sockets.get(id);
                return {
                    id,
                    userName: userSocket?.userName || 'Unknown'
                };
            });
        
        // Store user name
        socket.userName = userName;
        socket.roomId = roomId;
        
        // Send existing users to the new user
        socket.emit('all-users', usersInRoom);
        
        // Join the room
        socket.join(roomId);
        
        // Notify other users about the new user
        socket.to(roomId).emit('user-joined', {
            id: socket.id,
            userName: userName
        });
    });

    // Handle signaling
    socket.on('send-signal', ({ userToSignal, callerID, signal }) => {
        io.to(userToSignal).emit('signal-received', {
            signal,
            callerID
        });
    });

    socket.on('return-signal', ({ callerID, signal }) => {
        io.to(callerID).emit('signal-returned', {
            signal,
            id: socket.id
        });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-left', {
                id: socket.id
            });
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Metachat server running on http://localhost:${PORT}`);
});