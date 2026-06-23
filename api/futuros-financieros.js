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

  // Símbolos EXACTOS tal como los devuelve Primary reMarkets (de /rest/instruments/all)
  // Solo futuros mensuales estándar y mini — sin opciones, sin spreads
  // Para SEP26 y DIC26 solo existe la versión Mini (M)
  const CONTRATOS = [
    // 2026
    { mesKey: "2026-06", sym: "DLR/JUN26",  fallback: "DLR/JUN26M"  },
    { mesKey: "2026-07", sym: "DLR/JUL26",  fallback: "DLR/JUL26M"  },
    { mesKey: "2026-08", sym: "DLR/AGO26",  fallback: "DLR/AGO26M"  },
    { mesKey: "2026-09", sym: "DLR/SEP26M", fallback: null           }, // solo Mini
    { mesKey: "2026-10", sym: "DLR/OCT26",  fallback: "DLR/OCT26M"  },
    { mesKey: "2026-11", sym: "DLR/NOV26",  fallback: "DLR/NOV26M"  },
    { mesKey: "2026-12", sym: "DLR/DIC26A", fallback: "DLR/DIC26M"  }, // solo DIC26A y M
    // 2027
    { mesKey: "2027-01", sym: "DLR/ENE27",  fallback: "DLR/ENE27M"  },
    { mesKey: "2027-02", sym: "DLR/FEB27",  fallback: "DLR/FEB27M"  },
    { mesKey: "2027-03", sym: "DLR/MAR27",  fallback: "DLR/MAR27M"  },
    { mesKey: "2027-04", sym: "DLR/ABR27",  fallback: "DLR/ABR27M"  },
    { mesKey: "2027-05", sym: "DLR/MAY27M", fallback: null           }, // solo Mini
  ];

  // Entries válidos confirmados por Primary reMarkets:
  // LA = último precio negociado
  // SE = precio de settlement/ajuste (siempre existe si el contrato está vivo)
  // CL = cierre anterior
  // BI = mejor compra
  // OF = mejor venta
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

    // 2. Fetch de cada contrato
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
          fuente: md?.LA?.price ? "LA" : md?.SE?.price ? "SE" : md?.CL?.price ? "CL" : "BI/OF",
          variacion: md?.LA?.change ?? null,
          volumen: md?.LA?.size ?? 0,
        };
      } catch (e) {
        return null;
      }
    };

    // 3. Consultar todos los contratos en paralelo
    const dolarFuturo = {};
    const fuentes = {};

    await Promise.allSettled(
      CONTRATOS.map(async ({ mesKey, sym, fallback }) => {
        // Intentar símbolo principal primero
        let result = await fetchSym(sym);

        // Si no hay datos, intentar fallback (mini u otra variante)
        if (!result && fallback) {
          result = await fetchSym(fallback);
          if (result) result.sym_usado = fallback;
        }

        if (result) {
          dolarFuturo[mesKey] = result.precio;
          fuentes[mesKey] = {
            sym: result.sym_usado || sym,
            fuente: result.fuente,
            variacion: result.variacion,
            volumen: result.volumen,
          };
        }
      })
    );

    // 4. Ordenar por fecha
    const dolarOrdenado = Object.fromEntries(
      Object.entries(dolarFuturo)
        .filter(([, v]) => v != null && v > 0)
        .sort(([a], [b]) => a.localeCompare(b))
    );

    return res.status(200).json({
      ok: true,
      source: "Primary_reMarkets",
      dolar_futuro: dolarOrdenado,
      contratos: Object.keys(dolarOrdenado).length,
      fuentes,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error.message,
      dolar_futuro: {},
      contratos: 0,
      timestamp: new Date().toISOString(),
    });
  }
}
