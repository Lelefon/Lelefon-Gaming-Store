// =========================
//  Helper / Handler funcs
// =========================

/**
 * ADMIN login
 * - Used by admin.html only
 * - Requires role === 'admin'
 */
async function handleAdminLogin(request, env) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return Response.json({ success: false, message: 'Email and password are required.' }, { status: 400 });
  }

  const user = await env.DB.prepare(
    'SELECT email, password_hash, role FROM users WHERE email = ?'
  ).bind(email).first();

  if (!user) return Response.json({ success: false, message: 'Invalid admin credentials.' }, { status: 401 });

  if (user.password_hash !== btoa(password)) {
    return Response.json({ success: false, message: 'Invalid admin credentials.' }, { status: 401 });
  }

  if (user.role !== 'admin') {
    return Response.json({ success: false, message: 'Access denied. Not an administrator.' }, { status: 403 });
  }

  return Response.json({ success: true, email: user.email, role: user.role });
}

/**
 * USER login
 * - Local users: compare Base64(password)
 * - Google users: pass provider:'google' (no password check, hash is 'GOOGLE_SSO')
 */
async function handleUserLogin(request, env) {
  const { email, password, provider } = await request.json();

  if (!email) {
    return Response.json({ success: false, message: 'Email is required.' }, { status: 400 });
  }

  const user = await env.DB.prepare(
    'SELECT email, password_hash, role FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first();

  if (!user) return Response.json({ success: false, message: 'Account not found.' }, { status: 404 });

  if (provider === 'google') {
    if (user.password_hash !== 'GOOGLE_SSO') {
      return Response.json({ success: false, message: 'This account is not a Google login.' }, { status: 401 });
    }
  } else {
    if (!password || user.password_hash !== btoa(password)) {
      return Response.json({ success: false, message: 'Invalid email or password.' }, { status: 401 });
    }
  }

  return Response.json({ success: true, email: user.email, role: user.role || 'user' });
}

/**
 * Registration for both:
 * - Local signup (provider:'local', requires password)
 * - Google SSO (provider:'google', no password)
 * Ensures user + wallet rows (idempotent).
 */
async function handleRegister(request, env) {
  const { email, password, provider } = await request.json();

  if (!email) {
    return Response.json({ success: false, message: 'Email is required.' }, { status: 400 });
  }

  const normEmail = email.toLowerCase();
  const hash = provider === 'google' ? 'GOOGLE_SSO' : btoa(password || '');

  try {
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO users (email, password_hash) VALUES (?, ?)').bind(normEmail, hash),
      env.DB.prepare('INSERT OR IGNORE INTO wallets (user_email, balance) VALUES (?, 0)').bind(normEmail),
    ]);

    return Response.json({ success: true, message: 'Registered successfully!' });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    return Response.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ---------- Orders helpers ----------

function makeOrderId() {
  return 'ORD-' + Math.random().toString(36).slice(2, 8) + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * Create order
 * - Deduct wallet if method === 'LF Wallet' (with balance check)
 * - For iPay88 (simulated) no wallet change
 * - Inserts order + items
 */
async function handleCreateOrder(request, env) {
  const { user_email, items = [], total, method = 'LF Wallet' } = await request.json();

  if (!user_email || !items.length || !Number.isFinite(total)) {
    return Response.json({ success: false, message: 'Invalid payload.' }, { status: 400 });
  }
  const email = user_email.toLowerCase();

  // method guards
  if (method === 'LF Wallet') {
    // verify wallet balance
    const wallet = await env.DB.prepare('SELECT balance FROM wallets WHERE user_email = ?').bind(email).first();
    const bal = wallet ? Number(wallet.balance) : 0;
    if (bal < total) {
      return Response.json({ success: false, message: 'Insufficient wallet balance.' }, { status: 402 });
    }
  }

  const orderId = makeOrderId();
  const createdAt = new Date().toISOString();

  try {
    // Begin "transaction-like" sequence (D1 doesn't support actual SQL transactions, so we order ops)
    // 1) Insert order
    await env.DB.prepare(
      'INSERT INTO orders (id, user_email, total, payment_method, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(orderId, email, total, method, 'Processing', createdAt).run();

    // 2) Insert items
    for (const it of items) {
      // Fields: order_id, game_name, package_label, quantity, price_at_purchase, uid, pin
      await env.DB.prepare(
        'INSERT INTO order_items (order_id, game_name, package_label, quantity, price_at_purchase, uid, pin) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        orderId,
        it.gameName || '',
        it.pkgLabel || '',
        it.qty || 1,
        it.price || 0,
        it.uid || null,
        null // pin to be set by admin for "Game Card" items
      ).run();
    }

    // 3) Handle wallet deduction only for LF Wallet
    if (method === 'LF Wallet') {
      await env.DB.prepare('UPDATE wallets SET balance = balance - ? WHERE user_email = ?').bind(total, email).run();
    }

    // Mark order as placed (still "Processing" until admin completes/cancels)
    return Response.json({ success: true, orderId });
  } catch (err) {
    console.error('CREATE ORDER ERROR:', err);
    return Response.json({ success: false, message: err.message }, { status: 500 });
  }
}

/**
 * Topup - (placeholder)
 */
async function handleTopup(_request, _env) {
  return Response.json({ message: 'Top-up endpoint not implemented.' }, { status: 501 });
}


// =========================
//  Main fetch router
// =========================

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
      return new Response(null, { status: 204, headers: isAllowed ? baseCors(origin) : {} });
    }

    const url = new URL(request.url);
    let response;

    try {
      // ----- Auth -----
      if (url.pathname === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env);

      } else if (url.pathname === '/api/login/admin' && request.method === 'POST') {
        response = await handleAdminLogin(request, env);

      } else if ((url.pathname === '/api/login/user' || url.pathname === '/api/user/login') && request.method === 'POST') {
        response = await handleUserLogin(request, env);

      // Back-compat old admin login path:
      } else if (url.pathname === '/api/login' && request.method === 'POST') {
        response = await handleAdminLogin(request, env);

      // ----- Catalog -----
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
        const params = [gameId];

        if (regionKey && regionKey !== 'null' && regionKey !== 'undefined') {
          query += ' AND region_key = ?';
          params.push(regionKey);
        } else {
          query += ' AND (region_key IS NULL OR region_key = "")';
        }

        const { results } = await env.DB.prepare(query).bind(...params).all();
        response = Response.json(results);

      // ----- Wallet / Orders -----
      } else if (url.pathname === '/api/wallet' && request.method === 'GET') {
        const email = (url.searchParams.get('email') || '').toLowerCase();
        const wallet = await env.DB.prepare('SELECT balance FROM wallets WHERE user_email = ?').bind(email).first();
        response = Response.json({ balance: wallet ? wallet.balance : 0 });

      } else if (url.pathname === '/api/wallet/topup' && request.method === 'POST') {
        response = await handleTopup(request, env);

      } else if (url.pathname === '/api/orders' && request.method === 'POST') {
        response = await handleCreateOrder(request, env);

      } else if (url.pathname === '/api/orders' && request.method === 'GET') {
        const email = (url.searchParams.get('email') || '').toLowerCase();
        const { results } = await env.DB.prepare(
          'SELECT * FROM orders WHERE user_email = ? ORDER BY created_at DESC'
        ).bind(email).all();
        response = Response.json(results);

      // ----- Admin: Orders list / status / item pin -----
      } else if (url.pathname === '/api/admin/orders' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, user_email, total, payment_method, status, created_at FROM orders ORDER BY created_at DESC LIMIT 200'
        ).all();
        response = Response.json(results);

      } else if (url.pathname === '/api/admin/order/status' && request.method === 'POST') {
        // payload: { orderId, action }  action ∈ complete | cancel | refund
        const { orderId, action } = await request.json();
        if (!orderId || !['complete','cancel','refund'].includes(action)) {
          response = Response.json({ success:false, message:'Invalid payload' }, { status: 400 });
        } else {
          // Get current order
          const order = await env.DB.prepare('SELECT id, user_email, total, payment_method, status FROM orders WHERE id = ?')
            .bind(orderId).first();
          if (!order) {
            response = Response.json({ success:false, message:'Order not found' }, { status: 404 });
          } else {
            const current = order.status;
            if (action === 'complete') {
              await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('Completed', orderId).run();
              response = Response.json({ success:true, status:'Completed' });
            } else if (action === 'cancel') {
              await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('Cancelled', orderId).run();
              response = Response.json({ success:true, status:'Cancelled' });
            } else if (action === 'refund') {
              if (current === 'Refunded') {
                // already refunded; do nothing idempotently
                response = Response.json({ success:true, status:'Refunded', message:'Already refunded' });
              } else {
                // Credit wallet only once
                if (order.payment_method === 'LF Wallet') {
                  await env.DB.prepare('UPDATE wallets SET balance = balance + ? WHERE user_email = ?')
                    .bind(order.total, order.user_email.toLowerCase()).run();
                }
                await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('Refunded', orderId).run();
                response = Response.json({ success:true, status:'Refunded' });
              }
            }
          }
        }

      } else if (url.pathname === '/api/admin/order/item-pin' && request.method === 'POST') {
        // Set / update PIN for a specific order item (for Game Card)
        // payload: { orderItemId, pin }
        const { orderItemId, pin } = await request.json();
        if (!orderItemId) {
          response = Response.json({ success:false, message:'orderItemId required' }, { status: 400 });
        } else {
          await env.DB.prepare('UPDATE order_items SET pin = ? WHERE id = ?').bind(pin || null, orderItemId).run();
          response = Response.json({ success:true });
        }

      // ----- Admin utilities (users, wallet, games, regions, packages) -----
      } else if (url.pathname === '/api/admin/users' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT u.email, u.role, w.balance FROM users u LEFT JOIN wallets w ON u.email = w.user_email ORDER BY u.created_at DESC'
        ).all();
        response = Response.json(results);

      } else if (url.pathname === '/api/admin/wallet' && request.method === 'POST') {
        const { email, newBalance } = await request.json();
        await env.DB.prepare('UPDATE wallets SET balance = ? WHERE user_email = ?')
          .bind(newBalance, (email || '').toLowerCase())
          .run();
        response = Response.json({ success: true });

      } else if (url.pathname === '/api/admin/game' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare(
          'INSERT OR REPLACE INTO games (id, name, image_url, category, regionable, uid_required) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
          data.id, data.name, data.image_url, data.category, data.regionable ? 1 : 0, data.uid_required ? 1 : 0
        ).run();
        response = Response.json({ success: true });

      } else if (url.pathname === '/api/admin/game' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) {
          response = Response.json({ success:false, message:'id required' }, { status:400 });
        } else {
          // delete game + cascading children (regions/packages) via separate queries
          await env.DB.batch([
            env.DB.prepare('DELETE FROM packages WHERE game_id = ?').bind(id),
            env.DB.prepare('DELETE FROM regions WHERE game_id = ?').bind(id),
            env.DB.prepare('DELETE FROM games WHERE id = ?').bind(id),
          ]);
          response = Response.json({ success: true });
        }

      } else if (url.pathname === '/api/admin/region' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare(
          'INSERT INTO regions (game_id, region_key, name, flag) VALUES (?, ?, ?, ?)'
        ).bind(data.game_id, data.region_key, data.name, data.flag).run();
        response = Response.json({ success: true });

      } else if (url.pathname === '/api/admin/package' && request.method === 'POST') {
        const data = await request.json();
        const id = `${data.game_id}-${data.label.replace(/\s+/g, '-')}-${Date.now().toString(36)}`;
        await env.DB.prepare(
          'INSERT INTO packages (id, game_id, region_key, label, price) VALUES (?, ?, ?, ?, ?)'
        ).bind(id, data.game_id, data.region_key, data.label, data.price).run();
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

    // Attach CORS headers for allowed origins
    if (isAllowed) {
      const headers = new Headers(response.headers);
      const corsHeaders = baseCors(origin);
      for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return response;
  }
};
