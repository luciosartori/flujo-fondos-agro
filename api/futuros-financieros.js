// api/futuros-financieros.js — Vercel API Route
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return res.status(200).json({ ok: false, error: "Sin credenciales Primary" });
  }

  try {
    // 1. Autenticar
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

    // 2. Probar TODOS los formatos posibles de ticker para JUL26
    //    para encontrar cuál responde con datos
    const testSymbols = [
      "DLR/JUL26",
      "DLR/JUL26M",
      "DLRJUL26",
      "DLR.JUL26",
      "DOL/JUL26",
      "DLR/JUL2026",
      "RFX20JUL26",
    ];

    const debugResults = {};
    const allEntries = "LA,CL,SE,BI,OF,AP,NV,OI,IV,TV,HI,LO,OP,CL";

    await Promise.allSettled(testSymbols.map(async (sym) => {
      try {
        // Probar con marketId=ROFX
        const r1 = await fetch(
          `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=${allEntries}`,
          { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(6000) }
        );
        const d1 = await r1.json();

        // Probar sin marketId
        const r2 = await fetch(
          `https://api.remarkets.primary.com.ar/rest/marketdata/get?symbol=${encodeURIComponent(sym)}&entries=${allEntries}`,
          { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(6000) }
        );
        const d2 = await r2.json();

        debugResults[sym] = {
          conMarketId: {
            status: d1?.status,
            description: d1?.description,
            marketData_keys: d1?.marketData ? Object.keys(d1.marketData) : null,
            marketData: d1?.marketData,
          },
          sinMarketId: {
            status: d2?.status,
            description: d2?.description,
            marketData_keys: d2?.marketData ? Object.keys(d2.marketData) : null,
            marketData: d2?.marketData,
          },
        };
      } catch (e) {
        debugResults[sym] = { error: e.message };
      }
    }));

    // 3. También intentar el endpoint de instruments para ver cómo se llaman
    let instrumentsResult = null;
    try {
      const ir = await fetch(
        `https://api.remarkets.primary.com.ar/rest/instruments/details?marketId=ROFX&symbol=DLR`,
        { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(8000) }
      );
      instrumentsResult = await ir.json();
    } catch (e) {
      instrumentsResult = { error: e.message };
    }

    // 4. Buscar contratos activos de dólar
    let segmentResult = null;
    try {
      const sr = await fetch(
        `https://api.remarkets.primary.com.ar/rest/instruments/all?marketId=ROFX`,
        { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(10000) }
      );
      const sdata = await sr.json();
      // Filtrar solo instrumentos DLR
      const dlrInstruments = (sdata?.instruments || sdata || [])
        .filter(i => {
          const sym = i?.instrumentId?.symbol || i?.symbol || "";
          return sym.toUpperCase().includes("DLR");
        })
        .slice(0, 30)
        .map(i => i?.instrumentId?.symbol || i?.symbol || JSON.stringify(i).slice(0,80));
      segmentResult = { total_dlr: dlrInstruments.length, symbols: dlrInstruments };
    } catch (e) {
      segmentResult = { error: e.message };
    }

    return res.status(200).json({
      ok: true,
      debug_mode: true,
      token_present: !!token,
      ticker_tests: debugResults,
      instruments_dlr: segmentResult,
      instruments_detail: instrumentsResult,
      dolar_futuro: {},
      contratos: 0,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error.message,
      dolar_futuro: {},
      timestamp: new Date().toISOString(),
    });
  }
}
