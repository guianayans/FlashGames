// Painel admin (modelo Notchly). Regra: dados do servidor entram só via textContent.
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- API ----------

const CSRF_HEADER = "x-flashgames-admin";

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Erro ${status}`);
    this.status = status;
    this.code = body?.error;
  }
}

async function api(method, path, body) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: "same-origin",
    headers: { [CSRF_HEADER]: "1", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/")) {
    showLogin();
    throw new ApiError(401, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------- Formatação ----------

// datas chegam em epoch (segundos, número ou texto só com dígitos) ou texto ISO
const toDate = (t) =>
  t === null || t === undefined || t === "" ? null : new Date(typeof t === "number" || /^\d+$/.test(t) ? Number(t) * 1000 : t);
const fmtDate = (t) => toDate(t)?.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) ?? "—";
const fmtDateTime = (t) => toDate(t)?.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) ?? "—";
const fmtMoney = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

const ACTION = {
  codigo_enviado: "Código de login enviado",
  codigo_errado: "Código de login errado",
  login: "Login",
};
const actionLabel = (a) => ACTION[a] ?? a;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const badge = ([label, tone]) => h("span", { class: tone ? `badge ${tone}` : "badge" }, label);

/** Valor de uma coluna, conforme o tipo declarado em panel.js. */
function cell(col, row) {
  const v = row[col.field];
  switch (col.type) {
    case "date":
      return fmtDate(v);
    case "datetime":
      return fmtDateTime(v);
    case "money":
      return fmtMoney(v);
    case "number":
      return v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR");
    case "bool":
      return v ? "Sim" : "Não";
    case "badge": {
      const m = col.map?.[v];
      return m ? badge(m) : v === null || v === undefined ? "—" : badge([String(v), ""]);
    }
    default:
      return v === null || v === undefined || v === "" ? "—" : String(v);
  }
}

function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = isError ? "show error" : "show";
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = ""), 3200);
}

// ---------- Login ----------

const loginForm = $("#login-code");

function showLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $$("dialog[open]").forEach((d) => d.close());
  $("[data-error]", loginForm).textContent = "";
  loginForm.code.value = "";
  loginForm.code.focus();
}

$("[data-send]", loginForm).addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const err = $("[data-error]", loginForm);
  err.textContent = "";
  btn.disabled = true;
  try {
    await api("POST", "/auth/login");
    $("[data-hint]", loginForm).textContent = "Código enviado. Confira o e-mail do administrador.";
    loginForm.code.focus();
    // evita cliques repetidos enquanto o e-mail chega
    setTimeout(() => (btn.disabled = false), 30_000);
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("[data-error]", loginForm);
  err.textContent = "";
  try {
    await api("POST", "/auth/verify", { code: loginForm.code.value });
    await start();
  } catch (ex) {
    err.textContent = ex.message;
    loginForm.code.select();
  }
});

$("[data-logout]").addEventListener("click", async () => {
  await api("POST", "/auth/logout").catch(() => {});
  showLogin();
});

// ---------- Abas ----------

const loaders = {
  overview: loadOverview,
  audit: loadAudit,
};

// indicador que desliza até a aba ativa, dentro do notch das abas
function moveIndicator() {
  const on = $('[data-tab][aria-selected="true"]');
  const ind = $(".tab-ind");
  if (!on || !ind) return;
  ind.style.width = `${on.offsetWidth}px`;
  ind.style.transform = `translateX(${on.offsetLeft}px)`;
}
addEventListener("resize", moveIndicator);

function openTab(name, push = false) {
  if (!loaders[name]) name = "overview";
  // a aba fica no endereço (#audit): atualizar a página volta nela; clicar cria uma entrada
  // no histórico, para o voltar/avançar do navegador trocar de aba
  if (location.hash.slice(1) !== name) history[push ? "pushState" : "replaceState"](null, "", `#${name}`);
  $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  moveIndicator();
  loaders[name]().catch((ex) => toast(ex.message, true));
}

function bindTabs() {
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab, true)));
}
addEventListener("popstate", () => !$("#app").hidden && openTab(location.hash.slice(1)));

