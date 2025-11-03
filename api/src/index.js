// =========================
//  Helpers
// =========================

function b64(s) { return typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64'); }
function normEmail(e) { return (e || '').toLowerCase(); }
function nowOrderId() { return `ORD-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e8).toString(36)}`; }

async function ensureWalletRow(env, email) {
  await env.DB.prepare('INSERT OR IGNORE INTO wallets (user_email, balance) VALUES (?, 0)').bind(email).run();
}

async function creditWallet(env, email, amount) {
  const em = normEmail(email);
  await ensureWalletRow(env, em);
  await env.DB.prepare('UPDATE wallets SET balance = balance + ? WHERE user_email = ?').bind(Number(amount || 0), em).run();
}

async function debitWallet(env, email, amount) {
  const em = normEmail(email);
  const row = await env.DB.prepare('SELECT balance FROM wallets WHERE user_email = ?').bind(em).first();
  const bal = row ? Number(row.balance) : 0;
  const amt = Number(amount || 0);
  if (bal < amt) return { ok: false, balance: bal };
  await env.DB.prepare('UPDATE wallets SET balance = balance - ? WHERE user_email = ?').bind(amt, em).run();
  return { ok: true, balance: bal - amt };
}

async function getOrder(env, orderId) {
  return await env.DB.prepare(
    'SELECT id, user_email, total, payment_method, status FROM orders WHERE id = ?'
  ).bind(orderId).first();
}


// =========================
//  Auth Handlers
// =========================

/** ADMIN login (used by admin.html) */
async function handleAdminLogin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) {
    return Response.json({ success: false, message: 'Email and password are required.' }, { status: 400 });
  }

  const user = await env.DB.prepare(
    'SELECT email, password_hash, role FROM users WHERE email = ?'
  ).bind(normEmail(email)).first();

  if (!user) return Response.json({ success: false, message: 'Invalid admin credentials.' }, { status: 401 });
  if (user.password_hash !== b64(password)) {
    return Response.json({ success: false, message: 'Invalid admin credentials.' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return Response.json({ success: false, message: 'Access denied. Not an administrator.' }, { status: 403 });
  }

  return Response.json({ success: true, email: user.email, role: user.role });
}

/** USER login (local or google) */
async function handleUserLogin(request, env) {
  const { email, password, provider } = await request.json();
  if (!email) return Response.json({ success: false, message: 'Email is required.' }, { status: 400 });

  const user = await env.DB.prepare(
    'SELECT email, password_hash, role FROM users WHERE email = ?'
  ).bind(normEmail(email)).first();

  if (!user) return Response.json({ success: false, message: 'Account not found.' }, { status: 404 });

  if (provider === 'google') {
    if (user.password_hash !== 'GOOGLE_SSO') {
      return Response.json({ success: false, message: 'This account is not a Google login.' }, { status: 401 });
    }
  } else {
    if (!password || user.password_hash !== b64(password)) {
      return Response.json({ success: false, message: 'Invalid email or password.' }, { status: 401 });
    }
  }

  return Response.json({ success: true, email: user.email, role: user.role || 'user' });
}

/** Registration (local or google) */
async function handleRegister(request, env) {
  const { email, password, provider } = await request.json();
  if (!email) return Response.json({ success: false, message: 'Email is required.' }, { status: 400 });

  const em = normEmail(email);
  const hash = provider === 'google' ? 'GOOGLE_SSO' : b64(password || '');

  try {
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO users (email, password_hash) VALUES (?, ?)').bind(em, hash),
      env.DB.prepare('INSERT OR IGNORE INTO wallets (user_email, balance) VALUES (?, 0)').bind(em),
    ]);
    return Response.json({ success: true, message: 'Registered successfully!' });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    return Response.json({ success: false, message: err.message }, { status: 500 });
  }
}


// =========================
//  Wallet & Orders
// =========================

async function handleTopup(request, env) {
  const { email, amount } = await request.json();
  const amt = Number(amount || 0);
  if (!email || !(amt > 0)) {
    return Response.json({ success: false, message: 'email and positive amount required' }, { status: 400 });
  }
  await creditWallet(env, email, amt);
  const w = await env.DB.prepare('SELECT balance FROM wallets WHERE user_email = ?').bind(normEmail(email)).first();
  return Response.json({ success: true, balance: w ? Number(w.balance) : 0 });
}

/**
 * Create an order:
 * body: {
 *   user_email,
 *   items:[{gameName, pkgLabel, price, qty, uid?, pin?}],
 *   total,
 *   method: 'LF Wallet' | 'iPay88',
 *   channel?
 * }
 * - For 'LF Wallet': checks funds, debits, then creates order.
 * - For 'iPay88': simulates gateway success (no wallet change).
 */
