// api/futuros-agro.js — Vercel API Route
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const FALLBACK = {
    soja: { "2026-07": 324, "2026-09": 331, "2026-11": 334, "2027-05": 326, "2027-07": 338 },
    maiz: { "2026-07": 178, "2026-09": 183, "2026-11": 183, "2027-01": 183, "2027-03": 183 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const IOL_USER     = process.env.IOL_USUARIO;
  const IOL_PASS     = process.env.IOL_CONTRASENA;

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return res.status(200).json({
      ok: true, source: "fallback_no_creds",
      soja: FALLBACK.soja, maiz: FALLBACK.maiz,
      timestamp: new Date().toISOString(),
    });
  }

  // Símbolos EXACTOS confirmados desde /rest/instruments/all
  // Formato: SOJ.ROS/MES26  y  MAI.ROS/MES26
  // Mini: SOJ.ROS/JUL26M,  SOJ.MIN/JUL26
  // Para soja: JUL, SEP, NOV, ENE, MAR, MAY, JUL (ciclo bimensual)
  // Para maíz: JUL, AGO, SEP, NOV, DIC, ENE, ABR, JUL, SEP (ciclo mensual en cosecha)
  const CONTRATOS_SOJA = [
    { mesKey: "2026-07", sym: "SOJ.ROS/JUL26",  fallback: "SOJ.ROS/JUL26M" },
    { mesKey: "2026-09", sym: "SOJ.ROS/SEP26",  fallback: null              },
    { mesKey: "2026-11", sym: "SOJ.ROS/NOV26",  fallback: "SOJ.ROS/NOV26M" },
    { mesKey: "2027-01", sym: "SOJ.ROS/ENE27",  fallback: null              },
    { mesKey: "2027-03", sym: "SOJ.ROS/ABR27",  fallback: null              }, // ABR es el más líquido de la nueva campaña
    { mesKey: "2027-05", sym: "SOJ.ROS/MAY27",  fallback: "SOJ.ROS/MAY27M" },
    { mesKey: "2027-07", sym: "SOJ.ROS/JUL27",  fallback: null              },
  ];
  const CONTRATOS_MAIZ = [
    { mesKey: "2026-07", sym: "MAI.ROS/JUL26",  fallback: "MAI.MIN/JUL26"  },
    { mesKey: "2026-08", sym: "MAI.ROS/AGO26",  fallback: null              },
    { mesKey: "2026-09", sym: "MAI.ROS/SEP26",  fallback: "MAI.MIN/SEP26"  },
    { mesKey: "2026-11", sym: "MAI.ROS/NOV26",  fallback: null              },
    { mesKey: "2026-12", sym: "MAI.ROS/DIC26",  fallback: "MAI.MIN/DIC26"  },
    { mesKey: "2027-01", sym: "MAI.ROS/ENE27",  fallback: null              },
    { mesKey: "2027-04", sym: "MAI.ROS/ABR27",  fallback: null              },
    { mesKey: "2027-07", sym: "MAI.ROS/JUL27",  fallback: null              },
    { mesKey: "2027-09", sym: "MAI.ROS/SEP27",  fallback: null              },
  ];

  // Entries válidos confirmados (sin AP que rompe la request)
  const ENTRIES = "LA,SE,CL,BI,OF";

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

    // 2. Fetch de un símbolo
    const fetchSym = async (sym) => {
      if (!sym) return null;
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
        const precio =
          md?.LA?.price ??
          md?.SE?.price ??
          md?.CL?.price ??
          md?.OF?.price ??
          md?.BI?.price ??
          null;
        if (!precio || precio <= 0) return null;
        return {
          precio,
          fuente: md?.LA?.price ? "LA" : md?.SE?.price ? "SE" : "CL/OF/BI",
          variacion: md?.LA?.change ?? null,
        };
      } catch (e) { return null; }
    };

    // 3. Consultar todos en paralelo
    const sojaData = {}, maizData = {};

    await Promise.allSettled([
      ...CONTRATOS_SOJA.map(async ({ mesKey, sym, fallback }) => {
        let r = await fetchSym(sym);
        if (!r && fallback) r = await fetchSym(fallback);
        if (r) sojaData[mesKey] = r.precio;
      }),
      ...CONTRATOS_MAIZ.map(async ({ mesKey, sym, fallback }) => {
        let r = await fetchSym(sym);
        if (!r && fallback) r = await fetchSym(fallback);
        if (r) maizData[mesKey] = r.precio;
      }),
    ]);

    // 4. Para meses faltantes, intentar IOL como complemento
    if (IOL_USER && IOL_PASS) {
      try {
        const iolBody = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
        const iolTokenRes = await fetch("https://api.invertironline.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: iolBody,
          signal: AbortSignal.timeout(8000),
        });
        if (iolTokenRes.ok) {
          const { access_token } = await iolTokenRes.json();
          if (access_token) {
            const MES_IOL = {
              "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
              "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
            };
            const iolFetch = async (ticker) => {
              try {
                const r = await fetch(
                  `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                  { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(5000) }
                );
                if (!r.ok) return null;
                const d = await r.json();
                // precioAjuste es el precio oficial ROFX, más confiable que ultimoPrecio
                return d?.precioAjuste || d?.ultimoPrecio || d?.cierreAnterior || null;
              } catch (e) { return null; }
            };

            // Completar meses de soja faltantes
            const sojaFaltantes = CONTRATOS_SOJA.filter(c => !sojaData[c.mesKey]);
            const maizFaltantes  = CONTRATOS_MAIZ.filter(c => !maizData[c.mesKey]);

            await Promise.allSettled([
              ...sojaFaltantes.map(async ({ mesKey }) => {
                const [y, m] = mesKey.split("-");
                const p = await iolFetch(`SOJ${MES_IOL[m]}${y.slice(2)}`);
                if (p) sojaData[mesKey] = p;
              }),
              ...maizFaltantes.map(async ({ mesKey }) => {
                const [y, m] = mesKey.split("-");
                const p = await iolFetch(`MAI${MES_IOL[m]}${y.slice(2)}`);
                if (p) maizData[mesKey] = p;
              }),
            ]);
          }
        }
      } catch (e) { /* IOL falló — continuar sin él */ }
    }

    // 5. Usar fallback para meses que siguen sin datos
    const sojaFinal = Object.keys(sojaData).length > 0
      ? { ...FALLBACK.soja, ...sojaData }  // fallback como base, Primary sobreescribe
      : FALLBACK.soja;
    const maizFinal = Object.keys(maizData).length > 0
      ? { ...FALLBACK.maiz, ...maizData }
      : FALLBACK.maiz;

    const source = Object.keys(sojaData).length > 0
      ? (IOL_USER ? "Primary+IOL" : "Primary_reMarkets")
      : "fallback_static";

    return res.status(200).json({
      ok: true,
      source,
      soja: sojaFinal,
      maiz: maizFinal,
      contratos_soja: Object.keys(sojaFinal).length,
      contratos_maiz: Object.keys(maizFinal).length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    // Primary falló — intentar IOL solo
    if (IOL_USER && IOL_PASS) {
      try {
        const iolBody = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
        const iolTokenRes = await fetch("https://api.invertironline.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: iolBody, signal: AbortSignal.timeout(8000),
        });
        if (iolTokenRes.ok) {
          const { access_token } = await iolTokenRes.json();
          const MES_IOL = {
            "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
            "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
          };
          const sojaData = {}, maizData = {};
          await Promise.allSettled([
            ...CONTRATOS_SOJA.map(async ({ mesKey }) => {
              const [y,m] = mesKey.split("-");
              const r = await fetch(
                `https://api.invertironline.com/api/v2/ROFX/Titulos/SOJ${MES_IOL[m]}${y.slice(2)}/Cotizacion`,
                { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(5000) }
              );
              if (!r.ok) return;
              const d = await r.json();
              const p = d?.precioAjuste || d?.ultimoPrecio || null;
              if (p) sojaData[mesKey] = p;
            }),
            ...CONTRATOS_MAIZ.map(async ({ mesKey }) => {
              const [y,m] = mesKey.split("-");
              const r = await fetch(
                `https://api.invertironline.com/api/v2/ROFX/Titulos/MAI${MES_IOL[m]}${y.slice(2)}/Cotizacion`,
                { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(5000) }
              );
              if (!r.ok) return;
              const d = await r.json();
              const p = d?.precioAjuste || d?.ultimoPrecio || null;
              if (p) maizData[mesKey] = p;
            }),
          ]);
          if (Object.keys(sojaData).length > 0 || Object.keys(maizData).length > 0) {
            return res.status(200).json({
              ok: true, source: "IOL_only",
              soja: Object.keys(sojaData).length > 0 ? sojaData : FALLBACK.soja,
              maiz: Object.keys(maizData).length > 0 ? maizData : FALLBACK.maiz,
              contratos_soja: Object.keys(sojaData).length,
              contratos_maiz: Object.keys(maizData).length,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (e2) { /* IOL también falló */ }
    }

    return res.status(200).json({
      ok: true, source: "fallback_error",
      soja: FALLBACK.soja, maiz: FALLBACK.maiz,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
