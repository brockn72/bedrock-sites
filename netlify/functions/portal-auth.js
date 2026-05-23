exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action, email, password } = body;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Auth service not configured' }) };
  }

  if (action === 'signin') {
    if (!email || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email and password required' }) };
    }

    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnon,
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: data.error_description || data.msg || 'Invalid email or password' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_in:    data.expires_in,
        user:          data.user,
      }),
    };
  }

  if (action === 'update-password') {
    const accessToken = body.access_token;
    const newPassword = body.new_password;
    if (!accessToken || !newPassword) {
      return { statusCode: 400, body: JSON.stringify({ error: 'access_token and new_password required' }) };
    }
    if (newPassword.length < 6) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 6 characters' }) };
    }
    // Supabase: PUT /auth/v1/user with Bearer token updates the authed user's password.
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnon,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        statusCode: res.status === 401 ? 401 : 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: data.msg || data.error_description || 'Password update failed — try signing out and back in.' }),
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  }

  if (action === 'refresh') {
    const refresh_token = body.refresh_token;
    if (!refresh_token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'refresh_token required' }) };
    }

    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnon,
      },
      body: JSON.stringify({ refresh_token }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Session expired — please sign in again' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_in:    data.expires_in,
        user:          data.user,
      }),
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
