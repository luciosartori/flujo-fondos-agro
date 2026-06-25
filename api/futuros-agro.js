// api/futuros-agro.js — Debug detallado para ver campos exactos en horario de mercado
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!global._agroCache) global._agroCache = { soja: {}, maiz: {}, ts: null };

  const FALLBACK = {
    soja: { "2026-07": 327.6, "2026-09": 331.5, "2026-11": 336.4, "2027-05": 328.0, "2027-07": 335.0 },
    maiz: { "2026-07": 178.4, "2026-08": 178.0, "2026-09": 180.9, "2026-11": 181.0, "2026-12": 185.5, "2027-01": 186.0, "2027-04": 183.5, "2027-07": 181.4 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const IOL_USER     = process.env.IOL_USUARIO;
  const IOL_PASS     = process.env.IOL_CONTRASENA;
  const DEBUG        = req.query.debug === "1";

  const CONTRATOS_SOJA = [
    { mesKey: "2026-07", sym: "SOJ.ROS/JUL26" },
    { mesKey: "2026-09", sym: "SOJ.ROS/SEP26" },
    { mesKey: "2026-11", sym: "SOJ.ROS/NOV26" },
    { mesKey: "2027-01", sym: "SOJ.ROS/ENE27" },
    { mesKey: "2027-03", sym: "SOJ.ROS/ABR27" },
    { mesKey: "2027-05", sym: "SOJ.ROS/MAY27" },
    { mesKey: "2027-07", sym: "SOJ.ROS/JUL27" },
  ];
  const CONTRATOS_MAIZ = [
    { mesKey: "2026-07", sym: "MAL.ROS/JUL26" },
    { mesKey: "2026-08", sym: "MAL.ROS/AGO26" },
    { mesKey: "2026-09", sym: "MAL.ROS/SEP26" },
    { mesKey: "2026-11", sym: "MAL.ROS/NOV26" },
    { mesKey: "2026-12", sym: "MAL.ROS/DIC26" },
    { mesKey: "2027-01", sym: "MAL.ROS/ENE27" },
    { mesKey: "2027-04", sym: "MAL.ROS/ABR27" },
    { mesKey: "2027-07", sym: "MAL.ROS/JUL27" },
    { mesKey: "2027-09", sym: "MAL.ROS/SEP27" },
  ];

  const sojaData = {}, maizData = {};
  const debugLog = {};

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
                // Pedir TODOS los campos relevantes para ver cuál tiene el precio correcto
                `?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=LA,SE,CL,BI,OF,TV,NV,OI`,
                { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(7000) }
              );
              if (!r.ok) return null;
              const d = await r.json();
              if (d?.status === "ERROR") {
                if (DEBUG) debugLog[sym] = { error: d.description };
                return null;
              }
              const md = d?.marketData;
              if (!md) return null;

              // Extraer TODOS los precios disponibles para debug
              const allPrices = {};
              for (const [k, v] of Object.entries(md)) {
                if (v?.price != null) allPrices[k] = { price: v.price, change: v.change, size: v.size };
              }

              if (DEBUG) debugLog[sym] = { allPrices, md_keys: Object.keys(md) };

              // Precio más actualizado:
              // TV = precio del último trade (más fresco que LA en algunos casos)
              // LA = last price (último negociado)  
              // BI/OF = bid/offer actuales (precio de mercado ahora mismo)
              // SE = settlement del día anterior
              // CL = cierre anterior

              // Durante mercado abierto: usar promedio bid/offer si LA no existe
              const la  = md?.LA?.price;
              const bi  = md?.BI?.price;
              const of  = md?.OF?.price;
              const se  = md?.SE?.price;
              const cl  = md?.CL?.price;

              // Si hay bid y offer, el precio justo es el promedio (midpoint)
              const midpoint = (bi && of) ? (bi + of) / 2 : null;

              // Prioridad: LA → midpoint bid/offer → SE → CL
              const precio = la ?? midpoint ?? se ?? cl ?? null;

              if (DEBUG) debugLog[sym].precio_final = { la, bi, of, midpoint, se, cl, precio };

              return precio != null && precio > 0 ? precio : null;
            } catch (e) {
              if (DEBUG) debugLog[sym] = { error: e.message };
              return null;
            }
          };

          await Promise.allSettled([
            ...CONTRATOS_SOJA.map(async ({ mesKey, sym }) => {
              const p = await fetchSym(sym);
              if (p) sojaData[mesKey] = p;
            }),
            ...CONTRATOS_MAIZ.map(async ({ mesKey, sym }) => {
              const p = await fetchSym(sym);
              if (p) maizData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch (e) {
      if (DEBUG) debugLog["_auth"] = { error: e.message };
    }
  }

  // IOL — complementar faltantes
  const sojaFaltantes = CONTRATOS_SOJA.filter(c => !sojaData[c.mesKey]);
  const maizFaltantes = CONTRATOS_MAIZ.filter(c => !maizData[c.mesKey]);

  if (IOL_USER && IOL_PASS && (sojaFaltantes.length > 0 || maizFaltantes.length > 0)) {
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
          const MES = { "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
                        "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC" };
          const iolFetch = async (ticker) => {
            try {
              const r = await fetch(
                `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(6000) }
              );
              if (!r.ok) return null;
              const d = await r.json();
              if (DEBUG) debugLog[`IOL:${ticker}`] = {
                ultimoPrecio: d?.ultimoPrecio,
                precioAjuste: d?.precioAjuste,
                variacion: d?.variacion,
                // IOL también tiene puntas
                puntaCompradora: d?.puntaCompradora,
                puntaVendedora: d?.puntaVendedora,
              };
              // Usar último precio negociado si es > 0, sino ajuste
              const ultimo = d?.ultimoPrecio > 0 ? d.ultimoPrecio : null;
              const ajuste = d?.precioAjuste > 0 ? d.precioAjuste : null;
              // Midpoint de puntas si están disponibles
              const comp = d?.puntaCompradora?.precio;
              const vend = d?.puntaVendedora?.precio;
              const mid  = (comp && vend) ? (comp + vend) / 2 : null;
              return ultimo ?? mid ?? ajuste ?? null;
            } catch (e) { return null; }
          };
          await Promise.allSettled([
            ...sojaFaltantes.map(async ({ mesKey }) => {
              const [y,m] = mesKey.split("-");
              const p = await iolFetch(`SOJ${MES[m]}${y.slice(2)}`);
              if (p) sojaData[mesKey] = p;
            }),
            ...maizFaltantes.map(async ({ mesKey }) => {
              const [y,m] = mesKey.split("-");
              const p = await iolFetch(`MAI${MES[m]}${y.slice(2)}`);
              if (p) maizData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch (e) { /* IOL falló */ }
  }

  // Caché en memoria
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
    sojaOk && maizOk ? "Primary_reMarkets" :
    sojaOk           ? "Primary(soja)+IOL(maiz)" :
    maizOk           ? "IOL(maiz)+fallback(soja)" :
    cacheOk          ? "cache_ultimo_cierre" :
    "fallback_static";

  return res.status(200).json({
    ok: true, source,
    soja: sojaFinal, maiz: maizFinal,
    contratos_soja: Object.keys(sojaFinal).length,
    contratos_maiz: Object.keys(maizFinal).length,
    primary_soja: Object.keys(sojaData).length,
    primary_maiz: Object.keys(maizData).length,
    cache_ts: global._agroCache.ts,
    timestamp: new Date().toISOString(),
    ...(DEBUG ? { debug: debugLog } : {}),
  });
}
