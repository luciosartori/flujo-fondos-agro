// netlify/functions/iol-debug.js
// Función de diagnóstico — llama a IOL y lista todos los paneles disponibles
// USAR SOLO PARA DEBUGGEAR — podés borrarla después

export async function handler(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;

  if (!IOL_USER || !IOL_PASS) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "Sin credenciales" }) };
  }

  try {
    // Token
    const tokenRes = await fetch("https://api.invertironline.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: IOL_USER, password: IOL_PASS, grant_type: "password" }),
      signal: AbortSignal.timeout(8000),
    });
    const { access_token: token } = await tokenRes.json();

    // Probar distintos endpoints para encontrar cuál funciona
    const pruebas = {};

    // 1. Panel futuros dólar
    try {
      const r = await fetch("https://api.invertironline.com/api/v2/ROFX/Titulos/Panel/futuros_dolar",
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      pruebas.panel_futuros_dolar = { status: r.status, tipo: typeof d, keys: Array.isArray(d) ? `array[${d.length}]` : Object.keys(d).join(','), muestra: JSON.stringify(d).slice(0,300) };
    } catch(e) { pruebas.panel_futuros_dolar = { error: e.message }; }

    // 2. Ticker individual DOJUL26
    try {
      const r = await fetch("https://api.invertironline.com/api/v2/ROFX/Titulos/DOJUL26/Cotizacion",
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      pruebas.ticker_DOJUL26 = { status: r.status, data: JSON.stringify(d).slice(0,400) };
    } catch(e) { pruebas.ticker_DOJUL26 = { error: e.message }; }

    // 3. Ticker con formato alternativo
    try {
      const r = await fetch("https://api.invertironline.com/api/v2/Titulos/ROFX/DOJUL26/Cotizacion",
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      pruebas.ticker_alt_DOJUL26 = { status: r.status, data: JSON.stringify(d).slice(0,400) };
    } catch(e) { pruebas.ticker_alt_DOJUL26 = { error: e.message }; }

    // 4. Panel soja
    try {
      const r = await fetch("https://api.invertironline.com/api/v2/ROFX/Titulos/Panel/futuros_soja",
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      pruebas.panel_futuros_soja = { status: r.status, muestra: JSON.stringify(d).slice(0,300) };
    } catch(e) { pruebas.panel_futuros_soja = { error: e.message }; }

    // 5. Ticker soja individual
    try {
      const r = await fetch("https://api.invertironline.com/api/v2/ROFX/Titulos/SOJJUL26/Cotizacion",
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      pruebas.ticker_SOJJUL26 = { status: r.status, data: JSON.stringify(d).slice(0,400) };
    } catch(e) { pruebas.ticker_SOJJUL26 = { error: e.message }; }

    // 6. Buscar lista de instrumentos ROFX
    try {
      const r = await fetch("https://api.invertironline.com/api/v2/ROFX/Titulos",
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      pruebas.lista_ROFX = { status: r.status, muestra: JSON.stringify(d).slice(0,500) };
    } catch(e) { pruebas.lista_ROFX = { error: e.message }; }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, token_ok: !!token, pruebas }, null, 2),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, error: error.message }),
    };
  }
}
