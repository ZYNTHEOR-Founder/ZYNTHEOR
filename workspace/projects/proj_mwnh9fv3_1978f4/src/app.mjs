import fs from 'node:fs';
import path from 'node:path';

export const APP_META = {
  name: "Live HTTP smoke test dashboard",
  slug: "live-http-smoke-test-dashboard",
  domain: "saas",
  domainLabel: "Multi-View SaaS Operations Platform",
  version: '1.1.0',
  endpoints: [
    {
      "method": "GET",
      "path": "/api/health",
      "purpose": "Service liveness & version check"
    },
    {
      "method": "GET",
      "path": "/api/items",
      "purpose": "List domain records"
    },
    {
      "method": "POST",
      "path": "/api/items",
      "purpose": "Create validated domain record"
    },
    {
      "method": "GET",
      "path": "/",
      "purpose": "Responsive HTML application view"
    }
  ]
};

export function createStore(initialItems = [], options = {}) {
  const persistPath = options.persistPath || null;
  let items = [...initialItems];
  let users = [{ id: 1, name: 'Workspace Admin', email: 'admin@app.local', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' }];
  if (persistPath && fs.existsSync(persistPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
      if (Array.isArray(parsed.items)) items = parsed.items;
      if (Array.isArray(parsed.users)) users = parsed.users;
    } catch (_) {}
  }
  function flush() {
    if (!persistPath) return;
    const dir = path.dirname(persistPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(persistPath, JSON.stringify({ items, users }, null, 2), 'utf8');
  }
  return {
    list(filterCategory) {
      if (!filterCategory || filterCategory === 'all') return items.slice();
      return items.filter((it) => it.category === filterCategory);
    },
    create(input) {
      const title = typeof input?.title === 'string' ? input.title.trim() : '';
      if (!title || title.length > 140) {
        throw new Error('VALIDATION_ERROR: title (1-140 chars) is required');
      }
      const nextId = items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1;
      const entry = {
        id: nextId,
        title,
        category: typeof input?.category === 'string' && input.category.trim() ? input.category.trim() : "operations",
        status: typeof input?.status === 'string' && input.status.trim() ? input.status.trim().toUpperCase() : 'ACTIVE',
        owner: typeof input?.owner === 'string' && input.owner.trim() ? input.owner.trim() : 'operator',
        value: Number.isFinite(Number(input?.value)) ? Number(input.value) : 0,
        createdAt: new Date().toISOString(),
      };
      items.unshift(entry);
      flush();
      return entry;
    },
    updateStatus(id, status) {
      const idx = items.findIndex((it) => Number(it.id) === Number(id));
      if (idx < 0) return null;
      items[idx] = { ...items[idx], status: String(status || 'VERIFIED').toUpperCase() };
      flush();
      return items[idx];
    },
    remove(id) {
      const before = items.length;
      items = items.filter((it) => Number(it.id) !== Number(id));
      if (items.length !== before) { flush(); return true; }
      return false;
    },
    listUsers() { return users.slice(); },
    registerUser(input) {
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (!name || !email.includes('@')) throw new Error('VALIDATION_ERROR: valid name and email required');
      const user = { id: users.length + 1, name, email, role: input?.role === 'admin' ? 'admin' : 'member', createdAt: new Date().toISOString() };
      users.push(user);
      flush();
      return user;
    },
    summary() {
      const byCategory = {};
      let totalValue = 0;
      for (const it of items) {
        byCategory[it.category] = (byCategory[it.category] || 0) + 1;
        totalValue += Number(it.value) || 0;
      }
      return {
        totalItems: items.length,
        verifiedItems: items.filter((i) => i.status === 'VERIFIED').length,
        totalUsers: users.length,
        totalValue,
        byCategory,
      };
    },
  };
}

export function routeRequest(method, urlPath, body, store) {
  if (method === 'GET' && urlPath === '/api/health') {
    return { status: 200, body: { status: 'ok', service: APP_META.slug, domain: APP_META.domain, version: APP_META.version } };
  }
  if (method === 'GET' && urlPath === '/api/summary') {
    return { status: 200, body: { meta: APP_META, summary: store.summary() } };
  }
  if (method === 'GET' && urlPath === '/api/items') {
    return { status: 200, body: { items: store.list() } };
  }
  if (method === 'POST' && urlPath === '/api/items') {
    try {
      const item = store.create(body);
      return { status: 201, body: { item } };
    } catch (err) {
      return { status: 400, body: { error: err.message } };
    }
  }
  if (method === 'PATCH' && urlPath.startsWith('/api/items/')) {
    const id = Number(urlPath.split('/').pop());
    const updated = store.updateStatus(id, body?.status || 'VERIFIED');
    return updated ? { status: 200, body: { item: updated } } : { status: 404, body: { error: 'Not found' } };
  }
  if (method === 'DELETE' && urlPath.startsWith('/api/items/')) {
    const id = Number(urlPath.split('/').pop());
    return store.remove(id) ? { status: 200, body: { deleted: true } } : { status: 404, body: { error: 'Not found' } };
  }
  if (method === 'GET' && urlPath === '/api/users') {
    return { status: 200, body: { users: store.listUsers() } };
  }
  if (method === 'POST' && urlPath === '/api/users') {
    try {
      const user = store.registerUser(body);
      return { status: 201, body: { user } };
    } catch (err) {
      return { status: 400, body: { error: err.message } };
    }
  }
  return { status: 404, body: { error: 'Route not found' } };
}
