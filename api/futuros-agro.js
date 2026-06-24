// api/futuros-agro.js — Producción final
// Soja: Primary reMarkets ROFX — símbolos SOJ.ROS/XXX confirmados
// Maíz: Primary reMarkets ROFX — símbolos MAL.ROS/XXX (NO MAI.ROS)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const FALLBACK = {
    soja: { "2026-07": 327, "2026-09": 331, "2026-11": 336, "2027-05": 328, "2027-07": 335 },
    maiz: { "2026-07": 178, "2026-09": 181, "2026-11": 181, "2026-12": 186, "2027-04": 183, "2027-07": 181 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const IOL_USER     = process.env.IOL_USUARIO;
  const IOL_PASS     = process.env.IOL_CONTRASENA;

  // Símbolos EXACTOS confirmados en A3 Real Time hoy 24/06/2026
  // Soja Rosario: SOJ.ROS/XXX — ya confirmado en instrumentos ROFX
  const CONTRATOS_SOJA = [
    { mesKey: "2026-07", sym: "SOJ.ROS/JUL26" },
    { mesKey: "2026-09", sym: "SOJ.ROS/SEP26" },
    { mesKey: "2026-11", sym: "SOJ.ROS/NOV26" },
    { mesKey: "2027-01", sym: "SOJ.ROS/ENE27" },
    { mesKey: "2027-03", sym: "SOJ.ROS/ABR27" },
    { mesKey: "2027-05", sym: "SOJ.ROS/MAY27" },
    { mesKey: "2027-07", sym: "SOJ.ROS/JUL27" },
  ];

  // Maíz Rosario: MAL.ROS/XXX (no MAI.ROS) — confirmado en A3
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

  const ENTRIES = "LA,SE,CL,BI,OF";
  const sojaData = {}, maizData = {};

  // ══════════════════════════════════════════════
  // PRIMARY reMarkets — Soja y Maíz
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
          const fetchSym = async (sym) => {
            try {
              const r = await fetch(
                `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
                `?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=${ENTRIES}`,
                { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(7000) }
              );
              if (!r.ok) return null;
              const d = await r.json();
              if (d?.status === "ERROR") return null;
              const md = d?.marketData;
              if (!md) return null;
              // Prioridad: último negociado → ajuste oficial → cierre → oferta → compra
              return md?.LA?.price ?? md?.SE?.price ?? md?.CL?.price ?? md?.OF?.price ?? md?.BI?.price ?? null;
            } catch (e) { return null; }
          };

          await Promise.allSettled([
            ...CONTRATOS_SOJA.map(async ({ mesKey, sym }) => {
              const p = await fetchSym(sym);
              if (p && p > 0) sojaData[mesKey] = p;
            }),
            ...CONTRATOS_MAIZ.map(async ({ mesKey, sym }) => {
              const p = await fetchSym(sym);
              if (p && p > 0) maizData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch (e) { /* Primary falló */ }
  }

  // ══════════════════════════════════════════════
  // IOL — Complementar lo que Primary no trajo
  // ══════════════════════════════════════════════
  const sojaFaltantes = CONTRATOS_SOJA.filter(c => !sojaData[c.mesKey]);
  const maizFaltantes  = CONTRATOS_MAIZ.filter(c => !maizData[c.mesKey]);

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
          const MES = {
            "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
            "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
          };
          const iolFetch = async (ticker) => {
            try {
              const r = await fetch(
                `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(6000) }
              );
              if (!r.ok) return null;
              const d = await r.json();
              const p = d?.precioAjuste || (d?.ultimoPrecio > 0 ? d.ultimoPrecio : null) || null;
              return p > 0 ? p : null;
            } catch (e) { return null; }
          };

          await Promise.allSettled([
            ...sojaFaltantes.map(async ({ mesKey }) => {
              const [y, m] = mesKey.split("-");
              // IOL usa SOJ (no SOJ.ROS)
              const p = await iolFetch(`SOJ${MES[m]}${y.slice(2)}`);
              if (p) sojaData[mesKey] = p;
            }),
            ...maizFaltantes.map(async ({ mesKey }) => {
              const [y, m] = mesKey.split("-");
              // IOL usa MAI (no MAL.ROS)
              const p = await iolFetch(`MAI${MES[m]}${y.slice(2)}`);
              if (p) maizData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch (e) { /* IOL falló */ }
  }

  // ══════════════════════════════════════════════
  // RESULTADO
  // ══════════════════════════════════════════════
  const sojaOk = Object.keys(sojaData).length > 0;
  const maizOk = Object.keys(maizData).length > 0;

  // Merge: datos live sobreescriben fallback mes a mes
  const sojaFinal = { ...FALLBACK.soja, ...sojaData };
  const maizFinal = { ...FALLBACK.maiz, ...maizData };

  const source =
    sojaOk && maizOk ? "Primary_reMarkets" :
    sojaOk           ? "Primary(soja)+IOL(maiz)" :
    maizOk           ? "IOL(maiz)+fallback(soja)" :
    "fallback_static";

  return res.status(200).json({
    ok: true,
    source,
    soja: sojaFinal,
    maiz: maizFinal,
    contratos_soja: Object.keys(sojaFinal).length,
    contratos_maiz: Object.keys(maizFinal).length,
    timestamp: new Date().toISOString(),
  });
}
