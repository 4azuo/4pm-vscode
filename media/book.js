/* global acquireVsCodeApi, document, window */
/*
 * Book editor renderer of the 4PM VS Code extension (ADR-0674): draws the table / board model the extension posts
 * ({ type: "render", model }) with DOM text nodes only, keeps view state (tab, filter, sort, selection) locally,
 * and posts edits and actions back. No network access (the CSP allows none); every rule is the server's.
 */
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  const ui = Object.assign({ tab: "table", filter: "", sort: -1, desc: false, selected: [] }, vscode.getState() || {});
  let model = null;

  /** Persist the view state. */
  function keep() {
    vscode.setState(ui);
  }

  /** Create an element with a class and optional text. */
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** A button posting `msg`. */
  function button(label, cls, msg, disabled) {
    const b = el("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.disabled = !!disabled || !!model.busy;
    b.addEventListener("click", function () { vscode.postMessage(msg); });
    return b;
  }

  /** The rows after the filter and the sort. */
  function visibleRows() {
    const q = ui.filter.trim().toLowerCase();
    const rows = model.rows.filter(function (r) {
      return !q || r.cells.join(" ").toLowerCase().indexOf(q) >= 0;
    });
    if (ui.sort >= 0) {
      rows.sort(function (a, b) {
        const x = a.cells[ui.sort] || "";
        const y = b.cells[ui.sort] || "";
        return (ui.desc ? -1 : 1) * x.localeCompare(y, undefined, { numeric: true });
      });
    }
    return rows;
  }

  /** The toolbar. */
  function toolbar() {
    const L = model.labels;
    const bar = el("div", "toolbar");
    if (model.board) {
      ["table", "board"].forEach(function (t) {
        const b = el("button", "tab" + (ui.tab === t ? " tab--on" : ""), L[t]);
        b.type = "button";
        b.addEventListener("click", function () { ui.tab = t; keep(); render(); });
        bar.appendChild(b);
      });
    }
    if (ui.tab === "table") {
      const filter = el("input", "filter");
      filter.type = "search";
      filter.placeholder = L.filter;
      filter.value = ui.filter;
      filter.addEventListener("input", function () { ui.filter = filter.value; keep(); renderBody(); });
      bar.appendChild(filter);
    }
    const sel = ui.selected.filter(function (id) { return model.rows.some(function (r) { return r.id === id; }); });
    const approvable = sel.filter(function (id) { return model.rows.some(function (r) { return r.id === id && r.canApprove; }); });
    const unapprovable = sel.filter(function (id) { return model.rows.some(function (r) { return r.id === id && r.canUnapprove; }); });
    if (model.editable) {
      bar.appendChild(button(L.save.replace("{0}", String(model.dirty)), "btn--primary", { type: "save" }, model.dirty === 0));
      bar.appendChild(button(L.discard, "", { type: "discard" }, model.dirty === 0));
    } else {
      bar.appendChild(el("span", "badge", L.readOnly));
    }
    if (approvable.length) bar.appendChild(button(L.approve + " (" + approvable.length + ")", "", { type: "approve", ids: approvable }));
    if (unapprovable.length) bar.appendChild(button(L.unapprove + " (" + unapprovable.length + ")", "btn--danger", { type: "unapprove", ids: unapprovable }));
    bar.appendChild(button(L.refresh, "", { type: "refresh" }));
    bar.appendChild(button(L.source, "", { type: "source" }));
    bar.appendChild(button(L.web, "", { type: "web" }));
    return bar;
  }

  /** The table. */
  function table() {
    const L = model.labels;
    const rows = visibleRows();
    if (!rows.length) return el("p", "muted", L.empty);
    const wrap = el("div", "table-wrap");
    const t = el("table", "grid");
    const head = el("tr");
    head.appendChild(el("th", "col-select"));
    model.columns.forEach(function (c, k) {
      const th = el("th");
      const b = el("button", "sort", c + (ui.sort === k ? (ui.desc ? " ▼" : " ▲") : ""));
      b.type = "button";
      b.addEventListener("click", function () {
        if (ui.sort === k) ui.desc = !ui.desc; else { ui.sort = k; ui.desc = false; }
        keep();
        renderBody();
      });
      th.appendChild(b);
      head.appendChild(th);
    });
    head.appendChild(el("th", "", L.approval));
    const thead = el("thead");
    thead.appendChild(head);
    t.appendChild(thead);
    const body = el("tbody");
    rows.forEach(function (r) {
      const tr = el("tr", (r.edited ? "row--edited " : "") + (r.conflict ? "row--conflict" : ""));
      const tdSel = el("td", "col-select");
      if (r.canApprove || r.canUnapprove) {
        const box = el("input");
        box.type = "checkbox";
        box.checked = ui.selected.indexOf(r.id) >= 0;
        box.setAttribute("aria-label", r.id);
        box.addEventListener("change", function () {
          ui.selected = box.checked ? ui.selected.concat([r.id]) : ui.selected.filter(function (x) { return x !== r.id; });
          keep();
          render();
        });
        tdSel.appendChild(box);
      }
      tr.appendChild(tdSel);
      model.columns.forEach(function (c, k) {
        const td = el("td");
        const isId = c.trim().toLowerCase() === "id";
        if (isId) {
          const link = el("button", "link", r.cells[k]);
          link.type = "button";
          link.title = L.open;
          link.addEventListener("click", function () { vscode.postMessage({ type: "open", id: r.id }); });
          td.appendChild(link);
        } else if (model.editable) {
          const area = el("textarea", "cell");
          area.value = r.cells[k] || "";
          area.rows = Math.min(6, Math.max(1, Math.ceil(area.value.length / 48)));
          area.disabled = !!model.busy;
          area.setAttribute("aria-label", r.id + " · " + c);
          area.addEventListener("change", function () {
            vscode.postMessage({ type: "edit", id: r.id, col: k, value: area.value });
          });
          td.appendChild(area);
        } else {
          td.textContent = r.cells[k] || "";
        }
        tr.appendChild(td);
      });
      tr.appendChild(el("td", "approval", r.approval === "final" ? "✔" : r.approval));
      body.appendChild(tr);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  /** The board. */
  function board() {
    const wrap = el("div", "board");
    model.board.forEach(function (col) {
      const c = el("section", "board__col");
      c.appendChild(el("h2", "section__title", col.title + " · " + col.cards.length));
      col.cards.forEach(function (card) {
        const b = el("button", "card");
        b.type = "button";
        b.appendChild(el("strong", "card__id", card.id));
        b.appendChild(el("span", "card__title", card.title));
        const meta = [card.team, card.priority, card.approval === "final" ? "✔" : card.approval, card.worker].filter(Boolean).join(" · ");
        if (meta) b.appendChild(el("span", "card__meta", meta));
        b.addEventListener("click", function () { vscode.postMessage({ type: "open", id: card.id }); });
        c.appendChild(b);
      });
      wrap.appendChild(c);
    });
    return wrap;
  }

  /** The new-request form (USER_TODO). */
  function requestForm() {
    const L = model.labels;
    const form = el("form", "form");
    const label = el("label", "form__label", L.newRequest);
    const area = el("textarea", "form__input");
    area.id = "new-request";
    area.rows = 3;
    area.disabled = !!model.busy;
    label.htmlFor = area.id;
    const submit = el("button", "btn btn--primary", L.send);
    submit.type = "submit";
    submit.disabled = !!model.busy;
    form.appendChild(label);
    form.appendChild(area);
    form.appendChild(submit);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (area.value.trim()) vscode.postMessage({ type: "newRequest", text: area.value });
    });
    return form;
  }

  let bodyNode = null;

  /** Redraw only the table / board (keeps the filter input focused while typing). */
  function renderBody() {
    const next = ui.tab === "board" && model.board ? board() : table();
    if (bodyNode) bodyNode.replaceWith(next);
    bodyNode = next;
  }

  /** Redraw everything. */
  function render() {
    if (!model) return;
    if (!model.board && ui.tab === "board") ui.tab = "table";
    root.textContent = "";
    const head = el("header", "head");
    head.appendChild(el("h1", "head__title", model.title));
    head.appendChild(el("p", "head__subtitle", model.subtitle));
    root.appendChild(head);
    model.notices.forEach(function (n) { root.appendChild(el("p", "notice notice--" + n.kind, n.text)); });
    root.appendChild(toolbar());
    bodyNode = null;
    renderBody();
    root.appendChild(bodyNode);
    if (model.canNewRequest && ui.tab === "table") root.appendChild(requestForm());
  }

  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "render") {
      model = e.data.model;
      if (model.initialTab) {
        ui.tab = model.initialTab;
        keep();
      }
      render();
    }
  });
  vscode.postMessage({ type: "ready" });
})();
