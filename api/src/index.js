export default {
  async fetch(request, env) {
    // allow your front-end hosts
    const ALLOWED_ORIGINS = new Set([
      'https://lelefongaming.com',
      'https://www.lelefongaming.com',
      'https://lelefon-gaming-store.pages.dev',
    ]);

    const origin = request.headers.get('Origin') || '';
    const isAllowed = ALLOWED_ORIGINS.has(origin);

    const baseCors = (o) => ({
      'Access-Control-Allow-Origin': o,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      // only keep this if you actually use cookies/session/credentials
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '600',
    });

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: isAllowed ? baseCors(origin) : {},
      });
    }

    const url = new URL(request.url);
    let response;

    try {
      // === your existing routes ===
      if (url.pathname === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env);
      } else if (url.pathname === '/api/login' && request.method === 'POST') {
        response = await handleLogin(request, env);
      } else if (url.pathname === '/api/games' && request.method === 'GET') {
        const games = await env.DB.prepare('SELECT * FROM games').all();
        response = Response.json(games.results);
      } else if (url.pathname === '/api/regions' && request.method === 'GET') {
        const gameId = url.searchParams.get('gameId');
        const regions = await env.DB.prepare('SELECT * FROM regions WHERE game_id = ?').bind(gameId).all();
        response = Response.json(regions.results);
      } else if (url.pathname === '/api/packages' && request.method === 'GET') {
        const gameId = url.searchParams.get('gameId');
        const regionKey = url.searchParams.get('regionKey');
        let query = 'SELECT * FROM packages WHERE game_id = ?';
        let params = [gameId];
        if (regionKey && regionKey !== 'null') { query += ' AND region_key = ?'; params.push(regionKey); }
        const pkgs = await env.DB.prepare(query).bind(...params).all();
        response = Response.json(pkgs.results);
      } else if (url.pathname === '/api/wallet' && request.method === 'GET') {
        const email = url.searchParams.get('email');
        const wallet = await env.DB.prepare('SELECT balance FROM wallets WHERE user_email = ?').bind(email).first();
        response = Response.json({ balance: wallet ? wallet.balance : 0 });
      } else if (url.pathname === '/api/wallet/topup' && request.method === 'POST') {
        response = await handleTopup(request, env);
      } else if (url.pathname === '/api/orders' && request.method === 'POST') {
        response = await handleCreateOrder(request, env);
      } else if (url.pathname === '/api/orders' && request.method === 'GET') {
        const email = url.searchParams.get('email');
        const orders = await env.DB.prepare('SELECT * FROM orders WHERE user_email = ? ORDER BY created_at DESC').bind(email).all();
        response = Response.json(orders.results);
      } else if (url.pathname === '/api/admin/game' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare('INSERT OR REPLACE INTO games (id, name, image_url, category, regionable, uid_required) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(data.id, data.name, data.image_url, data.category, data.regionable ? 1 : 0, data.uid_required ? 1 : 0).run();
        response = Response.json({ success: true });
      } else if (url.pathname === '/api/admin/region' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare('INSERT INTO regions (game_id, region_key, name, flag) VALUES (?, ?, ?, ?)').bind(data.game_id, data.region_key, data.name, data.flag).run();
        response = Response.json({ success: true });
      } else if (url.pathname === '/api/admin/package' && request.method === 'POST') {
        const data = await request.json();
        const id = data.game_id + '-' + Date.now().toString(36);
        await env.DB.prepare('INSERT INTO packages (id, game_id, region_key, label, price) VALUES (?, ?, ?, ?, ?)').bind(id, data.game_id, data.region_key, data.label, data.price).run();
        response = Response.json({ success: true });
      } else if (url.pathname === '/api/admin/package' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        await env.DB.prepare('DELETE FROM packages WHERE id = ?').bind(id).run();
        response = Response.json({ success: true });
      } else {
        response = new Response('Not Found', { status: 404 });
      }
    } catch (e) {
      console.error(e);
      response = Response.json({ success: false, message: e.message }, { status: 500 });
    }

    // attach CORS only when allowed
    if (isAllowed) {
      const headers = new Headers(response.headers);
      const ch = baseCors(origin);
      for (const [k, v] of Object.entries(ch)) headers.set(k, v);
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }
};
