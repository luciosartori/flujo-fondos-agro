// api/iol-debug.js — Diagnóstico de credenciales IOL
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;

  const result = {
    timestamp: new Date().toISOString(),
    vars: {
      IOL_USUARIO_set:    !!IOL_USER,
      IOL_CONTRASENA_set: !!IOL_PASS,
      // Mostrar primeros/últimos chars para verificar sin exponer todo
      IOL_USUARIO_preview:    IOL_USER  ? `${IOL_USER.slice(0,3)}...${IOL_USER.slice(-3)}`   : null,
      IOL_CONTRASENA_length:  IOL_PASS  ? IOL_PASS.length : 0,
    },
  };

  if (!IOL_USER || !IOL_PASS) {
    return res.status(200).json({ ...result, error: "Variables no configuradas en Vercel" });
  }

  // Intentar autenticar
  try {
    const body = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
    const r = await fetch("https://api.invertironline.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body, signal: AbortSignal.timeout(12000),
    });

    result.auth_http_status = r.status;
    result.auth_http_ok = r.ok;

    const text = await r.text();
    result.auth_response_raw = text.slice(0, 500); // primeros 500 chars

    let parsed = null;
    try { parsed = JSON.parse(text); } catch(e) {}

    if (parsed) {
      result.auth_parsed = {
        has_access_token: !!parsed.access_token,
        token_type:       parsed.token_type,
        expires_in:       parsed.expires_in,
        error:            parsed.error,
        error_description: parsed.error_description,
      };
    }

    // Si token OK, probar una cotización simple
    if (parsed?.access_token) {
      result.token_ok = true;
      try {
        const r2 = await fetch(
          "https://api.invertironline.com/api/v2/ROFX/Titulos/SOJJUL26/Cotizacion",
          { headers: { Authorization: `Bearer ${parsed.access_token}` }, signal: AbortSignal.timeout(8000) }
        );
        result.cotizacion_http = r2.status;
        const d2 = await r2.json();
        result.cotizacion_SOJJUL26 = {
          precioAjuste:    d2?.precioAjuste,
          ultimoPrecio:    d2?.ultimoPrecio,
          variacion:       d2?.variacion,
          puntaCompradora: d2?.puntaCompradora?.precio,
          puntaVendedora:  d2?.puntaVendedora?.precio,
          error:           d2?.error,
        };
        // También probar MAIJUL26
        const r3 = await fetch(
          "https://api.invertironline.com/api/v2/ROFX/Titulos/MAIJUL26/Cotizacion",
          { headers: { Authorization: `Bearer ${parsed.access_token}` }, signal: AbortSignal.timeout(8000) }
        );
        const d3 = await r3.json();
        result.cotizacion_MAIJUL26 = {
          precioAjuste:    d3?.precioAjuste,
          ultimoPrecio:    d3?.ultimoPrecio,
          puntaCompradora: d3?.puntaCompradora?.precio,
          puntaVendedora:  d3?.puntaVendedora?.precio,
        };
      } catch (e2) {
        result.cotizacion_error = e2.message;
      }
    } else {
      result.token_ok = false;
    }

  } catch (e) {
    result.auth_error = e.message;
  }

  return res.status(200).json(result);
}
