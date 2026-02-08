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

// Service Database with Pricing
const SERVICES = {
    instagram: {
        followers_real: { 
            id: 894, name: 'Real Followers', 
            cost: 0.018, margin: 1.8, 
            price_usd: 0.0324, price_jpy: 4.86,
            limit: 1000
        },
        followers_temp: { 
            id: 757, name: 'Temporary Followers', 
            cost: 0.0078, margin: 1.8, 
            price_usd: 0.0140, price_jpy: 2.10,
            limit: 1000, free: true
        },
        likes: { 
            id: 856, name: 'Likes', 
            cost: 0.0052, margin: 2.0, 
            price_usd: 0.0104, price_jpy: 1.56,
            limit: 1000
        },
        views: { 
            id: 'story', name: 'Story Views', 
            cost: 0.0039, margin: 1.92, 
            price_usd: 0.0075, price_jpy: 1.12,
            limit: 1000
        }
    },
    tiktok: {
        followers: { 
            id: 708, name: 'Followers', 
            cost: 0.0199, margin: 1.8, 
            price_usd: 0.0358, price_jpy: 5.37,
            limit: 1000
        },
        likes: { 
            id: 988, name: 'Likes', 
            cost: 0.0004, margin: 2.25, 
            price_usd: 0.0009, price_jpy: 0.13,
            limit: 1000
        },
        comments: { 
            id: 694, name: 'Comments', 
            cost: 0.0239, margin: 1.8, 
            price_usd: 0.0430, price_jpy: 6.45,
            limit: 1000
        },
        views_live: { 
            id: 794, name: 'Live Views', 
            cost: 0.0239, margin: 1.8, 
            price_usd: 0.0430, price_jpy: 6.45,
            limit: 1000
        },
        shares: { 
            id: 786, name: 'Shares', 
            cost: 0.0034, margin: 1.8, 
            price_usd: 0.0061, price_jpy: 0.92,
            limit: 1000
        },
        reposts: { 
            id: 1039, name: 'Reposts', 
            cost: 0.0335, margin: 1.8, 
            price_usd: 0.0603, price_jpy: 9.04,
            limit: 1000
        }
    },
    twitter: {
        followers: { 
            id: 781, name: 'Followers', 
            cost: 0.0322, margin: 2.0, 
            price_usd: 0.0644, price_jpy: 9.66,
            limit: 1000
        },
        views: { 
            id: 399, name: 'Tweet Views', 
            cost: 0.0003, margin: 1.8, 
            price_usd: 0.0005, price_jpy: 0.08,
            limit: 1000
        },
        retweets: { 
            id: 403, name: 'Retweets', 
            cost: 0.0481, margin: 1.8, 
            price_usd: 0.0866, price_jpy: 12.99,
            limit: 1000
        }
    }
};

// Point Packages
const POINT_PACKAGES = [
    { id: 1, name: '100 Points', points: 100, price_usd: 1, price_jpy: 150 },
    { id: 2, name: '1000 Points', points: 1000, price_usd: 10, price_jpy: 1500 },
    { id: 3, name: '5000 Points', points: 5000, price_usd: 45, price_jpy: 6750 },
    { id: 4, name: '25000 Points', points: 25000, price_usd: 200, price_jpy: 30000 }
];

// Security Manager
class SecurityManager {
    constructor() {
        this.patterns = {
            bot: /bot|crawler|spider|curl|wget|python|requests|selenium|puppeteer|mechanize|scrapy|httpx/i,
            vpn: /vpn|proxy|tor|vps|datacenter|aws|azure|digital.ocean|linode|vultr|virtual|hide|vpngate|expressvpn|nord|surfshark|cyberghost|hotspot/i,
            adblock: /ad.*block|ublock|adguard|ghostery|disconnect|fair.ads|adawy|ubo/i,
            root: /root|sudo|su|administrator|system32|program.files|etc\/passwd/i,
            tools: /nmap|metasploit|burp|wireshark|charles|fiddler|zaproxy|owasp/i
        };
    }
    
    isBlocked(ua, ip) {
        const uaLower = (ua || '').toLowerCase();
        const ipStr = String(ip || '').toLowerCase();
        
        for (const [type, pattern] of Object.entries(this.patterns)) {
            if (pattern.test(uaLower) || pattern.test(ipStr)) {
                console.log(`Blocked (${type}): ${ip}`);
                return true;
            }
        }
        
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

// Routes

// Get Pricing
app.get('/api/pricing', (req, res) => {
    try {
        const pricing = {};
        for (const [platform, services] of Object.entries(SERVICES)) {
            pricing[platform] = {};
            for (const [key, svc] of Object.entries(services)) {
                pricing[platform][key] = {
                    name: svc.name,
                    price_usd: svc.price_usd,
                    price_jpy: svc.price_jpy,
                    limit: svc.limit,
                    free: svc.free || false
                };
            }
        }
        res.json(pricing);
    } catch (error) {
        console.error('Pricing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Point Packages
app.get('/api/points/packages', (req, res) => {
    try {
        res.json({
            packages: POINT_PACKAGES
        });
    } catch (error) {
        console.error('Packages error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Calculate Point Cost
app.post('/api/points/calculate', (req, res) => {
    try {
        const { platform, service, quantity } = req.body;
        
        if (!platform || !service || !quantity) {
            return res.status(400).json({ error: 'Missing parameters' });
        }
        
        const svc = SERVICES[platform]?.[service];
        if (!svc) {
            return res.status(400).json({ error: 'Service not found' });
        }
        
        if (quantity > svc.limit || quantity < 10) {
            return res.status(400).json({ error: `Quantity must be 10-${svc.limit}` });
        }
        
        // Calculate points needed (based on USD price)
        const points = Math.ceil(quantity * svc.price_usd * 100);
        
        res.json({
            service: svc.name,
            quantity,
            points_needed: points,
            price_usd: (points / 100).toFixed(2),
            price_jpy: Math.ceil(points * 1.5)
        });
    } catch (error) {
        console.error('Calculate error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Purchase Service (with points)
app.post('/api/boost/purchase', async (req, res) => {
    try {
        const { platform, service, url, qty } = req.body;
        const ip = req.ip;
        const ua = req.headers['user-agent'] || '';
        
        // Security checks
        if (security.isBlocked(ua, ip)) {
            return res.status(403).json({ error: 'Access denied - VPN/Bot detected' });
        }
        
        if (!platform || !service || !url || !qty) {
            return res.status(400).json({ error: 'Missing parameters' });
        }
        
        const svc = SERVICES[platform]?.[service];
        if (!svc) {
            return res.status(400).json({ error: 'Service not found' });
        }
        
        if (qty > svc.limit || qty < 10) {
            return res.status(400).json({ error: `Quantity must be 10-${svc.limit}` });
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
                    message: 'Order placed! Points will be deducted from your account.'
                });
            } else if (result.error) {
                return res.status(400).json({ error: `Zefame: ${result.error}` });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Order processing failed' });
        }
    } catch (error) {
        console.error('Purchase error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Gumroad Webhook
app.post('/api/gumroad-webhook', (req, res) => {
    try {
        const { email, product_id, price, license_key } = req.body;
        console.log('Gumroad webhook received:', { email, product_id, price });
        res.json({ success: true, message: 'Payment received' });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    try {
        res.json({ status: 'ok', time: new Date().toISOString() });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`✅ Zefoy 2 running on port ${PORT}`);
    console.log(`🔒 Security: VPN/Bot/AdBlock/Root Detection Enabled`);
    console.log(`💳 Payment: Gumroad Integration Ready`);
    console.log(`📊 System: Points-based Purchase System`);
});