// ---------- Visão geral ----------

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
function countUp(el, end, money) {
  const show = (v) => (el.textContent = money ? fmtMoney(v) : Math.round(v).toLocaleString("pt-BR"));
  if (still || !end) return show(end);
  const t0 = performance.now();
  const dur = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    show(end * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function loadOverview() {
  const { tiles } = await api("GET", "/stats");
  // números contam até o valor ao abrir a aba
  $("#tiles").replaceChildren(
    ...tiles.map(({ label, value, sub, money }) => {
      const big = h("p", { class: "big" }, money ? fmtMoney(0) : "0");
      if (typeof value === "number") countUp(big, value, money);
      else big.textContent = value ?? "—";
      return h("article", { class: "tile" }, h("p", { class: "muted" }, label), big, sub && h("p", { class: "muted small" }, sub));
    }),
  );
}

// ---------- Abas de dados (panel.js) ----------

let schema = null;
const state = {}; // por aba: { offset }

function buildResourceTabs() {
  const anchor = $('[data-tab="audit"]');
  for (const r of schema.resources) {
    if ($(`[data-tab="${r.name}"]`)) continue;
    anchor.before(h("button", { role: "tab", "data-tab": r.name }, r.label));

    const panel = $("#resource-panel").content.firstElementChild.cloneNode(true);
    panel.dataset.panel = r.name;
    const f = $("[data-filters]", panel);
    f.q.placeholder = r.placeholder ?? "Buscar";
    f.q.hidden = !r.placeholder;
    f.filter.replaceChildren(h("option", { value: "" }, "Todos"), ...r.filters.map((x) => h("option", { value: x.value }, x.label)));
    f.filter.hidden = !r.filters.length;
    const add = $("[data-new]", f);
    add.textContent = `${r.feminine ? "Nova" : "Novo"} ${r.singular}`;
    add.hidden = !r.create;
    add.addEventListener("click", () => openCreate(r));
    $("thead tr", panel).replaceChildren(...r.columns.map((c) => h("th", {}, c.label ?? c.field)));

    let timer;
    f.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadResource(r, true).catch((ex) => toast(ex.message, true)), 250);
    });
    f.addEventListener("submit", (e) => e.preventDefault());
    $("[data-more]", panel).addEventListener("click", () => loadResource(r, false).catch((ex) => toast(ex.message, true)));

    $('[data-panel="audit"]').before(panel);
    loaders[r.name] = () => loadResource(r, true);
    state[r.name] = { offset: 0 };
  }
}

async function loadResource(r, reset = false) {
  const st = state[r.name];
  if (reset) st.offset = 0;
  const panel = $(`[data-panel="${r.name}"]`);
  const f = $("[data-filters]", panel);
  const params = new URLSearchParams({ q: f.q.value, filter: f.filter.value, offset: st.offset });
  const data = await api("GET", `/r/${r.name}?${params}`);
  const rows = data.rows.map((row) =>
    h(
      "tr",
      {
        class: "clickable",
        tabindex: "0",
        onclick: () => openDetail(r, row.__id),
        onkeydown: (e) => e.key === "Enter" && openDetail(r, row.__id),
      },
      ...r.columns.map((c, i) =>
        h(
          "td",
          { class: c.type === "date" || c.type === "datetime" ? "muted" : null },
          h("div", {}, cell(c, row)),
          c.sub && row[c.sub] && h("div", { class: "muted small" }, String(row[c.sub])),
          i === 0 && row.__badges?.length ? h("div", { class: "badges" }, row.__badges.map(badge)) : null,
        ),
      ),
    ),
  );
  const tbody = $("tbody", panel);
  if (reset) tbody.replaceChildren(...rows);
  else tbody.append(...rows);
  if (reset && !rows.length) {
    tbody.replaceChildren(h("tr", {}, h("td", { colspan: String(r.columns.length), class: "muted empty" }, "Nada encontrado.")));
  }
  st.offset += data.rows.length;
  $("[data-count]", panel).textContent = `${Math.min(st.offset, data.total)} de ${data.total}`;
  $("[data-more]", panel).hidden = st.offset >= data.total;
}

// ---------- Campos de formulário (edição e criação) ----------

function toDateInput(t) {
  const d = toDate(t);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateInput(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, 23, 59, 59).getTime() / 1000);
}

function fieldInput(f, value) {
  const el = fieldControl(f, value);
  if (f.when) el.dataset.when = JSON.stringify(f.when);
  return el;
}

/** Mostra só os campos cujo "when: [campo, valor]" bate com o formulário. */
function syncWhen(form) {
  for (const el of form.querySelectorAll("[data-when]")) {
    const [field, value] = JSON.parse(el.dataset.when);
    const ctl = form.elements[field];
    el.hidden = ctl ? String(ctl.value) !== String(value) : false;
  }
}

