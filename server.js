const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mood-app';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mood Schema
const moodSchema = new mongoose.Schema({
  mood: {
    type: String,
    required: true,
    enum: ['happy', 'excited', 'loved', 'calm', 'sad', 'tired', 'stressed', 'angry', 'silly']
  },
  emoji: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  userId: {
    type: String,
    default: 'girlfriend' // Simple user identification
  }
});

const Mood = mongoose.model('Mood', moodSchema);

// API Routes

// Get current mood
app.get('/api/mood/current', async (req, res) => {
  try {
    const currentMood = await Mood.findOne().sort({ timestamp: -1 });
    
    if (!currentMood) {
      return res.json({ success: true, mood: null });
    }

    res.json({
      success: true,
      mood: {
        mood: currentMood.mood,
        emoji: currentMood.emoji,
        timestamp: currentMood.timestamp,
        timeAgo: getTimeAgo(currentMood.timestamp)
      }
    });
  } catch (error) {
    console.error('Error fetching mood:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch mood' });
  }
});

// Set new mood
app.post('/api/mood/set', async (req, res) => {
  try {
    const { mood, emoji } = req.body;

    if (!mood || !emoji) {
      return res.status(400).json({ success: false, error: 'Mood and emoji are required' });
    }

    const newMood = new Mood({
      mood,
      emoji,
      userId: 'girlfriend'
    });

    await newMood.save();

    const moodData = {
      mood: newMood.mood,
      emoji: newMood.emoji,
      timestamp: newMood.timestamp,
      timeAgo: 'Just now'
    };

    // Emit to all connected clients
    io.emit('mood-updated', moodData);

    res.json({ success: true, mood: moodData });
  } catch (error) {
    console.error('Error setting mood:', error);
    res.status(500).json({ success: false, error: 'Failed to set mood' });
  }
});

// Get mood history
app.get('/api/mood/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const moods = await Mood.find()
      .sort({ timestamp: -1 })
      .limit(limit);

    const moodHistory = moods.map(mood => ({
      mood: mood.mood,
      emoji: mood.emoji,
      timestamp: mood.timestamp,
      timeAgo: getTimeAgo(mood.timestamp)
    }));

    res.json({ success: true, history: moodHistory });
  } catch (error) {
    console.error('Error fetching mood history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch mood history' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Utility function to calculate time ago
function getTimeAgo(timestamp) {
  const now = new Date();
  const moodTime = new Date(timestamp);
  const diffMinutes = Math.floor((now - moodTime) / (1000 * 60));

  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else {
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }
  }
}

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

module.exports = app;