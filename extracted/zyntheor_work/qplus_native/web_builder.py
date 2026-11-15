# -*- coding: utf-8 -*-
"""
ZYNTHEOR Full-Stack Website & Application Builder.

Generates runnable, multi-file Node.js ESM full-stack applications across 8 domain classes:
  1. ecommerce     - Product catalog, cart, orders, admin dashboard, fail-closed payment boundary
  2. saas          - Workspaces, members, analytics, subscriptions, fail-closed billing boundary
  3. social        - Profiles, posts, comments, likes, follows, direct messages
  4. learning      - Courses, lessons, enrollments, auto-graded quizzes, progress tracking
  5. management    - Tasks, staff, customers, inventory, live summary reports
  6. booking       - Resources, slot availability, conflict-checked bookings, cancellations
  7. ai_app        - Dataset statistical/outlier analysis, workflows, explicit external LLM boundary
  8. business_web  - Corporate showcase, services, portfolio, contact/lead inquiries

Zero Simulation Policy:
  - Generated servers run real Node.js http/fs/crypto code with file-backed persistence.
  - External gateways (Stripe/Omise/Cloud deploy) fail closed (HTTP 501 REQUIRES_EXTERNAL_CREDENTIALS)
    unless real credentials/infra are provided — never fake payment or live deployment URLs.
"""
import json
from typing import Dict, Optional


WEB_APP_CLASSES = (
    "ecommerce",
    "saas",
    "social",
    "learning",
    "management",
    "booking",
    "ai_app",
    "business_web",
)

APP_CLASS_META: Dict[str, Dict[str, str]] = {
    "ecommerce": {
        "title": "Storefront & Commerce Engine",
        "subtitle": "Product Catalog, Shopping Cart, Order Ledger & Admin Inventory",
        "primary_endpoint": "/api/products",
        "external_boundary": "POST /api/payments/charge -> 501 REQUIRES_EXTERNAL_CREDENTIALS until STRIPE_SECRET_KEY/OMISE_SECRET_KEY configured",
    },
    "saas": {
        "title": "SaaS Multi-Tenant Workspace",
        "subtitle": "Member RBAC, Workspaces, Usage Analytics & Subscription Plans",
        "primary_endpoint": "/api/workspaces",
        "external_boundary": "POST /api/billing/checkout -> 501 REQUIRES_EXTERNAL_CREDENTIALS until billing provider configured",
    },
    "social": {
        "title": "Social Network Hub",
        "subtitle": "Profiles, Feed Posts, Comments, Likes, Follow Graph & Direct Chat",
        "primary_endpoint": "/api/posts",
        "external_boundary": "Realtime WebSocket push upgrades & cloud media CDN: NOT_IMPLEMENTED (polling/JSON DB active locally)",
    },
    "learning": {
        "title": "Learning & Course Platform",
        "subtitle": "Courses, Lessons, Enrollments, Graded Quizzes & Progress Tracking",
        "primary_endpoint": "/api/courses",
        "external_boundary": "External video transcoding CDN: NOT_IMPLEMENTED (structured lesson URLs & quiz grading active)",
    },
    "management": {
        "title": "Operations & Resource Management",
        "subtitle": "Tasks, Staff Directory, Customer CRM, Inventory Stock & Reports",
        "primary_endpoint": "/api/inventory",
        "external_boundary": "Cloud ERP sync: NOT_DEPLOYED_EXTERNAL_INFRA_REQUIRED",
    },
    "booking": {
        "title": "Booking & Scheduling Platform",
        "subtitle": "Rooms/Slots, Availability Lookup, Conflict-Checked Reservations & Cancellations",
        "primary_endpoint": "/api/bookings",
        "external_boundary": "SMS/Email notification gateway: REQUIRES_EXTERNAL_CREDENTIALS",
    },
    "ai_app": {
        "title": "AI Analytics & Workflow Studio",
        "subtitle": "Statistical Dataset Analysis, Outlier Detection & Multi-Step Workflows",
        "primary_endpoint": "/api/workflows",
        "external_boundary": "External LLM API node: REQUIRES_CLOUD_INFERENCE_ENDPOINT unless ZYNTHEOR_INFERENCE_URL configured",
    },
    "business_web": {
        "title": "Corporate Website & Portfolio",
        "subtitle": "Services Showcase, Case-Study Portfolio & Lead Inquiry Management",
        "primary_endpoint": "/api/portfolio",
        "external_boundary": "Public DNS / TLS cloud hosting: NOT_DEPLOYED_EXTERNAL_INFRA_REQUIRED",
    },
}


def classify_web_app(goal: str) -> Optional[str]:
    """Detects whether a goal asks for one of the 8 web/app classes; returns class or None."""
    g = (goal or "").lower()
    if any(k in g for k in ("e-commerce", "ecommerce", "ร้านค้า", "ตะกร้า", "cart", "shop", "storefront", "checkout", "สินค้า", "ชำระเงิน")):
        return "ecommerce"
    if any(k in g for k in ("saas", "subscription", "สมัครสมาชิก", "tenant", "billing", "ระบบสมาชิก")):
        return "saas"
    if any(k in g for k in ("social", "โซเชียล", "คอมเมนต์", "โพสต์", "follow", "ชุมชน", "network", "messaging")):
        return "social"
    if any(k in g for k in ("learning", "course", "lms", "quiz", "บทเรียน", "คอร์ส", "การเรียน")):
        return "learning"
    if any(k in g for k in ("booking", "hotel", "appointment", "reservation", "slot", "จองคิว", "จองห้อง", "ตารางเวลา", "โรงแรม")):
        return "booking"
    if any(k in g for k in ("management", "inventory", "crm", "erp", "staff", "คลังสินค้า", "พนักงาน", "จัดการงาน")):
        return "management"
    if any(k in g for k in ("ai app", "ai application", "analytics", "workflow", "outlier", "วิเคราะห์ข้อมูล", "ระบบอัตโนมัติ", "automation")):
        return "ai_app"
    if any(k in g for k in ("corporate", "landing", "portfolio", "company site", "business web", "เว็บไซต์", "เว็บแอป", "website", "web app", "full-stack", "fullstack", "สร้างเว็บ", "สร้างแอป", "html", "frontend")):
        return "business_web"
    return None


def _build_package_json(app_class: str) -> str:
    return json.dumps(
        {
            "name": f"zyntheor-{app_class.replace('_', '-')}-app",
            "version": "1.0.0",
            "private": True,
            "type": "module",
            "scripts": {
                "start": "node src/server.js",
                "test": "node tests/app.test.js",
            },
        },
        indent=2,
    ) + "\n"


