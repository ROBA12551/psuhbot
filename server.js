const express = require('express');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const ZEFAME_API = 'https://zefame.com/api/v2';
const API_KEY = process.env.ZEFAME_API_KEY || '';

// All Services with Complete Pricing
const SERVICES = {
    instagram: {
        followers_real: { id: 894, name: 'Real Followers', cost: 1.80, margin: 1.8, limit: 1000 },
        followers_temp: { id: 757, name: 'Temporary Followers', cost: 0.78, margin: 1.8, limit: 1000, free: true },
        likes: { id: 856, name: 'Likes', cost: 0.52, margin: 2.0, limit: 10000 },
        views: { id: 'story', name: 'Story Views', cost: 0.39, margin: 1.92, limit: 10000 }
    },
    tiktok: {
        followers: { id: 708, name: 'Followers', cost: 1.99, margin: 1.8, limit: 30000 },
        likes: { id: 988, name: 'Likes', cost: 0.04, margin: 2.25, limit: 500000 },
        comments: { id: 694, name: 'Comments', cost: 2.39, margin: 1.8, limit: 10000 },
        views_live: { id: 794, name: 'Live Views', cost: 2.39, margin: 1.8, limit: 100000 },
        shares: { id: 786, name: 'Shares', cost: 0.34, margin: 1.8, limit: 50000 },
        reposts: { id: 1039, name: 'Reposts', cost: 3.35, margin: 1.8, limit: 50000 }
    },
    twitter: {
        followers: { id: 781, name: 'Followers', cost: 3.22, margin: 2.0, limit: 10000 },
        views: { id: 399, name: 'Tweet Views', cost: 0.03, margin: 1.8, limit: 100000 },
        retweets: { id: 403, name: 'Retweets', cost: 4.81, margin: 1.8, limit: 5000 }
    }
};

// Point Packages
const POINT_PACKAGES = [
    { id: 1, points: 100, price: 1 },
    { id: 2, points: 1000, price: 10 },
    { id: 3, points: 5000, price: 45 },
    { id: 4, points: 10000, price: 85 },
    { id: 5, points: 25000, price: 200 }
];

// Subscription
const SUBSCRIPTION = { price: 1280, interval: 30 * 60 * 1000, followers: 10 };

// Security
class SecurityManager {
    constructor() {
        this.patterns = {
            bot: /bot|crawler|spider|curl|wget|python|requests|selenium|puppeteer|mechanize|scrapy|httpx/i,
            vpn: /vpn|proxy|tor|vps|datacenter|aws|azure|digital.ocean|linode|vultr|virtual|hide|vpngate|expressvpn|nord|surfshark|cyberghost|hotspot/i,
            adblock: /ad.*block|ublock|adguard|ghostery|disconnect/i,
            root: /root|sudo|su|administrator|system32/i
        };
    }
    
    isBlocked(ua, ip) {
        const uaLower = (ua || '').toLowerCase();
        for (const pattern of Object.values(this.patterns)) {
            if (pattern.test(uaLower) || pattern.test(String(ip).toLowerCase())) return true;
        }
        if (/^127\.|^192\.168|^10\.|^172\.1[6-9]\.|^172\.2[0-9]\.|^172\.3[01]\./.test(ip)) return true;
        return false;
    }
}

class ZefameAPI {
    constructor(apiKey) {
        this.key = apiKey;
    }
    
    async addOrder(serviceId, link, qty) {
        try {
            const params = new URLSearchParams({ key: this.key, action: 'add', service: serviceId, link, quantity: qty });
            const res = await axios.post(ZEFAME_API, params.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000
            });
            return res.data;
        } catch (error) {
            console.error('Zefame Error:', error.message);
            throw error;
        }
    }
}

const security = new SecurityManager();
const zefame = new ZefameAPI(API_KEY);
const freeFollowerLog = new Map();

// Routes

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/services', (req, res) => {
    try {
        const data = {};
        for (const [platform, services] of Object.entries(SERVICES)) {
            data[platform] = {};
            for (const [key, svc] of Object.entries(services)) {
                const pricePerUnit = svc.cost * svc.margin / 100;
                data[platform][key] = {
                    name: svc.name,
                    id: svc.id,
                    price: pricePerUnit,
                    limit: svc.limit,
                    free: svc.free || false
                };
            }
        }
        res.json(data);
    } catch (error) {
        console.error('Services error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/points/packages', (req, res) => {
    try {
        res.json({ packages: POINT_PACKAGES });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/boost/purchase', async (req, res) => {
    try {
        const { platform, service, url, qty } = req.body;
        const ip = req.ip;
        const ua = req.headers['user-agent'] || '';
        
        if (security.isBlocked(ua, ip)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        if (!platform || !service || !url || !qty) {
            return res.status(400).json({ error: 'Missing parameters' });
        }
        
        const svc = SERVICES[platform]?.[service];
        if (!svc) return res.status(400).json({ error: 'Service not found' });
        if (qty > 1000 || qty < 10) {
            return res.status(400).json({ error: `Quantity must be 10-1000 (service max: ${svc.limit})` });
        }
        if (qty > svc.limit) {
            return res.status(400).json({ error: `Service max: ${svc.limit}` });
        }
        
        try {
            const result = await zefame.addOrder(svc.id, url, qty);
            if (result.order) {
                return res.json({
                    success: true,
                    orderId: result.order,
                    quantity: qty,
                    service: svc.name
                });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Order processing failed' });
        }
    } catch (error) {
        console.error('Purchase error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/boost/free', async (req, res) => {
    try {
        const { url } = req.body;
        const ip = req.ip;
        const ua = req.headers['user-agent'] || '';
        
        if (security.isBlocked(ua, ip)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        if (!url || !url.includes('instagram.com')) {
            return res.status(400).json({ error: 'Invalid Instagram URL' });
        }
        
        // IP-based rate limiting (12 hours)
        const lastClaim = freeFollowerLog.get(ip);
        const now = Date.now();
        const TWELVE_HOURS = 12 * 60 * 60 * 1000;
        
        if (lastClaim && (now - lastClaim) < TWELVE_HOURS) {
            const nextTime = new Date(lastClaim + TWELVE_HOURS);
            return res.status(429).json({
                error: 'Wait before claiming again',
                nextTime: nextTime.toISOString(),
                remainingMs: (lastClaim + TWELVE_HOURS) - now
            });
        }
        
        try {
            const result = await zefame.addOrder(757, url, 10);
            if (result.order) {
                freeFollowerLog.set(ip, now);
                return res.json({ success: true, orderId: result.order });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Failed to add followers' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/gumroad-webhook', (req, res) => {
    try {
        const { email, product_id, price } = req.body;
        console.log('Gumroad webhook:', { email, product_id, price });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`✅ Zefoy 2 running on port ${PORT}`);
});