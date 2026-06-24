// api/futuros-agro.js — DEBUG para identificar símbolos exactos de SOJ y MAI
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;

  const FALLBACK = {
    soja: { "2026-07": 324, "2026-09": 331, "2026-11": 334, "2027-05": 326, "2027-07": 338 },
    maiz: { "2026-07": 178, "2026-09": 183, "2026-11": 183, "2027-01": 183, "2027-03": 183 },
  };

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return res.status(200).json({ ok: true, source: "fallback_no_creds", ...FALLBACK });
  }

  try {
    // Auth
    const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Username": PRIMARY_USER,
        "X-Password": PRIMARY_PASS,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenRes.ok) throw new Error(`Auth HTTP ${tokenRes.status}`);
    const token = tokenRes.headers.get("X-Auth-Token");
    if (!token) throw new Error("Sin X-Auth-Token");

    // Traer TODOS los instrumentos y filtrar SOJ y MAI
    const instrRes = await fetch(
      "https://api.remarkets.primary.com.ar/rest/instruments/all?marketId=ROFX",
      { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(15000) }
    );
    const instrData = await instrRes.json();

    const instruments = instrData?.instruments || instrData || [];

    // Filtrar SOJ y MAI — futuros mensuales únicamente (sin opciones ni spreads)
    const sojSyms = [];
    const maiSyms = [];

    instruments.forEach(inst => {
      const sym = inst?.instrumentId?.symbol || inst?.symbol || "";
      const cfi = inst?.cficode || inst?.CFICode || "";
      const desc = inst?.securityDescription || inst?.description || "";
      const segment = inst?.marketSegmentId || "";

      // Futuros agropecuarios: segmento DAF o similar
      // Excluir opciones (contienen espacio + precio strike) y spreads (contienen /)
      // pero SOJ/MAR27 es un futuro mensual válido (la barra es parte del nombre, no spread)
      const isOption = /\d{3,5}\s+[CP]$/.test(sym);  // ej: SOJ/MAR27 1000 C
      const isSpread = sym.includes("/") && sym.split("/").length > 2; // ej: spreads raros

      if (sym.startsWith("SOJ") && !isOption) sojSyms.push({ sym, cfi, segment, desc });
      if (sym.startsWith("MAI") && !isOption) maiSyms.push({ sym, cfi, segment, desc });
    });

    // También probar variantes de ticker conocidas para JUL26
    const testTickersSoja = [
      "SOJ/JUL26", "SOJJUL26", "SOJ.JUL26",
      "SOJ/JUL2026", "ROSARIO_SOJ/JUL26",
    ];
    const testTickersMaiz = [
      "MAI/JUL26", "MAIJUL26", "MAI.JUL26",
      "MAI/JUL2026",
    ];

    const ENTRIES = "LA,SE,CL,BI,OF";
    const testResults = {};

    await Promise.allSettled([
      ...testTickersSoja.map(async sym => {
        try {
          const r = await fetch(
            `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=${ENTRIES}`,
            { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(5000) }
          );
          const d = await r.json();
          testResults[sym] = {
            status: d?.status,
            description: d?.description,
            marketData_keys: d?.marketData ? Object.keys(d.marketData) : null,
            prices: d?.marketData ? Object.fromEntries(
              Object.entries(d.marketData).map(([k,v]) => [k, v?.price ?? null])
            ) : null,
          };
        } catch(e) { testResults[sym] = { error: e.message }; }
      }),
      ...testTickersMaiz.map(async sym => {
        try {
          const r = await fetch(
            `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=${ENTRIES}`,
            { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(5000) }
          );
          const d = await r.json();
          testResults[sym] = {
            status: d?.status,
            description: d?.description,
            marketData_keys: d?.marketData ? Object.keys(d.marketData) : null,
            prices: d?.marketData ? Object.fromEntries(
              Object.entries(d.marketData).map(([k,v]) => [k, v?.price ?? null])
            ) : null,
          };
        } catch(e) { testResults[sym] = { error: e.message }; }
      }),
    ]);

    return res.status(200).json({
      ok: true,
      debug_mode: true,
      soj_instruments: sojSyms.slice(0, 40),
      mai_instruments: maiSyms.slice(0, 40),
      ticker_tests: testResults,
      soja: FALLBACK.soja,
      maiz: FALLBACK.maiz,
      source: "fallback_debug",
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    return res.status(200).json({
      ok: true, source: "fallback_error",
      soja: FALLBACK.soja, maiz: FALLBACK.maiz,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
