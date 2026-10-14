/*
 * Optimizador de rutas (problema del viajero, asimétrico).
 * M: matriz de costos n×n (segundos de manejo reales). Índice 0 = oficina.
 * Devuelve el orden de las paradas (índices 1..n-1) que minimiza el tiempo total.
 *  - Hasta 12 paradas: solución exacta (programación dinámica Held-Karp).
 *  - Más paradas: vecino más cercano + 2-opt + or-opt (muy cerca del óptimo).
 */
(function (root) {
  "use strict";

  function routeCost(M, seq, ret) {
    let c = 0, prev = 0;
    for (const j of seq) { c += M[prev][j]; prev = j; }
    if (ret && seq.length) c += M[prev][0];
    return c;
  }

  function heldKarp(M, ret) {
    const k = M.length - 1;              // número de paradas
    const FULL = (1 << k) - 1;
    const dp = new Float64Array((1 << k) * k).fill(Infinity);
    const par = new Int8Array((1 << k) * k).fill(-1);
    for (let j = 0; j < k; j++) dp[(1 << j) * k + j] = M[0][j + 1];
    for (let mask = 1; mask <= FULL; mask++) {
      for (let j = 0; j < k; j++) {
        if (!(mask & (1 << j))) continue;
        const cur = dp[mask * k + j];
        if (cur === Infinity) continue;
        for (let n = 0; n < k; n++) {
          if (mask & (1 << n)) continue;
          const nm = mask | (1 << n), v = cur + M[j + 1][n + 1];
          if (v < dp[nm * k + n]) { dp[nm * k + n] = v; par[nm * k + n] = j; }
        }
      }
    }
    let best = Infinity, end = -1;
    for (let j = 0; j < k; j++) {
      const v = dp[FULL * k + j] + (ret ? M[j + 1][0] : 0);
      if (v < best) { best = v; end = j; }
    }
    const seq = [];
    let mask = FULL, j = end;
    while (j !== -1) { seq.push(j + 1); const p = par[mask * k + j]; mask ^= (1 << j); j = p; }
    return seq.reverse();
  }

  function heuristic(M, ret) {
    const n = M.length;
    const left = new Set(); for (let i = 1; i < n; i++) left.add(i);
    let seq = [], cur = 0;
    while (left.size) {
      let bi = -1, bv = Infinity;
      for (const i of left) if (M[cur][i] < bv) { bv = M[cur][i]; bi = i; }
      seq.push(bi); left.delete(bi); cur = bi;
    }
    let best = routeCost(M, seq, ret), improved = true;
    while (improved) {
      improved = false;
      // 2-opt (invertir tramos)
      for (let i = 0; i < seq.length - 1; i++) for (let j = i + 1; j < seq.length; j++) {
        const c = seq.slice(0, i).concat(seq.slice(i, j + 1).reverse(), seq.slice(j + 1));
        const v = routeCost(M, c, ret);
        if (v + 1e-6 < best) { seq = c; best = v; improved = true; }
      }
      // or-opt (mover tramos de 1 a 3 paradas)
      for (let len = 1; len <= 3; len++) for (let i = 0; i + len <= seq.length; i++) {
        const seg = seq.slice(i, i + len), rest = seq.slice(0, i).concat(seq.slice(i + len));
        for (let p = 0; p <= rest.length; p++) {
          if (p === i) continue;
          const c = rest.slice(0, p).concat(seg, rest.slice(p));
          const v = routeCost(M, c, ret);
          if (v + 1e-6 < best) { seq = c; best = v; improved = true; }
        }
      }
    }
    return seq;
  }

  function solve(M, ret) {
    const k = M.length - 1;
    if (k <= 0) return [];
    if (k === 1) return [1];
    return k <= 12 ? heldKarp(M, ret) : heuristic(M, ret);
  }

  const api = { solve, routeCost, heldKarp, heuristic };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RouteSolver = api;
})(typeof window !== "undefined" ? window : globalThis);
