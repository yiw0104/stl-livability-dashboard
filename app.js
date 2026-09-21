/* Spatial inequities & livability in St. Louis — interactive companion.
 *
 * All figures are computed in build/precompute.py from the analysis sources, so
 * the slopes and intercepts shown here are the ones printed in the paper.
 */
(function () {
  "use strict";

  var D = null, TRACTS = null, HOODS = null;
  var state = { feature: "facade", correlate: "pct_black", scatterView: "chart", valView: "chart" };
  var byGeoid = {};
  var tip = document.getElementById("tip");

  // ------------------------------------------------------------- helpers
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function seqRamp(kind) {
    var p = kind === "alt" ? "--alt-" : "--seq-";
    return [1, 2, 3, 4, 5].map(function (i) { return css(p + i); });
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function fmt(v, d) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return Number(v).toFixed(d === undefined ? 1 : d);
  }
  function featureMeta(key) {
    return D.meta.features.filter(function (f) { return f.key === key; })[0];
  }
  function correlateMeta(key) {
    return D.meta.correlates.filter(function (c) { return c.key === key; })[0];
  }
  function correlateValue(p, key) { return p[key]; }
  function unitOf(key) { return correlateMeta(key).unit === "k" ? "" : "%"; }
  function fmtCorrelate(v, key) {
    if (v === null || v === undefined) return "no data";
    return correlateMeta(key).unit === "k" ? "$" + fmt(v, 1) + "k" : fmt(v, 1) + "%";
  }

  // ------------------------------------------------------------ tooltip
  function showTip(evt, node) {
    tip.innerHTML = "";
    tip.appendChild(node);
    tip.style.opacity = "1";
    moveTip(evt);
  }
  function moveTip(evt) {
    var pad = 14, r = tip.getBoundingClientRect();
    var x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() { tip.style.opacity = "0"; }

  function tractTip(geoid) {
    var p = byGeoid[geoid];
    var fm = featureMeta(state.feature), cm = correlateMeta(state.correlate);
    var box = el("div");
    box.appendChild(el("div", { class: "t-title", text: "Tract " + geoid.slice(-6) }));
    [[fm.label, fmt(p[state.feature]) + "% of segments", css("--seq-3")],
     [cm.label, fmtCorrelate(correlateValue(p, state.correlate), state.correlate), css("--alt-3")]
    ].forEach(function (row) {
      var key = el("span", { class: "t-key" });
      var sw = el("i"); sw.style.background = row[2]; key.appendChild(sw);
      key.appendChild(document.createTextNode(row[0]));
      var r = el("div", { class: "t-row" }, [key, el("span", { class: "t-val", text: row[1] })]);
      box.appendChild(r);
    });
    box.appendChild(el("div", { class: "t-foot", text: p.n + " segments audited · " + p.pop_label }));
    return box;
  }

  // --------------------------------------------------- cross-panel focus
  var focused = null;
  function focus(geoid) {
    focused = geoid;
    d3.selectAll(".tract").classed("hi", function (d) { return d.properties.GEOID === geoid; });
    d3.selectAll(".dot").classed("hi", function (d) { return d.g === geoid; })
      .attr("r", function (d) { return d.g === geoid ? 6.5 : 4.5; });
    d3.selectAll(".tract.hi").each(function () { this.parentNode.appendChild(this); });
    d3.selectAll(".dot.hi").each(function () { this.parentNode.appendChild(this); });
  }

  // ----------------------------------------------------------- KPI row
  function renderKPI(root) {
    var h = D.meta.headline;
    var hero = el("div", { class: "card hero" });
    hero.appendChild(el("div", { class: "hero-val", text: h.hero.value.toLocaleString() }));
    hero.appendChild(el("div", { class: "hero-label", text: h.hero.label }));
    hero.appendChild(el("div", { class: "hero-note",
      text: "Across " + D.meta.n_tracts + " census tracts. A single manual pass of the same "
          + "segments was estimated at 500–730 hours of trained-annotator time." }));

    var tiles = el("div", { class: "tiles" });
    h.tiles.forEach(function (t) {
      var c = el("div", { class: "card tile" });
      c.appendChild(el("div", { class: "tile-label", text: t.label }));
      c.appendChild(el("div", { class: "tile-val", text: t.pct + "%" }));
      var meter = el("div", { class: "tile-meter" });
      var fill = el("i"); fill.style.width = t.pct + "%";
      meter.appendChild(fill); c.appendChild(meter);
      tiles.appendChild(c);
    });

    var sec = el("section");
    sec.appendChild(el("div", { class: "sec-head" }, [
      el("h2", { text: "What the audit found" }),
      el("p", { class: "sec", text: "Baseline infrastructure is widespread; the features that make a "
        + "street usable for a wheelchair, a stroller, or a slow walker are not." })
    ]));
    sec.appendChild(el("div", { class: "kpi" }, [hero, tiles]));
    root.appendChild(sec);
  }

  // ------------------------------------------------------------ filters
  function renderFilters(root) {
    var f = el("div", { class: "card filters" });

    var fsel = el("select", { id: "featSel", "aria-label": "Built-environment feature" });
    D.meta.features.forEach(function (x) {
      fsel.appendChild(el("option", { value: x.key, text: x.label }));
    });
    fsel.value = state.feature;
    fsel.addEventListener("change", function () { state.feature = this.value; rerender(); });

    var csel = el("select", { id: "corrSel", "aria-label": "Tract characteristic to compare against" });
    D.meta.correlates.forEach(function (x) {
      csel.appendChild(el("option", { value: x.key, text: x.label }));
    });
    csel.value = state.correlate;
    csel.addEventListener("change", function () { state.correlate = this.value; rerender(); });

    f.appendChild(el("div", { class: "field" }, [
      el("label", { for: "featSel", text: "Built-environment feature" }), fsel]));
    f.appendChild(el("div", { class: "field" }, [
      el("label", { for: "corrSel", text: "Compare against" }), csel]));
    f.appendChild(el("p", { class: "filter-note",
      text: "Both maps, the scatter plot and its statistics all follow these two controls." }));
    root.appendChild(f);
  }

  // --------------------------------------------------------------- maps
  function renderMaps(root) {
    var W = 420, H = 560;
    var proj = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], TRACTS);
    var path = d3.geoPath(proj);

    var maps = el("div", { class: "maps" });
    var fm = featureMeta(state.feature), cm = correlateMeta(state.correlate);

    [{ kind: "seq", accessor: function (p) { return p.properties[fm.col]; },
       title: fm.label, sub: "% of audited segments in the tract", labels: true, unit: "%" },
     { kind: "alt", accessor: function (p) { return p.properties[state.correlate]; },
       title: cm.label, sub: cm.axis, labels: false, unit: cm.unit === "k" ? "k" : "%" }
    ].forEach(function (spec) {
      var vals = TRACTS.features.map(spec.accessor).filter(function (v) { return v !== null; });
      var colors = seqRamp(spec.kind);
      var scale = d3.scaleQuantile().domain(vals).range(colors);

      var card = el("div", { class: "card map-card" });
      card.appendChild(el("div", { class: "map-title", text: spec.title }));
      card.appendChild(el("div", { class: "map-sub", text: spec.sub }));

      var svg = d3.create("svg")
        .attr("class", "chart")
        .attr("viewBox", "0 0 " + W + " " + H)
        .attr("role", "img")
        .attr("aria-label", spec.title + " by census tract, City of St. Louis");

      svg.append("g").selectAll("path").data(TRACTS.features).join("path")
        .attr("class", "tract")
        .attr("d", path)
        .attr("fill", function (d) {
          var v = spec.accessor(d);
          return v === null ? css("--nodata") : scale(v);
        })
        .on("pointerenter", function (evt, d) {
          focus(d.properties.GEOID); showTip(evt, tractTip(d.properties.GEOID));
        })
        .on("pointermove", moveTip)
        .on("pointerleave", function () { focus(null); hideTip(); });

      svg.append("g").selectAll("path").data(HOODS.features).join("path")
        .attr("class", "hood").attr("d", path);

      if (spec.labels) {
        svg.append("g").selectAll("text").data(HOODS.features).join("text")
          .attr("class", "hood-label")
          .attr("x", function (d) { return proj([d.properties.cx, d.properties.cy])[0]; })
          .attr("y", function (d) { return proj([d.properties.cx, d.properties.cy])[1]; })
          .attr("text-anchor", "middle")
          .text(function (d) { return d.properties.name; });
      }

      card.appendChild(svg.node());

      // legend — quantile edges, labelled with real values
      var edges = scale.quantiles();
      var lg = el("div", { class: "legend" });
      colors.forEach(function (c, i) {
        var sw = el("i"); sw.style.background = c; lg.appendChild(sw);
        if (i < edges.length) {
          var lab = spec.unit === "k" ? "$" + fmt(edges[i], 0) + "k" : fmt(edges[i], 0) + "%";
          lg.appendChild(el("span", { class: "lg-lab", text: lab }));
        }
      });
      if (vals.length < TRACTS.features.length) {
        var nd = el("div", { class: "legend-nd" });
        nd.appendChild(el("i"));
        nd.appendChild(document.createTextNode("no data"));
        lg.appendChild(nd);
      }
      card.appendChild(lg);
      maps.appendChild(card);
    });

    var sec = el("section");
    sec.appendChild(el("div", { class: "sec-head" }, [
      el("h2", { text: "Where the gaps are" }),
      el("p", { class: "sec", text: "The same 104 tracts, drawn twice. Hover any tract to read both "
        + "values at once; the four neighbourhoods named in the paper are outlined." })
    ]));
    sec.appendChild(maps);
    root.appendChild(sec);
  }

  // ------------------------------------------------------------ scatter
  function renderScatter(root) {
    var fm = featureMeta(state.feature), cm = correlateMeta(state.correlate);
    var a = D.assoc[state.feature + "|" + state.correlate];
    var pts = D.points.filter(function (p) { return correlateValue(p, state.correlate) !== null; });

    var sec = el("section");
    sec.appendChild(el("div", { class: "sec-head" }, [
      el("h2", { text: "How closely they track" }),
      el("p", { class: "sec", text: "Each dot is one census tract. The line is the bivariate "
        + "ordinary-least-squares fit reported in the paper, shaded with its 95% confidence band." })
    ]));

    var tabs = el("div", { class: "tabs", role: "tablist" });
    [["chart", "Chart"], ["table", "Data table"]].forEach(function (t) {
      var b = el("button", { class: "tab", type: "button", role: "tab", text: t[1],
        "aria-selected": state.scatterView === t[0] ? "true" : "false" });
      b.addEventListener("click", function () { state.scatterView = t[0]; rerender(); });
      tabs.appendChild(b);
    });
    sec.appendChild(tabs);

    var card = el("div", { class: "card pad" });

    if (state.scatterView === "table") {
      card.appendChild(scatterTable(pts, fm, cm));
    } else {
      var grid = el("div", { class: "scatter-grid" });
      grid.appendChild(scatterPlot(pts, fm, cm, a));
      grid.appendChild(scatterReadout(fm, cm, a));
      card.appendChild(grid);
    }
    sec.appendChild(card);
    root.appendChild(sec);
  }

  function scatterPlot(pts, fm, cm, a) {
    var W = 620, H = 400, M = { t: 14, r: 16, b: 46, l: 52 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;
    var xv = pts.map(function (p) { return correlateValue(p, state.correlate); });
    var yv = pts.map(function (p) { return p[state.feature]; });

    var x = d3.scaleLinear().domain(d3.extent(xv)).nice().range([0, iw]);
    var y = d3.scaleLinear().domain(d3.extent(yv)).nice().range([ih, 0]);

    var svg = d3.create("svg").attr("class", "chart")
      .attr("viewBox", "0 0 " + W + " " + H)
      .attr("role", "img")
      .attr("aria-label", fm.label + " against " + cm.label + " across " + pts.length + " census tracts");
    var g = svg.append("g").attr("transform", "translate(" + M.l + "," + M.t + ")");

    g.append("g").selectAll("line").data(y.ticks(6)).join("line")
      .attr("class", "grid-line").attr("x1", 0).attr("x2", iw)
      .attr("y1", y).attr("y2", y);

    g.append("g").selectAll("text").data(y.ticks(6)).join("text")
      .attr("class", "tick-txt").attr("x", -9).attr("y", y)
      .attr("dy", "0.32em").attr("text-anchor", "end")
      .text(function (d) { return d + "%"; });

    g.append("g").selectAll("text").data(x.ticks(7)).join("text")
      .attr("class", "tick-txt").attr("x", x).attr("y", ih + 18).attr("text-anchor", "middle")
      .text(function (d) { return cm.unit === "k" ? "$" + d + "k" : d + "%"; });

    g.append("line").attr("class", "axis-line")
      .attr("x1", 0).attr("x2", iw).attr("y1", ih).attr("y2", ih);

    // confidence band + fit line
    var band = a.band;
    var area = d3.area()
      .x(function (d, i) { return x(band.x[i]); })
      .y0(function (d, i) { return y(band.lo[i]); })
      .y1(function (d, i) { return y(band.hi[i]); });
    g.append("path").attr("class", "fit-band").attr("d", area(band.x));
    var line = d3.line().x(function (d, i) { return x(band.x[i]); })
                        .y(function (d, i) { return y(band.y[i]); });
    g.append("path").attr("class", "fit-line").attr("d", line(band.x));

    var dots = g.append("g").selectAll("circle").data(pts).join("circle")
      .attr("class", "dot").attr("r", 4.5)
      .attr("cx", function (p) { return x(correlateValue(p, state.correlate)); })
      .attr("cy", function (p) { return y(p[state.feature]); });

    // nearest-point hover: the pointer only has to be closest, not dead-centre
    var delaunay = d3.Delaunay.from(pts,
      function (p) { return x(correlateValue(p, state.correlate)); },
      function (p) { return y(p[state.feature]); });
    g.append("rect").attr("width", iw).attr("height", ih)
      .attr("fill", "transparent")
      .on("pointermove", function (evt) {
        var m = d3.pointer(evt, this);
        var i = delaunay.find(m[0], m[1]);
        focus(pts[i].g);
        showTip(evt, tractTip(pts[i].g));
      })
      .on("pointerleave", function () { focus(null); hideTip(); });

    g.append("text").attr("class", "axis-txt")
      .attr("x", iw / 2).attr("y", ih + 40).attr("text-anchor", "middle")
      .text(cm.label + " (" + cm.axis + ")");
    g.append("text").attr("class", "axis-txt")
      .attr("transform", "rotate(-90)").attr("x", -ih / 2).attr("y", -38)
      .attr("text-anchor", "middle")
      .text("% of segments — " + fm.label);

    var box = el("div");
    box.appendChild(svg.node());
    return box;
  }

  function scatterReadout(fm, cm, a) {
    var box = el("div", { class: "readout" });
    box.appendChild(el("h3", { text: "Bivariate fit" }));
    var pTxt = a.p < 0.001 ? "< 0.001" : a.p.toFixed(3);
    [["Slope", (a.slope > 0 ? "+" : "") + a.slope.toFixed(2) + " " + a.stars],
     ["Intercept", a.intercept.toFixed(2)],
     ["R²", a.r2.toFixed(3)],
     ["p-value", pTxt],
     ["Tracts", String(a.n)]
    ].forEach(function (r) {
      box.appendChild(el("div", { class: "stat-line" }, [
        el("span", { text: r[0] }), el("span", { text: r[1] })]));
    });

    var step = cm.unit === "k" ? "$1,000 of median household income" : "1 percentage point";
    var dir = a.slope >= 0 ? "rises" : "falls";
    box.appendChild(el("p", { class: "interp",
      text: "Each " + step + " more is associated with a share of segments having "
          + fm.label.toLowerCase() + " that " + dir + " by "
          + Math.abs(a.slope).toFixed(2) + " percentage points"
          + (a.p < 0.05 ? "." : ", though the association is not statistically significant.") }));

    if (state.feature === "canopy") {
      box.appendChild(el("p", { class: "flag", text: D.meta.notes.canopy }));
    }
    if (a.n < D.meta.n_tracts) {
      box.appendChild(el("p", { class: "interp muted",
        text: (D.meta.n_tracts - a.n) + " tracts are excluded: the American Community Survey "
            + "reports no median household income for them." }));
    }
    return box;
  }

  function scatterTable(pts, fm, cm) {
    var wrap = el("div", { class: "scroll" });
    var t = el("table");
    var head = el("tr");
    ["Tract", "Segments audited", fm.label + " (%)", cm.label + " (" + cm.axis + ")"]
      .forEach(function (h) { head.appendChild(el("th", { text: h })); });
    t.appendChild(el("thead", null, [head]));
    var tb = el("tbody");
    pts.slice().sort(function (a, b) {
      return correlateValue(b, state.correlate) - correlateValue(a, state.correlate);
    }).forEach(function (p) {
      var tr = el("tr");
      tr.appendChild(el("td", { text: p.g }));
      tr.appendChild(el("td", { text: String(p.n) }));
      tr.appendChild(el("td", { text: fmt(p[state.feature]) }));
      tr.appendChild(el("td", { text: fmt(correlateValue(p, state.correlate)) }));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  // ---------------------------------------------------------- inventory
  var STATUS = {
    validated:    { color: "--good",     label: "Validated", icon: "check" },
    not_assessed: { color: "--warning",  label: "No human item", icon: "alert" },
    excluded_var: { color: "--text-muted", label: "Excluded — no variation", icon: "minus" },
    excluded_val: { color: "--critical", label: "Excluded — failed check", icon: "cross" }
  };
  function icon(kind, color) {
    var ns = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(ns, "svg");
    s.setAttribute("width", "12"); s.setAttribute("height", "12"); s.setAttribute("viewBox", "0 0 12 12");
    var p = document.createElementNS(ns, "path");
    var d = { check: "M2.5 6.5 L5 9 L9.5 3.5", cross: "M3 3 L9 9 M9 3 L3 9",
              alert: "M6 2.5 L6 7 M6 9.2 L6 9.6", minus: "M3 6 L9 6" }[kind];
    p.setAttribute("d", d);
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", "1.8");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    s.appendChild(p);
    if (kind === "alert") {
      var c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", "6"); c.setAttribute("cy", "6"); c.setAttribute("r", "4.6");
      c.setAttribute("stroke", color); c.setAttribute("stroke-width", "1.2"); c.setAttribute("fill", "none");
      s.appendChild(c);
    }
    return s;
  }
  function statusBadge(status) {
    var s = STATUS[status];
    var b = el("span", { class: "badge", title: s.label });
    b.appendChild(icon(s.icon, css(s.color)));
    b.appendChild(document.createTextNode(s.label));
    return b;
  }

  function renderInventory(root) {
    var sec = el("section");
    sec.appendChild(el("div", { class: "sec-head" }, [
      el("h2", { text: "Every feature the model rated" }),
      el("p", { class: "sec", text: "All 20 items, including the ones that did not survive screening. "
        + "A feature the model reported confidently is not the same as a feature it got right — the "
        + "status column carries that distinction, and the excluded items are drawn in grey." })
    ]));
    var card = el("div", { class: "card pad" });
    var head = el("div", { class: "inv-head" });
    ["Feature", "Prevalence across 7,848 segments", "%", "Status"].forEach(function (h) {
      head.appendChild(el("span", { text: h }));
    });
    card.appendChild(head);

    D.inventory.forEach(function (item) {
      var excluded = item.status.indexOf("excluded") === 0;
      var row = el("div", { class: "inv-row" });
      row.appendChild(el("div", { class: "inv-label", text: item.label }));
      var track = el("div", { class: "inv-track" });
      var bar = el("div", { class: "inv-bar" + (excluded ? " off" : "") });
      bar.style.width = item.pct + "%";
      track.appendChild(bar);
      row.appendChild(track);
      row.appendChild(el("div", { class: "inv-val", text: item.pct + "%" }));
      row.appendChild(statusBadge(item.status));
      row.title = item.label + ": " + item.n.toLocaleString() + " of "
        + item.total.toLocaleString() + " segments"
        + (item.ac1 !== null ? " · AC1 " + item.ac1.toFixed(2) : "");
      card.appendChild(row);
    });
    sec.appendChild(card);
    root.appendChild(sec);
  }

  // --------------------------------------------------------- validation
  function renderValidation(root) {
    var v = D.validation;
    var sec = el("section");
    sec.appendChild(el("div", { class: "sec-head" }, [
      el("h2", { text: "How far to trust the model" }),
      el("p", { class: "sec", text: "164 panoramas were audited by five trained raters and compared "
        + "with the model's own ratings. Two trained humans agreed with each other on "
        + v.pooled_human_agreement + "% of paired ratings — that is the ceiling this task allows, "
        + "not 100%." })
    ]));

    var tabs = el("div", { class: "tabs", role: "tablist" });
    [["chart", "Agreement"], ["table", "Coherence checks"]].forEach(function (t) {
      var b = el("button", { class: "tab", type: "button", role: "tab", text: t[1],
        "aria-selected": state.valView === t[0] ? "true" : "false" });
      b.addEventListener("click", function () { state.valView = t[0]; rerender(); });
      tabs.appendChild(b);
    });
    sec.appendChild(tabs);

    var card = el("div", { class: "card pad" });
    card.appendChild(state.valView === "chart" ? validationTable(v) : coherenceTable(v));
    sec.appendChild(card);
    root.appendChild(sec);
  }

  function ac1Cell(ac1) {
    var cell = el("div", { class: "ac1-cell" });
    var track = el("div", { class: "ac1-track" });
    track.appendChild(el("div", { class: "ac1-zero" }));
    var bar = el("div", { class: "ac1-bar" });
    var w = Math.abs(ac1) / 1 * 43;
    bar.style.width = w + "px";
    if (ac1 >= 0) { bar.style.left = "43px"; bar.style.background = css("--accent"); bar.style.borderRadius = "0 2px 2px 0"; }
    else { bar.style.left = (43 - w) + "px"; bar.style.background = css("--pole-neg"); bar.style.borderRadius = "2px 0 0 2px"; }
    track.appendChild(bar);
    cell.appendChild(track);
    cell.appendChild(el("span", { text: ac1.toFixed(2) }));
    return cell;
  }

  function validationTable(v) {
    var wrap = el("div", { class: "scroll" });
    var t = el("table");
    var head = el("tr");
    ["Feature", "n", "Human says present", "Model says present", "Agreement",
     "AC1 (−0.9 ← 0 → +1)", "Sensitivity", "Specificity", "Status"]
      .forEach(function (h) { head.appendChild(el("th", { text: h })); });
    t.appendChild(el("thead", null, [head]));
    var tb = el("tbody");
    v.vlm.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(el("td", { text: r.feature }));
      tr.appendChild(el("td", { text: String(r.n) }));
      tr.appendChild(el("td", { text: fmt(r.human_pct) + "%" }));
      tr.appendChild(el("td", { text: fmt(r.vlm_pct) + "%" }));
      tr.appendChild(el("td", { text: fmt(r.agreement) + "%" }));
      var ac = el("td"); ac.appendChild(ac1Cell(r.ac1)); tr.appendChild(ac);
      tr.appendChild(el("td", { text: fmt(r.sens) + "%" }));
      tr.appendChild(el("td", { text: fmt(r.spec) + "%" }));
      var st = el("td"); st.appendChild(statusBadge(r.status)); tr.appendChild(st);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);

    wrap.appendChild(el("p", { class: "interp", html:
      "Sensitivity runs high and specificity low across the board: the model's error is "
      + "systematic, not random — it reports features as <em>present</em>. Two measures agreed "
      + "no better than chance and were dropped. Cycling infrastructure had passed the "
      + "variation screen, which is why variation alone is not a sufficient filter." }));
    return wrap;
  }

  function coherenceTable(v) {
    var wrap = el("div", { class: "scroll" });
    var t = el("table");
    var head = el("tr");
    ["Check", "Group", "%", "Group", "%", "Test"].forEach(function (h) {
      head.appendChild(el("th", { text: h }));
    });
    t.appendChild(el("thead", null, [head]));
    var tb = el("tbody");
    v.coherence.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(el("td", { text: r.feature }));
      tr.appendChild(el("td", { text: r.group_a }));
      tr.appendChild(el("td", { text: fmt(r.pct_a) + "%" }));
      tr.appendChild(el("td", { text: r.group_b }));
      tr.appendChild(el("td", { text: fmt(r.pct_b) + "%" }));
      tr.appendChild(el("td", { text: "p < 0.001" }));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    wrap.appendChild(el("p", { class: "interp",
      text: "Features move in the directions theory predicts, and related features co-occur. "
          + "Land-use type is itself model-derived, so these checks establish internal coherence "
          + "rather than correspondence with an external criterion." }));
    return wrap;
  }

  // ----------------------------------------------------------- evidence
  function renderEvidence(root) {
    var kinds = {
      converge: { color: "--accent", label: "Quantitative and qualitative agree" },
      diverge:  { color: "--alt-3",  label: "The interview catches what the model missed" },
      context:  { color: "--text-muted", label: "Mechanism offered by participants" }
    };
    var sec = el("section");
    sec.appendChild(el("div", { class: "sec-head" }, [
      el("h2", { text: "What residents and stakeholders said" }),
      el("p", { class: "sec", text: "Each published quotation sits beside the quantitative result it "
        + "speaks to. Where the two diverge, the divergence is the finding." })
    ]));
    var grid = el("div", { class: "ev-grid" });
    D.evidence.forEach(function (e) {
      var k = kinds[e.kind];
      var c = el("div", { class: "card ev" });
      var tag = el("div", { class: "ev-tag" });
      var dot = el("i"); dot.style.background = css(k.color); tag.appendChild(dot);
      tag.appendChild(document.createTextNode(k.label));
      c.appendChild(tag);
      c.appendChild(el("p", { class: "ev-q", text: "“" + e.quote + "”" }));
      c.appendChild(el("div", { class: "ev-src", text: e.source + " · " + e.theme }));
      var find = el("div", { class: "ev-find" });
      find.appendChild(el("b", { text: "In the audit data" }));
      find.appendChild(document.createTextNode(e.pairs_with));
      c.appendChild(find);
      grid.appendChild(c);
    });
    sec.appendChild(grid);
    root.appendChild(sec);
  }

  // -------------------------------------------------------------- notes
  function renderNotes(root) {
    var sec = el("section");
    sec.appendChild(el("div", { class: "sec-head" }, [el("h2", { text: "Reading these numbers" })]));
    var card = el("div", { class: "card pad" });
    var notes = el("div", { class: "notes" });
    [["Tract-level, not person-level",
      "Every association here is between tract aggregates. It describes places, not the people in "
      + "them; inferring individual experience from these slopes is an ecological fallacy."],
     ["What the imagery can and cannot see",
      "Street View coverage varies in date and completeness. Alleys and private streets are absent, "
      + "and features are rated from the imagery available rather than from a field visit."],
     ["Validated against audits, not ground truth",
      "The reference standard is independent human rating of the same panoramas — itself imperfect, "
      + "and virtual rather than field-based. Four features carried into the analyses had no "
      + "comparable human item at all."],
     ["Sources and vintage",
      "Built-environment features: Google Street View imagery via the Street View Static API. "
      + "Demographics: American Community Survey 2018–2022 5-year estimates, via IPUMS NHGIS. "
      + "Boundaries: City of St. Louis Open Data."]
    ].forEach(function (n) {
      notes.appendChild(el("div", { class: "note" }, [
        el("h3", { text: n[0] }), el("p", { text: n[1] })]));
    });
    card.appendChild(notes);

    var dl = el("div", { class: "dl" });
    [["data/tract_stats.csv", "Tract table (CSV)"],
     ["data/segments.csv", "Segment ratings (CSV)"],
     ["data/tracts.geojson", "Tract boundaries (GeoJSON)"],
     ["data/dashboard.json", "Everything on this page (JSON)"]
    ].forEach(function (d) {
      dl.appendChild(el("a", { href: d[0], download: "", text: d[1] }));
    });
    card.appendChild(el("h3", { text: "Download the data", style: "margin-top:22px" }));
    card.appendChild(dl);
    sec.appendChild(card);

    sec.appendChild(el("footer", { html:
      "Favar&atilde;o Le&atilde;o AL, Wang Y, Banda BF, Balogun M, Xing E, Gudapati S, Rios-Hernandez M, "
      + "Jacobs N, Reis RS. <em>Exploring spatial inequities and livability: a mixed-methods study using "
      + "artificial intelligence and community insights.</em> Journal of Urban Health, 2026.<br>"
      + "Figures regenerated from the analysis sources on " + D.meta.generated
      + ". Interviews conducted under Washington University in St. Louis IRB #202406091; "
      + "no transcript material beyond the published quotations appears here." }));
    root.appendChild(sec);
  }

  // ------------------------------------------------------------- render
  function rerender() {
    var app = document.getElementById("app");
    app.innerHTML = "";
    renderKPI(app);
    renderFilters(app);
    renderMaps(app);
    renderScatter(app);
    renderInventory(app);
    renderValidation(app);
    renderEvidence(app);
    renderNotes(app);
  }

  // -------------------------------------------------------------- theme
  var MODES = ["system", "light", "dark"];
  function applyTheme(mode) {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    document.getElementById("themeBtn").textContent = "Theme: " + mode;
    try { localStorage.setItem("stl-theme", mode); } catch (e) { /* private mode */ }
  }
  function initTheme() {
    var saved = "system";
    try { saved = localStorage.getItem("stl-theme") || "system"; } catch (e) { /* private mode */ }
    applyTheme(saved);
    document.getElementById("themeBtn").addEventListener("click", function () {
      var cur = MODES.indexOf(this.textContent.replace("Theme: ", ""));
      applyTheme(MODES[(cur + 1) % MODES.length]);
      if (D) rerender();
    });
  }

  // --------------------------------------------------------------- boot
  initTheme();
  Promise.all([
    fetch("data/dashboard.json").then(function (r) { return r.json(); }),
    fetch("data/tracts.geojson").then(function (r) { return r.json(); }),
    fetch("data/neighborhoods.geojson").then(function (r) { return r.json(); })
  ]).then(function (res) {
    D = res[0]; TRACTS = res[1]; HOODS = res[2];
    var popOf = {};
    TRACTS.features.forEach(function (f) { popOf[f.properties.GEOID] = f.properties.pop; });
    D.points.forEach(function (p) {
      var pop = popOf[p.g];
      p.pop_label = pop ? "population " + pop.toLocaleString() : "population unknown";
      byGeoid[p.g] = p;
    });
    rerender();
  }).catch(function (err) {
    document.getElementById("app").innerHTML =
      '<div class="loading">Could not load the data files.<br>' +
      'If you are opening this file directly, serve the folder over HTTP instead ' +
      '(<code>python3 -m http.server</code>), because browsers block <code>fetch</code> on <code>file://</code>.</div>';
    console.error(err);
  });
})();
