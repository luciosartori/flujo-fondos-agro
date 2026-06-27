// api/futuros-agro.js — Versión final
// Primary SE = precio de ajuste oficial ROFX (coincide con A3 al cierre)
// Primary LA = último negociado durante la rueda
// MAI.ROS funciona — tu cuenta SÍ tiene maíz (confirmado en debug)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!global._agroCache) global._agroCache = { soja:{}, maiz:{}, ts:null };

  const FALLBACK = {
    // Actualizado al cierre de A3 del 26/06/2026
    soja: {"2026-07":327.6,"2026-09":331.8,"2026-11":335.6,"2027-01":0,"2027-03":0,"2027-05":327.9,"2027-07":335.0},
    maiz: {"2026-07":178.5,"2026-08":178.0,"2026-09":181.1,"2026-11":181.0,"2026-12":186.2,
           "2027-01":190.0,"2027-04":183.0,"2027-07":178.8,"2027-09":180.0},
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const DEBUG = req.query.debug === "1";
  const debugLog = {};

  // Detectar horario de mercado (10:00-18:00 ARG = 13:00-21:00 UTC, L-V)
  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const diaSemana = now.getUTCDay(); // 0=dom, 6=sab
  const mercadoAbierto = diaSemana >= 1 && diaSemana <= 5
    && utcMin >= 13*60 && utcMin < 21*60;

  // Todos los contratos disponibles — MAI.ROS confirmado funcionando
  const CONTRATOS_SOJA = {
    "2026-07":"SOJ.ROS/JUL26",
    "2026-09":"SOJ.ROS/SEP26",
    "2026-11":"SOJ.ROS/NOV26",
    "2027-01":"SOJ.ROS/ENE27",
    "2027-03":"SOJ.ROS/ABR27",
    "2027-05":"SOJ.ROS/MAY27",
    "2027-07":"SOJ.ROS/JUL27",
  };
  const CONTRATOS_MAIZ = {
    "2026-07":"MAI.ROS/JUL26",
    "2026-09":"MAI.ROS/SEP26",
    "2026-12":"MAI.ROS/DIC26",
    "2027-04":"MAI.ROS/ABR27",
    "2027-07":"MAI.ROS/JUL27",
    "2027-09":"MAI.ROS/SEP27",
  };

  const sojaData = {}, maizData = {};

  if (PRIMARY_USER && PRIMARY_PASS) {
    try {
      const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Username": PRIMARY_USER,
          "X-Password": PRIMARY_PASS,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (tokenRes.ok) {
        const token = tokenRes.headers.get("X-Auth-Token");
        if (token) {
          const fetchSym = async (sym) => {
            try {
              const r = await fetch(
                `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
                `?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=LA,SE,CL,BI,OF`,
                { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(7000) }
              );
              if (!r.ok) return null;
              const d = await r.json();
              if (d?.status === "ERROR") return null;
              const md = d?.marketData;
              if (!md) return null;

              const la = md?.LA?.price;
              const se = md?.SE?.price;  // ajuste oficial ROFX
              const cl = md?.CL?.price;
              const bi = md?.BI?.price;
              const of = md?.OF?.price;
              const mid = (bi && of) ? Math.round(((bi+of)/2)*10)/10 : null;

              if (DEBUG) debugLog[sym] = { la, se, cl, bi, of, mid };

              // Durante mercado: LA (último negociado) o midpoint puntas
              // Fuera de mercado: SE (ajuste oficial publicado al cierre = coincide con A3)
              return mercadoAbierto
                ? (la ?? mid ?? se ?? cl ?? null)
                : (se ?? cl ?? la ?? null);
            } catch(e) {
              if (DEBUG) debugLog[sym] = { error: e.message };
              return null;
            }
          };

          await Promise.allSettled([
            ...Object.entries(CONTRATOS_SOJA).map(async ([k, sym]) => {
              const p = await fetchSym(sym);
              if (p && p > 0) sojaData[k] = p;
            }),
            ...Object.entries(CONTRATOS_MAIZ).map(async ([k, sym]) => {
              const p = await fetchSym(sym);
              if (p && p > 0) maizData[k] = p;
            }),
          ]);
        }
      }
    } catch(e) {
      if (DEBUG) debugLog["_auth_error"] = e.message;
    }
  }

  // Caché en memoria — sirve el último precio conocido si Primary falla
  const sojaOk = Object.keys(sojaData).length > 0;
  const maizOk = Object.keys(maizData).length > 0;
  if (sojaOk) { Object.assign(global._agroCache.soja, sojaData); global._agroCache.ts = new Date().toISOString(); }
  if (maizOk) { Object.assign(global._agroCache.maiz, maizData); global._agroCache.ts = new Date().toISOString(); }

  const cacheOk = global._agroCache.ts && Object.keys(global._agroCache.soja).length > 0;
  const sojaFuente = sojaOk ? sojaData : cacheOk ? global._agroCache.soja : null;
  const maizFuente = maizOk ? maizData : cacheOk ? global._agroCache.maiz : null;

  const sojaFinal = { ...FALLBACK.soja, ...(sojaFuente || {}) };
  const maizFinal = { ...FALLBACK.maiz, ...(maizFuente || {}) };

  const source =
    sojaOk && maizOk ? (mercadoAbierto ? "Primary_LA_tiempo_real" : "Primary_SE_ajuste_oficial") :
    sojaOk           ? "Primary_soja+fallback_maiz" :
    cacheOk          ? "cache_ultimo_cierre" :
    "fallback_static";

  return res.status(200).json({
    ok: true,
    source,
    mercadoAbierto,
    soja: sojaFinal,
    maiz: maizFinal,
    contratos_soja: Object.keys(sojaFinal).length,
    contratos_maiz: Object.keys(maizFinal).length,
    primary_soja: Object.keys(sojaData).length,
    primary_maiz: Object.keys(maizData).length,
    cache_ts: global._agroCache.ts,
    timestamp: new Date().toISOString(),
    ...(DEBUG ? { debug: debugLog } : {}),
  });
}
