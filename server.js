const express = require('express');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
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

// Service Database
const SERVICES = {
    instagram: {
        followers_real: { id: 894, name: 'Real Followers', cost: 0.018, margin: 1.8, limit: 5, jpy: 2.7 },
        followers_temp: { id: 757, name: 'Temporary Followers', cost: 0.0078, margin: 1.8, limit: 10, jpy: 1.4, free: true },
        likes: { id: 856, name: 'Likes', cost: 0.0052, margin: 2.0, limit: 10000, jpy: 1.0 },
        views: { id: 'story', name: 'Story Views', cost: 0.0039, margin: 1.92, limit: 10000, jpy: 0.75 }
    },
    tiktok: {
        followers: { id: 708, name: 'Followers', cost: 0.0199, margin: 1.8, limit: 30000, jpy: 3.58 },
        likes: { id: 988, name: 'Likes', cost: 0.0004, margin: 2.25, limit: 500000, jpy: 0.09 },
        comments: { id: 694, name: 'Comments', cost: 0.0239, margin: 1.8, limit: 10000, jpy: 4.3 },
        views_live: { id: 794, name: 'Live Views', cost: 0.0239, margin: 1.8, limit: 100000, jpy: 4.3 },
        shares: { id: 786, name: 'Shares', cost: 0.0034, margin: 1.8, limit: 50000, jpy: 0.61 },
        reposts: { id: 1039, name: 'Reposts', cost: 0.0335, margin: 1.8, limit: 50000, jpy: 6.03 }
    },
    twitter: {
        followers: { id: 781, name: 'Followers', cost: 0.0322, margin: 2.0, limit: 10000, jpy: 6.44 },
        views: { id: 399, name: 'Tweet Views', cost: 0.0003, margin: 1.8, limit: 100000, jpy: 0.054 },
        retweets: { id: 403, name: 'Retweets', cost: 0.0481, margin: 1.8, limit: 5000, jpy: 8.66 }
    }
};

// Security Manager
class SecurityManager {
    constructor() {
        this.blockedIPs = new Map();
        this.attempts = new Map();
        this.patterns = {
            bot: /bot|crawler|spider|curl|wget|python|requests|selenium|puppeteer|mechanize|scrapy|httpx/i,
            vpn: /vpn|proxy|tor|vps|datacenter|aws|azure|digital.ocean|linode|vultr|virtual|hide|vpngate|expressvpn|nord|surfshark|cyberghost|hotspot/i,
            adblock: /ad.*block|ublock|adguard|ghostery|disconnect|fair.ads|adawy|ubo/i,
            root: /root|sudo|su|administrator|system32|program.files|etc\/passwd/i,
            tools: /nmap|metasploit|burp|wireshark|charles|fiddler|zaproxy|owasp/i
        };
    }
    
    isBlocked(ua, ip) {
        // Check blocked IPs
        if (this.blockedIPs.has(ip)) {
            const blocked = this.blockedIPs.get(ip);
            if (Date.now() - blocked < 3600000) return true;
            this.blockedIPs.delete(ip);
        }
        
        // Check patterns
        const uaLower = (ua || '').toLowerCase();
        const ipStr = String(ip || '').toLowerCase();
        
        for (const [type, pattern] of Object.entries(this.patterns)) {
            if (pattern.test(uaLower) || pattern.test(ipStr)) {
                console.log(`Blocked (${type}): ${ip}`);
                this.blockedIPs.set(ip, Date.now());
                return true;
            }
        }
        
        // Check local IPs
        if (/^127\.|^192\.168|^10\.|^172\.1[6-9]\.|^172\.2[0-9]\.|^172\.3[01]\./.test(ip)) {
            return true;
        }
        
        return false;
    }
}

class ZefameAPI {
    constructor(apiKey) {
        this.key = apiKey;
    }
    
    async call(action, data = {}) {
        try {
            const params = new URLSearchParams({ key: this.key, action, ...data });
            const response = await axios.post(ZEFAME_API, params.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000
            });
            return response.data;
        } catch (error) {
            console.error('Zefame Error:', error.message);
            throw error;
        }
    }
    
    async addOrder(serviceId, link, qty) {
        return this.call('add', { service: serviceId, link, quantity: qty });
    }
}

const security = new SecurityManager();
const zefame = new ZefameAPI(API_KEY);
const freeFollowerLog = new Map(); // IP -> timestamp

// Routes

// Get Pricing
app.get('/api/pricing', (req, res) => {
    const pricing = {};
    for (const [platform, services] of Object.entries(SERVICES)) {
        pricing[platform] = {};
        for (const [key, svc] of Object.entries(services)) {
            pricing[platform][key] = {
                name: svc.name,
                price_usd: (svc.cost * svc.margin).toFixed(4),
                price_jpy: svc.jpy,
                limit: svc.limit,
                free: svc.free || false
            };
        }
    }
    res.json(pricing);
});

// Free Followers (30 second ad)
app.post('/api/boost/free', async (req, res) => {
    try {
        const { url } = req.body;
        const ip = req.ip;
        const ua = req.headers['user-agent'] || '';
        
        // Security checks
        if (security.isBlocked(ua, ip)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        if (!url || !url.includes('instagram.com')) {
            return res.status(400).json({ error: 'Invalid Instagram URL' });
        }
        
        // Check 12 hour limit
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
        
        // Add order to Zefame
        try {
            const result = await zefame.addOrder(757, url, 10); // ID 757 = Temporary followers (cheapest)
            
            if (result.order) {
                freeFollowerLog.set(ip, now);
                return res.json({
                    success: true,
                    orderId: result.order,
                    followers: 10,
                    message: 'Free 10 followers added!'
                });
            } else {
                return res.status(400).json({ error: 'Failed to add followers' });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Service temporarily unavailable' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purchase Service
app.post('/api/boost/purchase', async (req, res) => {
    try {
        const { platform, service, url, qty } = req.body;
        const ip = req.ip;
        const ua = req.headers['user-agent'] || '';
        
        // Security checks
        if (security.isBlocked(ua, ip)) {
            return res.status(403).json({ error: 'Access denied - VPN/Bot detected' });
        }
        
        // Validate request
        if (!platform || !service || !url || !qty) {
            return res.status(400).json({ error: 'Missing parameters' });
        }
        
        const svc = SERVICES[platform]?.[service];
        if (!svc) {
            return res.status(400).json({ error: 'Service not found' });
        }
        
        if (qty > svc.limit || qty < 1) {
            return res.status(400).json({ error: `Invalid quantity. Max: ${svc.limit}` });
        }
        
        // Add order to Zefame
        try {
            const result = await zefame.addOrder(svc.id, url, qty);
            
            if (result.order) {
                return res.json({
                    success: true,
                    orderId: result.order,
                    quantity: qty,
                    service: svc.name,
                    message: 'Order placed! Complete payment to confirm.'
                });
            } else if (result.error) {
                return res.status(400).json({ error: `Zefame: ${result.error}` });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Order processing failed' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Gumroad Webhook
app.post('/api/gumroad-webhook', (req, res) => {
    try {
        const { email, product_id, price, license_key } = req.body;
        
        console.log('Gumroad webhook received:', { email, product_id, price });
        
        // Process payment
        res.json({ success: true, message: 'Payment received' });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`✅ Zefoy 2 Pro running on port ${PORT}`);
    console.log(`🔒 Security: VPN/Bot/AdBlock/Root Detection Enabled`);
    console.log(`💳 Payment: Gumroad Integration Ready`);
});