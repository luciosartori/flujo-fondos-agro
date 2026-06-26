// api/futuros-agro.js
// Soja: Primary SE (ajuste oficial ROFX) > IOL precioAjuste > IOL ultimoPrecio
// Maiz: IOL (Primary no tiene MAI habilitado)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!global._agroCache) global._agroCache = { soja: {}, maiz: {}, ts: null };

  const FALLBACK = {
    soja: { "2026-07":329.2,"2026-09":333.5,"2026-11":337.5,"2027-05":329.0,"2027-07":335.5 },
    maiz: { "2026-07":179.5,"2026-08":179.0,"2026-09":182.4,"2026-11":181.0,"2026-12":187.0,"2027-01":190.0,"2027-04":183.5,"2027-07":179.0,"2027-09":180.0 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const IOL_USER     = process.env.IOL_USUARIO;
  const IOL_PASS     = process.env.IOL_CONTRASENA;
  const DEBUG        = req.query.debug === "1";

  const CONTRATOS_SOJA_PRIMARY = {
    "2026-07":"SOJ.ROS/JUL26",
    "2026-09":"SOJ.ROS/SEP26",
    "2026-11":"SOJ.ROS/NOV26",
    "2027-01":"SOJ.ROS/ENE27",
    "2027-03":"SOJ.ROS/ABR27",
    "2027-05":"SOJ.ROS/MAY27",
    "2027-07":"SOJ.ROS/JUL27",
  };

  const CONTRATOS_MAIZ_IOL = [
    "2026-07","2026-08","2026-09","2026-11","2026-12",
    "2027-01","2027-04","2027-07","2027-09",
  ];

  const MES = {
    "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
    "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
  };

  const sojaData = {}, maizData = {};
  const debugLog = {};

  // ══════════════════════════════════════════════
  // SOJA — Primary reMarkets
  // Usar SE (settlement = ajuste oficial ROFX publicado al cierre)
  // Durante el día: LA si existe, sino SE
  // ══════════════════════════════════════════════
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
          await Promise.allSettled(
            Object.entries(CONTRATOS_SOJA_PRIMARY).map(async ([mesKey, sym]) => {
              try {
                const r = await fetch(
                  `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
                  `?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=LA,SE,CL,BI,OF`,
                  { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(7000) }
                );
                if (!r.ok) return;
                const d = await r.json();
                if (d?.status === "ERROR") return;
                const md = d?.marketData;
                if (!md) return;

                const la = md?.LA?.price;
                const se = md?.SE?.price;  // ajuste oficial ROFX ← el correcto
                const cl = md?.CL?.price;
                const bi = md?.BI?.price;
                const of = md?.OF?.price;

                if (DEBUG) debugLog[`PRM:${sym}`] = { la, se, cl, bi, of };

                // SE es el precio de ajuste oficial — siempre preferirlo sobre LA
                // porque LA puede ser el precio electrónico que difiere del de cámara
                // Solo usar LA si SE no existe (contrato sin ajuste publicado)
                const precio = se ?? la ?? cl ?? null;

                if (precio && precio > 0) sojaData[mesKey] = precio;
              } catch (e) {
                if (DEBUG) debugLog[`PRM:${sym}`] = { error: e.message };
              }
            })
          );
        }
      }
    } catch (e) {
      if (DEBUG) debugLog["_primary_auth"] = { error: e.message };
    }
  }

  // ══════════════════════════════════════════════
  // MAÍZ — IOL (Primary no tiene MAI habilitado)
  // También complementar soja faltante con IOL precioAjuste
  // ══════════════════════════════════════════════
  if (IOL_USER && IOL_PASS) {
    try {
      const iolBody = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
      const iolTokenRes = await fetch("https://api.invertironline.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: iolBody, signal: AbortSignal.timeout(10000),
      });

      if (iolTokenRes.ok) {
        const { access_token } = await iolTokenRes.json();
        if (access_token) {
          const iolFetch = async (ticker) => {
            try {
              const r = await fetch(
                `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(6000) }
              );
              if (!r.ok) return null;
              const d = await r.json();

              if (DEBUG) debugLog[`IOL:${ticker}`] = {
                ultimoPrecio:    d?.ultimoPrecio,
                precioAjuste:    d?.precioAjuste,
                puntaCompradora: d?.puntaCompradora?.precio,
                puntaVendedora:  d?.puntaVendedora?.precio,
              };

              // Para maíz: precioAjuste es el ajuste oficial ROFX
              // ultimoPrecio puede ser electrónico o 0 si no hubo operaciones
              const ajuste = d?.precioAjuste > 0 ? d.precioAjuste : null;
              const ultimo = d?.ultimoPrecio > 0 ? d.ultimoPrecio : null;
              const comp   = d?.puntaCompradora?.precio;
              const vend   = d?.puntaVendedora?.precio;
              const mid    = (comp && vend) ? Math.round(((comp+vend)/2)*10)/10 : null;

              // Prioridad: ajuste oficial → midpoint puntas → último
              return ajuste ?? mid ?? ultimo ?? null;
            } catch (e) { return null; }
          };

          const sojaFaltantes = Object.keys(CONTRATOS_SOJA_PRIMARY).filter(k => !sojaData[k]);

          await Promise.allSettled([
            // Maíz completo desde IOL
            ...CONTRATOS_MAIZ_IOL.map(async (mesKey) => {
              const [y, m] = mesKey.split("-");
              const p = await iolFetch(`MAI${MES[m]}${y.slice(2)}`);
              if (p) maizData[mesKey] = p;
            }),
            // Soja faltante (ENE27, ABR27 que Primary no devuelve SE)
            ...sojaFaltantes.map(async (mesKey) => {
              const [y, m] = mesKey.split("-");
              const p = await iolFetch(`SOJ${MES[m]}${y.slice(2)}`);
              if (p) sojaData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch (e) {
      if (DEBUG) debugLog["_iol_auth"] = { error: e.message };
    }
  }

  // Caché
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
    sojaOk && maizOk ? "Primary_SE(soja)+IOL(maiz)" :
    sojaOk           ? "Primary_SE(soja)+fallback(maiz)" :
    maizOk           ? "IOL(maiz)+fallback(soja)" :
    cacheOk          ? "cache_ultimo_cierre" :
    "fallback_static";

  return res.status(200).json({
    ok: true, source,
    soja: sojaFinal,
    maiz: maizFinal,
    contratos_soja: Object.keys(sojaFinal).length,
    contratos_maiz: Object.keys(maizFinal).length,
    primary_soja: Object.keys(sojaData).filter(k=>!Object.keys(CONTRATOS_MAIZ_IOL).includes(k)).length,
    iol_maiz: Object.keys(maizData).length,
    cache_ts: global._agroCache.ts,
    timestamp: new Date().toISOString(),
    ...(DEBUG ? { debug: debugLog } : {}),
  });
}
