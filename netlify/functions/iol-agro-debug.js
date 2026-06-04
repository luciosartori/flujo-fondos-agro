// netlify/functions/iol-agro-debug.js
export async function handler(event, context) {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;

  if (!IOL_USER || !IOL_PASS) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "Sin credenciales IOL" }) };
  }

  try {
    // Encoding manual para evitar problemas con caracteres especiales como @
    const body = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;

    const tokenRes = await fetch("https://api.invertironline.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10000),
    });

    const tokenText = await tokenRes.text();

    if (!tokenRes.ok) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          error: `Token HTTP ${tokenRes.status}`,
          detalle: tokenText.slice(0, 300),
          user_enviado: IOL_USER,
          // No loguear la pass completa por seguridad
          pass_primeros3: IOL_PASS.slice(0,3) + '***',
          pass_encoded: encodeURIComponent(IOL_PASS),
        })
      };
    }

    const tokenData = JSON.parse(tokenText);
    const token = tokenData.access_token;
    if (!token) throw new Error("Sin access_token en respuesta");

    // Con token OK, probar tickers de soja y maíz
    const probar = async (ticker) => {
      try {
        const r = await fetch(
          `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
        );
        if (!r.ok) return { status: r.status, error: `HTTP ${r.status}` };
        const d = await r.json();
        return {
          status: r.status,
          ultimoPrecio: d?.ultimoPrecio,
          precioAjuste: d?.precioAjuste,
          cierreAnterior: d?.cierreAnterior,
          raw: JSON.stringify(d).slice(0, 250),
        };
      } catch (e) { return { error: e.message }; }
    };

    // Probar formatos de tickers soja y maíz en paralelo
    const tickersPrueba = [
      // Formato sin punto (como dólar: DOJUL26)
      'SOJJUL26','SOJSEP26','SOJNOV26','SOJMAY27','SOJJUL27',
      'MAIJUL26','MAISEP26','MAINOV26',
      // Formato con punto
      'SOJ.JUL26','MAI.JUL26',
      // Formato largo
      'SOJAROSJUL26','MAIROSJUL26',
    ];

    // También probar panel de futuros agro
    const paneles = ['futuros_agropecuarios','futuros_granos','futuros_soja','futuros_maiz','agro'];
    const panelResults = {};
    for (const p of paneles) {
      try {
        const r = await fetch(
          `https://api.invertironline.com/api/v2/ROFX/Titulos/Panel/${p}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
        );
        const txt = await r.text();
        panelResults[p] = { status: r.status, muestra: txt.slice(0, 400) };
      } catch(e) { panelResults[p] = { error: e.message }; }
    }

    const tickerResults = await Promise.allSettled(
      tickersPrueba.map(async t => ({ ticker: t, ...(await probar(t)) }))
    );

    const detalle = tickerResults.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    const funcionan = detalle.filter(r => r.ultimoPrecio != null || r.precioAjuste != null);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        token_ok: true,
        tickers_con_precio: funcionan,
        paneles,
        panel_resultados: panelResults,
        detalle_tickers: detalle,
      }, null, 2),
    };
  } catch (error) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: error.message }) };
  }
}
