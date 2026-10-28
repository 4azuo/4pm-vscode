/* global acquireVsCodeApi, document, window */
/*
 * Panel renderer of the 4PM VS Code extension (ADR-0673): draws the view model the extension posts
 * ({ type: "render", model }) with DOM text nodes only — no innerHTML — and posts the user's actions back
 * ({ type: "action", id, value }). No network access (the CSP allows none).
 */
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  /** Create an element with a class and optional text. */
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** Post an action. */
  function act(id, value) {
    vscode.postMessage({ type: "action", id: id, value: value });
  }

  /** Render one section. */
  function section(s, busy) {
    const box = el("section", "section");
    box.appendChild(el("h2", "section__title", s.title));
    let empty = true;
    if (s.fields && s.fields.length) {
      empty = false;
      const dl = el("dl", "fields");
      s.fields.forEach(function (f) {
        dl.appendChild(el("dt", "", f[0]));
        dl.appendChild(el("dd", "", f[1] || "—"));
      });
      box.appendChild(dl);
    }
    if (s.text) {
      empty = false;
      box.appendChild(el("p", "text", s.text));
    }
    if (s.items && s.items.length) {
      empty = false;
      const ul = el("ul", "items");
      s.items.forEach(function (it) {
        const li = el("li", "item");
        const label = it.action ? el("button", "link", it.label) : el("span", "", it.label);
        if (it.action) {
          label.disabled = busy;
          label.addEventListener("click", function () { act(it.action, it.value); });
        }
        li.appendChild(label);
        if (it.detail) li.appendChild(el("span", "item__detail", it.detail));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    if (s.messages && s.messages.length) {
      empty = false;
      s.messages.forEach(function (m) {
        const msg = el("article", "message" + (m.muted ? " message--muted" : ""));
        const head = el("header", "message__head");
        head.appendChild(el("strong", "", m.author));
        head.appendChild(el("span", "message__at", m.at));
        msg.appendChild(head);
        msg.appendChild(el("p", "message__body", m.body));
        box.appendChild(msg);
      });
    }
    if (empty && s.empty) box.appendChild(el("p", "muted", s.empty));
    return box;
  }

  /** Render the whole model. */
  function render(model) {
    root.textContent = "";
    const head = el("header", "head");
    head.appendChild(el("h1", "head__title", model.title));
    if (model.subtitle) head.appendChild(el("p", "head__subtitle", model.subtitle));
    root.appendChild(head);
    (model.notices || []).forEach(function (n) {
      root.appendChild(el("p", "notice notice--" + n.kind, n.text));
    });
    model.sections.forEach(function (s) { root.appendChild(section(s, model.busy)); });
    if (model.form) {
      const form = el("form", "form");
      const label = el("label", "form__label", model.form.label);
      const area = el("textarea", "form__input");
      area.id = "panel-form-input";
      area.rows = 4;
      area.placeholder = model.form.placeholder || "";
      area.disabled = !!model.busy;
      label.htmlFor = area.id;
      const submit = el("button", "btn btn--primary", model.form.submit);
      submit.type = "submit";
      submit.disabled = !!model.busy;
      form.appendChild(label);
      form.appendChild(area);
      form.appendChild(submit);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (area.value.trim()) act(model.form.id, area.value);
      });
      root.appendChild(form);
    }
    if (model.actions.length) {
      const bar = el("div", "actions");
      model.actions.forEach(function (a) {
        const b = el("button", "btn" + (a.kind ? " btn--" + a.kind : ""), a.label);
        b.type = "button";
        b.disabled = !!model.busy || !!a.disabled;
        b.addEventListener("click", function () { act(a.id); });
        bar.appendChild(b);
      });
      root.appendChild(bar);
    }
  }

  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "render") render(e.data.model);
  });
  vscode.postMessage({ type: "ready" });
})();