def _build_store_js(app_class: str) -> str:
    seed_blocks: Dict[str, str] = {
        "ecommerce": """  products: [
    { id: 'prod-1', name: 'Sovereign Compute Node', category: 'Hardware', price: 1290, stock: 12 },
    { id: 'prod-2', name: 'Encrypted Storage Vault', category: 'Storage', price: 450, stock: 25 },
  ],
  carts: {},
  orders: [],""",
        "saas": """  plans: [
    { id: 'starter', name: 'Starter', monthlyPrice: 0, seatsLimit: 5 },
    { id: 'pro', name: 'Pro Operations', monthlyPrice: 49, seatsLimit: 25 },
  ],
  workspaces: [
    { id: 'ws-1', name: 'Default Operations', planId: 'starter', ownerId: 'seed-admin', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  members: [],
  subscriptions: [],""",
        "social": """  posts: [
    { id: 'post-1', authorId: 'seed-admin', authorName: 'Admin', content: 'Welcome to the network workspace.', likes: [], createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  comments: [],
  follows: [],
  messages: [],""",
        "learning": """  courses: [
    { id: 'course-1', title: 'Systems Engineering Foundations', instructor: 'Core Faculty', lessons: [{ id: 'l-1', title: 'Architecture Overview', durationMin: 15 }] },
  ],
  quizzes: [
    { id: 'quiz-1', courseId: 'course-1', title: 'Module 1 Check', questions: [{ id: 'q1', prompt: 'What ensures atomic persistence?', answer: 'rename' }] },
  ],
  enrollments: [],""",
        "management": """  tasks: [
    { id: 't-1', title: 'Audit monthly stock levels', assignee: 'ops-lead', status: 'open', priority: 'High' },
  ],
  staff: [
    { id: 'st-1', name: 'Ops Lead', department: 'Operations', role: 'Supervisor' },
  ],
  customers: [
    { id: 'cust-1', name: 'Acme Logistics', email: 'ops@acme.example', tier: 'Enterprise' },
  ],
  inventory: [
    { id: 'inv-1', sku: 'SKU-100', name: 'Barcode Scanner', quantity: 14, reorderLevel: 5 },
  ],""",
        "booking": """  resources: [
    { id: 'res-1', name: 'Executive Suite A', kind: 'hotel_room', ratePerSlot: 180 },
    { id: 'res-2', name: 'Consultation Room 1', kind: 'appointment', ratePerSlot: 60 },
  ],
  bookings: [],""",
        "ai_app": """  datasets: [],
  workflows: [
    { id: 'wf-1', name: 'Anomaly & Variance Pipeline', steps: ['normalize', 'compute_stats', 'flag_outliers'], runs: [] },
  ],""",
        "business_web": """  services: [
    { id: 'srv-1', title: 'Full-Stack Architecture', summary: 'Resilient APIs, data modeling, and verified deployments.' },
    { id: 'srv-2', title: 'Security Hardening', summary: 'Constant-time auth verification and strict input validation.' },
  ],
  portfolio: [
    { id: 'pf-1', title: 'Automated Ledger Platform', client: 'FinCore', outcome: '99.98% reconciliation accuracy' },
  ],
  inquiries: [],""",
    }
    seed_body = seed_blocks[app_class]
    return f"""// Persistent JSON File-Backed Store ({app_class})
import fs from 'node:fs';
import path from 'node:path';

export function defaultSeedState() {{
  return {{
    users: [],
{seed_body}
  }};
}}

export class FileStore {{
  constructor(dataDir) {{
    this.dataDir = path.resolve(dataDir);
    this.dbFile = path.join(this.dataDir, 'database.json');
    this.ensureInitialized();
  }}

  ensureInitialized() {{
    fs.mkdirSync(this.dataDir, {{ recursive: true }});
    if (!fs.existsSync(this.dbFile)) {{
      this.writeState(defaultSeedState());
    }}
  }}

  readState() {{
    this.ensureInitialized();
    const raw = fs.readFileSync(this.dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {{ ...defaultSeedState(), ...parsed }};
  }}

  writeState(nextState) {{
    fs.mkdirSync(this.dataDir, {{ recursive: true }});
    const tmpFile = `${{this.dbFile}}.${{process.pid}}.${{Date.now()}}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(nextState, null, 2), 'utf8');
    fs.renameSync(tmpFile, this.dbFile);
  }}

  mutate(fn) {{
    const state = this.readState();
    const result = fn(state);
    this.writeState(state);
    return result;
  }}
}}
"""


def _build_auth_js() -> str:
    return """// Cryptographic PBKDF2 Auth + HS256 Token Engine (timingSafeEqual verified)
import crypto from 'node:crypto';

export function createAuthService(configuredKey) {
  const secretKey = configuredKey || process.env.APP_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
  const keyBuffer = Buffer.from(secretKey, 'utf8');

  function hashCredential(plainText, salt = crypto.randomBytes(16).toString('hex')) {
    const derived = crypto.pbkdf2Sync(String(plainText), salt, 10000, 32, 'sha256').toString('hex');
    return `${salt}:${derived}`;
  }

  function verifyCredential(plainText, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, expectedHex] = storedHash.split(':');
    const actualBuf = crypto.pbkdf2Sync(String(plainText), salt, 10000, 32, 'sha256');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  }

  function signToken(user, ttlSeconds = 3600) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        iat: now,
        exp: now + ttlSeconds,
      })
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', keyBuffer).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
  }

  function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    let header;
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (header.alg !== 'HS256') return null;
    const expectedSig = crypto.createHmac('sha256', keyBuffer).update(`${headerB64}.${payloadB64}`).digest();
    const actualSig = Buffer.from(sigB64, 'base64url');
    if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
      return null;
    }
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function authenticateRequest(req) {
    const authHeader = String(req.headers['authorization'] || '');
    if (!authHeader.startsWith('Bearer ')) return null;
    return verifyToken(authHeader.slice(7).trim());
  }

  return {
    hashCredential,
    verifyCredential,
    signToken,
    verifyToken,
    authenticateRequest,
  };
}
"""


