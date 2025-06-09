const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const webpush = require('web-push');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configure web-push
webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'your-email@example.com'),
  process.env.VAPID_PUBLIC_KEY || 'your-public-key',
  process.env.VAPID_PRIVATE_KEY || 'your-private-key'
);

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

// Push Subscription Schema
const subscriptionSchema = new mongoose.Schema({
  endpoint: {
    type: String,
    required: true,
    unique: true
  },
  keys: {
    p256dh: {
      type: String,
      required: true
    },
    auth: {
      type: String,
      required: true
    }
  },
  userId: {
    type: String,
    default: 'default'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Mood = mongoose.model('Mood', moodSchema);
const PushSubscription = mongoose.model('PushSubscription', subscriptionSchema);

// API Routes

// Get VAPID public key
app.get('/api/vapid-public-key', (req, res) => {
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY || 'your-public-key'
  });
});

// Subscribe to push notifications
app.post('/api/subscribe', async (req, res) => {
  try {
    const subscription = req.body;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid subscription object' 
      });
    }

    // Save or update subscription
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        userId: req.body.userId || 'default'
      },
      { upsert: true, new: true }
    );

    console.log('New push subscription saved');
    res.json({ success: true, message: 'Subscription saved successfully' });
  } catch (error) {
    console.error('Error saving subscription:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to save subscription' 
    });
  }
});

// Unsubscribe from push notifications
app.post('/api/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    
    if (!endpoint) {
      return res.status(400).json({ 
        success: false, 
        error: 'Endpoint is required' 
      });
    }

    await PushSubscription.deleteOne({ endpoint });
    res.json({ success: true, message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('Error unsubscribing:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to unsubscribe' 
    });
  }
});

// Send test notification
app.post('/api/send-test-notification', async (req, res) => {
  try {
    const subscriptions = await PushSubscription.find();
    
    if (subscriptions.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No subscribers to send notifications to' 
      });
    }

    const payload = JSON.stringify({
      title: 'Test Notification',
      body: 'This is a test push notification from your mood app!',
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: 'test',
      data: {
        url: '/',
        timestamp: Date.now()
      }
    });

    const results = await sendNotificationToAll(subscriptions, payload);
    
    res.json({ 
      success: true, 
      message: `Test notifications sent to ${results.successful} subscribers`,
      details: results
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send test notification' 
    });
  }
});

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

// Set new mood (enhanced with notifications)
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

    // Send push notifications
    await sendMoodUpdateNotification(moodData);

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

// Push notification functions
async function sendMoodUpdateNotification(moodData) {
  try {
    const subscriptions = await PushSubscription.find();
    
    if (subscriptions.length === 0) {
      console.log('No subscribers for mood update notification');
      return;
    }

    const moodMessages = {
      happy: "Someone's feeling happy! 😊",
      excited: "Excitement is in the air! 🎉",
      loved: "Love is all around! 💕",
      calm: "Peaceful vibes detected 🧘‍♀️",
      sad: "Sending you virtual hugs 🤗",
      tired: "Time for some rest? 😴",
      stressed: "Take a deep breath 🌱",
      angry: "Let's work through this together 💪",
      silly: "Someone's being silly! 🤪"
    };

    const payload = JSON.stringify({
      title: 'Mood Update',
      body: moodMessages[moodData.mood] || `Mood updated to ${moodData.mood} ${moodData.emoji}`,
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: 'mood-update',
      data: {
        url: '/',
        mood: moodData.mood,
        emoji: moodData.emoji,
        timestamp: moodData.timestamp
      },
      actions: [
        {
          action: 'view',
          title: 'View Details'
        },
        {
          action: 'close',
          title: 'Close'
        }
      ]
    });

    const results = await sendNotificationToAll(subscriptions, payload);
    console.log(`Mood update notifications sent to ${results.successful} subscribers`);
  } catch (error) {
    console.error('Error sending mood update notification:', error);
  }
}

async function sendNotificationToAll(subscriptions, payload) {
  const results = {
    successful: 0,
    failed: 0,
    errors: []
  };

  const promises = subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys
        },
        payload
      );
      results.successful++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        endpoint: subscription.endpoint,
        error: error.message
      });

      // Remove invalid subscriptions
      if (error.statusCode === 410 || error.statusCode === 404) {
        await PushSubscription.deleteOne({ endpoint: subscription.endpoint });
        console.log('Removed invalid subscription:', subscription.endpoint);
      }
    }
  });

  await Promise.all(promises);
  return results;
}

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