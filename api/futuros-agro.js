// api/futuros-agro.js — Producción final con MAL.ROS para maíz
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const FALLBACK = {
    soja: { "2026-07": 327, "2026-09": 331, "2026-11": 336, "2027-05": 328, "2027-07": 335 },
    maiz: { "2026-07": 178.4, "2026-08": 178, "2026-09": 180.9, "2026-11": 181, "2026-12": 185.5, "2027-01": 186, "2027-04": 183.5, "2027-07": 181.4 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const IOL_USER     = process.env.IOL_USUARIO;
  const IOL_PASS     = process.env.IOL_CONTRASENA;
  const DEBUG        = req.query.debug === "1";

  // Soja Rosario — confirmado ROFX
  const CONTRATOS_SOJA = [
    { mesKey: "2026-07", sym: "SOJ.ROS/JUL26" },
    { mesKey: "2026-09", sym: "SOJ.ROS/SEP26" },
    { mesKey: "2026-11", sym: "SOJ.ROS/NOV26" },
    { mesKey: "2027-01", sym: "SOJ.ROS/ENE27" },
    { mesKey: "2027-03", sym: "SOJ.ROS/ABR27" },
    { mesKey: "2027-05", sym: "SOJ.ROS/MAY27" },
    { mesKey: "2027-07", sym: "SOJ.ROS/JUL27" },
  ];

  // Maíz Rosario — MAL.ROS confirmado en A3
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
  const debugLog = {};

  // ══════════════════════════════════════════════
  // PRIMARY — Soja y Maíz (MAL.ROS)
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
              // Precio exacto con decimales — no redondear
              const precio =
                md?.LA?.price ??  // último negociado (horario mercado)
                md?.SE?.price ??  // settlement oficial (siempre disponible)
                md?.CL?.price ??  // cierre sesión anterior
                md?.OF?.price ??
                md?.BI?.price ?? null;
              if (DEBUG) debugLog[sym] = {
                precio,
                fields: Object.fromEntries(
                  Object.entries(md)
                    .filter(([,v]) => v?.price != null)
                    .map(([k,v]) => [k, v.price])
                ),
              };
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
    } catch (e) { /* Primary falló */ }
  }

  // ══════════════════════════════════════════════
  // IOL — Complementar meses sin datos de Primary
  // Nota: IOL puede devolver precios redondeados a entero
  // Solo usar si Primary no trajo el dato
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
              if (DEBUG) debugLog[`IOL:${ticker}`] = {
                precioAjuste: d?.precioAjuste,
                ultimoPrecio: d?.ultimoPrecio,
                cierreAnterior: d?.cierreAnterior,
              };
              // precioAjuste = precio oficial ROFX con decimales completos
              // ultimoPrecio puede ser 0 o entero redondeado
              const p = d?.precioAjuste || (d?.ultimoPrecio > 0 ? d.ultimoPrecio : null) || d?.cierreAnterior || null;
              return p > 0 ? p : null;
            } catch (e) { return null; }
          };

          await Promise.allSettled([
            ...sojaFaltantes.map(async ({ mesKey }) => {
              const [y, m] = mesKey.split("-");
              const p = await iolFetch(`SOJ${MES[m]}${y.slice(2)}`);
              if (p) sojaData[mesKey] = p;
            }),
            ...maizFaltantes.map(async ({ mesKey }) => {
              const [y, m] = mesKey.split("-");
              const p = await iolFetch(`MAI${MES[m]}${y.slice(2)}`);
              if (p) maizData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch (e) { /* IOL falló */ }
  }

  // ══════════════════════════════════════════════
  // RESULTADO FINAL
  // Merge: live sobreescribe fallback mes a mes
  // El fallback ahora tiene los valores reales con decimales
  // ══════════════════════════════════════════════
  const sojaOk = Object.keys(sojaData).length > 0;
  const maizOk = Object.keys(maizData).length > 0;

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
    primary_soja: Object.keys(sojaData).length,
    primary_maiz: Object.keys(maizData).length,
    timestamp: new Date().toISOString(),
    ...(DEBUG ? { debug: debugLog } : {}),
  });
}
