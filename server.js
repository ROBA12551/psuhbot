const express = require('express');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const ZEFAME_API = 'https://zefame.com/api/v2';
const API_KEY = 'a372c290e5a194628192507663f9cb64';

// Service IDs (free services only)
const SERVICES = {
    instagram_followers: 220,
    instagram_likes: 234,
    instagram_views: 237,
    instagram_comments: 231,
    tiktok_followers: 352,
    tiktok_likes: 351,
    tiktok_views: 350,
    tiktok_comments: 353
};

const cooldowns = new Map();
const COOLDOWN = 30;

// Call Zefame API
async function callZefameAPI(action, data) {
    try {
        const params = new URLSearchParams({
            key: API_KEY,
            action: action,
            ...data
        });

        const response = await axios.post(ZEFAME_API, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000
        });

        return response.data;
    } catch (error) {
        console.error('Zefame API Error:', error.message);
        throw error;
    }
}

// Add order to Zefame
async function addOrder(serviceId, link, quantity) {
    try {
        const response = await callZefameAPI('add', {
            service: serviceId,
            link: link,
            quantity: quantity
        });

        return response;
    } catch (error) {
        throw error;
    }
}

// Get service ID
function getServiceId(platform, type) {
    const key = `${platform}_${type}`;
    return SERVICES[key];
}

// Validate URL
function validateUrl(url, platform) {
    if (platform === 'instagram') {
        return /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|stories|[\w\.]+)/i.test(url);
    } else {
        return /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\w\.-]+/i.test(url);
    }
}

// Check cooldown
function getCooldownRemaining(identifier) {
    if (!cooldowns.has(identifier)) return 0;
    const elapsed = Date.now() - cooldowns.get(identifier);
    const remaining = Math.max(0, COOLDOWN * 1000 - elapsed);
    return Math.ceil(remaining / 1000);
}

// Set cooldown
function setCooldown(identifier) {
    cooldowns.set(identifier, Date.now());
}

// Routes
app.post('/api/boost', async (req, res) => {
    try {
        const { platform, url, type, qty } = req.body;
        const clientId = req.headers['x-client-id'] || req.ip;

        // Validate input
        if (!platform || !url || !type || !qty) {
            return res.status(400).json({ msg: 'Missing fields' });
        }

        if (!['instagram', 'tiktok'].includes(platform)) {
            return res.status(400).json({ msg: 'Invalid platform' });
        }

        if (!['followers', 'likes', 'views', 'comments'].includes(type)) {
            return res.status(400).json({ msg: 'Invalid type' });
        }

        if (qty < 1 || qty > 10000) {
            return res.status(400).json({ msg: 'Quantity 1-10000' });
        }

        // Validate URL
        if (!validateUrl(url, platform)) {
            return res.status(400).json({ msg: 'Invalid URL format' });
        }

        // Check cooldown
        const remaining = getCooldownRemaining(clientId);
        if (remaining > 0) {
            return res.status(429).json({ msg: `Wait ${remaining}s`, remaining });
        }

        // Get service ID
        const serviceId = getServiceId(platform, type);
        if (!serviceId) {
            return res.status(400).json({ msg: 'Service not available' });
        }

        // Set cooldown
        setCooldown(clientId);

        // Send to Zefame API
        console.log(`Processing: ${platform} ${type} x${qty} to ${url}`);
        const result = await addOrder(serviceId, url, qty);

        console.log('Zefame Response:', result);

        // Check if successful
        if (result.order) {
            return res.json({
                id: result.order,
                status: 'success',
                platform,
                type,
                qty,
                message: 'Order placed successfully on Zefame'
            });
        } else if (result.error) {
            return res.status(400).json({ msg: `Zefame: ${result.error}` });
        } else {
            return res.json({
                id: `ORD-${Date.now()}`,
                status: 'processing',
                platform,
                type,
                qty,
                message: 'Order processing'
            });
        }

    } catch (error) {
        console.error('Error:', error.message);
        return res.status(500).json({ 
            msg: error.message || 'Server error'
        });
    }
});

// Check order status
app.get('/api/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const response = await callZefameAPI('status', {
            order: orderId
        });

        res.json(response);
    } catch (error) {
        res.status(500).json({ msg: 'Failed to get status' });
    }
});

// Get balance
app.get('/api/balance', async (req, res) => {
    try {
        const response = await callZefameAPI('balance', {});
        res.json(response);
    } catch (error) {
        res.status(500).json({ msg: 'Failed to get balance' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', api: 'Zefame' });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`🔑 API Key: ${API_KEY.substring(0, 8)}...`);
    console.log(`⏱️ Cooldown: ${COOLDOWN}s per user`);
});
