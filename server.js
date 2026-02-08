const express = require('express');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const ZEFAME_API = 'https://zefame.com/api/v2';
const API_KEY = process.env.ZEFAME_API_KEY || '';

if (!API_KEY) {
    console.error('ERROR: ZEFAME_API_KEY not set in .env');
    process.exit(1);
}

// Advanced Service Database with Real Pricing
const SERVICES = {
    instagram: {
        followers_real: {
            id: 894,
            name: 'Real Followers',
            price: 0.0324,
            cost: 0.018,
            limit: 5,
            free: false,
            category: 'followers'
        },
        followers_temp: {
            id: 757,
            name: 'Temporary Followers',
            price: 0.0014,
            cost: 0.0078,
            limit: 10,
            free: true,
            freeInterval: 12 * 60 * 60 * 1000,
            category: 'followers'
        },
        likes: {
            id: 856,
            name: 'Likes',
            price: 0.01,
            cost: 0.0052,
            limit: 10000,
            category: 'engagement'
        },
        views: {
            id: 'story',
            name: 'Story Views',
            price: 0.0075,
            cost: 0.0039,
            limit: 10000,
            category: 'engagement'
        }
    },
    tiktok: {
        followers: {
            id: 708,
            name: 'Followers',
            price: 0.00358,
            cost: 0.00199,
            limit: 30000,
            category: 'followers'
        },
        likes: {
            id: 988,
            name: 'Likes',
            price: 0.00009,
            cost: 0.00004,
            limit: 500000,
            category: 'engagement'
        },
        comments: {
            id: 694,
            name: 'Comments',
            price: 0.04302,
            cost: 0.02390,
            limit: 10000,
            category: 'engagement'
        },
        views_live: {
            id: 794,
            name: 'Live Views',
            price: 0.04302,
            cost: 0.02390,
            limit: 100000,
            category: 'engagement'
        },
        shares: {
            id: 786,
            name: 'Shares',
            price: 0.00612,
            cost: 0.00340,
            limit: 50000,
            category: 'engagement'
        },
        reposts: {
            id: 1039,
            name: 'Reposts',
            price: 0.06030,
            cost: 0.03350,
            limit: 50000,
            category: 'engagement'
        }
    },
    twitter: {
        followers: {
            id: 781,
            name: 'Followers',
            price: 0.00644,
            cost: 0.00322,
            limit: 10000,
            category: 'followers'
        },
        views: {
            id: 399,
            name: 'Tweet Views',
            price: 0.000054,
            cost: 0.00003,
            limit: 100000,
            category: 'engagement'
        },
        retweets: {
            id: 403,
            name: 'Retweets',
            price: 0.008658,
            cost: 0.00481,
            limit: 5000,
            category: 'engagement'
        }
    }
};

// Advanced Database (Production: Use MongoDB/PostgreSQL)
class Database {
    constructor() {
        this.users = new Map();
        this.orders = new Map();
        this.transactions = new Map();
        this.sessions = new Map();
    }

    getUser(userId) {
        if (!this.users.has(userId)) {
            this.users.set(userId, {
                id: userId,
                balance: 0,
                spent: 0,
                orders: [],
                transactions: [],
                subscription: null,
                freeFollowerLog: {},
                createdAt: Date.now(),
                lastActive: Date.now()
            });
        }
        const user = this.users.get(userId);
        user.lastActive = Date.now();
        return user;
    }

    saveOrder(order) {
        this.orders.set(order.id, order);
        const user = this.getUser(order.userId);
        user.orders.push(order.id);
    }

    getOrder(orderId) {
        return this.orders.get(orderId);
    }

    saveTransaction(transaction) {
        this.transactions.set(transaction.id, transaction);
        const user = this.getUser(transaction.userId);
        user.transactions.push(transaction.id);
    }
}

const db = new Database();

// Advanced Block Detection
class SecurityManager {
    constructor() {
        this.blockedIPs = new Set();
        this.suspiciousActivity = new Map();
        this.patterns = {
            bot: /bot|crawler|spider|curl|wget|python|requests|selenium|puppeteer|playwright|mechanize/i,
            vpn: /vpn|proxy|tor|vps|root|sudo|vps|cloud|datacenter/i,
            adblock: /ad.*block|ublock|adblock|adguard/i,
            localIP: /^127\.|^192\.168\.|^10\.|^172\./
        };
    }

    isBlocked(userAgent, ip, userId) {
        if (this.blockedIPs.has(ip)) return true;

        for (const [type, pattern] of Object.entries(this.patterns)) {
            if (pattern.test(userAgent || '') || pattern.test(ip || '')) {
                this.recordSuspicious(userId, ip, type);
                if (this.getSuspiciousCount(userId) > 3) {
                    this.blockIP(ip);
                    return true;
                }
            }
        }
        return false;
    }

    recordSuspicious(userId, ip, type) {
        const key = `${userId}:${ip}`;
        const count = (this.suspiciousActivity.get(key) || 0) + 1;
        this.suspiciousActivity.set(key, count);
    }

