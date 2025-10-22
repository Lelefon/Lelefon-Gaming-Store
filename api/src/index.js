// --- Handler Functions ---

/**
 * Handles user login.
 * Compares a Base64 encoded password from the database.
 * NOTE: Base64 is NOT a secure hash. This is for functionality based on the current schema.
 * You should upgrade to a real hashing library like bcrypt in the future.
 */
async function handleLogin(request, env) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return Response.json({ message: 'Email and password are required.' }, { status: 400 });
  }

  // CORRECTED: Select the 'password_hash' column to match your schema.
  const user = await env.DB.prepare('SELECT email, password_hash, role FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user) {
    return Response.json({ message: 'Invalid admin credentials.' }, { status: 401 });
  }

  // In your schema, 'YWRtaW4xMjM=' is the Base64 encoding of 'admin123'.
  // We must encode the submitted password in the same way to compare it.
  const submittedPasswordEncoded = btoa(password);

  // CORRECTED: Compare the encoded submitted password with the user.password_hash from the DB.
  if (user.password_hash !== submittedPasswordEncoded) {
    return Response.json({ message: 'Invalid admin credentials.' }, { status: 401 });
  }

  // Check if the user has the 'admin' role
  if (user.role !== 'admin') {
    return Response.json({ message: 'Access denied. Not an administrator.' }, { status: 403 });
  }

  // Login successful
  return Response.json({ success: true, role: user.role });
}


// --- Placeholder functions for other routes to prevent crashes ---

async function handleRegister(request, env) {
  // TODO: Implement user registration logic here.
  // Remember to HASH the password before storing it in the database.
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
    // allow your front-end hosts
    const ALLOWED_ORIGINS = new Set([
      'https://lelefongaming.com',
      'https://www.lelefongaming.com',
      'https://lelefon-gaming-store.pages.dev',
      // For local development, you might add:
      // 'http://localhost:3000',
      // 'http://127.0.0.1:5500' // Or whatever your local server port is
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

    // Handle Preflight OPTIONS requests
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
          // Handle cases where a game is not regionable
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
      // For better debugging, return the actual error message in development
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
    
    // If origin is not allowed, return the original response without CORS headers
    return response;
  }
};