function fieldControl(f, value) {
  const label = f.label ?? f.field;
  const attrs = { name: f.field, required: f.required || null };
  switch (f.type) {
    case "select":
      return h("label", {}, label, h("select", attrs, f.options.map(([v, l]) => h("option", { value: String(v), selected: String(v) === String(value) || null }, l))));
    case "bool":
      return h("label", { class: "check field-wide" }, h("input", { ...attrs, type: "checkbox", checked: Boolean(value) || null }), label);
    case "textarea":
      return h("label", { class: "field-wide" }, label, Object.assign(h("textarea", { ...attrs, maxlength: f.maxLength ?? null }), { value: value ?? "" }));
    case "date":
      return h("label", {}, label, h("input", { ...attrs, type: "date", value: toDateInput(value) }));
    case "number":
      return h("label", {}, label, h("input", { ...attrs, type: "number", min: f.min ?? null, max: f.max ?? null, step: f.step ?? "any", value: value ?? "" }));
    default:
      return h("label", {}, label, h("input", { ...attrs, type: f.type === "email" ? "email" : "text", maxlength: f.maxLength ?? null, value: value ?? "" }));
  }
}

function readField(form, f) {
  const el = form.elements[f.field];
  if (f.type === "bool") return el.checked ? 1 : 0;
  if (f.type === "date") return fromDateInput(el.value);
  if (f.type === "number") return el.value === "" ? null : Number(el.value);
  const v = el.value.trim();
  return v === "" ? null : f.type === "email" ? v.toLowerCase() : v;
}

// ---------- Detalhe ----------

let current = null; // { r, data }
const detail = $("#detail");
const fd = (name) => $(`[data-f="${name}"]`, detail);

function renderDetail(r, data) {
  current = { r, data };
  const row = data.row;
  fd("title").textContent = row[r.title] ?? `${r.singular} ${data.id}`;
  const sub = r.copy ? row[r.copy] : r.subtitle ? row[r.subtitle] : null;
  fd("subtitle").textContent = [r.subtitle && r.copy ? row[r.subtitle] : null, sub].filter(Boolean).join(" · ");
  $("[data-copy]", detail).hidden = !r.copy;
  fd("badges").replaceChildren(...data.badges.filter(Boolean).map(badge));

  const form = $("#edit");
  form.hidden = !r.fields.length;
  form.replaceChildren(...r.fields.map((f) => fieldInput(f, row[f.field])), $(".row-end", form));
  syncWhen(form);

  fd("actions").replaceChildren(
    ...data.actions.map((a) => h("button", { class: a.tone ? `btn ${a.tone}` : "btn", onclick: () => runAction(a) }, a.label)),
    r.remove && h("button", { class: "btn danger", onclick: removeCurrent }, `Excluir ${r.singular}`),
  );
  fd("actions-title").hidden = !fd("actions").children.length;

  fd("related").replaceChildren(
    ...data.related.flatMap((rel) => [
      h("h3", {}, rel.label, " ", h("span", { class: "muted" }, `(${rel.items.length})`)),
      h(
        "ul",
        { class: "list" },
        rel.items.length
          ? rel.items.map((it) =>
              h(
                "li",
                { class: "rel" },
                h("div", {}, h("b", {}, it.primary ?? "—"), it.secondary && h("div", { class: "muted small" }, it.secondary)),
                h(
                  "div",
                  { class: "rel-side" },
                  h("span", { class: "muted small" }, it.meta ?? ""),
                  it.action && h("button", { class: "btn small", onclick: () => runAction(it.action, { value: it.action.value }) }, it.action.label),
                ),
              ),
            )
          : [h("li", { class: "muted" }, rel.empty)],
      ),
    ]),
  );

  fd("history").replaceChildren(
    ...(data.history.length
      ? data.history.map((a) => h("li", {}, h("span", { class: "muted" }, fmtDateTime(a.at)), h("span", {}, actionLabel(a.action)), h("span", { class: "muted" }, a.actor)))
      : [h("li", { class: "muted" }, "Sem alterações pelo painel.")]),
  );
  $("[data-error]", detail).textContent = "";
}

async function openDetail(r, id) {
  try {
    renderDetail(r, await api("GET", `/r/${r.name}/${encodeURIComponent(id)}`));
    if (!detail.open) detail.showModal();
  } catch (ex) {
    toast(ex.message, true);
  }
}

async function refreshAfter(promise, msg) {
  try {
    const res = await promise;
    toast(res?.message || msg);
    await openDetail(current.r, current.data.id);
    loadResource(current.r, true).catch(() => {});
  } catch (ex) {
    $("[data-error]", detail).textContent = ex.message;
    toast(ex.message, true);
  }
}

$("#edit").addEventListener("change", (e) => syncWhen(e.currentTarget));
$("#create-form").addEventListener("change", (e) => syncWhen(e.currentTarget));