def _domain_routes_js(app_class: str) -> str:
    if app_class == "ecommerce":
        return """    if (method === 'GET' && urlPath === '/api/products') {
      const state = store.readState();
      return sendJson(res, 200, { products: state.products });
    }
    if (method === 'POST' && urlPath === '/api/admin/products') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      const price = Number(body.price);
      const stock = Number(body.stock ?? 0);
      if (!name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
        return sendJson(res, 400, { error: 'Valid name, positive price, and non-negative integer stock required' });
      }
      const created = store.mutate((st) => {
        const item = {
          id: `prod-${crypto.randomUUID().slice(0, 8)}`,
          name,
          category: String(body.category || 'General').trim(),
          price: Number(price.toFixed(2)),
          stock,
        };
        st.products.push(item);
        return item;
      });
      return sendJson(res, 201, { product: created });
    }
    if (method === 'GET' && urlPath === '/api/cart') {
      const user = requireUser(req, res);
      if (!user) return;
      const state = store.readState();
      const items = state.carts[user.sub] || [];
      return sendJson(res, 200, { items });
    }
    if (method === 'POST' && urlPath === '/api/cart') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const productId = String(body.productId || '').trim();
      const qty = Number(body.qty || 1);
      if (!productId || !Number.isInteger(qty) || qty <= 0) {
        return sendJson(res, 400, { error: 'Valid productId and positive integer qty required' });
      }
      const out = store.mutate((st) => {
        const prod = st.products.find((p) => p.id === productId);
        if (!prod) return { errorStatus: 404, error: 'Product not found' };
        if (prod.stock < qty) return { errorStatus: 409, error: 'Insufficient stock' };
        const cart = st.carts[user.sub] || [];
        const existing = cart.find((c) => c.productId === productId);
        if (existing) existing.qty += qty;
        else cart.push({ productId, name: prod.name, unitPrice: prod.price, qty });
        st.carts[user.sub] = cart;
        return { items: cart };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 200, out);
    }
    if (method === 'DELETE' && urlPath.startsWith('/api/cart/')) {
      const user = requireUser(req, res);
      if (!user) return;
      const pid = decodeURIComponent(urlPath.slice('/api/cart/'.length));
      const items = store.mutate((st) => {
        const next = (st.carts[user.sub] || []).filter((c) => c.productId !== pid);
        st.carts[user.sub] = next;
        return next;
      });
      return sendJson(res, 200, { items });
    }
    if (method === 'GET' && urlPath === '/api/orders') {
      const user = requireUser(req, res);
      if (!user) return;
      const state = store.readState();
      const orders = user.role === 'admin' ? state.orders : state.orders.filter((o) => o.userId === user.sub);
      return sendJson(res, 200, { orders });
    }
    if (method === 'POST' && urlPath === '/api/orders') {
      const user = requireUser(req, res);
      if (!user) return;
      const out = store.mutate((st) => {
        const cart = st.carts[user.sub] || [];
        if (cart.length === 0) return { errorStatus: 400, error: 'Cart is empty' };
        let total = 0;
        const lines = [];
        for (const c of cart) {
          const prod = st.products.find((p) => p.id === c.productId);
          if (!prod || prod.stock < c.qty) {
            return { errorStatus: 409, error: `Insufficient stock for ${c.productId}` };
          }
          prod.stock -= c.qty;
          const lineTotal = Number((prod.price * c.qty).toFixed(2));
          total = Number((total + lineTotal).toFixed(2));
          lines.push({ productId: prod.id, name: prod.name, qty: c.qty, unitPrice: prod.price, lineTotal });
        }
        const order = {
          id: `ord-${crypto.randomUUID().slice(0, 8)}`,
          userId: user.sub,
          lines,
          total,
          status: 'AWAITING_EXTERNAL_PAYMENT',
          createdAt: new Date().toISOString(),
        };
        st.orders.push(order);
        st.carts[user.sub] = [];
        return { order };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 201, out);
    }
    if (method === 'GET' && urlPath === '/api/admin/overview') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const state = store.readState();
      const totalOrderValue = Number(state.orders.reduce((s, o) => s + o.total, 0).toFixed(2));
      return sendJson(res, 200, {
        productCount: state.products.length,
        orderCount: state.orders.length,
        pendingSettlementTotal: totalOrderValue,
      });
    }
    if (method === 'POST' && urlPath === '/api/payments/charge') {
      const user = requireUser(req, res);
      if (!user) return;
      if (!process.env.STRIPE_SECRET_KEY && !process.env.OMISE_SECRET_KEY) {
        return sendJson(res, 501, {
          status: 'NOT_IMPLEMENTED',
          code: 'REQUIRES_EXTERNAL_CREDENTIALS',
          error: 'External payment gateway credentials required (STRIPE_SECRET_KEY / OMISE_SECRET_KEY). Zero fake card settlement.',
        });
      }
      return sendJson(res, 501, {
        status: 'NOT_IMPLEMENTED',
        code: 'EXTERNAL_PROVIDER_ADAPTER_REQUIRED',
        error: 'Live external HTTP settlement adapter must be connected cleanly per provider SDK.',
      });
    }"""

    if app_class == "saas":
        return """    if (method === 'GET' && urlPath === '/api/plans') {
      return sendJson(res, 200, { plans: store.readState().plans });
    }
    if (method === 'GET' && urlPath === '/api/workspaces') {
      const user = requireUser(req, res);
      if (!user) return;
      const st = store.readState();
      return sendJson(res, 200, { workspaces: st.workspaces });
    }
    if (method === 'POST' && urlPath === '/api/workspaces') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'Workspace name is required' });
      const workspace = store.mutate((st) => {
        const ws = {
          id: `ws-${crypto.randomUUID().slice(0, 8)}`,
          name,
          planId: String(body.planId || 'starter'),
          ownerId: user.sub,
          createdAt: new Date().toISOString(),
        };
        st.workspaces.push(ws);
        return ws;
      });
      return sendJson(res, 201, { workspace });
    }
    if (method === 'POST' && urlPath === '/api/members') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const workspaceId = String(body.workspaceId || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      if (!workspaceId || !email) return sendJson(res, 400, { error: 'workspaceId and email required' });
      const member = store.mutate((st) => {
        const rec = { id: `mem-${crypto.randomUUID().slice(0, 8)}`, workspaceId, email, role: String(body.role || 'member') };
        st.members.push(rec);
        return rec;
      });
      return sendJson(res, 201, { member });
    }
    if (method === 'GET' && urlPath === '/api/analytics') {
      const user = requireUser(req, res);
      if (!user) return;
      const st = store.readState();
      return sendJson(res, 200, {
        usersCount: st.users.length,
        workspacesCount: st.workspaces.length,
        membersCount: st.members.length,
        subscriptionsCount: st.subscriptions.length,
      });
    }
    if (method === 'POST' && urlPath === '/api/subscriptions') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const planId = String(body.planId || 'starter');
      const workspaceId = String(body.workspaceId || 'ws-1');
      const out = store.mutate((st) => {
        const plan = st.plans.find((p) => p.id === planId);
        if (!plan) return { errorStatus: 404, error: 'Plan not found' };
        const status = plan.monthlyPrice === 0 ? 'ACTIVE_FREE' : 'AWAITING_EXTERNAL_BILLING';
        const sub = { id: `sub-${crypto.randomUUID().slice(0, 8)}`, workspaceId, planId, status, userId: user.sub };
        st.subscriptions.push(sub);
        return { subscription: sub };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 201, out);
    }
    if (method === 'POST' && urlPath === '/api/billing/checkout') {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 501, {
        status: 'NOT_IMPLEMENTED',
        code: 'REQUIRES_EXTERNAL_CREDENTIALS',
        error: 'External SaaS billing gateway credentials required (STRIPE_SECRET_KEY).',
      });
    }"""

    if app_class == "social":
        return """    if (method === 'GET' && urlPath === '/api/posts') {
      const st = store.readState();
      return sendJson(res, 200, { posts: st.posts, comments: st.comments });
    }
    if (method === 'POST' && urlPath === '/api/posts') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const content = String(body.content || '').trim();
      if (!content) return sendJson(res, 400, { error: 'Post content is required' });
      const post = store.mutate((st) => {
        const item = { id: `post-${crypto.randomUUID().slice(0, 8)}`, authorId: user.sub, authorName: user.name, content, likes: [], createdAt: new Date().toISOString() };
        st.posts.unshift(item);
        return item;
      });
      return sendJson(res, 201, { post });
    }
    if (method === 'POST' && urlPath.startsWith('/api/posts/') && urlPath.endsWith('/like')) {
      const user = requireUser(req, res);
      if (!user) return;
      const postId = urlPath.split('/')[3];
      const out = store.mutate((st) => {
        const p = st.posts.find((x) => x.id === postId);
        if (!p) return { errorStatus: 404, error: 'Post not found' };
        if (!p.likes.includes(user.sub)) p.likes.push(user.sub);
        return { post: p };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 200, out);
    }
    if (method === 'POST' && urlPath.startsWith('/api/posts/') && urlPath.endsWith('/comments')) {
      const user = requireUser(req, res);
      if (!user) return;
      const postId = urlPath.split('/')[3];
      const body = await readJsonBody(req);
      const text = String(body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'Comment text required' });
      const out = store.mutate((st) => {
        if (!st.posts.find((x) => x.id === postId)) return { errorStatus: 404, error: 'Post not found' };
        const comment = { id: `cmt-${crypto.randomUUID().slice(0, 8)}`, postId, authorId: user.sub, authorName: user.name, text };
        st.comments.push(comment);
        return { comment };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 201, out);
    }
    if (method === 'POST' && urlPath === '/api/follow') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const targetUserId = String(body.targetUserId || '').trim();
      if (!targetUserId || targetUserId === user.sub) return sendJson(res, 400, { error: 'Valid targetUserId required' });
      const follow = store.mutate((st) => {
        const rec = { followerId: user.sub, targetUserId };
        if (!st.follows.some((f) => f.followerId === user.sub && f.targetUserId === targetUserId)) st.follows.push(rec);
        return rec;
      });
      return sendJson(res, 201, { follow });
    }
    if (method === 'GET' && urlPath === '/api/messages') {
      const user = requireUser(req, res);
      if (!user) return;
      const st = store.readState();
      return sendJson(res, 200, { messages: st.messages.filter((m) => m.fromId === user.sub || m.toId === user.sub) });
    }
    if (method === 'POST' && urlPath === '/api/messages') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const toId = String(body.toId || '').trim();
      const text = String(body.text || '').trim();
      if (!toId || !text) return sendJson(res, 400, { error: 'toId and text required' });
      const msg = store.mutate((st) => {
        const m = { id: `msg-${crypto.randomUUID().slice(0, 8)}`, fromId: user.sub, toId, text, createdAt: new Date().toISOString() };
        st.messages.push(m);
        return m;
      });
      return sendJson(res, 201, { message: msg });
    }"""

    if app_class == "learning":
        return """    if (method === 'GET' && urlPath === '/api/courses') {
      const st = store.readState();
      return sendJson(res, 200, { courses: st.courses, quizzes: st.quizzes });
    }
    if (method === 'POST' && urlPath === '/api/admin/courses') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'Course title required' });
      const course = store.mutate((st) => {
        const c = { id: `course-${crypto.randomUUID().slice(0, 8)}`, title, instructor: user.name, lessons: [] };
        st.courses.push(c);
        return c;
      });
      return sendJson(res, 201, { course });
    }
    if (method === 'POST' && urlPath === '/api/enrollments') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const courseId = String(body.courseId || '').trim();
      const out = store.mutate((st) => {
        if (!st.courses.find((c) => c.id === courseId)) return { errorStatus: 404, error: 'Course not found' };
        let enr = st.enrollments.find((e) => e.userId === user.sub && e.courseId === courseId);
        if (!enr) {
          enr = { id: `enr-${crypto.randomUUID().slice(0, 8)}`, userId: user.sub, courseId, completedLessons: [], quizScores: {} };
          st.enrollments.push(enr);
        }
        return { enrollment: enr };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 201, out);
    }
    if (method === 'POST' && urlPath.startsWith('/api/quizzes/') && urlPath.endsWith('/submit')) {
      const user = requireUser(req, res);
      if (!user) return;
      const quizId = urlPath.split('/')[3];
      const body = await readJsonBody(req);
      const answers = body.answers || {};
      const out = store.mutate((st) => {
        const qz = st.quizzes.find((q) => q.id === quizId);
        if (!qz) return { errorStatus: 404, error: 'Quiz not found' };
        let correct = 0;
        for (const q of qz.questions) {
          if (String(answers[q.id] || '').trim().toLowerCase() === q.answer.toLowerCase()) correct++;
        }
        const scorePct = Math.round((correct / Math.max(1, qz.questions.length)) * 100);
        const enr = st.enrollments.find((e) => e.userId === user.sub && e.courseId === qz.courseId);
        if (enr) enr.quizScores[quizId] = scorePct;
        return { quizId, correct, total: qz.questions.length, scorePct };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 200, out);
    }
    if (method === 'GET' && urlPath === '/api/progress') {
      const user = requireUser(req, res);
      if (!user) return;
      const st = store.readState();
      return sendJson(res, 200, { enrollments: st.enrollments.filter((e) => e.userId === user.sub) });
    }"""

    if app_class == "management":
        return """    if (method === 'GET' && urlPath === '/api/tasks') {
      return sendJson(res, 200, { tasks: store.readState().tasks });
    }
    if (method === 'POST' && urlPath === '/api/tasks') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'Task title required' });
      const task = store.mutate((st) => {
        const t = { id: `t-${crypto.randomUUID().slice(0, 8)}`, title, assignee: String(body.assignee || user.name), status: 'open', priority: String(body.priority || 'Medium') };
        st.tasks.push(t);
        return t;
      });
      return sendJson(res, 201, { task });
    }
    if (method === 'GET' && urlPath === '/api/inventory') {
      return sendJson(res, 200, { inventory: store.readState().inventory });
    }
    if (method === 'POST' && urlPath === '/api/admin/inventory') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const sku = String(body.sku || '').trim();
      const name = String(body.name || '').trim();
      const quantity = Number(body.quantity ?? 0);
      if (!sku || !name || !Number.isInteger(quantity) || quantity < 0) {
        return sendJson(res, 400, { error: 'Valid sku, name, and non-negative integer quantity required' });
      }
      const item = store.mutate((st) => {
        const rec = { id: `inv-${crypto.randomUUID().slice(0, 8)}`, sku, name, quantity, reorderLevel: Number(body.reorderLevel ?? 5) };
        st.inventory.push(rec);
        return rec;
      });
      return sendJson(res, 201, { item });
    }
    if (method === 'POST' && urlPath === '/api/customers') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'Customer name required' });
      const customer = store.mutate((st) => {
        const c = { id: `cust-${crypto.randomUUID().slice(0, 8)}`, name, email: String(body.email || ''), tier: String(body.tier || 'Standard') };
        st.customers.push(c);
        return c;
      });
      return sendJson(res, 201, { customer });
    }
    if (method === 'GET' && urlPath === '/api/reports/summary') {
      const user = requireUser(req, res);
      if (!user) return;
      const st = store.readState();
      return sendJson(res, 200, {
        tasksTotal: st.tasks.length,
        staffCount: st.staff.length,
        customerCount: st.customers.length,
        inventoryUnits: st.inventory.reduce((s, i) => s + i.quantity, 0),
        lowStockCount: st.inventory.filter((i) => i.quantity <= i.reorderLevel).length,
      });
    }"""

    if app_class == "booking":
        return """    if (method === 'GET' && urlPath === '/api/resources') {
      return sendJson(res, 200, { resources: store.readState().resources });
    }
    if (method === 'POST' && urlPath === '/api/admin/resources') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      const rate = Number(body.ratePerSlot);
      if (!name || !Number.isFinite(rate) || rate <= 0) return sendJson(res, 400, { error: 'Valid name and positive ratePerSlot required' });
      const resource = store.mutate((st) => {
        const r = { id: `res-${crypto.randomUUID().slice(0, 8)}`, name, kind: String(body.kind || 'appointment'), ratePerSlot: rate };
        st.resources.push(r);
        return r;
      });
      return sendJson(res, 201, { resource });
    }
    if (method === 'GET' && urlPath === '/api/bookings') {
      const user = requireUser(req, res);
      if (!user) return;
      const st = store.readState();
      return sendJson(res, 200, { bookings: user.role === 'admin' ? st.bookings : st.bookings.filter((b) => b.userId === user.sub) });
    }
    if (method === 'POST' && urlPath === '/api/bookings') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const resourceId = String(body.resourceId || '').trim();
      const slot = String(body.slot || '').trim();
      if (!resourceId || !slot) return sendJson(res, 400, { error: 'resourceId and slot required' });
      const out = store.mutate((st) => {
        const resObj = st.resources.find((r) => r.id === resourceId);
        if (!resObj) return { errorStatus: 404, error: 'Resource not found' };
        const conflict = st.bookings.find((b) => b.resourceId === resourceId && b.slot === slot && b.status === 'CONFIRMED');
        if (conflict) return { errorStatus: 409, error: 'Selected resource slot is already booked' };
        const booking = { id: `bk-${crypto.randomUUID().slice(0, 8)}`, userId: user.sub, resourceId, slot, total: resObj.ratePerSlot, status: 'CONFIRMED' };
        st.bookings.push(booking);
        return { booking };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 201, out);
    }
    if (method === 'POST' && urlPath.startsWith('/api/bookings/') && urlPath.endsWith('/cancel')) {
      const user = requireUser(req, res);
      if (!user) return;
      const bookingId = urlPath.split('/')[3];
      const out = store.mutate((st) => {
        const b = st.bookings.find((x) => x.id === bookingId && (user.role === 'admin' || x.userId === user.sub));
        if (!b) return { errorStatus: 404, error: 'Booking not found' };
        b.status = 'CANCELLED';
        return { booking: b };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 200, out);
    }"""

    if app_class == "ai_app":
        return """    if (method === 'POST' && urlPath === '/api/datasets/analyze') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const rawValues = Array.isArray(body.values) ? body.values.map(Number).filter(Number.isFinite) : [];
      if (rawValues.length < 2) return sendJson(res, 400, { error: 'At least 2 numeric values required' });
      const mean = rawValues.reduce((a, b) => a + b, 0) / rawValues.length;
      const variance = rawValues.reduce((s, v) => s + (v - mean) ** 2, 0) / rawValues.length;
      const stddev = Math.sqrt(variance);
      const outliers = stddev > 0 ? rawValues.filter((v) => Math.abs(v - mean) / stddev > 1.8) : [];
      const analysis = {
        id: `ds-${crypto.randomUUID().slice(0, 8)}`,
        count: rawValues.length,
        mean: Number(mean.toFixed(4)),
        stddev: Number(stddev.toFixed(4)),
        min: Math.min(...rawValues),
        max: Math.max(...rawValues),
        outliers,
      };
      store.mutate((st) => { st.datasets.push(analysis); });
      return sendJson(res, 201, { analysis });
    }
    if (method === 'GET' && urlPath === '/api/workflows') {
      return sendJson(res, 200, { workflows: store.readState().workflows });
    }
    if (method === 'POST' && urlPath.startsWith('/api/workflows/') && urlPath.endsWith('/run')) {
      const user = requireUser(req, res);
      if (!user) return;
      const wfId = urlPath.split('/')[3];
      const body = await readJsonBody(req);
      if (body.requireExternalLlm && !process.env.ZYNTHEOR_INFERENCE_URL) {
        return sendJson(res, 501, {
          status: 'NOT_IMPLEMENTED',
          code: 'REQUIRES_CLOUD_INFERENCE_ENDPOINT',
          error: 'External cloud inference URL (ZYNTHEOR_INFERENCE_URL) is required for LLM step.',
        });
      }
      const out = store.mutate((st) => {
        const wf = st.workflows.find((w) => w.id === wfId);
        if (!wf) return { errorStatus: 404, error: 'Workflow not found' };
        const vals = Array.isArray(body.values) ? body.values.map(Number).filter(Number.isFinite) : [10, 12, 11];
        const avg = Number((vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)).toFixed(4));
        const run = { id: `run-${crypto.randomUUID().slice(0, 8)}`, status: 'COMPLETED', computedAvg: avg, ranAt: new Date().toISOString() };
        wf.runs.push(run);
        return { workflowId: wf.id, run };
      });
      if (out.errorStatus) return sendJson(res, out.errorStatus, { error: out.error });
      return sendJson(res, 200, out);
    }"""

    # business_web default
    return """    if (method === 'GET' && urlPath === '/api/services') {
      return sendJson(res, 200, { services: store.readState().services });
    }
    if (method === 'GET' && urlPath === '/api/portfolio') {
      return sendJson(res, 200, { portfolio: store.readState().portfolio });
    }
    if (method === 'POST' && urlPath === '/api/admin/portfolio') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const title = String(body.title || '').trim();
      const client = String(body.client || '').trim();
      if (!title || !client) return sendJson(res, 400, { error: 'title and client required' });
      const project = store.mutate((st) => {
        const item = { id: `pf-${crypto.randomUUID().slice(0, 8)}`, title, client, outcome: String(body.outcome || 'Delivered cleanly') };
        st.portfolio.push(item);
        return item;
      });
      return sendJson(res, 201, { project });
    }
    if (method === 'POST' && urlPath === '/api/inquiries') {
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim();
      const message = String(body.message || '').trim();
      if (!name || !email.includes('@') || !message) {
        return sendJson(res, 400, { error: 'Valid name, email, and message required' });
      }
      const inquiry = store.mutate((st) => {
        const rec = { id: `inq-${crypto.randomUUID().slice(0, 8)}`, name, email, message, createdAt: new Date().toISOString() };
        st.inquiries.push(rec);
        return rec;
      });
      return sendJson(res, 201, { inquiry });
    }
    if (method === 'GET' && urlPath === '/api/admin/inquiries') {
      const user = requireAdmin(req, res);
      if (!user) return;
      return sendJson(res, 200, { inquiries: store.readState().inquiries });
    }"""


