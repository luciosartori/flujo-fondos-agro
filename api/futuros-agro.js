// api/futuros-agro.js — Vercel API Route con debug detallado
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
  const DEBUG        = req.query.debug === "1"; // ?debug=1 para ver detalle

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return res.status(200).json({ ok: true, source: "fallback_no_creds", ...FALLBACK });
  }

  const CONTRATOS_SOJA = [
    { mesKey: "2026-07", sym: "SOJ.ROS/JUL26",  fallback: "SOJ.ROS/JUL26M" },
    { mesKey: "2026-09", sym: "SOJ.ROS/SEP26",  fallback: null              },
    { mesKey: "2026-11", sym: "SOJ.ROS/NOV26",  fallback: "SOJ.ROS/NOV26M" },
    { mesKey: "2027-01", sym: "SOJ.ROS/ENE27",  fallback: null              },
    { mesKey: "2027-03", sym: "SOJ.ROS/ABR27",  fallback: null              },
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

  const ENTRIES = "LA,SE,CL,BI,OF";

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

    // Fetch símbolo con respuesta raw para debug
    const fetchSym = async (sym) => {
      if (!sym) return { precio: null, raw: null };
      try {
        const r = await fetch(
          `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
          `?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=${ENTRIES}`,
          { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(7000) }
        );
        if (!r.ok) return { precio: null, raw: `HTTP ${r.status}` };
        const d = await r.json();
        if (d?.status === "ERROR") return { precio: null, raw: `ERROR: ${d.description}` };
        const md = d?.marketData;
        if (!md) return { precio: null, raw: "Sin marketData" };

        // Precio con prioridad LA → SE → CL → OF → BI
        const precio =
          md?.LA?.price ?? md?.SE?.price ?? md?.CL?.price ??
          md?.OF?.price ?? md?.BI?.price ?? null;

        const rawPrices = {};
        ["LA","SE","CL","OF","BI"].forEach(k => {
          if (md[k]?.price != null) rawPrices[k] = md[k].price;
        });

        return {
          precio: precio > 0 ? precio : null,
          fuente: md?.LA?.price ? "LA" : md?.SE?.price ? "SE" : md?.CL?.price ? "CL" : "OF/BI",
          raw: rawPrices,
        };
      } catch (e) {
        return { precio: null, raw: e.message };
      }
    };

    const sojaData = {}, maizData = {};
    const debugLog = {};

    await Promise.allSettled([
      ...CONTRATOS_SOJA.map(async ({ mesKey, sym, fallback }) => {
        const r1 = await fetchSym(sym);
        if (r1.precio) {
          sojaData[mesKey] = r1.precio;
          if (DEBUG) debugLog[sym] = r1;
        } else {
          if (DEBUG) debugLog[sym] = r1;
          if (fallback) {
            const r2 = await fetchSym(fallback);
            if (r2.precio) {
              sojaData[mesKey] = r2.precio;
              if (DEBUG) debugLog[fallback] = r2;
            } else if (DEBUG) {
              debugLog[fallback] = r2;
            }
          }
        }
      }),
      ...CONTRATOS_MAIZ.map(async ({ mesKey, sym, fallback }) => {
        const r1 = await fetchSym(sym);
        if (r1.precio) {
          maizData[mesKey] = r1.precio;
          if (DEBUG) debugLog[sym] = r1;
        } else {
          if (DEBUG) debugLog[sym] = r1;
          if (fallback) {
            const r2 = await fetchSym(fallback);
            if (r2.precio) {
              maizData[mesKey] = r2.precio;
              if (DEBUG) debugLog[fallback] = r2;
            } else if (DEBUG) {
              debugLog[fallback] = r2;
            }
          }
        }
      }),
    ]);

    // Intentar IOL para meses sin datos de Primary
    let iolUsed = false;
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
                const p = d?.precioAjuste || d?.ultimoPrecio || null;
                if (DEBUG && p) debugLog[`IOL_${ticker}`] = { precio: p };
                return p > 0 ? p : null;
              } catch (e) { return null; }
            };
            await Promise.allSettled([
              ...CONTRATOS_SOJA.filter(c => !sojaData[c.mesKey]).map(async ({ mesKey }) => {
                const [y,m] = mesKey.split("-");
                const p = await iolFetch(`SOJ${MES_IOL[m]}${y.slice(2)}`);
                if (p) { sojaData[mesKey] = p; iolUsed = true; }
              }),
              ...CONTRATOS_MAIZ.filter(c => !maizData[c.mesKey]).map(async ({ mesKey }) => {
                const [y,m] = mesKey.split("-");
                const p = await iolFetch(`MAI${MES_IOL[m]}${y.slice(2)}`);
                if (p) { maizData[mesKey] = p; iolUsed = true; }
              }),
            ]);
          }
        }
      } catch (e) { /* IOL falló */ }
    }

    const primaryOk = Object.keys(sojaData).length > 0 || Object.keys(maizData).length > 0;
    const sojaFinal = primaryOk ? { ...FALLBACK.soja, ...sojaData } : FALLBACK.soja;
    const maizFinal = primaryOk ? { ...FALLBACK.maiz, ...maizData } : FALLBACK.maiz;
    const source = !primaryOk ? "fallback_static"
      : iolUsed ? "Primary+IOL"
      : "Primary_reMarkets";

    return res.status(200).json({
      ok: true, source,
      soja: sojaFinal,
      maiz: maizFinal,
      contratos_soja: Object.keys(sojaFinal).length,
      contratos_maiz: Object.keys(maizFinal).length,
      primary_soja_count: Object.keys(sojaData).length,
      primary_maiz_count: Object.keys(maizData).length,
      timestamp: new Date().toISOString(),
      ...(DEBUG ? { debug: debugLog } : {}),
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
