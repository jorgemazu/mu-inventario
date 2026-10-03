const MONEDAS = new Set(["ORO", "MUC", "BOUND MUC", "BOUND", "DIAMANTES"]);
const KEY = window.MU_MASTER ? "mu-master-cuenta" : "mu-cuenta";
const state = { cuenta: localStorage.getItem(KEY) || "", archivo: null, personajes: [], aviso: "", pantalla: "lista", detalle: null, edit: null, ocupado: false, apkNueva: false, instalando: false, tab: "", marcados: [], estados: {}, servidores: [], pruebas: {}, lineas: [], nobot: {}, sumar: {}, log5: [] };
try { state.nobot = JSON.parse(localStorage.getItem("mu-nobot") || "{}") || {}; } catch (err) { state.nobot = {}; }
try { state.sumar = JSON.parse(localStorage.getItem("mu-sumar") || "{}") || {}; } catch (err) { state.sumar = {}; }

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fmt(n) { return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(n || 0); }
function fmtHora(n) { const t = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0); return n > 0 ? "+" + t : t; }
function fmtDiario(n) { return n > 0 ? "+" + fmt(n) : fmt(n); }

function stack(v) {
  if (typeof v === "number" && isFinite(v)) return { bolsa: v, baul: 0, total: v };
  if (v && typeof v === "object") {
    const bolsa = Number(v.Bolsa ?? v.bolsa ?? 0) || 0;
    const baul = Number(v.Baul ?? v.baul ?? 0) || 0;
    const total = Number(v.Total ?? v.total ?? bolsa + baul) || 0;
    return { bolsa, baul, total };
  }
  return { bolsa: 0, baul: 0, total: 0 };
}
function pick(datos, names) {
  const keys = Object.keys(datos || {});
  for (const name of names) {
    const hit = keys.find((k) => k.toUpperCase() === name);
    if (hit) return stack(datos[hit]);
  }
  return { bolsa: 0, baul: 0, total: 0 };
}
function itemsOf(datos) {
  const items = [];
  for (const [nombre, value] of Object.entries(datos || {})) {
    if (MONEDAS.has(nombre.toUpperCase())) continue;
    const s = stack(value);
    if (!s.total && !s.bolsa && !s.baul) continue;
    items.push({ nombre, ...s });
  }
  items.sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
  return items;
}
function lecturaDe(nombre, servidor, raw) {
  if (!raw || typeof raw !== "object") return null;
  const fecha = String(raw.Fecha || raw.fecha || "");
  const datos = raw.Datos || raw.datos || {};
  if (!fecha) return null;
  return { nombre, servidor, fecha, muc: pick(datos, ["MUC"]).total, oro: pick(datos, ["ORO"]).total, bound: pick(datos, ["BOUND MUC", "BOUND"]).total, diamantes: pick(datos, ["DIAMANTES"]).total, items: itemsOf(datos) };
}
function mejor(a, b) {
  if (a.fecha !== b.fecha) return a.fecha > b.fecha ? a : b;
  return a.items.length >= b.items.length ? a : b;
}
function whenOf(fecha) {
  const m = String(fecha).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}