def _build_server_js(app_class: str, goal_safe: str) -> str:
    meta = APP_CLASS_META[app_class]
    domain_routes = _domain_routes_js(app_class)
    return f"""// ZYNTHEOR Full-Stack Node.js ESM Server ({app_class})
// Goal: {goal_safe}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {{ fileURLToPath }} from 'node:url';
import {{ FileStore }} from '../db/store.js';
import {{ createAuthService }} from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

function sendJson(res, status, payload) {{
  const body = JSON.stringify(payload);
  res.writeHead(status, {{
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }});
  res.end(body);
}}

function readJsonBody(req) {{
  return new Promise((resolve, reject) => {{
    let data = '';
    req.on('data', (chunk) => {{
      data += chunk.toString('utf8');
      if (data.length > 1024 * 1024) reject(new Error('Payload too large'));
    }});
    req.on('end', () => {{
      if (!data.trim()) return resolve({{}});
      try {{
        resolve(JSON.parse(data));
      }} catch {{
        reject(new Error('Invalid JSON body'));
      }}
    }});
    req.on('error', reject);
  }});
}}

export function createAppServer(options = {{}}) {{
  const dataDir = options.dataDir || path.resolve(__dirname, '../data');
  const store = new FileStore(dataDir);
  const auth = createAuthService(options.authSecret);

  function requireUser(req, res) {{
    const user = auth.authenticateRequest(req);
    if (!user) {{
      sendJson(res, 401, {{ error: 'Authentication required' }});
      return null;
    }}
    return user;
  }}

  function requireAdmin(req, res) {{
    const user = requireUser(req, res);
    if (!user) return null;
    if (user.role !== 'admin') {{
      sendJson(res, 403, {{ error: 'Admin role required' }});
      return null;
    }}
    return user;
  }}

  const server = http.createServer(async (req, res) => {{
    try {{
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const urlPath = parsedUrl.pathname;
      const method = (req.method || 'GET').toUpperCase();

      // Static frontend assets
      if (method === 'GET' && (urlPath === '/' || urlPath === '/index.html')) {{
        const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
        res.writeHead(200, {{ 'Content-Type': 'text/html; charset=utf-8' }});
        res.end(html);
        return;
      }}
      if (method === 'GET' && urlPath === '/styles.css') {{
        const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');
        res.writeHead(200, {{ 'Content-Type': 'text/css; charset=utf-8' }});
        res.end(css);
        return;
      }}
      if (method === 'GET' && urlPath === '/app.js') {{
        const js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
        res.writeHead(200, {{ 'Content-Type': 'application/javascript; charset=utf-8' }});
        res.end(js);
        return;
      }}

      // Health & Deployment Boundary Status
      if (method === 'GET' && urlPath === '/api/health') {{
        return sendJson(res, 200, {{
          status: 'ok',
          appClass: {json.dumps(app_class)},
          title: {json.dumps(meta["title"])},
          storeInitialized: fs.existsSync(store.dbFile),
          externalBoundary: {json.dumps(meta["external_boundary"])},
          deploymentStatus: 'LOCAL_SANDBOX_ONLY_NOT_DEPLOYED',
        }});
      }}

      // Auth Routes
      if (method === 'POST' && urlPath === '/api/auth/register') {{
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || email.split('@')[0] || 'User').trim();
        const credential = String(body.credential || body.passcode || '');
        const role = body.role === 'admin' ? 'admin' : 'user';
        if (!email.includes('@') || credential.length < 6) {{
          return sendJson(res, 400, {{ error: 'Valid email and credential (>= 6 chars) required' }});
        }}
        const out = store.mutate((st) => {{
          if (st.users.some((u) => u.email === email)) {{
            return {{ errorStatus: 409, error: 'Email already registered' }};
          }}
          const user = {{
            id: `usr-${{crypto.randomUUID().slice(0, 8)}}`,
            email,
            name,
            role,
            credentialHash: auth.hashCredential(credential),
            createdAt: new Date().toISOString(),
          }};
          st.users.push(user);
          return {{ user }};
        }});
        if (out.errorStatus) return sendJson(res, out.errorStatus, {{ error: out.error }});
        const token = auth.signToken(out.user);
        return sendJson(res, 201, {{
          token,
          user: {{ id: out.user.id, email: out.user.email, name: out.user.name, role: out.user.role }},
        }});
      }}

      if (method === 'POST' && urlPath === '/api/auth/login') {{
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const credential = String(body.credential || body.passcode || '');
        const st = store.readState();
        const user = st.users.find((u) => u.email === email);
        if (!user || !auth.verifyCredential(credential, user.credentialHash)) {{
          return sendJson(res, 401, {{ error: 'Invalid credentials' }});
        }}
        const token = auth.signToken(user);
        return sendJson(res, 200, {{
          token,
          user: {{ id: user.id, email: user.email, name: user.name, role: user.role }},
        }});
      }}

      if (method === 'GET' && urlPath === '/api/auth/me') {{
        const user = requireUser(req, res);
        if (!user) return;
        return sendJson(res, 200, {{ user }});
      }}

{domain_routes}

      return sendJson(res, 404, {{ error: `Route not found: ${{method}} ${{urlPath}}` }});
    }} catch (err) {{
      return sendJson(res, 500, {{ error: err.message || 'Internal Server Error' }});
    }}
  }});

  return {{ server, store, auth }};
}}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {{
  const port = Number(process.env.PORT || 3100);
  const {{ server }} = createAppServer();
  server.listen(port, '127.0.0.1', () => {{
    const addr = server.address();
    const activePort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`APP_SERVER_LISTENING http://127.0.0.1:${{activePort}}`);
  }});
}}
"""


