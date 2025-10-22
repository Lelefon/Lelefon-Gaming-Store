export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://lelefon.gaming.com', // <-- THIS LINE IS UPDATED
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    let response;
    try {
      // --- AUTH ---
      if (url.pathname === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env);
      } else if (url.pathname === '/api/login' && request.method === 'POST') {
        response = await handleLogin(request, env);
      
      // --- DATA FETCHING (PUBLIC) ---
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

      // --- USER ACTIONS ---
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
         // For simplicity, just fetching main order details here. specialized endpoint needed for full details if many items.
         const orders = await env.DB.prepare('SELECT * FROM orders WHERE user_email = ? ORDER BY created_at DESC').bind(email).all();
         response = Response.json(orders.results);
      
      // --- ADMIN ACTIONS ---
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

    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(response.body, { status: response.status, headers: newHeaders });
  },
};

async function handleRegister(req, env) {
  const { email, password } = await req.json();
  if (!email || !password) throw new Error('Missing data');
  try {
     await env.DB.batch([
      env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind(email, btoa(password)),
      env.DB.prepare('INSERT INTO wallets (user_email, balance) VALUES (?, 0)').bind(email)
    ]);
    return Response.json({ success: true, message: 'Registered successfully!' }, { status: 201 });
  } catch (e) {
      if(e.message.includes('UNIQUE')) return Response.json({ success: false, message: 'Email exists' }, { status: 409 });
      throw e;
  }
}

async function handleLogin(req, env) {
  const { email, password } = await req.json();
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (user && user.password_hash === btoa(password)) {
    return Response.json({ success: true, email: user.email, role: user.role });
  }
  return Response.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
}

async function handleTopup(req, env) {
    const { email, amount } = await req.json();
    await env.DB.prepare('UPDATE wallets SET balance = balance + ? WHERE user_email = ?').bind(amount, email).run();
    return Response.json({ success: true });
}

async function handleCreateOrder(req, env) {
    const { user_email, items, total, method } = await req.json();
    
    if (method === 'LF Wallet') {
        const wallet = await env.DB.prepare('SELECT balance FROM wallets WHERE user_email = ?').bind(user_email).first();
        if (!wallet || wallet.balance < total) return Response.json({ success: false, message: 'Insufficient balance' }, { status: 400 });
        await env.DB.prepare('UPDATE wallets SET balance = balance - ? WHERE user_email = ?').bind(total, user_email).run();
    }

    const orderId = 'LF' + Date.now().toString(36).toUpperCase();
    const batch = [
        env.DB.prepare('INSERT INTO orders (id, user_email, total, payment_method) VALUES (?, ?, ?, ?)').bind(orderId, user_email, total, method)
    ];
    for (const item of items) {
        batch.push(env.DB.prepare('INSERT INTO order_items (order_id, game_name, package_label, quantity, price_at_purchase, uid) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(orderId, item.gameName, item.pkgLabel, item.qty, item.price, item.uid || null));
    }
    await env.DB.batch(batch);
    return Response.json({ success: true, orderId });
}