$("#edit").addEventListener("submit", (e) => {
  e.preventDefault();
  const { r, data } = current;
  const body = {};
  for (const f of r.fields) {
    // campo escondido pelo "when" não vai junto
    if (e.currentTarget.elements[f.field].closest("[data-when]")?.hidden) continue;
    const v = readField(e.currentTarget, f);
    const old = data.row[f.field] ?? null;
    const same = f.type === "date" ? toDateInput(v) === toDateInput(old) : f.type === "bool" ? Boolean(v) === Boolean(old) : v === old;
    if (!same) body[f.field] = v;
  }
  if (!Object.keys(body).length) return toast("Nada para salvar.");
  refreshAfter(api("PATCH", `/r/${r.name}/${encodeURIComponent(data.id)}`, body), "Alterações salvas.");
});

function runAction(a, preset) {
  if (a.confirm && !confirm(a.confirm)) return;
  let body = preset;
  if (a.input) {
    const v = prompt(a.input);
    if (v === null) return;
    body = { value: v };
  }
  const { r, data } = current;
  refreshAfter(api("POST", `/r/${r.name}/${encodeURIComponent(data.id)}/${a.name}`, body), `${a.label}: feito.`);
}

async function removeCurrent() {
  const { r, data } = current;
  const expected = String(data.row[r.remove.confirm] ?? data.id);
  const typed = prompt(`Excluir de vez este ${r.singular}. Não dá para desfazer.\n\nDigite para confirmar:\n${expected}`);
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== expected.toLowerCase()) return toast("Não confere; nada foi excluído.", true);
  try {
    await api("DELETE", `/r/${r.name}/${encodeURIComponent(data.id)}`);
    detail.close();
    toast(`${cap(r.singular)} ${r.feminine ? "excluída" : "excluído"}.`);
    loadResource(r, true);
  } catch (ex) {
    toast(ex.message, true);
  }
}

$("[data-copy]", detail).addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(String(current.data.row[current.r.copy]));
    toast("Copiado.");
  } catch {
    toast("Não foi possível copiar.", true);
  }
});

$$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

// ---------- Novo registro ----------

let creating = null;

function openCreate(r) {
  creating = r;
  const form = $("#create-form");
  $('[data-f="create-title"]', form).textContent = `${r.feminine ? "Nova" : "Novo"} ${r.singular}`;
  $('[data-f="create-fields"]', form).replaceChildren(...r.create.map((f) => fieldInput(f, f.type === "bool" ? f.default ?? 0 : f.default ?? null)));
  syncWhen(form);
  $("[data-error]", form).textContent = "";
  $("#create").showModal();
}

$("#create-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const form = e.currentTarget;
  const r = creating;
  const body = Object.fromEntries(r.create.map((f) => [f.field, readField(form, f)]));
  try {
    const { id } = await api("POST", `/r/${r.name}`, body);
    $("#create").close();
    toast(`${cap(r.singular)} ${r.feminine ? "criada" : "criado"}.`);
    loadResource(r, true);
    if (id !== undefined && id !== null) openDetail(r, id);
  } catch (ex) {
    $("[data-error]", form).textContent = ex.message;
  }
});

// ---------- Auditoria ----------

async function loadAudit() {
  const { entries } = await api("GET", "/audit");
  $("#audit-rows").replaceChildren(
    ...(entries.length
      ? entries.map((a) =>
          h(
            "tr",
            {},
            h("td", { class: "muted" }, fmtDateTime(a.at)),
            h("td", {}, a.actor),
            h("td", {}, actionLabel(a.action)),
            h("td", {}, a.target || "—"),
            h("td", { class: "muted small mono" }, a.detail || ""),
            h("td", { class: "muted small" }, a.ip || ""),
          ),
        )
      : [h("tr", {}, h("td", { colspan: "6", class: "muted empty" }, "Nada registrado ainda."))]),
  );
}

// ---------- Início ----------

async function start() {
  await api("GET", "/me");
  if (!schema) {
    schema = await api("GET", "/schema");
    Object.assign(ACTION, schema.actions);
    buildResourceTabs();
    bindTabs();
    $("[data-links]").replaceChildren(
      ...schema.links.map((l) => h("a", { class: "btn small ghost", href: l.href, target: "_blank", rel: "noopener" }, l.label)),
    );
  }
  $("#login").hidden = true;
  $("#app").hidden = false;
  openTab(location.hash.slice(1) || "overview");
  // a fonte muda a largura das abas: reposiciona o indicador quando ela carregar
  document.fonts?.ready.then(moveIndicator);
}

start().catch(() => showLogin());
