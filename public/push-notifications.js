class PushNotificationManager {
    constructor() {
      this.registration = null;
      this.subscription = null;
      this.vapidPublicKey = null;
      this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    }
  
    async init() {
      if (!this.isSupported) {
        console.warn('Push notifications are not supported in this browser');
        return false;
      }
  
      try {
        // Register service worker
        this.registration = await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registered successfully');
  
        // Get VAPID public key
        await this.fetchVapidPublicKey();
  
        // Check if already subscribed
        this.subscription = await this.registration.pushManager.getSubscription();
        
        if (this.subscription) {
          console.log('Already subscribed to push notifications');
          this.updateUIState(true);
        } else {
          this.updateUIState(false);
        }
  
        return true;
      } catch (error) {
        console.error('Error initializing push notifications:', error);
        return false;
      }
    }
  
    async fetchVapidPublicKey() {
      try {
        const response = await fetch('/api/vapid-public-key');
        const data = await response.json();
        this.vapidPublicKey = data.publicKey;
      } catch (error) {
        console.error('Error fetching VAPID public key:', error);
        throw error;
      }
    }
  
    async subscribe() {
      if (!this.registration || !this.vapidPublicKey) {
        console.error('Service worker not registered or VAPID key not available');
        return false;
      }
  
      try {
        // Request notification permission
        const permission = await Notification.requestPermission();
        
        if (permission !== 'granted') {
          console.warn('Notification permission denied');
          return false;
        }
  
        // Subscribe to push notifications
        this.subscription = await this.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlB64ToUint8Array(this.vapidPublicKey)
        });
  
        // Send subscription to server
        const response = await fetch('/api/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(this.subscription)
        });
  
        const result = await response.json();
        
        if (result.success) {
          console.log('Successfully subscribed to push notifications');
          this.updateUIState(true);
          this.showNotification('Subscribed!', 'You will now receive mood update notifications.');
          return true;
        } else {
          console.error('Failed to save subscription:', result.error);
          return false;
        }
      } catch (error) {
        console.error('Error subscribing to push notifications:', error);
        return false;
      }
    }
  
    async unsubscribe() {
      if (!this.subscription) {
        console.warn('No active subscription to unsubscribe from');
        return false;
      }
  
      try {
        // Unsubscribe from push manager
        const success = await this.subscription.unsubscribe();
        
        if (success) {
          // Remove subscription from server
          await fetch('/api/unsubscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ endpoint: this.subscription.endpoint })
          });
  
          this.subscription = null;
          console.log('Successfully unsubscribed from push notifications');
          this.updateUIState(false);
          this.showNotification('Unsubscribed', 'You will no longer receive notifications.');
          return true;
        }
        
        return false;
      } catch (error) {
        console.error('Error unsubscribing from push notifications:', error);
        return false;
      }
    }
  
    async sendTestNotification() {
      try {
        const response = await fetch('/api/send-test-notification', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        });
  
        const result = await response.json();
        
        if (result.success) {
          console.log('Test notification sent:', result.message);
          // Show local notification as feedback
          this.showNotification('Test Sent!', 'Check for the test notification.');
        } else {
          console.error('Failed to send test notification:', result.error);
        }
      } catch (error) {
        console.error('Error sending test notification:', error);
      }
    }
  
    updateUIState(isSubscribed) {
      const subscribeBtn = document.getElementById('subscribe-btn');
      const unsubscribeBtn = document.getElementById('unsubscribe-btn');
      const testBtn = document.getElementById('test-notification-btn');
      const statusEl = document.getElementById('notification-status');
  
      if (subscribeBtn) {
        subscribeBtn.style.display = isSubscribed ? 'none' : 'inline-block';
        subscribeBtn.disabled = false;
      }
  
      if (unsubscribeBtn) {
        unsubscribeBtn.style.display = isSubscribed ? 'inline-block' : 'none';
        unsubscribeBtn.disabled = false;
      }
  
      if (testBtn) {
        testBtn.style.display = isSubscribed ? 'inline-block' : 'none';
        testBtn.disabled = false;
      }
  
      if (statusEl) {
        statusEl.textContent = isSubscribed ? 
          'Subscribed to notifications' : 
          'Not subscribed to notifications';
        statusEl.className = isSubscribed ? 'status-subscribed' : 'status-unsubscribed';
      }
    }
  
    showNotification(title, body, options = {}) {
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/icon-192x192.png',
          badge: '/badge-72x72.png',
          ...options
        });
      }
    }
  
    urlB64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
  
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
  
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }
  
    getPermissionStatus() {
      if (!('Notification' in window)) {
        return 'not-supported';
      }
      return Notification.permission;
    }
  
    isSubscribed() {
      return this.subscription !== null;
    }
  }
  
  // Initialize push notification manager
  const pushManager = new PushNotificationManager();
  
  // Auto-initialize when DOM is loaded
  document.addEventListener('DOMContentLoaded', async () => {
    await pushManager.init();
    
    // Set up event listeners
    const subscribeBtn = document.getElementById('subscribe-btn');
    const unsubscribeBtn = document.getElementById('unsubscribe-btn');
    const testBtn = document.getElementById('test-notification-btn');
  
    if (subscribeBtn) {
      subscribeBtn.addEventListener('click', async () => {
        subscribeBtn.disabled = true;
        subscribeBtn.textContent = 'Subscribing...';
        
        const success = await pushManager.subscribe();
        
        if (!success) {
          subscribeBtn.disabled = false;
          subscribeBtn.textContent = 'Enable Notifications';
        }
      });
    }
  
    if (unsubscribeBtn) {
      unsubscribeBtn.addEventListener('click', async () => {
        unsubscribeBtn.disabled = true;
        unsubscribeBtn.textContent = 'Unsubscribing...';
        
        const success = await pushManager.unsubscribe();
        
        if (!success) {
          unsubscribeBtn.disabled = false;
          unsubscribeBtn.textContent = 'Disable Notifications';
        }
      });
    }
  
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = 'Sending...';
        
        await pushManager.sendTestNotification();
        
        setTimeout(() => {
          testBtn.disabled = false;
          testBtn.textContent = 'Send Test';
        }, 2000);
      });
    }
  });
  
  // Export for use in other scripts
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PushNotificationManager;
  }