function mucRate(lecturas) {
  const serie = lecturas.map((row) => ({ row, when: whenOf(row.fecha) })).filter((row) => row.when !== null && row.row.muc > 0).sort((a, b) => a.when - b.when || a.row.fecha.localeCompare(b.row.fecha));
  if (serie.length < 2) return { hora: 0, diario: 0 };
  let hasta = serie.length - 1;
  if (serie[hasta].row.muc <= serie[hasta - 1].row.muc) hasta -= 1;
  for (let i = hasta; i >= 1; i--) {
    const dm = serie[i].row.muc - serie[i - 1].row.muc;
    if (dm <= 0) continue;
    const hours = (serie[i].when - serie[i - 1].when) / 3600000;
    if (hours < 0.02) continue;
    const hora = dm / hours;
    return { hora: Math.round(hora * 10) / 10, diario: Math.round(hora * 24) };
  }
  return { hora: 0, diario: 0 };
}
const CATALOGO_ITEMS = ["BLESS", "SOUL", "LIFE", "CHAOS", "CREATION", "SD SEED", "COMBO HEART", "CONDOR", "GARUDA", "WING ENHANCE STONE", "HEAVENLY STEEL", "ANGEL SIGNET", "ROSSY SIGNET", "ANILLOS", "AROS", "COLLARES"].concat(
  ...["Fire", "Ice", "Wind", "Water"].map((elem) => Array.from({ length: 12 }, (_, i) => "Fluorite " + elem + " " + (i + 1)))
);
function tieneItems(row) {
  return (row.items || []).some((it) => (it.total || it.bolsa || it.baul) > 0);
}
function lecturasOrdenadas(lecturas) {
  return (lecturas || [])
    .filter((row) => row && row.fecha && !/^LECTURA/i.test(row.fecha))
    .map((row) => ({ row, when: whenOf(row.fecha) }))
    .sort((a, b) => (a.when || 0) - (b.when || 0) || String(a.row.fecha).localeCompare(String(b.row.fecha)));
}
function lecturasVisibles(lecturas) {
  const s = lecturasOrdenadas(lecturas);
  const vivas = s.filter((x) => x.row.muc > 0 || x.row.oro > 0 || tieneItems(x.row));
  const con = vivas.filter((x) => tieneItems(x.row));
  if (con.length) return con;
  if (vivas.length) return vivas;
  return s;
}
function totalItem(row, nombre) {
  const hit = ((row && row.items) || []).find((it) => it.nombre.toUpperCase() === nombre.toUpperCase());
  return hit ? hit.total : 0;
}
function vistaDe(p) {
  const vis = lecturasVisibles(p.lecturas || []);
  const last = vis.length ? vis[vis.length - 1].row : null;
  const mucs = vis.filter((x) => x.when && x.row.muc > 0);
  return {
    nombre: p.nombre,
    fecha: last ? last.fecha : (p.fecha || ""),
    hora: p.hora || 0,
    diario: p.diario || 0,
    muc: mucs.length ? mucs[mucs.length - 1].row.muc : 0,
    oro: last ? last.oro : 0,
    diamantes: last ? last.diamantes : 0,
    bound: last ? last.bound : 0,
    items: (last && last.items) || [],
    item: (nombre) => totalItem(last, nombre)
  };
}
function vistasResultado() {
  return state.personajes.map(vistaDe);
}
function nombresItemResultado(vistas) {
  const rows = CATALOGO_ITEMS.filter((nombre) => vistas.some((v) => v.item(nombre)));
  vistas.forEach((v) => (v.items || []).forEach((it) => {
    if (!it.total || MONEDAS.has(it.nombre.toUpperCase())) return;
    if (rows.some((n) => n.toUpperCase() === it.nombre.toUpperCase())) return;
    rows.push(it.nombre);
  }));
  return rows;
}
function filaDe(row) {
  const lista = Array.isArray(row && row.instancias) ? row.instancias.map((x) => String(x).trim()).filter(Boolean) : [];
  return { nombre: String((row && row.nombre) || "").trim(), actualizar: !!(row && row.actualizar === true), control: !!(row && row.control === true), todas: lista.some((x) => x === "*"), instancias: lista.filter((x) => x !== "*") };
}
function permite(fila, nombre) {
  if (!fila) return false;
  if (fila.todas || window.MU_MASTER) return true;
  return fila.instancias.some((x) => x.toLowerCase() === nombre.toLowerCase());
}
function acceso() {
  const n = state.cuenta;
  const row = state.archivo && state.archivo.cuentas && state.archivo.cuentas[n];
  if (!row) return null;
  return { numero: n, ...filaDe(row) };
}
function versionNueva() {
  const v = state.archivo && state.archivo.versiones;
  const remota = String((v && (window.MU_MASTER ? v.control : v.lector)) || "").trim();
  return remota && remota !== String(window.APP_VERSION);
}
function cuentasLista() {
  return Object.entries((state.archivo && state.archivo.cuentas) || {}).map(([numero, row]) => ({ numero, ...filaDe(row) })).sort((a, b) => Number(a.numero) - Number(b.numero));
}

function procesar(libros) {
  const por = new Map();
  const fila = acceso();
  for (const [servidor, libro] of Object.entries(libros || {})) {
    for (const [nombre, lecturas] of Object.entries(libro || {})) {
      if (!permite(fila, nombre)) continue;
      if (!Array.isArray(lecturas)) continue;
      const lista = por.get(nombre) || [];
      for (const raw of lecturas) {
        const lectura = lecturaDe(nombre, servidor, raw);
        if (!lectura) continue;
        const idx = lista.findIndex((row) => row.fecha === lectura.fecha);
        if (idx >= 0) lista[idx] = mejor(lista[idx], lectura);
        else lista.push(lectura);
      }
      por.set(nombre, lista);
    }
  }
  state.personajes = [...por.entries()].map(([nombre, lecturas]) => {
    const serie = lecturas.filter((row) => whenOf(row.fecha) !== null && row.muc > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const last = serie.length ? serie[serie.length - 1] : lecturas.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1);
    const rate = mucRate(lecturas);
    return { ...(last || { nombre, servidor: "", fecha: "", muc: 0, oro: 0, bound: 0, diamantes: 0, items: [] }), hora: rate.hora, diario: rate.diario, lecturas };
  }).sort((a, b) => b.muc - a.muc || a.nombre.localeCompare(b.nombre));
}

function mucHtml(p, grande) {
  const caja = grande ? "caja" : "mini";
  const hora = p.hora < 0 ? "bad" : "ok";
  const dia = p.diario < 0 ? "bad" : "ok";
  return `<div class="tres ${grande ? "grande" : ""}">
    <div class="${caja}"><p class="lbl">MUC actual</p><p class="num cream">${fmt(p.muc)}</p></div>
    <div class="${caja} mid"><p class="lbl">MUC/hora</p><p class="num ${hora}">${fmtHora(p.hora)}</p></div>
    <div class="${caja} end"><p class="lbl">MUC diario</p><p class="num ${dia}">${fmtDiario(p.diario)}</p></div>
  </div>`;
}
function versionDe(text) {
  const m = String(text || "").match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : "";
}
function etiquetaServidor(nombre) {
  const ver = versionDe(state.estados && state.estados[nombre]);
  return ver ? nombre + " " + ver : nombre;
}
function motorDe(text) {
  const m = String(text || "").match(/MOTOR\s+(ON|OFF)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/i);
  if (!m) return "sin";
  const t = Date.parse(m[2].replace(" ", "T") + "Z");
  if (!isFinite(t) || Date.now() - t > 120000 || t - Date.now() > 30000) return "sin";
  return m[1].toUpperCase() === "ON" ? "on" : "off";
}
function motorInfo(nombre) {
  const modo = motorDe(state.estados && state.estados[nombre]);
  if (modo === "on") return { cls: "on", text: "Motor activo" };
  if (modo === "off") return { cls: "off", text: "Motor detenido" };
  return { cls: "sin", text: "Sin señal" };
}
function filasPrueba() {
  const out = [];
  Object.entries(state.pruebas || {}).forEach(([srv, rows]) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!row) return;
      out.push({
        cuando: row.cuando || "",
        cuenta: row.cuenta || "",
        tipo: row.tipo || "",
        ok: !!row.ok,
        nota: row.nota || "",
        servidor: srv
      });
    });
  });
  out.sort((a, b) => String(b.cuando).localeCompare(String(a.cuando)));
  return out.slice(0, 40);
}
function claveDe(servidor, nombre) { return servidor + "\n" + nombre; }