def _build_html(app_class: str, goal_safe: str) -> str:
    meta = APP_CLASS_META[app_class]
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ZYNTHEOR App · {meta["title"]}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="topbar">
    <div>
      <span class="eyebrow">ZYNTHEOR AUTONOMOUS BUILD · {app_class.upper()}</span>
      <h1>{meta["title"]}</h1>
      <p class="subtitle">{meta["subtitle"]} — {goal_safe}</p>
    </div>
    <div id="health-status" class="status-box">Checking backend...</div>
  </header>

  <main class="layout">
    <section class="panel">
      <h2>Account & Session (PBKDF2 + HMAC)</h2>
      <form id="auth-form" class="stack">
        <input id="auth-email" type="email" placeholder="user@example.com" required />
        <input id="auth-cred" type="password" placeholder="Credential (>= 6 chars)" required />
        <select id="auth-role">
          <option value="user">User Role</option>
          <option value="admin">Admin Role</option>
        </select>
        <div class="row">
          <button type="submit" data-mode="register">Register</button>
          <button type="button" id="login-btn">Login</button>
        </div>
      </form>
      <pre id="auth-out" class="output"></pre>
    </section>

    <section class="panel">
      <h2>Live Workspace Data ({meta["primary_endpoint"]})</h2>
      <div class="row">
        <button type="button" id="refresh-btn">Refresh Live Data</button>
      </div>
      <pre id="data-out" class="output"></pre>
    </section>

    <section class="panel">
      <h2>External Infrastructure & Boundaries</h2>
      <p class="notice">{meta["external_boundary"]}</p>
      <p class="notice">Deployment State: LOCAL_SANDBOX_ONLY_NOT_DEPLOYED (requires explicit cloud hosting target).</p>
    </section>
  </main>

  <script type="module" src="/app.js"></script>