async function handleCreateOrder(request, env) {
  const body = await request.json();
  const email = normEmail(body.user_email);
  const items = Array.isArray(body.items) ? body.items : [];
  const total = Number(body.total || 0);
  const method = body.method || 'LF Wallet';

  if (!email || !items.length || !(total > 0)) {
    return Response.json({ success: false, message: 'Invalid order payload.' }, { status: 400 });
  }

  if (method === 'LF Wallet') {
    const deb = await debitWallet(env, email, total);
    if (!deb.ok) {
      return Response.json({ success: false, message: `Insufficient wallet balance (have ${deb.balance.toFixed(2)}).` }, { status: 400 });
    }
  }

  const orderId = nowOrderId();

  // Insert order
  await env.DB.prepare(
    'INSERT INTO orders (id, user_email, total, payment_method, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(orderId, email, total, method, 'Processing').run();

  // Insert items
  for (const it of items) {
    const qty = Number(it.qty || 1);
    const price = Number(it.price || 0);
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, game_name, package_label, quantity, price_at_purchase, uid, pin)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId,
      it.gameName || '',
      it.pkgLabel || '',
      qty,
      price,
      it.uid || null,
      it.pin || null
    ).run();
  }

  return Response.json({ success: true, orderId });
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

      // Back-compat (admin.html used this)
      } else if (url.pathname === '/api/login' && request.method === 'POST') {
        response = await handleAdminLogin(request, env);


      // ----- Catalog -----
      } else if (url.pathname === '/api/games' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM games').all();
        response = Response.json(results);

      } else if (url.pathname === '/api/admin/game' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare(
          'INSERT OR REPLACE INTO games (id, name, image_url, category, regionable, uid_required) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
          data.id, data.name, data.image_url, data.category, data.regionable ? 1 : 0, data.uid_required ? 1 : 0
        ).run();
        response = Response.json({ success: true });

      } else if (url.pathname === '/api/admin/game' && request.method === 'DELETE') {
        const gameId = url.searchParams.get('id');
        await env.DB.prepare('DELETE FROM games WHERE id = ?').bind(gameId).run();
        response = Response.json({ success: true });

      } else if (url.pathname === '/api/regions' && request.method === 'GET') {
        const gameId = url.searchParams.get('gameId');
        const { results } = await env.DB.prepare('SELECT * FROM regions WHERE game_id = ?').bind(gameId).all();
        response = Response.json(results);

      } else if (url.pathname === '/api/admin/region' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare(
          'INSERT INTO regions (game_id, region_key, name, flag) VALUES (?, ?, ?, ?)'
        ).bind(data.game_id, data.region_key, data.name, data.flag).run();
        response = Response.json({ success: true });

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

      } else if (url.pathname === '/api/admin/package' && request.method === 'POST') {
        const data = await request.json();
        const id = `${data.game_id}-${data.label.replace(/\s+/g, '-')}-${Date.now().toString(36)}`;
        await env.DB.prepare(
          'INSERT INTO packages (id, game_id, region_key, label, price) VALUES (?, ?, ?, ?, ?)'
        ).bind(id, data.game_id, data.region_key, data.label, data.price).run();
        response = Response.json({ success: true });

      // *** NEW: Update package (label and/or price) ***
      } else if (url.pathname === '/api/admin/package' && request.method === 'PUT') {
        const data = await request.json();
        const id = data.id;
        if (!id) {
          response = Response.json({ success: false, message: 'id is required' }, { status: 400 });
        } else {
          const label = (typeof data.label === 'string') ? data.label : null;
          const price = (data.price === undefined || data.price === null) ? null : Number(data.price);
          await env.DB.prepare(
            'UPDATE packages SET label = COALESCE(?, label), price = COALESCE(?, price) WHERE id = ?'
          ).bind(label, price, id).run();
          response = Response.json({ success: true });
        }

      } else if (url.pathname === '/api/admin/package' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        await env.DB.prepare('DELETE FROM packages WHERE id = ?').bind(id).run();
        response = Response.json({ success: true });


      // ----- Wallet / Orders (user) -----
      } else if (url.pathname === '/api/wallet' && request.method === 'GET') {
        const email = normEmail(url.searchParams.get('email'));
        const wallet = await env.DB.prepare('SELECT balance FROM wallets WHERE user_email = ?').bind(email).first();
        response = Response.json({ balance: wallet ? Number(wallet.balance) : 0 });

      } else if (url.pathname === '/api/wallet/topup' && request.method === 'POST') {
        response = await handleTopup(request, env);

      } else if (url.pathname === '/api/orders' && request.method === 'POST') {
        response = await handleCreateOrder(request, env);

      } else if (url.pathname === '/api/orders' && request.method === 'GET') {
        const email = normEmail(url.searchParams.get('email'));
        const { results } = await env.DB.prepare(
          'SELECT * FROM orders WHERE user_email = ? ORDER BY created_at DESC'
        ).bind(email).all();
        response = Response.json(results);


      // ----- Admin utilities -----
      } else if (url.pathname === '/api/admin/users' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT u.email, u.role, w.balance FROM users u LEFT JOIN wallets w ON u.email = w.user_email ORDER BY u.created_at DESC'
        ).all();
        response = Response.json(results);

      } else if (url.pathname === '/api/admin/wallet' && request.method === 'POST') {
        const { email, newBalance } = await request.json();
        await ensureWalletRow(env, normEmail(email));
        await env.DB.prepare('UPDATE wallets SET balance = ? WHERE user_email = ?')
          .bind(Number(newBalance || 0), normEmail(email))
          .run();
        response = Response.json({ success: true });

      // Orders list for admin
      } else if (url.pathname === '/api/admin/orders' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, user_email, total, payment_method, status, created_at FROM orders ORDER BY created_at DESC LIMIT 200'
        ).all();
        response = Response.json(results);

      // Order items for admin
      } else if (url.pathname === '/api/admin/order-items' && request.method === 'GET') {
        const orderId = url.searchParams.get('orderId');
        const { results } = await env.DB.prepare(
          `SELECT id, order_id, game_name, package_label, quantity, price_at_purchase, uid, pin
           FROM order_items
           WHERE order_id = ?
           ORDER BY id ASC`
        ).bind(orderId).all();
        response = Response.json(results);

      // Save a PIN on a game-card item
      } else if (url.pathname === '/api/admin/order/pin' && request.method === 'POST') {
        const { order_id, item_id, pin } = await request.json();
        if (!order_id || !item_id) {
          response = Response.json({ success: false, message: 'order_id and item_id are required' }, { status: 400 });
        } else {
          await env.DB.prepare('UPDATE order_items SET pin = ? WHERE id = ? AND order_id = ?')
            .bind(pin || '', item_id, order_id).run();
          response = Response.json({ success: true });
        }

      // Complete → set Completed
      } else if (url.pathname === '/api/admin/order/complete' && request.method === 'POST') {
        const { order_id } = await request.json();
        if (!order_id) {
          response = Response.json({ success: false, message: 'order_id required' }, { status: 400 });
        } else {
          await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('Completed', order_id).run();
          response = Response.json({ success: true });
        }

      // Cancel → only set Cancelled (no refund here)
      } else if (url.pathname === '/api/admin/order/cancel' && request.method === 'POST') {
        const { order_id } = await request.json();
        if (!order_id) {
          response = Response.json({ success: false, message: 'order_id required' }, { status: 400 });
        } else {
          const o = await getOrder(env, order_id);
          if (!o) {
            response = Response.json({ success: false, message: 'Order not found' }, { status: 404 });
          } else if (o.status === 'Cancelled' || o.status === 'Refunded') {
            response = Response.json({ success: true, message: 'Already cancelled/refunded' });
          } else {
            await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('Cancelled', order_id).run();
            response = Response.json({ success: true });
          }
        }

      // Refund → allowed when currently Cancelled. Credit wallet only for LF Wallet.
      } else if (url.pathname === '/api/admin/order/refund' && request.method === 'POST') {
        const { order_id } = await request.json();
        if (!order_id) {
          response = Response.json({ success: false, message: 'order_id required' }, { status: 400 });
        } else {
          const o = await getOrder(env, order_id);
          if (!o) {
            response = Response.json({ success: false, message: 'Order not found' }, { status: 404 });
          } else if (o.status === 'Refunded') {
            response = Response.json({ success: true, message: 'Already refunded' });
          } else if (o.status !== 'Cancelled') {
            response = Response.json({ success: false, message: 'Refund only allowed after Cancelled' }, { status: 400 });
          } else {
            // Credit wallet only if it was wallet payment
            if (o.payment_method === 'LF Wallet') {
              await creditWallet(env, o.user_email, Number(o.total));
            }
            await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('Refunded', order_id).run();
            response = Response.json({ success: true });
          }
        }

      } else {
        response = new Response('Not Found', { status: 404 });
      }
    } catch (e) {
      console.error(e);
      response = Response.json({ success: false, message: e.message }, { status: 500 });
    }

    // Add CORS if allowed origin
    if (isAllowed) {
      const headers = new Headers(response.headers);
      const cors = baseCors(origin);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return response;
  }
};
