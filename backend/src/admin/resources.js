// Motor genérico das abas de dados (o equivalente à aba "Licenças" do Notchly, para qualquer tabela).
// Cada recurso é descrito em panel.js; identificadores vêm só de lá (código), nunca da requisição.

import { LIKE_CI, all, get, now, run } from "./db.js";
import { HttpError, fail } from "./http.js";

const PAGE = 50;
// nunca vão para o navegador, nem no detalhe
const SECRET = /pass|hash|secret|token|salt|otp|code/i;
const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

export function makeResources(panel, audit) {
  const defs = panel.resources ?? {};

  const def = (name) => {
    if (!Object.hasOwn(defs, name)) fail(404, "recurso_nao_encontrado", "Aba não encontrada.");
    return { name, ...defs[name] };
  };
  const target = (r, id) => `${r.name}:${id}`;
  const hiddenField = (r, f) => SECRET.test(f) || (r.hidden ?? []).includes(f);
  const clean = (r, row) => Object.fromEntries(Object.entries(row).filter(([k]) => !hiddenField(r, k)));

  async function findRow(r, id) {
    const row = await get(`SELECT * FROM ${q(r.table)} WHERE ${q(r.key ?? "id")} = ?`, [id]);
    if (!row) fail(404, "nao_encontrado", `${cap(r.singular ?? "registro")} não encontrado.`);
    return row;
  }

  // ---------- Esquema que o painel usa para desenhar as abas ----------

  function schema() {
    return Object.entries(defs).map(([name, r]) => ({
      name,
      label: r.label,
      singular: r.singular ?? "registro",
      // palavra feminina ("licença"): "Nova licença", "Licença editada"
      feminine: Boolean(r.feminine),
      title: r.title,
      subtitle: r.subtitle ?? null,
      copy: r.copy ?? null,
      placeholder: r.search?.length ? `Buscar por ${r.searchLabel ?? r.search.join(", ")}` : null,
      filters: (r.filters ?? []).map(({ value, label }) => ({ value, label })),
      columns: r.columns,
      fields: r.fields ?? [],
      create: r.create ? r.create.fields ?? r.fields : null,
      remove: r.remove === false ? null : { confirm: r.remove?.confirm ?? r.title },
    }));
  }

  // ---------- Lista ----------

  async function list(name, url) {
    const r = def(name);
    const where = [];
    const params = [];
    const term = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (term && r.search?.length) {
      where.push(`(${r.search.map((f) => `CAST(${q(f)} AS TEXT) ${LIKE_CI} ?`).join(" OR ")})`);
      params.push(...r.search.map(() => `%${term}%`));
    }
    const filter = url.searchParams.get("filter");
    if (filter) {
      const f = (r.filters ?? []).find((x) => x.value === filter);
      if (!f) fail(400, "filtro_invalido", "Filtro inválido.");
      where.push(`(${typeof f.where === "function" ? f.where(now()) : f.where})`);
    }
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const [{ n }] = await all(`SELECT COUNT(*) AS n FROM ${q(r.table)} ${sqlWhere}`, params);
    const rows = await all(
      `SELECT * FROM ${q(r.table)} ${sqlWhere} ORDER BY ${r.order ?? `${q(r.key ?? "id")} DESC`} LIMIT ${PAGE} OFFSET ${offset}`,
      params,
    );
    const shown = new Set([r.key ?? "id", ...r.columns.flatMap((c) => [c.field, c.sub].filter(Boolean))]);
    return {
      total: Number(n),
      rows: await Promise.all(
        rows.map(async (row) => {
          const out = Object.fromEntries([...shown].filter((k) => !hiddenField(r, k)).map((k) => [k, row[k] ?? null]));
          out.__id = row[r.key ?? "id"];
          out.__badges = r.listBadges ? await r.listBadges(row) : [];
          return out;
        }),
      ),
    };
  }

  // ---------- Detalhe ----------

  async function detail(name, id) {
    const r = def(name);
    const row = await findRow(r, id);
    const ctx = { row, all, get, run, now };
    const related = [];
    for (const rel of r.related ?? []) related.push({ label: rel.label, empty: rel.empty ?? "Nada por aqui.", items: await rel.load(ctx) });
    return {
      row: clean(r, row),
      id: row[r.key ?? "id"],
      badges: r.badges ? await r.badges(row) : [],
      actions: (r.actions ?? [])
        // hidden: ação usada só pelos botões das listas relacionadas
        .filter((a) => !a.hidden && (!a.show || a.show(row)))
        .map(({ name: n, label, tone, confirm, input }) => ({ name: n, label, tone: tone ?? null, confirm: confirm ?? null, input: input ?? null })),
      related,
      history: await all("SELECT at, actor, action FROM admin_audit WHERE target = ? ORDER BY id DESC LIMIT 50", [target(r, row[r.key ?? "id"])]),
    };
  }

  // ---------- Escrita ----------

  function coerce(f, raw) {
    const label = f.label ?? f.field;
    if (raw === undefined) return undefined;
    if (raw === null || raw === "") {
      if (f.required) fail(400, "campo_obrigatorio", `${label}: obrigatório.`);
      return null;
    }
    switch (f.type ?? "text") {
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
          fail(400, "numero_invalido", `${label}: número inválido.`);
        }
        return n;
      }
      case "bool":
        return raw === true || raw === 1 || raw === "1" || raw === "true" ? 1 : 0;
      case "select":
        if (!f.options.some(([v]) => String(v) === String(raw))) fail(400, "opcao_invalida", `${label}: opção inválida.`);
        return f.options.find(([v]) => String(v) === String(raw))[0];
      case "date": {
        // epoch em segundos (como no Notchly); o painel manda o fim do dia escolhido
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) fail(400, "data_invalida", `${label}: data inválida.`);
        return n;
      }
      case "email": {
        const s = String(raw).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 200) fail(400, "email_invalido", `${label}: e-mail inválido.`);
        return s;
      }
      default: {
        const s = String(raw).trim();
        if (s.length > (f.maxLength ?? 2000)) fail(400, "texto_longo", `${label}: texto longo demais.`);
        return s;
      }
    }
  }

  function pick(fields, body) {
    const out = {};
    for (const f of fields) {
      const v = coerce(f, body[f.field]);
      if (v !== undefined) out[f.field] = v;
    }
    return out;
  }

  async function update(req, actor, name, id, body) {
    const r = def(name);
    const before = await findRow(r, id);
    const changes = pick(r.fields ?? [], body);
    for (const k of Object.keys(changes)) if (changes[k] === before[k]) delete changes[k];
    if (!Object.keys(changes).length) return { ok: true, changed: [] };
    try {
      if (r.update) await r.update({ row: before, changes, actor, all, get, run, now });
      else {
        const sets = Object.keys(changes).map((k) => `${q(k)} = ?`);
        const vals = Object.values(changes);
        if (r.updatedAt) {
          sets.push(`${q(r.updatedAt)} = ?`);
          vals.push(now());
        }
        await run(`UPDATE ${q(r.table)} SET ${sets.join(", ")} WHERE ${q(r.key ?? "id")} = ?`, [...vals, id]);
      }
    } catch (err) {
      throw uniqueError(err);
    }
    const diff = Object.fromEntries(Object.keys(changes).map((k) => [k, hiddenField(r, k) ? "(oculto)" : { de: before[k], para: changes[k] }]));
    await audit(req, actor, `${r.name}_editado`, target(r, id), diff);
    return { ok: true, changed: Object.keys(changes) };
  }

  async function create(req, actor, name, body) {
    const r = def(name);
    if (!r.create) fail(405, "sem_criacao", "Esta aba não cria registros.");
    const values = pick(r.create.fields ?? r.fields, body);
    for (const f of r.create.fields ?? r.fields) {
      if (f.required && (values[f.field] === undefined || values[f.field] === null)) fail(400, "campo_obrigatorio", `${f.label ?? f.field}: obrigatório.`);
    }
    let id;
    try {
      if (r.create.run) id = await r.create.run({ values, body, actor, all, get, run, now });
      else {
        const cols = Object.keys(values);
        const info = await run(
          `INSERT INTO ${q(r.table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          Object.values(values),
        );
        id = info.lastInsertRowid !== undefined ? Number(info.lastInsertRowid) : info.id;
      }
    } catch (err) {
      throw uniqueError(err);
    }
    await audit(req, actor, `${r.name}_criado`, target(r, id));
    return { id };
  }

  async function remove(req, actor, name, id) {
    const r = def(name);
    if (r.remove === false) fail(405, "sem_exclusao", "Esta aba não exclui registros.");
    const row = await findRow(r, id);
    if (r.remove?.run) await r.remove.run({ row, actor, all, get, run, now });
    else await run(`DELETE FROM ${q(r.table)} WHERE ${q(r.key ?? "id")} = ?`, [id]);
    await audit(req, actor, `${r.name}_excluido`, target(r, id), r.title ? { [r.title]: row[r.title] } : null);
    return { deleted: true };
  }

  async function action(req, actor, name, id, actionName, body) {
    const r = def(name);
    const a = (r.actions ?? []).find((x) => x.name === actionName);
    if (!a) fail(404, "acao_nao_encontrada", "Ação não encontrada.");
    const row = await findRow(r, id);
    if (a.show && !a.show(row)) fail(409, "acao_indisponivel", "Ação indisponível para este registro.");
    const result = (await a.run({ row, body, actor, all, get, run, now })) ?? {};
    await audit(req, actor, `${r.name}_${a.name}`, target(r, id), result.audit ?? null);
    return { ok: true, message: result.message ?? null };
  }

  // rótulos da auditoria gerados a partir de panel.js
  function actionLabels() {
    const out = {};
    for (const [name, r] of Object.entries(defs)) {
      const s = cap(r.singular ?? name);
      const o = r.feminine ? "a" : "o";
      out[`${name}_criado`] = `${s} criad${o}`;
      out[`${name}_editado`] = `${s} editad${o}`;
      out[`${name}_excluido`] = `${s} excluíd${o}`;
      for (const a of r.actions ?? []) out[`${name}_${a.name}`] = a.audit ?? `${s}: ${a.label.toLowerCase()}`;
    }
    return out;
  }

  return { schema, list, detail, update, create, remove, action, actionLabels };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function uniqueError(err) {
  if (err instanceof HttpError) return err;
  if (/unique|duplicate/i.test(String(err?.message))) return new HttpError(409, "duplicado", "Já existe um registro com esse valor.");
  return err;
}