</body>
</html>
"""


def _build_css() -> str:
    return """:root {
  color-scheme: dark;
  --bg: #0c0f14;
  --panel: #141923;
  --border: #252e3f;
  --text: #eef2f8;
  --muted: #98a4b8;
  --accent: #38bdf8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 24px 32px;
  border-bottom: 1px solid var(--border);
}
.eyebrow { font-size: 11px; letter-spacing: 0.12em; color: var(--accent); font-weight: 700; }
h1 { margin: 4px 0; font-size: 22px; }
h2 { margin: 0 0 12px; font-size: 15px; }
.subtitle { margin: 0; color: var(--muted); font-size: 13px; }
.status-box {
  padding: 8px 12px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-size: 12px;
}
.layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  padding: 24px 32px;
}
.panel {
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 16px;
}
.stack { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; }
input, select, button {
  padding: 8px 10px;
  border: 1px solid var(--border);
  background: #0e131b;
  color: var(--text);
  font-size: 13px;
}
button {
  cursor: pointer;
  background: #172536;
  border-color: #2f4b6e;
  font-weight: 600;
}
.output {
  margin: 12px 0 0;
  padding: 10px;
  background: #0a0d12;
  border: 1px solid var(--border);
  font-size: 12px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
}
.notice { font-size: 12px; color: var(--muted); }
"""


def _build_client_app_js(app_class: str) -> str:
    primary_ep = APP_CLASS_META[app_class]["primary_endpoint"]
    return f"""// Frontend Client Wired to Real Backend REST API ({app_class})
let authToken = '';

async function api(path, options = {{}}) {{
  const headers = {{ 'Content-Type': 'application/json', ...(options.headers || {{}}) }};
  if (authToken) headers['Authorization'] = `Bearer ${{authToken}}`;
  const res = await fetch(path, {{ ...options, headers }});
  const data = await res.json().catch(() => ({{}}));
  return {{ status: res.status, data }};
}}

async function refreshHealthAndData() {{
  const healthEl = document.getElementById('health-status');
  const dataEl = document.getElementById('data-out');
  const h = await api('/api/health');
  if (healthEl) healthEl.textContent = `HTTP ${{h.status}} · ${{h.data.appClass || 'app'}} (${{h.data.deploymentStatus || ''}})`;
  const d = await api({json.dumps(primary_ep)});
  if (dataEl) dataEl.textContent = JSON.stringify(d, null, 2);
}}