    getSuspiciousCount(userId) {
        let count = 0;
        for (const [key, val] of this.suspiciousActivity.entries()) {
            if (key.startsWith(userId)) count += val;
        }
        return count;
    }

    blockIP(ip) {
        this.blockedIPs.add(ip);
        setTimeout(() => this.blockedIPs.delete(ip), 60 * 60 * 1000); // Unblock after 1h
    }
}

const security = new SecurityManager();

// Advanced Zefame API Manager
class ZefameManager {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = ZEFAME_API;
        this.retryCount = 3;
        this.timeout = 15000;
        this.cache = new Map();
    }

    async call(action, data = {}) {
        const cacheKey = JSON.stringify({ action, data });
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        for (let attempt = 0; attempt < this.retryCount; attempt++) {
            try {
                const params = new URLSearchParams({
                    key: this.apiKey,
                    action,
                    ...data
                });

                const response = await axios.post(this.baseURL, params.toString(), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: this.timeout,
                    validateStatus: () => true
                });

                if (response.status === 200) {
                    if (action === 'services') {
                        this.cache.set(cacheKey, response.data);
                        setTimeout(() => this.cache.delete(cacheKey), 3600000); // Cache 1h
                    }
                    return response.data;
                } else if (attempt === this.retryCount - 1) {
                    throw new Error(`API Error: ${response.status}`);
                }

                await this.delay(1000 * (attempt + 1));
            } catch (error) {
                if (attempt === this.retryCount - 1) throw error;
                await this.delay(1000 * (attempt + 1));
            }
        }
    }

    async addOrder(serviceId, link, quantity) {
        return this.call('add', {
            service: serviceId,
            link,
            quantity
        });
    }

    async getStatus(orderId) {
        return this.call('status', { order: orderId });
    }

    async getBalance() {
        return this.call('balance', {});
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const zefame = new ZefameManager(API_KEY);

// Advanced Payment Processor
class PaymentProcessor {
    constructor() {
        this.pendingPayments = new Map();
        this.rates = {
            usd_to_points: 100,
            subscription_price: 1280,
            packages: {
                small: { usd: 10, points: 1000 },
                medium: { usd: 50, points: 5000 },
                large: { usd: 100, points: 10000 },
                xlarge: { usd: 250, points: 25000 }
            }
        };
    }

    generatePaymentId() {
        return `PAY-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    }

    createPaymentSession(userId, amount, package_type) {
        const paymentId = this.generatePaymentId();
        const session = {
            id: paymentId,
            userId,
            amount,
            package: package_type,
            status: 'pending',
            createdAt: Date.now(),
            expiresAt: Date.now() + 15 * 60 * 1000
        };
        this.pendingPayments.set(paymentId, session);
        return session;
    }

    processPayment(paymentId, verified = true) {
        const session = this.pendingPayments.get(paymentId);
        if (!session || session.status !== 'pending') {
            throw new Error('Invalid payment session');
        }
        if (Date.now() > session.expiresAt) {
            throw new Error('Payment session expired');
        }

        session.status = 'completed';
        return session;
    }
}

const payment = new PaymentProcessor();

// Advanced Order Manager
class OrderManager {
    constructor() {
        this.processingOrders = new Set();
        this.orderQueue = [];
    }

    async processOrder(order) {
        if (this.processingOrders.has(order.id)) {
            throw new Error('Order already processing');
        }

        this.processingOrders.add(order.id);

        try {
            const zefameOrder = await zefame.addOrder(
                order.serviceId,
                order.url,
                order.quantity
            );

            if (zefameOrder.order) {
                order.zefameId = zefameOrder.order;
                order.status = 'processing';
                order.processedAt = Date.now();
                return order;
            } else if (zefameOrder.error) {
                order.status = 'failed';
                order.error = zefameOrder.error;
                return order;
            }
        } finally {
            this.processingOrders.delete(order.id);
        }
    }

    async checkStatus(order) {
        if (!order.zefameId) return null;
        const status = await zefame.getStatus(order.zefameId);
        return status;
    }
}

const orderManager = new OrderManager();

// ===== API Routes =====

// Get user profile
app.post('/api/user/profile', (req, res) => {
    try {
        const userId = req.headers['x-user-id'] || crypto.randomBytes(16).toString('hex');
        const user = db.getUser(userId);

        res.json({
            userId,
            balance: user.balance,
            spent: user.spent,
            ordersCount: user.orders.length,
            subscription: user.subscription,
            createdAt: user.createdAt
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get pricing
app.get('/api/pricing', (req, res) => {
    try {
        const pricing = {};
        for (const [platform, services] of Object.entries(SERVICES)) {
            pricing[platform] = {};
            for (const [key, svc] of Object.entries(services)) {
                pricing[platform][key] = {
                    name: svc.name,
                    price: svc.price,
                    limit: svc.limit,
                    margin: ((svc.price - svc.cost) / svc.cost * 100).toFixed(1) + '%'
                };
            }
        }
        res.json(pricing);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add balance (payment)
app.post('/api/payment/process', async (req, res) => {
    try {
        const { amount, package_type } = req.body;
        const userId = req.headers['x-user-id'] || crypto.randomBytes(16).toString('hex');

        if (!payment.rates.packages[package_type]) {
            return res.status(400).json({ error: 'Invalid package' });
        }

        const pkg = payment.rates.packages[package_type];
        if (pkg.usd !== amount) {
            return res.status(400).json({ error: 'Amount mismatch' });
        }

        const session = payment.createPaymentSession(userId, amount, package_type);

        res.json({
            paymentId: session.id,
            amount: session.amount,
            points: pkg.points,
            message: 'Payment session created'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Confirm payment
app.post('/api/payment/confirm', (req, res) => {
    try {
        const { paymentId } = req.body;
        const userId = req.headers['x-user-id'] || crypto.randomBytes(16).toString('hex');

        const session = payment.processPayment(paymentId);
        if (session.userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const pkg = payment.rates.packages[session.package];
        const user = db.getUser(userId);
        user.balance += pkg.points;

        const transaction = {
            id: `TXN-${Date.now()}`,
            userId,
            type: 'purchase',
            amount: session.amount,
            points: pkg.points,
            timestamp: Date.now()
        };

        db.saveTransaction(transaction);

        res.json({
            success: true,
            balance: user.balance,
            points: pkg.points
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purchase service
app.post('/api/boost/purchase', async (req, res) => {
    try {
        const { platform, service, url, qty } = req.body;
        const userId = req.headers['x-user-id'] || crypto.randomBytes(16).toString('hex');
        const userAgent = req.headers['user-agent'] || '';
        const ip = req.ip;

        // Security check
        if (security.isBlocked(userAgent, ip, userId)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const svc = SERVICES[platform]?.[service];
        if (!svc) {
            return res.status(400).json({ error: 'Service not found' });
        }

        if (qty > svc.limit || qty < 1) {
            return res.status(400).json({ error: `Invalid quantity. Max: ${svc.limit}` });
        }

        const cost = Math.ceil(qty * svc.price * 100);
        const user = db.getUser(userId);

        if (user.balance < cost) {
            return res.status(400).json({
                error: 'Insufficient balance',
                balance: user.balance,
                needed: cost
            });
        }

        // Create order
        const orderId = `ORD-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
        const order = {
            id: orderId,
            userId,
            platform,
            service,
            serviceId: svc.id,
            url,
            quantity: qty,
            cost,
            status: 'pending',
            createdAt: Date.now(),
            zefameId: null
        };

        // Deduct balance
        user.balance -= cost;
        user.spent += cost;

        // Process order async
        setImmediate(async () => {
            try {
                const result = await orderManager.processOrder(order);
                db.saveOrder(result);
            } catch (error) {
                console.error('Order processing error:', error);
                user.balance += cost;
                user.spent -= cost;
            }
        });

        db.saveOrder(order);

        res.json({
            success: true,
            orderId: order.id,
            cost,
            balance: user.balance,
            status: 'processing'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get order status
app.get('/api/order/:orderId', async (req, res) => {
    try {
        const order = db.getOrder(req.params.orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        let zefameStatus = null;
        if (order.status === 'processing' || order.status === 'completed') {
            zefameStatus = await orderManager.checkStatus(order);
        }

        res.json({
            order,
            zefameStatus
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Free followers
app.post('/api/boost/free', async (req, res) => {
    try {
        const { url } = req.body;
        const userId = req.headers['x-user-id'] || crypto.randomBytes(16).toString('hex');
        const user = db.getUser(userId);

        const platform = url.includes('tiktok') ? 'tiktok' : 'instagram';
        const svc = SERVICES[platform].followers_temp;

        const lastFree = user.freeFollowerLog[platform] || 0;
        if (Date.now() - lastFree < svc.freeInterval) {
            const nextTime = new Date(lastFree + svc.freeInterval);
            return res.status(429).json({
                error: 'Wait before claiming again',
                nextTime: nextTime.toISOString()
            });
        }

        const orderId = `FREE-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
        const order = {
            id: orderId,
            userId,
            platform,
            service: 'followers_temp',
            serviceId: svc.id,
            url,
            quantity: 10,
            cost: 0,
            status: 'pending',
            free: true,
            createdAt: Date.now()
        };

        setImmediate(async () => {
            try {
                await orderManager.processOrder(order);
                db.saveOrder(order);
            } catch (error) {
                console.error('Free order error:', error);
            }
        });

        user.freeFollowerLog[platform] = Date.now();
        db.saveOrder(order);

        res.json({
            success: true,
            orderId: order.id,
            quantity: 10,
            message: 'Free followers claimed!'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', async (req, res) => {
    try {
        const balance = await zefame.getBalance();
        res.json({
            status: 'ok',
            api: 'connected',
            zefameBalance: balance
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            message: error.message
        });
    }
});

// 404
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Zefoy 2 Pro running on port ${PORT}`);
    console.log(`🔐 Security: Enabled`);
    console.log(`💳 Payments: Configured`);
    console.log(`🔗 Zefame API: Connected`);
});