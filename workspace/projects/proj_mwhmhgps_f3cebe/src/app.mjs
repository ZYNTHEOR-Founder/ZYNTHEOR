export const APP_META = {
  name: "Batch31 Incident Tracker",
  slug: "batch31-incident-tracker",
  version: '1.0.0',
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

export function createStore(initialItems = []) {
  const items = [...initialItems];
  return {
    list() {
      return items.slice();
    },
    create(input) {
      const title = typeof input?.title === 'string' ? input.title.trim() : '';
      if (!title || title.length > 120) {
        throw new Error('VALIDATION_ERROR: title (1-120 chars) is required');
      }
      const entry = {
        id: items.length + 1,
        title,
        category: typeof input?.category === 'string' && input.category.trim() ? input.category.trim() : 'general',
        createdAt: new Date().toISOString(),
      };
      items.push(entry);
      return entry;
    },
  };
}

export function routeRequest(method, urlPath, body, store) {
  if (method === 'GET' && urlPath === '/api/health') {
    return { status: 200, body: { status: 'ok', service: APP_META.slug, version: APP_META.version } };
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
  return { status: 404, body: { error: 'Route not found' } };
}