if (typeof document !== 'undefined') {{
  const form = document.getElementById('auth-form');
  const loginBtn = document.getElementById('login-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const authOut = document.getElementById('auth-out');

  const submitAuth = async (mode) => {{
    const email = document.getElementById('auth-email').value;
    const credential = document.getElementById('auth-cred').value;
    const role = document.getElementById('auth-role').value;
    const res = await api(`/api/auth/${{mode}}`, {{
      method: 'POST',
      body: JSON.stringify({{ email, credential, role }}),
    }});
    if (res.data?.token) authToken = res.data.token;
    if (authOut) authOut.textContent = JSON.stringify(res, null, 2);
    await refreshHealthAndData();
  }};

  form?.addEventListener('submit', (e) => {{
    e.preventDefault();
    submitAuth('register');
  }});
  loginBtn?.addEventListener('click', () => submitAuth('login'));
  refreshBtn?.addEventListener('click', () => refreshHealthAndData());
  refreshHealthAndData();
}}
"""


def _build_domain_test_steps(app_class: str) -> str:
    if app_class == "ecommerce":
        return """  // E-Commerce Domain Workflow: Admin product -> User cart -> Order -> Fail-closed payment
  const adminProd = await req('POST', '/api/admin/products', { name: 'GPU Cluster', price: 2500, stock: 4 }, adminTok);
  assert.equal(adminProd.status, 201);
  const forbiddenProd = await req('POST', '/api/admin/products', { name: 'Fail', price: 10, stock: 1 }, userTok);
  assert.equal(forbiddenProd.status, 403);

  const addCart = await req('POST', '/api/cart', { productId: adminProd.data.product.id, qty: 2 }, userTok);
  assert.equal(addCart.status, 200);
  const orderRes = await req('POST', '/api/orders', {}, userTok);
  assert.equal(orderRes.status, 201);
  assert.equal(orderRes.data.order.total, 5000);
  assert.equal(orderRes.data.order.status, 'AWAITING_EXTERNAL_PAYMENT');

  const payRes = await req('POST', '/api/payments/charge', { orderId: orderRes.data.order.id }, userTok);
  assert.equal(payRes.status, 501);
  assert.equal(payRes.data.code, 'REQUIRES_EXTERNAL_CREDENTIALS');

  // Verify stock persisted at 2 across server restart
  const verifyPersisted = async (baseUrl2) => {
    const r = await fetch(`${baseUrl2}/api/products`);
    const pJson = await r.json();
    const item = pJson.products.find((p) => p.id === adminProd.data.product.id);
    assert.ok(item && item.stock === 2, 'Stock decrement must persist across restart');
  };"""

    if app_class == "saas":
        return """  const wsRes = await req('POST', '/api/workspaces', { name: 'Core Engineering', planId: 'pro' }, userTok);
  assert.equal(wsRes.status, 201);
  const subRes = await req('POST', '/api/subscriptions', { workspaceId: wsRes.data.workspace.id, planId: 'pro' }, userTok);
  assert.equal(subRes.status, 201);
  assert.equal(subRes.data.subscription.status, 'AWAITING_EXTERNAL_BILLING');
  const billRes = await req('POST', '/api/billing/checkout', { workspaceId: wsRes.data.workspace.id }, userTok);
  assert.equal(billRes.status, 501);
  assert.equal(billRes.data.code, 'REQUIRES_EXTERNAL_CREDENTIALS');
  const verifyPersisted = async (baseUrl2) => {
    const r = await fetch(`${baseUrl2}/api/workspaces`, { headers: { Authorization: `Bearer ${userTok}` } });
    const j = await r.json();
    assert.ok(j.workspaces.some((w) => w.id === wsRes.data.workspace.id));
  };"""

    if app_class == "social":
        return """  const postRes = await req('POST', '/api/posts', { content: 'Shipping verified build' }, userTok);
  assert.equal(postRes.status, 201);
  const likeRes = await req('POST', `/api/posts/${postRes.data.post.id}/like`, {}, adminTok);
  assert.equal(likeRes.status, 200);
  assert.equal(likeRes.data.post.likes.length, 1);
  const cmtRes = await req('POST', `/api/posts/${postRes.data.post.id}/comments`, { text: 'Verified!' }, adminTok);
  assert.equal(cmtRes.status, 201);
  const msgRes = await req('POST', '/api/messages', { toId: adminLogin.data.user.id, text: 'Ping' }, userTok);
  assert.equal(msgRes.status, 201);
  const verifyPersisted = async (baseUrl2) => {
    const r = await fetch(`${baseUrl2}/api/posts`);
    const j = await r.json();
    assert.ok(j.posts.some((p) => p.id === postRes.data.post.id && p.likes.length === 1));
  };"""

    if app_class == "learning":
        return """  const courseRes = await req('POST', '/api/admin/courses', { title: 'Distributed Systems' }, adminTok);
  assert.equal(courseRes.status, 201);
  const enrRes = await req('POST', '/api/enrollments', { courseId: 'course-1' }, userTok);
  assert.equal(enrRes.status, 201);
  const qRes = await req('POST', '/api/quizzes/quiz-1/submit', { answers: { q1: 'rename' } }, userTok);
  assert.equal(qRes.status, 200);
  assert.equal(qRes.data.scorePct, 100);
  const verifyPersisted = async (baseUrl2) => {
    const r = await fetch(`${baseUrl2}/api/progress`, { headers: { Authorization: `Bearer ${userTok}` } });
    const j = await r.json();
    assert.equal(j.enrollments[0].quizScores['quiz-1'], 100);
  };"""

    if app_class == "management":
        return """  const taskRes = await req('POST', '/api/tasks', { title: 'Verify stock reconciliation', priority: 'High' }, userTok);
  assert.equal(taskRes.status, 201);
  const invRes = await req('POST', '/api/admin/inventory', { sku: 'SKU-202', name: 'Sensor Unit', quantity: 3, reorderLevel: 5 }, adminTok);
  assert.equal(invRes.status, 201);
  const repRes = await req('GET', '/api/reports/summary', null, userTok);
  assert.equal(repRes.status, 200);
  assert.ok(repRes.data.lowStockCount >= 1);
  const verifyPersisted = async (baseUrl2) => {
    const r = await fetch(`${baseUrl2}/api/inventory`);
    const j = await r.json();
    assert.ok(j.inventory.some((i) => i.sku === 'SKU-202'));
  };"""

    if app_class == "booking":
        return """  const bkRes = await req('POST', '/api/bookings', { resourceId: 'res-1', slot: '2026-12-01T10:00Z' }, userTok);
  assert.equal(bkRes.status, 201);
  const conflictRes = await req('POST', '/api/bookings', { resourceId: 'res-1', slot: '2026-12-01T10:00Z' }, adminTok);
  assert.equal(conflictRes.status, 409);
  const verifyPersisted = async (baseUrl2) => {
    const r = await fetch(`${baseUrl2}/api/bookings`, { headers: { Authorization: `Bearer ${userTok}` } });
    const j = await r.json();
    assert.ok(j.bookings.some((b) => b.id === bkRes.data.booking.id && b.status === 'CONFIRMED'));
  };"""

    if app_class == "ai_app":
        return """  const dsRes = await req('POST', '/api/datasets/analyze', { values: [10, 11, 10, 12, 95] }, userTok);
  assert.equal(dsRes.status, 201);
  assert.ok(dsRes.data.analysis.outliers.includes(95));
  const wfRes = await req('POST', '/api/workflows/wf-1/run', { values: [10, 20, 30] }, userTok);
  assert.equal(wfRes.status, 200);
  assert.equal(wfRes.data.run.computedAvg, 20);
  const blockedLlm = await req('POST', '/api/workflows/wf-1/run', { requireExternalLlm: true }, userTok);
  assert.equal(blockedLlm.status, 501);
  assert.equal(blockedLlm.data.code, 'REQUIRES_CLOUD_INFERENCE_ENDPOINT');
  const verifyPersisted = async (baseUrl2) => {
    const r = await fetch(`${baseUrl2}/api/workflows`);
    const j = await r.json();
    assert.ok(j.workflows[0].runs.length >= 1);
  };"""

    # business_web
    return """  const pfRes = await req('POST', '/api/admin/portfolio', { title: 'Sovereign Portal', client: 'CoreBank', outcome: '100% test coverage' }, adminTok);
  assert.equal(pfRes.status, 201);
  const forbiddenPf = await req('POST', '/api/admin/portfolio', { title: 'Blocked', client: 'X' }, userTok);
  assert.equal(forbiddenPf.status, 403);
  const inqRes = await req('POST', '/api/inquiries', { name: 'Niran', email: 'niran@example.com', message: 'Requesting architecture demo' });
  assert.equal(inqRes.status, 201);
  const verifyPersisted = async (baseUrl2) => {
    const r = await fetch(`${baseUrl2}/api/admin/inquiries`, { headers: { Authorization: `Bearer ${adminTok}` } });
    const j = await r.json();
    assert.ok(j.inquiries.some((i) => i.id === inqRes.data.inquiry.id));
  };"""


def _build_integration_test_js(app_class: str) -> str:
    domain_steps = _domain_routes_and_verify = _build_domain_test_steps(app_class)
    return f"""// End-to-End Live HTTP + Auth/RBAC + File DB Persistence Integration Tests ({app_class})
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {{ createAppServer }} from '../src/server.js';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyn-app-test-'));
const authSecret = 'test_sovereign_secret_key_for_hmac_verification_32bytes';

async function listen(srv) {{
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const addr = srv.address();
  return `http://127.0.0.1:${{addr.port}}`;
}}

async function closeSrv(srv) {{
  await new Promise((resolve) => {{
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close(() => resolve());
  }});
}}

async function run() {{
  const {{ server }} = createAppServer({{ dataDir: tmpDataDir, authSecret }});
  const baseUrl = await listen(server);

  const req = async (method, urlPath, body = null, token = '') => {{
    const headers = {{ 'Content-Type': 'application/json' }};
    if (token) headers['Authorization'] = `Bearer ${{token}}`;
    const res = await fetch(`${{baseUrl}}${{urlPath}}`, {{
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }});
    const data = await res.json().catch(() => ({{}}));
    return {{ status: res.status, data }};
  }};

  let verifyPersisted;
  let adminTok = '';
  let userTok = '';

  try {{
    const htmlRes = await fetch(`${{baseUrl}}/`);
    assert.equal(htmlRes.status, 200);
    const htmlText = await htmlRes.text();
    assert.match(htmlText, /ZYNTHEOR AUTONOMOUS BUILD/);

    const healthRes = await req('GET', '/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.data.appClass, {json.dumps(app_class)});
    assert.equal(healthRes.data.storeInitialized, true);

    const unauthMe = await req('GET', '/api/auth/me');
    assert.equal(unauthMe.status, 401);

    const regAdmin = await req('POST', '/api/auth/register', {{
      email: 'admin@zyntheor.local',
      name: 'Admin',
      credential: 'adminpass123',
      role: 'admin',
    }});
    assert.equal(regAdmin.status, 201);
    const adminLogin = await req('POST', '/api/auth/login', {{
      email: 'admin@zyntheor.local',
      credential: 'adminpass123',
    }});
    assert.equal(adminLogin.status, 200);
    adminTok = adminLogin.data.token;

    const regUser = await req('POST', '/api/auth/register', {{
      email: 'user@zyntheor.local',
      name: 'Member',
      credential: 'userpass123',
      role: 'user',
    }});
    assert.equal(regUser.status, 201);
    userTok = regUser.data.token;

{domain_steps}
  }} finally {{
    await closeSrv(server);
  }}

  // Persistence verification across fresh server instance
  const {{ server: server2 }} = createAppServer({{ dataDir: tmpDataDir, authSecret }});
  const baseUrl2 = await listen(server2);
  try {{
    await verifyPersisted(baseUrl2);
  }} finally {{
    await closeSrv(server2);
    fs.rmSync(tmpDataDir, {{ recursive: true, force: true }});
  }}

  console.log('OK: Full-stack {app_class} HTTP/Auth/DB integration tests passed');
}}

run().catch((err) => {{
  console.error('Integration test failed:', err);
  process.exit(1);
}});
"""


def _build_smoke_solution_js(app_class: str) -> str:
    return f"""// Runnable Smoke Runner for {app_class} Full-Stack Server (boots on ephemeral port 0, verifies /api/health, shuts down cleanly)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {{ createAppServer }} from './src/server.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyn-smoke-'));
const {{ server }} = createAppServer({{ dataDir: tmpDir }});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const addr = server.address();
const baseUrl = `http://127.0.0.1:${{addr.port}}`;
try {{
  const res = await fetch(`${{baseUrl}}/api/health`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.status, 'ok');
  console.log('APP_RUN_OK:', JSON.stringify(data));
}} finally {{
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, {{ recursive: true, force: true }});
}}
"""


def _build_deploy_manifest(app_class: str, goal_safe: str, priority: str) -> str:
    meta = APP_CLASS_META[app_class]
    return json.dumps(
        {
            "appClass": app_class,
            "title": meta["title"],
            "goal": goal_safe,
            "priority": priority,
            "runtime": "Node.js ESM (zero external npm dependencies)",
            "entrypoint": "src/server.js",
            "smokeRunner": "solution.js",
            "database": "db/store.js (atomic JSON file store)",
            "authentication": "src/auth.js (PBKDF2 + HS256 HMAC timingSafeEqual)",
            "frontend": ["public/index.html", "public/styles.css", "public/app.js"],
            "integrationTests": "tests/app.test.js",
            "externalBoundaries": {
                "constraint": meta["external_boundary"],
                "cloudDeployment": "NOT_DEPLOYED_EXTERNAL_INFRA_REQUIRED",
            },
        },
        indent=2,
    ) + "\n"


def _build_readme(app_class: str, goal_safe: str, priority: str) -> str:
    meta = APP_CLASS_META[app_class]
    return f"""# ZYNTHEOR Autonomous Full-Stack Application ({meta["title"]})

- **Goal**: {goal_safe}
- **Application Class**: `{app_class}`
- **Priority**: {priority}
- **Runtime**: Node.js ESM (`node src/server.js`)

## Verified Capabilities (Local Sandbox)
- `db/store.js` — Atomic JSON-file-backed persistent store
- `src/auth.js` — PBKDF2 credential hashing + HS256 HMAC session tokens (`timingSafeEqual`) + Admin/User RBAC
- `src/server.js` — REST API (`/api/health`, `/api/auth/*`, `{meta["primary_endpoint"]}`, etc.) + static UI server
- `public/index.html`, `public/styles.css`, `public/app.js` — Interactive frontend wired to live REST endpoints
- `tests/app.test.js` — Live HTTP + Auth + DB persistence integration test suite

## Explicit External Boundaries (Zero Simulation)
- **External Integrations**: {meta["external_boundary"]}
- **Live Cloud Deployment**: `NOT_DEPLOYED_EXTERNAL_INFRA_REQUIRED` — Verified inside sandbox; deploy `src/server.js` to a live Node host with `APP_AUTH_SECRET` configured to expose publicly.
"""


def generate_fullstack_web_project(goal: str, priority: str = "Medium", app_class: Optional[str] = None) -> Dict[str, str]:
    """Generates a complete, multi-file runnable full-stack Node.js ESM web application."""
    resolved_class = app_class if app_class in WEB_APP_CLASSES else (classify_web_app(goal) or "business_web")
    goal_safe = (goal or resolved_class).replace('"', "'").replace("`", "'").strip()[:160]
    return {
        "package.json": _build_package_json(resolved_class),
        "db/store.js": _build_store_js(resolved_class),
        "src/auth.js": _build_auth_js(),
        "src/server.js": _build_server_js(resolved_class, goal_safe),
        "solution.js": _build_smoke_solution_js(resolved_class),
        "public/index.html": _build_html(resolved_class, goal_safe),
        "public/styles.css": _build_css(),
        "public/app.js": _build_client_app_js(resolved_class),
        "tests/app.test.js": _build_integration_test_js(resolved_class),
        "DEPLOY_MANIFEST.json": _build_deploy_manifest(resolved_class, goal_safe, priority),
        "README.md": _build_readme(resolved_class, goal_safe, priority),
    }
