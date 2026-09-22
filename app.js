/* Spatial inequities & livability in St. Louis — interactive companion.
 *
 * All figures are computed in build/precompute.py from the analysis sources, so
 * the slopes and intercepts shown here are the ones printed in the paper.
 */
(function () {
  "use strict";

  var D = null, TRACTS = null, HOODS = null, PANO = null;
  var state = { feature: "facade", correlate: "pct_black", scatterView: "chart" };
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
    [[fm.label, fmt(p[state.feature]) + "% of street segments", css("--seq-3")],
     [cm.label, fmtCorrelate(correlateValue(p, state.correlate), state.correlate), css("--alt-3")]
    ].forEach(function (row) {
      var key = el("span", { class: "t-key" });
      var sw = el("i"); sw.style.background = row[2]; key.appendChild(sw);
      key.appendChild(document.createTextNode(row[0]));
      var r = el("div", { class: "t-row" }, [key, el("span", { class: "t-val", text: row[1] })]);
      box.appendChild(r);
    });
    box.appendChild(el("div", { class: "t-foot", text: p.n + " street segments audited · " + p.pop_label }));
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
      el("label", { for: "corrSel", text: "Race / Income / Vacancy" }), csel]));
    f.appendChild(el("p", { class: "filter-note",
      text: "Scroll down for maps and descriptive statistics." }));
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
       title: fm.label, sub: "% of audited street segments in the tract", labels: true, unit: "%" },
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
      el("h2", { text: "Built Environment Feature vs. Race/Income/Vacancy" }),
      el("p", { class: "sec", text: "Hover any tract to read both "
        + "values at once." })
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
      el("p", { class: "sec", text: "Each dot is one census tract. The line shows the overall trend, and the shaded band shows how certain that trend is." })
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
      .text("% of street segments having " + fm.label);

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

    // Name the variable the step is measured in — "each 1 percentage point more"
    // on its own leaves the reader to guess. cm.phrase carries the label as it
    // reads mid-sentence, with its proper nouns intact.
    var phrase = cm.phrase || cm.label.toLowerCase();
    var step = cm.unit === "k" ? "$1,000 more " + phrase
                               : "1 percentage point more " + phrase;
    var size = Math.abs(a.slope).toFixed(2);
    var share = " share of street segments with " + fm.label.toLowerCase();
    var caveat = a.p < 0.05 ? "." : " — though this association is not statistically significant.";
    var sentence = size === "0.00"
      ? "A tract with " + step + " has essentially the same" + share + caveat
      : "A tract with " + step + " has, on average, a " + size + " percentage point "
        + (a.slope >= 0 ? "higher" : "lower") + share + caveat;
    box.appendChild(el("p", { class: "interp", text: sentence }));

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
    ["Tract", "Street segments audited", fm.label + " (%)", cm.label + " (" + cm.axis + ")"]
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

  // ---------------------------------------------------------- panoramas
  function renderPanoramas(root) {
    if (!PANO || !PANO.items[state.feature]) return;
    var fm = featureMeta(state.feature);
    var pair = PANO.items[state.feature];

    var sec = el("section");
    sec.appendChild(el("div", { class: "sec-head" }, [
      el("h2", { text: "What the AI model was looking at" }),
      el("p", { class: "sec", text: "Two of the audited panoramas, one the model rated each way "
        + "for " + fm.label.toLowerCase() + ". Each is a single Street View location stitched "
        + "from the four 90° views the model scored separately." })
    ]));

    var grid = el("div", { class: "pano-grid" });
    [["present", "--accent"], ["absent", "--alt-3"]].forEach(function (spec) {
      var item = pair[spec[0]];
      if (!item) return;
      var fig = el("figure", { class: "card pano" });

      var head = el("figcaption", { class: "pano-head" });
      var dot = el("i"); dot.style.background = css(spec[1]); head.appendChild(dot);
      head.appendChild(el("span", { text: item.label }));
      fig.appendChild(head);

      var img = el("img", {
        src: item.file, width: "1400", height: "350", loading: "lazy", decoding: "async",
        alt: "Street View panorama of a St. Louis street segment the model rated as: " + item.label
      });
      fig.appendChild(img);

      var cap = el("figcaption", { class: "pano-cap" });
      cap.appendChild(document.createTextNode(
        "Street segment " + item.image_id + " · " + item.lat.toFixed(4) + ", " + item.lon.toFixed(4)
        + " · Imagery © Google · "));
      var a = el("a", { href: item.streetview, target: "_blank", rel: "noopener noreferrer",
                        text: "open in Street View" });
      cap.appendChild(a);
      fig.appendChild(cap);

      grid.appendChild(fig);
    });
    sec.appendChild(grid);
    sec.appendChild(el("p", { class: "pano-note", text: PANO.note }));
    root.appendChild(sec);
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
    [["A census tract level study",
      "Every comparison here is between census tracts — areas of a few thousand residents each. "
      + "It describes overall quality of neighborhood streetscapes. "],
     ["What the photos can and cannot show",
      "The Street View photos were taken at different times, and coverage is patchy. Every rating comes from a photo, not from anyone "
      + "walking the street in person."],
     ["How we checked the AI",
      "Trained researchers rated the same photos by hand, and we compared the two. Those people "
      + "can be wrong too, and they were also working from photos rather than standing on the "
      + "street."],
     ["Where the data comes from",
      "Street features: Google Street View photographs. Population, income and vacancy: the "
      + "US Census Bureau's American Community Survey, 2018–2022 (via IPUMS NHGIS). Tract and "
      + "neighborhood boundaries: City of St. Louis Open Data."]
    ].forEach(function (n) {
      notes.appendChild(el("div", { class: "note" }, [
        el("h3", { text: n[0] }), el("p", { text: n[1] })]));
    });
    card.appendChild(notes);
    sec.appendChild(card);

    sec.appendChild(el("footer", { html:
      "Favar&atilde;o Le&atilde;o AL, Wang Y, Banda BF, Balogun M, Xing E, Gudapati S, Rios-Hernandez M, "
      + "Jacobs N, Reis RS. <em>Exploring spatial inequities and livability: a mixed-methods study using "
      + "artificial intelligence and community insights.</em> Journal of Urban Health, 2026.<br>" }));
    root.appendChild(sec);
  }

  // ------------------------------------------------------------- render
  function rerender() {
    var app = document.getElementById("app");
    app.innerHTML = "";
    renderFilters(app);   // scopes the maps and the scatter below it
    renderMaps(app);
    renderScatter(app);
    renderPanoramas(app);
    renderEvidence(app);
    renderNotes(app);
  }

  // --------------------------------------------------------------- boot
  Promise.all([
    fetch("data/dashboard.json").then(function (r) { return r.json(); }),
    fetch("data/tracts.geojson").then(function (r) { return r.json(); }),
    fetch("data/neighborhoods.geojson").then(function (r) { return r.json(); }),
    fetch("data/panoramas.json").then(function (r) { return r.json(); })
      .catch(function () { return null; })   // panel is optional
  ]).then(function (res) {
    D = res[0]; TRACTS = res[1]; HOODS = res[2]; PANO = res[3];
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
