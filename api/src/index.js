// --- Handler Functions ---

/**
 * Handles user login.
 * Compares a Base64 encoded password from the database.
 */
async function handleLogin(request, env) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return Response.json({ message: 'Email and password are required.' }, { status: 400 });
  }

  const user = await env.DB.prepare('SELECT email, password_hash, role FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user) {
    return Response.json({ message: 'Invalid admin credentials.' }, { status: 401 });
  }

  const submittedPasswordEncoded = btoa(password);

  if (user.password_hash !== submittedPasswordEncoded) {
    return Response.json({ message: 'Invalid admin credentials.' }, { status: 401 });
  }

  if (user.role !== 'admin') {
    return Response.json({ message: 'Access denied. Not an administrator.' }, { status: 403 });
  }

  return Response.json({ success: true, role: user.role });
}

async function handleRegister(request, env) {
  // TODO: Implement user registration logic here.
  return Response.json({ message: 'Registration endpoint not implemented.' }, { status: 501 });
}

async function handleTopup(request, env) {
  // TODO: Implement wallet top-up logic here.
  return Response.json({ message: 'Top-up endpoint not implemented.' }, { status: 501 });
}

async function handleCreateOrder(request, env) {
  // TODO: Implement order creation logic here.
  return Response.json({ message: 'Order creation endpoint not implemented.' }, { status: 501 });
}


// --- Main Fetch Handler ---

export default {
  async fetch(request, env) {
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
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '600',
    });

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: isAllowed ? baseCors(origin) : {},
      });
    }

    const url = new URL(request.url);
    let response;

    try {
      // --- API Routing ---
      if (url.pathname === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env);
      } else if (url.pathname === '/api/login' && request.method === 'POST') {
        response = await handleLogin(request, env);
      } else if (url.pathname === '/api/games' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM games').all();
        response = Response.json(results);
      } else if (url.pathname === '/api/regions' && request.method === 'GET') {
        const gameId = url.searchParams.get('gameId');
        const { results } = await env.DB.prepare('SELECT * FROM regions WHERE game_id = ?').bind(gameId).all();
        response = Response.json(results);
      } else if (url.pathname === '/api/packages' && request.method === 'GET') {
        const gameId = url.searchParams.get('gameId');
        const regionKey = url.searchParams.get('regionKey');
        let query = 'SELECT * FROM packages WHERE game_id = ?';
        let params = [gameId];
        if (regionKey && regionKey !== 'null' && regionKey !== 'undefined') {
          query += ' AND region_key = ?';
          params.push(regionKey);
        } else {
          query += ' AND (region_key IS NULL OR region_key = "")';
        }
        const { results } = await env.DB.prepare(query).bind(...params).all();
        response = Response.json(results);
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
        const { results } = await env.DB.prepare('SELECT * FROM orders WHERE user_email = ? ORDER BY created_at DESC').bind(email).all();
        response = Response.json(results);
      } else if (url.pathname === '/api/admin/users' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT u.email, u.role, w.balance FROM users u LEFT JOIN wallets w ON u.email = w.user_email ORDER BY u.created_at DESC'
        ).all();
        response = Response.json(results);
      } else if (url.pathname === '/api/admin/wallet' && request.method === 'POST') {
        const { email, newBalance } = await request.json();
        await env.DB.prepare('UPDATE wallets SET balance = ? WHERE user_email = ?')
          .bind(newBalance, email)
          .run();
        response = Response.json({ success: true });
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
        const id = `${data.game_id}-${data.label.replace(/\s+/g, '-')}-${Date.now().toString(36)}`;
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

    // Attach CORS headers to the final response
    if (isAllowed) {
      const headers = new Headers(response.headers);
      const corsHeaders = baseCors(origin);
      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    
    return response;
  }
};