function totales() {
  return state.personajes.reduce((a, p) => { a.muc += p.muc; a.hora += p.hora; a.diario += p.diario; return a; }, { muc: 0, hora: 0, diario: 0 });
}

function xmlEsc(s) { return esc(s); }
function numCell(value, style, index) {
  if (!value) return "";
  const at = index ? ` ss:Index="${index}"` : "";
  return `<Cell${at} ss:StyleID="${style}"><Data ss:Type="Number">${value}</Data></Cell>`;
}
function sheetName(name, used) {
  let base = String(name).replace(/[\\/*?:\[\]]/g, " ").trim() || "Instancia";
  if (base.length > 31) base = base.slice(0, 31);
  let n = base, i = 2;
  while (used.has(n)) { const suf = " " + (i++); n = base.slice(0, Math.max(1, 31 - suf.length)) + suf; }
  used.add(n);
  return n;
}
function listaXml() {
  const todos = vistasResultado();
  const entra = (nombre) => !state.sumar || state.sumar[nombre] !== false;
  const filaNum = (label, dec, get) => {
    const vals = todos.map(get);
    let sum = 0;
    todos.forEach((p, i) => { if (entra(p.nombre)) sum += Number(vals[i]) || 0; });
    const celda = (n) => {
      const v = dec ? Number(n || 0).toFixed(1) : String(Math.round(Number(n) || 0));
      return `<Cell ss:StyleID="${dec ? "dec" : "num"}"><Data ss:Type="Number">${v}</Data></Cell>`;
    };
    return `<Row><Cell ss:StyleID="item"><Data ss:Type="String">${xmlEsc(label)}</Data></Cell>${vals.map(celda).join("")}<Cell ss:StyleID="${dec ? "totd" : "tot"}"><Data ss:Type="Number">${dec ? sum.toFixed(1) : String(Math.round(sum))}</Data></Cell></Row>`;
  };
  const items = nombresItemResultado(todos);
  const rows = ['<?xml version="1.0" encoding="UTF-8"?>', '<?mso-application progid="Excel.Sheet"?>', '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">', "<Styles>",
    '<Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1F4E79" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:WrapText="1"/></Style>',
    '<Style ss:ID="item"><Font ss:Bold="1"/></Style>',
    '<Style ss:ID="num"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="#,##0"/></Style>',
    '<Style ss:ID="dec"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="#,##0.0"/></Style>',
    '<Style ss:ID="tot"><Font ss:Bold="1"/><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="#,##0"/></Style>',
    '<Style ss:ID="totd"><Font ss:Bold="1"/><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="#,##0.0"/></Style>',
    "</Styles>", '<Worksheet ss:Name="Resultados"><Table>', '<Column ss:Width="140"/>',
    todos.map(() => '<Column ss:Width="120"/>').join(""), '<Column ss:Width="120"/>',
    `<Row ss:Height="32"><Cell ss:StyleID="hdr"><Data ss:Type="String"></Data></Cell>${todos.map((p) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEsc(p.nombre + (p.fecha ? " " + p.fecha : ""))}</Data></Cell>`).join("")}<Cell ss:StyleID="hdr"><Data ss:Type="String">suma</Data></Cell></Row>`,
    filaNum("muc hora", true, (p) => p.hora),
    filaNum("muc diario", false, (p) => p.diario),
    filaNum("muc", false, (p) => p.muc),
    filaNum("oro", false, (p) => p.oro),
    filaNum("diamantes", false, (p) => p.diamantes),
    filaNum("bound muc", false, (p) => p.bound)];
  items.forEach((nombre) => rows.push(filaNum(nombre, false, (p) => p.item(nombre))));
  rows.push("</Table></Worksheet></Workbook>");
  return rows.join("\n");
}

function bannerApk() {
  if (!state.apkNueva) return "";
  return `<p class="aviso">Hay una actualización de la app.</p><button class="gold" id="instalarApk" type="button">${state.instalando ? "Descargando..." : "Actualizar"}</button>`;
}

function titulo() { return window.MU_MASTER ? "MU MASTER INVENTARIO" : "MU INVENTARIO"; }

function logHtml() {
  const lines = (state.log5 || []).slice(-5);
  while (lines.length < 5) lines.push("");
  return `<div class="log5" id="log5">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
}

function botonesComunes() {
  const acc = acceso();
  return `${bannerApk()}
    ${versionNueva() ? '<p class="aviso">Hay una versión nueva.</p>' : ""}
    ${logHtml()}
    ${mucHtml(totales(), true)}
    <button class="line" id="resBtn">Resultados</button>
    <button class="line" id="listaBtn">Generar excel</button>
    <button class="gold" id="upd">${state.ocupado ? "Leyendo..." : "Actualizar"}</button>
    <button class="line" id="cambiar">Cambiar cuenta</button>
    ${state.aviso ? `<p class="warn">${esc(state.aviso)}</p>` : ""}
    <p class="sub">Cuenta ${esc(state.cuenta)}${acc && acc.nombre ? " · " + esc(acc.nombre) : ""}</p>`;
}

function render() {
  const app = document.getElementById("app");
  if (!state.cuenta) {
    app.innerHTML = `<main><p class="kicker">MU</p><h1>${esc(titulo())}</h1><p class="sub">Ingresa el numero de cuenta</p>
      ${bannerApk()}
      <form id="login"><input id="num" inputmode="numeric" maxlength="12" placeholder="Ejemplo: 1" /><button class="gold" type="submit">Entrar</button></form></main>`;
    app.querySelector("#login").onsubmit = (e) => {
      e.preventDefault();
      const n = app.querySelector("#num").value.replace(/\D/g, "").slice(0, 12);
      if (!n) return;
      state.cuenta = n;
      localStorage.setItem(KEY, n);
      state.pantalla = "lista";
      cargar();
    };
    return;
  }
  if (!state.archivo) {
    app.innerHTML = `<main><p class="kicker">MU</p><h1>${esc(titulo())}</h1>${bannerApk()}<p class="sub">${esc(state.aviso || "Leyendo...")}</p></main>`;
    return;
  }
  const acc = acceso();
  if (!acc) {
    app.innerHTML = `<main>${bannerApk()}<p class="warn">Esa cuenta no existe</p><button class="line" id="cambiar">Cambiar cuenta</button></main>`;
    app.querySelector("#cambiar").onclick = cambiar;
    return;
  }
  if (window.MU_MASTER && !acc.control) {
    app.innerHTML = `<main>${bannerApk()}<p class="warn">Esta cuenta no abre MU MASTER INVENTARIO</p><button class="line" id="cambiar">Cambiar cuenta</button></main>`;
    app.querySelector("#cambiar").onclick = cambiar;
    return;
  }
  if (state.pantalla === "detalle" && state.detalle) {
    const p = state.personajes.find((x) => x.nombre === state.detalle);
    if (!p) { state.pantalla = "lista"; render(); return; }
    const fila = (nombre, bolsa, baul, total) => `<tr><td>${esc(nombre)}</td><td class="n">${fmt(bolsa)}</td><td class="n">${fmt(baul)}</td><td class="n cream">${fmt(total)}</td></tr>`;
    const rows = fila("ORO", p.oro, 0, p.oro) + fila("DIAMANTES", p.diamantes, 0, p.diamantes) + p.items.map((it) => fila(it.nombre, it.bolsa, it.baul, it.total)).join("");
    app.innerHTML = `<header>${bannerApk()}<button class="back" id="volver">‹ Volver</button><h1>${esc(p.nombre)}</h1><p class="sub">${esc(p.servidor)} · ${esc(p.fecha)}</p>${mucHtml(p, true)}</header>
      <section class="pad"><p class="kicker">ÍTEMS</p><table><tr><th>Ítem</th><th class="n">Bolsa</th><th class="n">Baúl</th><th class="n">Total</th></tr>${rows}</table></section>`;
    app.querySelector("#volver").onclick = () => { state.pantalla = "lista"; state.detalle = null; render(); };
    return;
  }
  if (window.MU_MASTER && state.pantalla === "editor" && state.edit) {
    const e = state.edit;
    const checks = e.todas ? "" : state.personajes.map((p) => {
      const on = e.elegidas.some((x) => x.toLowerCase() === p.nombre.toLowerCase());
      return `<button class="pick ${on ? "on" : ""}" data-n="${esc(p.nombre)}">${on ? "Sí · " : ""}${esc(p.nombre)}</button>`;
    }).join("");
    app.innerHTML = `<main>
      ${bannerApk()}
      <button class="back" id="volver">‹ Volver</button>
      <p class="kicker">NÚMERO DE CUENTA</p>
      <input id="num" inputmode="numeric" maxlength="12" value="${esc(e.numero)}" />
      <p class="sub">Hasta 12 dígitos. Mientras más largo, más difícil de adivinar. Ese número se escribe en MU INVENTARIO.</p>
      <label class="sub">Nombre<input id="nom" value="${esc(e.nombre)}" /></label>
      <button class="line ${e.actualizar ? "on" : ""}" id="act">${e.actualizar ? "Puede actualizar" : "No actualiza el programa"}</button>
      <button class="line ${e.control ? "on" : ""}" id="ctl">${e.control ? "También abre Master" : "Solo el lector"}</button>
      <button class="line ${e.todas ? "on" : ""}" id="todas">${e.todas ? "Ve todas las instancias" : "Elegir instancias"}</button>
      <div class="picks">${checks}</div>
      <button class="gold" id="save">Guardar</button>
      <button class="danger" id="del">Borrar cuenta</button>
      ${state.aviso ? `<p class="warn">${esc(state.aviso)}</p>` : ""}
    </main>`;
    app.querySelector("#volver").onclick = () => { state.pantalla = "lista"; state.edit = null; render(); };
    app.querySelector("#num").oninput = (ev) => {
      const limpio = ev.target.value.replace(/\D/g, "").slice(0, 12);
      e.numero = limpio;
      ev.target.value = limpio;
    };
    app.querySelector("#nom").oninput = (ev) => { e.nombre = ev.target.value.slice(0, 40); };
    app.querySelector("#act").onclick = () => { e.actualizar = !e.actualizar; render(); };
    app.querySelector("#ctl").onclick = () => { e.control = !e.control; render(); };
    app.querySelector("#todas").onclick = () => { e.todas = !e.todas; render(); };
    app.querySelectorAll(".pick").forEach((btn) => btn.onclick = () => {
      const nombre = btn.getAttribute("data-n");
      const tiene = e.elegidas.some((x) => x.toLowerCase() === nombre.toLowerCase());
      e.todas = false;
      e.elegidas = tiene ? e.elegidas.filter((x) => x.toLowerCase() !== nombre.toLowerCase()) : [...e.elegidas, nombre];
      render();
    });
    app.querySelector("#save").onclick = () => guardarEdit();
    app.querySelector("#del").onclick = () => borrarEdit();
    return;
  }

  if (state.pantalla === "resultados") {
    const cols = vistasResultado();
    const entra = (p) => state.sumar[p.nombre] !== false;
    const filas = [
      ["muc hora", (p) => fmtHora(p.hora), (p) => p.hora],
      ["muc diario", (p) => fmtDiario(p.diario), (p) => p.diario],
      ["muc", (p) => fmt(p.muc), (p) => p.muc],
      ["oro", (p) => fmt(p.oro), (p) => p.oro],
      ["diamantes", (p) => fmt(p.diamantes), (p) => p.diamantes],
      ["bound muc", (p) => fmt(p.bound), (p) => p.bound]
    ];
    nombresItemResultado(cols).forEach((nombre) => {
      filas.push([nombre, (p) => fmt(p.item(nombre)), (p) => p.item(nombre)]);
    });
    const head = `<tr><th></th>${cols.map((p) => {
      const on = entra(p);
      return `<th class="${on ? "" : "off"}"><label><input class="chksum" type="checkbox" data-sumar="${esc(p.nombre)}" ${on ? "checked" : ""}/>${esc(p.nombre)}<span class="fecha">${esc(p.fecha || "")}</span></label></th>`;
    }).join("")}<th>suma</th></tr>`;
    const body = filas.map(([lab, texto, num]) => {
      let sum = 0;
      const tds = cols.map((p) => {
        const n = Number(num(p)) || 0;
        if (entra(p)) sum += n;
        return `<td class="n ${entra(p) ? "" : "off"}">${texto(p)}</td>`;
      }).join("");
      const stxt = lab === "muc hora" ? fmtHora(sum) : (lab === "muc diario" ? fmtDiario(sum) : fmt(Math.round(sum)));
      return `<tr><td>${esc(lab)}</td>${tds}<td class="n cream">${stxt}</td></tr>`;
    }).join("");
    app.innerHTML = `<header>${bannerApk()}<button class="back" id="volver">‹ Volver</button><h1>Resultados</h1><p class="sub">Mismo criterio que FarmBoss: el último conteo que trajo ítems. El checkbox saca o pone al personaje en la suma.</p></header>
      <section class="pad"><div class="tabla-wrap"><table class="tabla-res">${head}${body}</table></div></section>`;
    app.querySelector("#volver").onclick = () => { state.pantalla = "lista"; render(); };
    app.querySelectorAll("[data-sumar]").forEach((box) => box.onchange = () => {
      state.sumar[box.getAttribute("data-sumar")] = box.checked;
      try { localStorage.setItem("mu-sumar", JSON.stringify(state.sumar)); } catch (err) {}
      render();
    });
    return;
  }

  const servidores = state.servidores.length ? state.servidores : [...new Set(state.personajes.map((p) => p.servidor).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const cards = state.personajes.map((p) => {
    const hit = `<button class="hit" type="button" data-n="${esc(p.nombre)}"><div class="name"><strong>${esc(p.nombre)}</strong><span>${esc(p.servidor)}</span></div>${mucHtml(p, false)}<p class="fecha">${esc(p.fecha)}</p></button>`;
    const on = !!state.nobot[p.nombre];
    const nobot = `<label class="nobot"><input type="checkbox" data-nobot="${esc(p.nombre)}" ${on ? "checked" : ""}/>NO BOT items</label>`;
    const foto = `<button class="line mini" type="button" data-foto="${esc(p.nombre)}" data-srv="${esc(p.servidor)}">Contar</button>`;
    const items = `<button class="line mini" type="button" data-items="${esc(p.nombre)}" data-srv="${esc(p.servidor)}">Contar items y muc</button>`;
    return `<div class="card">${hit}${nobot}<div class="acts">${foto}${items}</div></div>`;
  }).join("");
  let servidoresHtml = "";
  if (window.MU_MASTER) {
    const tabs = ["prueba"].concat(servidores);
    if (!tabs.includes(state.tab)) state.tab = servidores[0] || "prueba";
    const tabBtns = `<button class="line ${state.tab === "prueba" ? "on" : ""}" type="button" data-tab="prueba">Prueba</button>` +
      servidores.map((s) => `<button class="line ${s === state.tab ? "on" : ""}" type="button" data-tab="${esc(s)}">${esc(etiquetaServidor(s))}</button>`).join("");
    let cuerpo = "";
    if (state.tab === "prueba") {
      const rows = filasPrueba().map((r) => {
        const titulo = r.tipo === "cuenta" ? "Cuenta de prueba" : "Fotos de prueba";
        return `<div class="card"><div class="name"><strong>${esc(r.cuenta || "sin cuenta")}</strong><span class="${r.ok ? "ok" : "bad"}">${r.ok ? "ok" : "fallo"}</span></div><p class="fecha">${esc(titulo)} · ${esc(r.servidor)} · ${esc(r.cuando)}</p><p class="sub">${esc(r.nota)}</p></div>`;
      }).join("");
      cuerpo = `<div class="list">${rows || '<p class="sub">Todavía no hay pruebas.</p>'}</div><p class="sub">No entra al inventario. Solo dice si las fotos y el conteo de prueba salieron bien.</p>`;
    } else if (!servidores.length) {
      cuerpo = `<p class="sub">Ningún servidor acoplado. En FarmBoss aprieta Acoplar.</p>`;
    } else {
      const delTab = state.personajes.filter((p) => p.servidor === state.tab);
      const motor = motorInfo(state.tab);
      const checks = delTab.map((p) => {
        const on = state.marcados.includes(claveDe(p.servidor, p.nombre));
        return `<button class="pick ${on ? "on" : ""}" type="button" data-check="${esc(p.nombre)}" data-srv="${esc(p.servidor)}"><span class="box ${on ? "on" : ""}"></span>${esc(p.nombre)}</button>`;
      }).join("");
      const n = state.marcados.length;
      cuerpo = `<p class="motor ${motor.cls}" data-motor="1">${motor.text}</p>
        <button class="line" id="actsrv" type="button">Actualizar servidor</button>
        <div class="picks">${checks || '<p class="sub">Este servidor no tiene personajes en el inventario.</p>'}</div>
        <button class="gold" id="sacar" type="button">${n ? "Contar (" + n + ")" : "Contar"}</button>
        <p class="sub">Los marcados de todas las pestañas. Primero las fotos, después el conteo.</p>
        ${window.ES_PAGINA ? '<p class="sub">Contar puede demorar hasta 20 segundos en accionar.</p>' : ""}`;
    }
    servidoresHtml = `<section class="pad"><h2>SERVIDORES</h2><div class="tabs">${tabBtns}</div>${cuerpo}</section>`;
  }
  const cuentas = window.MU_MASTER ? `<section class="pad"><div class="row"><h2>CUENTAS</h2><button class="text" id="nueva">Nueva cuenta</button></div>
    ${cuentasLista().map((row) => `<button class="card cuenta" data-c="${esc(row.numero)}"><div class="name"><strong>${esc(row.numero)}</strong><span>${esc(row.nombre || "Sin nombre")}</span></div><p class="fecha">${row.todas ? "Ve todas las instancias" : (row.instancias.join(", ") || "No ve ninguna instancia")}${row.actualizar ? " · puede actualizar" : ""}${row.control ? " · control" : ""}</p></button>`).join("")}
    </section>` : "";
  const notaContar = window.ES_PAGINA ? `<p class="sub">Contar puede demorar hasta 20 segundos en accionar.</p>` : "";
  const personajes = `<section class="pad"><h2>PERSONAJES</h2><div class="list">${cards || '<p class="sub">Todavía no hay personajes en el inventario.</p>'}</div>${notaContar}</section>`;
  app.innerHTML = `<header><p class="kicker">MU</p><h1>${esc(titulo())}</h1>${botonesComunes()}</header>${window.MU_MASTER ? personajes + servidoresHtml + cuentas : `<div class="pad list">${cards || '<p class="sub">No hay instancias para esta cuenta.</p>'}</div>${notaContar}`}`;
  const listaBtn = app.querySelector("#listaBtn");
  if (listaBtn) listaBtn.onclick = () => { if (window.Nativo) window.Nativo.compartir("resultados.xls", listaXml()); };
  const resBtn = app.querySelector("#resBtn");
  if (resBtn) resBtn.onclick = () => { state.pantalla = "resultados"; render(); };
  const upd = app.querySelector("#upd");
  if (upd) upd.onclick = actualizar;
  const ch = app.querySelector("#cambiar");
  if (ch) ch.onclick = cambiar;
  app.querySelectorAll("[data-n]").forEach((btn) => btn.onclick = () => { state.detalle = btn.getAttribute("data-n"); state.pantalla = "detalle"; render(); });
  app.querySelectorAll("[data-tab]").forEach((btn) => btn.onclick = () => { state.tab = btn.getAttribute("data-tab"); render(); });
  app.querySelectorAll("[data-check]").forEach((btn) => btn.onclick = () => {
    const clave = claveDe(btn.getAttribute("data-srv") || "", btn.getAttribute("data-check") || "");
    state.marcados = state.marcados.includes(clave) ? state.marcados.filter((item) => item !== clave) : state.marcados.concat([clave]);
    render();
  });
  const sacar = app.querySelector("#sacar");
  if (sacar) sacar.onclick = () => {
    const grupos = {};
    state.marcados.forEach((clave) => {
      const corte = clave.indexOf("\n");
      if (corte < 1) return;
      const servidor = clave.slice(0, corte);
      const nombre = clave.slice(corte + 1);
      if (!state.personajes.some((p) => p.servidor === servidor && p.nombre === nombre)) return;
      (grupos[servidor] || (grupos[servidor] = [])).push(nombre);
    });
    const claves = Object.keys(grupos);
    if (!claves.length) { state.aviso = "Marca al menos un personaje"; render(); return; }
    if (!window.Nativo || !window.Nativo.orden) { state.aviso = "Actualiza la app para enviar la orden"; render(); return; }
    claves.forEach((servidor) => window.Nativo.orden(servidor, "foto", grupos[servidor].join(","), "0"));
  };
  const actsrv = app.querySelector("#actsrv");
  if (actsrv) actsrv.onclick = () => {
    if (!state.tab) return;
    if (!window.Nativo || !window.Nativo.orden) { state.aviso = "Actualiza la app para enviar la orden"; render(); return; }
    window.Nativo.orden(state.tab, "actualizar", "-", "0");
  };
  app.querySelectorAll("[data-foto],[data-items]").forEach((btn) => btn.onclick = () => {
    const items = btn.hasAttribute("data-items");
    const nombre = btn.getAttribute(items ? "data-items" : "data-foto");
    const servidor = btn.getAttribute("data-srv") || "";
    if (!servidor) { state.aviso = "Ese personaje no tiene servidor"; render(); return; }
    if (!window.Nativo || !window.Nativo.orden) { state.aviso = "Actualiza la app para enviar la orden"; render(); return; }
    state.aviso = "Enviando...";
    render();
    window.Nativo.orden(servidor, items ? "items" : "foto", nombre, items && state.nobot[nombre] ? "1" : "0");
  });
  app.querySelectorAll("[data-nobot]").forEach((box) => box.onchange = () => {
    state.nobot[box.getAttribute("data-nobot")] = box.checked;
    try { localStorage.setItem("mu-nobot", JSON.stringify(state.nobot)); } catch (err) {}
  });
  app.querySelectorAll("[data-c]").forEach((btn) => btn.onclick = () => abrirCuenta(btn.getAttribute("data-c")));
  const nueva = app.querySelector("#nueva");
  if (nueva) nueva.onclick = nuevaCuenta;
}

function cambiar() {
  localStorage.removeItem(KEY);
  state.cuenta = "";
  state.archivo = null;
  state.personajes = [];
  state.aviso = "";
  state.pantalla = "lista";
  state.edit = null;
  render();
}
function actualizar() {
  const acc = acceso();
  if (!window.MU_MASTER && acc && !acc.actualizar) {
    state.aviso = "Esta cuenta no actualiza el programa. Sí se actualizó lo que puede ver.";
    cargar();
    return;
  }
  location.reload();
}
function cargar() {
  state.aviso = state.aviso || "";
  state.ocupado = true;
  render();
  if (window.Nativo) window.Nativo.cargar();
  else { state.aviso = "Esta pantalla no está dentro de la app"; state.ocupado = false; render(); }
}
window.__datos = function (pack) {
  state.ocupado = false;
  state.archivo = pack.cuentas || {};
  const acc = acceso();
  if (!acc) { state.aviso = "Esa cuenta no existe"; render(); return; }
  if (window.MU_MASTER && !acc.control) { state.aviso = "Esta cuenta no abre MU MASTER INVENTARIO"; render(); return; }
  procesar(pack.libros || {});
  state.servidores = Object.keys(pack.libros || {}).sort((a, b) => a.localeCompare(b));
  state.estados = pack.estados || {};
  state.pruebas = pack.pruebas || {};
  state.aviso = "";
  render();
};
window.__error = function (msg) {
  state.ocupado = false;
  state.aviso = msg || "No se pudo leer el inventario";
  render();
};
window.__guardado = function () {
  state.ocupado = false;
  state.aviso = "Guardado";
  state.pantalla = "lista";
  state.edit = null;
  cargar();
};
window.__atras = function () {
  if (state.pantalla === "detalle" || state.pantalla === "editor") {
    state.pantalla = "lista";
    state.detalle = null;
    state.edit = null;
    render();
    return;
  }
  if (window.Nativo) window.Nativo.salir();
};

function abrirCuenta(numero) {
  const row = cuentasLista().find((x) => x.numero === numero);
  if (!row) return;
  state.edit = { anterior: row.numero, numero: row.numero, nombre: row.nombre, actualizar: row.actualizar, control: row.control, todas: row.todas, elegidas: row.instancias.slice() };
  state.pantalla = "editor";
  state.aviso = "";
  render();
}
function nuevaCuenta() {
  const nums = cuentasLista().map((x) => Number(x.numero)).filter((n) => Number.isFinite(n));
  const numero = String((nums.length ? Math.max(...nums) : 0) + 1);
  state.archivo.cuentas[numero] = { nombre: "", actualizar: false, control: false, instancias: [] };
  state.edit = { anterior: numero, numero, nombre: "", actualizar: false, control: false, todas: false, elegidas: [] };
  state.pantalla = "editor";
  state.aviso = "Número nuevo: " + numero;
  render();
}
function archivoDesdeEdit() {
  const e = state.edit;
  const nuevo = String(e.numero || "").replace(/\D/g, "").slice(0, 12);
  const anterior = e.anterior || nuevo;
  if (!/^\d{1,12}$/.test(nuevo)) throw new Error("El número debe tener de 1 a 12 dígitos");
  const cuentas = { ...(state.archivo.cuentas || {}) };
  if (nuevo !== anterior && cuentas[nuevo]) throw new Error("Ese número ya existe");
  const otras = Object.entries(cuentas).filter(([n, row]) => n !== anterior && row && row.control === true);
  if (!e.control && otras.length === 0) throw new Error("Tiene que quedar una cuenta con control");
  if (nuevo !== anterior) delete cuentas[anterior];
  cuentas[nuevo] = { nombre: e.nombre.trim(), actualizar: e.actualizar, control: e.control, instancias: e.todas ? ["*"] : e.elegidas.slice() };
  if (anterior === state.cuenta) {
    state.cuenta = nuevo;
    localStorage.setItem(KEY, nuevo);
  }
  return JSON.stringify({ ...state.archivo, cuentas }, null, 2) + "\n";
}
function guardarEdit() {
  try {
    const text = archivoDesdeEdit();
    state.ocupado = true;
    state.aviso = "Guardando...";
    render();
    window.Nativo.guardar(text);
  } catch (err) {
    state.aviso = err.message;
    render();
  }
}
function borrarEdit() {
  const e = state.edit;
  const clave = e.anterior || e.numero;
  if (clave === state.cuenta) { state.aviso = "No puedes borrar la cuenta con la que entraste"; render(); return; }
  const cuentas = { ...(state.archivo.cuentas || {}) };
  if (cuentas[clave] && cuentas[clave].control === true) {
    const otras = Object.entries(cuentas).filter(([n, row]) => n !== clave && row && row.control === true);
    if (!otras.length) { state.aviso = "Tiene que quedar una cuenta con control"; render(); return; }
  }
  delete cuentas[clave];
  state.ocupado = true;
  window.Nativo.guardar(JSON.stringify({ ...state.archivo, cuentas }, null, 2) + "\n");
}

window.__estados = function (obj) {
  state.estados = obj || {};
  const el = document.querySelector("[data-motor]");
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    const nombre = btn.getAttribute("data-tab") || "";
    btn.textContent = etiquetaServidor(nombre);
  });
  if (!el) return;
  const motor = motorInfo(state.tab);
  el.className = "motor " + motor.cls;
  el.textContent = motor.text;
};
window.__apk = function (remota) {
  state.apkNueva = Number(remota) > Number(window.APP_CODE || 0);
  render();
};
window.__apkEstado = function (msg) {
  state.instalando = false;
  state.aviso = msg || "";
  render();
};
document.getElementById("app").addEventListener("click", (e) => {
  const t = e.target;
  if (!t || t.id !== "instalarApk" || state.instalando) return;
  state.instalando = true;
  render();
  if (window.Nativo) window.Nativo.instalar();
});

render();
if (window.Nativo) window.Nativo.revisar();
if (state.cuenta) cargar();
setInterval(() => {
  if (window.MU_MASTER && state.cuenta && state.pantalla === "lista" && window.Nativo && window.Nativo.estados) window.Nativo.estados();
}, 20000);
function origenLocal() {
  const marcado = String(window.MU_ORIGEN || "").toUpperCase();
  if (marcado === "LECTOR" || marcado === "MASTER" || marcado === "PAGINA") return marcado;
  return window.MU_MASTER ? "MASTER" : "LECTOR";
}
function textoDeResultado(kind, name) {
  if (kind === "OK") return "Conteo exitoso: " + name;
  if (kind === "REINTENTO") return name + ": fallo, lo va a reintentar";
  if (kind === "COLA") return name + ": fallo, va a cola, lo va a reintentar";
  if (kind === "FALLO3") return name + ": fallo por tercera vez intentar mas tarde";
  if (kind === "BOLSA") return "Falló el conteo de " + name + ": bolsa cerrada";
  return "volver a intentar foto fallida: " + name;
}
function avisoDeRespuesta(map) {
  const yo = origenLocal();
  const lines = [];
  Object.keys(map || {}).forEach((srv) => {
    String(map[srv] || "").split(/\r?\n/).forEach((raw) => {
      const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (LECTOR|MASTER|PAGINA) (OK|BOLSA|FOTO|REINTENTO|COLA|FALLO3) (.+)$/);
      if (!m || m[2] !== yo) return;
      lines.push({ t: m[1], kind: m[3], name: m[4] });
    });
  });
  lines.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (!lines.length) return "";
  const visto = localStorage.getItem("mu-resp-visto") || "";
  const recientes = (lista) => {
    const ultima = lista[lista.length - 1];
    const t = Date.parse(ultima.t.replace(" ", "T"));
    if (!(t && Math.abs(Date.now() - t) < 6 * 3600 * 1000)) return [];
    return lista.filter((line) => line.t === ultima.t);
  };
  const nuevas = visto ? lines.filter((line) => line.t > visto) : recientes(lines);
  if (!nuevas.length) {
    if (!visto) localStorage.setItem("mu-resp-visto", lines[lines.length - 1].t);
    return state.avisoRespuesta || "";
  }
  localStorage.setItem("mu-resp-visto", nuevas[nuevas.length - 1].t);
  return nuevas.map((line) => textoDeResultado(line.kind, line.name)).join(" · ");
}
window.__respuesta = function (obj) {
  const texto = avisoDeRespuesta(obj);
  if (!texto || texto === state.avisoRespuesta) return;
  state.avisoRespuesta = texto;
  state.aviso = texto;
  const el = document.querySelector(".warn");
  if (el) el.textContent = texto;
  else render();
};
function lineasDeCola(map) {
  const pasos = [];
  const colas = [];
  Object.keys(map || {}).forEach((srv) => {
    String(map[srv] || "").split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line || line === "LIBRE") return;
      let m = line.match(/^PASO\s+(.+)$/i);
      if (m) { pasos.push(m[1]); return; }
      m = line.match(/^COLA\s+(\d+)\s+(.+)$/i);
      if (m) colas.push("conteo " + m[2].replace(/^ITEMS\s+/i, "") + " en cola posicion " + m[1]);
    });
  });
  return pasos.concat(colas).slice(-5);
}
window.__cola = function (obj) {
  const lineas = lineasDeCola(obj);
  const antes = JSON.stringify(state.log5 || []);
  if (JSON.stringify(lineas) === antes) return;
  state.log5 = lineas;
  const el = document.querySelector("#log5");
  if (el) {
    const show = lineas.slice();
    while (show.length < 5) show.push("");
    el.innerHTML = show.map((l) => `<p>${esc(l)}</p>`).join("");
    return;
  }
  if (state.cuenta && (state.pantalla === "lista" || state.pantalla === "resultados")) render();
};
setInterval(() => {
  if (state.cuenta && window.Nativo && window.Nativo.cola) window.Nativo.cola();
}, 8000);
