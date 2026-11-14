/*
 * stats.js — trend statistics for the Data Detective tool.
 *
 * Runs in the browser (window.DDStats) and in Node (module.exports) for testing.
 * Mirrors the Python pipeline (scipy.stats.linregress + pymannkendall) so the
 * website and the notebooks give the same numbers.
 *
 * Main entry point:
 *   DDStats.analyze(dates, values, {alpha: 0.05})
 *     dates  : array of Date objects or ISO strings ("2003-01-01"), monthly
 *     values : array of numbers (null/NaN allowed for missing months)
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const toDate = (d) => (d instanceof Date ? d : new Date(d));

  function mean(a) {
    let s = 0;
    for (const v of a) s += v;
    return s / a.length;
  }

  function median(a) {
    const s = Float64Array.from(a).sort();
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Ranks with ties averaged (same as scipy.stats.rankdata default)
  function rankdata(a) {
    const idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]);
    const ranks = new Array(a.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k]] = r;
      i = j + 1;
    }
    return ranks;
  }

  // ---------------------------------------------------------------------------
  // Distributions (normal + Student t)
  // ---------------------------------------------------------------------------
  function erf(x) {
    // W. J. Cody-style rational approximation via erfc; accurate to ~1e-12
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const r =
      t *
      Math.exp(
        -z * z -
          1.26551223 +
          t * (1.00002368 +
          t * (0.37409196 +
          t * (0.09678418 +
          t * (-0.18628806 +
          t * (0.27886807 +
          t * (-1.13520398 +
          t * (1.48851587 +
          t * (-0.82215223 + t * 0.17087277))))))))
      );
    return x >= 0 ? 1 - r : r - 1;
  }
  const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

  // Inverse normal CDF (Acklam's algorithm, refined with one Newton step)
  function normPpf(p) {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
      3.754408661907416];
    const pl = 0.02425;
    let x;
    if (p < pl) {
      const q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= 1 - pl) {
      const q = p - 0.5, r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
          (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const e = normCdf(x) - p;
    return x - e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  }

  function lgamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (const gj of g) ser += gj / ++y;
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
  }

  // Regularized incomplete beta I_x(a,b) (Numerical Recipes continued fraction)
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) +
      a * Math.log(x) + b * Math.log(1 - x));
    const cf = (a, b, x) => {
      const EPS = 1e-14, FPMIN = 1e-300;
      let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      d = 1 / d;
      let h = d;
      for (let m = 1; m <= 300; m++) {
        const m2 = 2 * m;
        let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
        d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
        c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1 / d; h *= d * c;
        aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
        d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
        c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < EPS) break;
      }
      return h;
    };
    return x < (a + 1) / (a + b + 2)
      ? (bt * cf(a, b, x)) / a
      : 1 - (bt * cf(b, a, 1 - x)) / b;
  }

  // Two-sided p-value for a t statistic with df degrees of freedom
  const tTwoSidedP = (t, df) => betai(df / 2, 0.5, df / (df + t * t));

  // Inverse t CDF (upper quantile) by bisection — only needed for the CI
  function tPpf(p, df) {
    let lo = 0, hi = 100;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const cdf = 1 - 0.5 * tTwoSidedP(mid, df);
      if (cdf < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------------------------------------------------------------------------
  // 1. Remove the seasonal cycle
  // ---------------------------------------------------------------------------
  // anomaly = value - (average of all values in the same calendar month)
  function deseasonalize(dates, values) {
    const sums = new Array(12).fill(0), counts = new Array(12).fill(0);
    dates.forEach((d, i) => {
      if (isNum(values[i])) {
        const m = toDate(d).getUTCMonth();
        sums[m] += values[i];
        counts[m]++;
      }
    });
    const clim = sums.map((s, m) => (counts[m] ? s / counts[m] : NaN));
    const anomalies = values.map((v, i) =>
      isNum(v) ? v - clim[toDate(dates[i]).getUTCMonth()] : NaN
    );
    return { anomalies, climatology: clim };
  }

  // ---------------------------------------------------------------------------
  // 2. Linear regression (least squares) + t-test + 95% confidence interval
  // ---------------------------------------------------------------------------
  // x is time in years since the first date, so the slope is in units/year.
  function linearTrend(dates, y, alpha = 0.05) {
    const t0 = toDate(dates[0]).getTime();
    const xs = [], ys = [];
    dates.forEach((d, i) => {
      if (isNum(y[i])) {
        xs.push((toDate(d).getTime() - t0) / (365.25 * 86400000));
        ys.push(y[i]);
      }
    });
    const n = xs.length;
    const mx = mean(xs), my = mean(ys);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    const df = n - 2;
    const sse = Math.max(syy - slope * sxy, 0);
    const stderr = Math.sqrt(sse / df / sxx);
    const t = stderr > 0 ? slope / stderr : Infinity;
    const p = stderr > 0 ? tTwoSidedP(t, df) : 0;
    const tcrit = tPpf(1 - alpha / 2, df);
    return {
      slopePerYear: slope,
      slopePerDecade: slope * 10,
      ciPerDecade: tcrit * stderr * 10, // ± half-width of the 95% CI
      intercept,                        // value at the first date
      stderr, t, p, n,
      significant: p < alpha,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Sen's slope (median of all pairwise slopes), per time step
  // ---------------------------------------------------------------------------
  function sensSlope(x) {
    const n = x.length, slopes = [];
    for (let i = 0; i < n - 1; i++)
      for (let j = i + 1; j < n; j++) slopes.push((x[j] - x[i]) / (j - i));
    const slope = median(slopes);
    const intercept = median(x) - median(x.map((v, i) => i)) * slope;
    return { slope, intercept };
  }

  // ---------------------------------------------------------------------------
  // 4. Mann-Kendall test with Hamed & Rao (1998) autocorrelation correction
  //    (same algorithm as pymannkendall.hamed_rao_modification_test)
  // ---------------------------------------------------------------------------
  function mkScore(x) {
    let s = 0;
    const n = x.length;
    for (let k = 0; k < n - 1; k++)
      for (let j = k + 1; j < n; j++) s += Math.sign(x[j] - x[k]);
    return s;
  }

  function mkVariance(x) {
    const n = x.length;
    const counts = new Map();
    for (const v of x) counts.set(v, (counts.get(v) || 0) + 1);
    let tie = 0;
    for (const t of counts.values()) tie += t * (t - 1) * (2 * t + 5);
    return (n * (n - 1) * (2 * n + 5) - tie) / 18;
  }

  function acf(x, nlags) {
    const n = x.length, m = mean(x);
    const y = x.map((v) => v - m);
    const out = [];
    let c0 = 0;
    for (const v of y) c0 += v * v;
    for (let k = 0; k <= nlags; k++) {
      let c = 0;
      for (let i = 0; i < n - k; i++) c += y[i] * y[i + k];
      out.push(c / c0);
    }
    return out;
  }

  // maxLag: how many months of autocorrelation to account for. pymannkendall's
  // default (all lags) gave ~10-19% false positives on trendless simulated data;
  // maxLag = 12 (one seasonal cycle) brought that back to ~6-7%.
  function mannKendall(values, alpha = 0.05, correct = true, maxLag = 12) {
    const x = values.filter(isNum);          // skip missing months
    const n = x.length;
    const s = mkScore(x);
    let varS = mkVariance(x);
    const sen = sensSlope(x);
    let correction = 1;

    if (correct) {
      // detrend with Sen's slope, rank, and look for significant autocorrelation
      const detr = x.map((v, i) => v - (i + 1) * sen.slope);
      const L = Math.min(maxLag, n - 1);
      const r = acf(rankdata(detr), L);
      const bound = normPpf(1 - alpha / 2) / Math.sqrt(n);
      let sni = 0;
      for (let i = 1; i <= L; i++) {
        if (r[i] > bound || r[i] < -bound)
          sni += (n - i) * (n - i - 1) * (n - i - 2) * r[i];
      }
      correction = 1 + (2 / (n * (n - 1) * (n - 2))) * sni;
      if (!(correction > 0)) correction = 1; // guard: never allow a negative variance
      varS *= correction;
    }

    const z = s > 0 ? (s - 1) / Math.sqrt(varS)
            : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
    const p = 2 * (1 - normCdf(Math.abs(z)));
    const significant = p < alpha;
    return {
      s, varS, z, p, n,
      tau: s / (0.5 * n * (n - 1)),
      trend: !significant ? "no trend" : z > 0 ? "increasing" : "decreasing",
      significant,
      senSlopePerStep: sen.slope,          // per month for monthly data
      senSlopePerDecade: sen.slope * 120,
      correctionFactor: correction,        // >1 means autocorrelation made the test more cautious
    };
  }

  // ---------------------------------------------------------------------------
  // 5. One call that does everything + plain-language verdict
  // ---------------------------------------------------------------------------
  function analyze(dates, values, opts = {}) {
    const alpha = opts.alpha ?? 0.05;
    const name = opts.name ?? "This variable";
    const units = opts.units ?? "";
    const { anomalies, climatology } = deseasonalize(dates, values);
    const lin = linearTrend(dates, anomalies, alpha);
    const mk = mannKendall(anomalies, alpha, true, opts.maxLag ?? 12);
    const mkPlain = mannKendall(anomalies, alpha, false);

    const valid = values.filter(isNum);
    const avg = mean(valid);
    const rate = mk.senSlopePerDecade;
    const pct = avg ? (100 * rate) / Math.abs(avg) : NaN;
    const years =
      (toDate(dates[dates.length - 1]) - toDate(dates[0])) / (365.25 * 86400000);
    const fmtP = (p) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
    const dir = rate > 0 ? "rising" : rate < 0 ? "falling" : "flat";

    let verdict =
      `${name} is ${dir} by about ${Math.abs(rate).toPrecision(2)}${units ? " " + units : ""} per decade` +
      (isFinite(pct) ? ` (${Math.abs(pct).toFixed(1)}% of its average per decade). ` : ". ");
    verdict += mk.significant
      ? `This trend is statistically significant (Mann-Kendall ${fmtP(mk.p)}): ` +
        `it is very unlikely to be just random variation.`
      : `This trend is not statistically significant (Mann-Kendall ${fmtP(mk.p)}). ` +
        `It could be random variation, or the record (${Math.round(years)} years) ` +
        `may be too short to tell yet.`;

    // Flag the "tests disagree" case so the UI can explain autocorrelation
    const testsDisagree = lin.significant !== mk.significant;

    return {
      n: valid.length, years, mean: avg,
      anomalies, climatology,
      linear: lin,
      mannKendall: mk,
      mannKendallUncorrected: mkPlain,
      testsDisagree,
      verdict,
    };
  }

  const DDStats = {
    analyze, deseasonalize, linearTrend, mannKendall, sensSlope,
    _internal: { normCdf, normPpf, tTwoSidedP, tPpf, rankdata, acf, median },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = DDStats;
  else root.DDStats = DDStats;
})(typeof window !== "undefined" ? window : globalThis);
