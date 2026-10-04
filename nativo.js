(function () {
  const KEY = "mu-gh-token";
  const PAGE = "mu-pagina";
  const REPO = "https://api.github.com/repos/jorgemazu/farmboss-inventario";

  const hash = (location.hash || "").replace(/^#/, "").trim();
  if (/^(ghp_|github_pat_|gho_)/.test(hash)) {
    localStorage.setItem(KEY, hash);
    location.replace(location.pathname);
    return;
  }
  if (/^[0-9a-f]{64}$/i.test(hash)) {
    localStorage.setItem(PAGE, hash.toLowerCase());
    location.replace(location.pathname);
    return;
  }

  function token() {
    return (localStorage.getItem(KEY) || "").trim();
  }

  function pageKey() {
    return (localStorage.getItem(PAGE) || "").trim();
  }

  if (!token() && !pageKey()) {
    document.getElementById("app").innerHTML =
      '<header><p class="kicker">FARMBOSS</p><h1>FarmBoss Inventario WEB</h1></header>' +
      '<section class="pad"><p class="sub">Este enlace no está completo.</p></section>';
    return;
  }

  function a64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function de64(text) {
    const bin = atob(String(text).replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  }

  async function gh(method, path, body, accept) {
    const res = await fetch(REPO + path, {
      method: method,
      headers: {
        Authorization: "Bearer " + token(),
        Accept: accept || "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
      localStorage.removeItem(KEY);
      location.replace(location.pathname);
      throw new Error("La clave no sirve");
    }
    if (res.status === 409) throw new Error("Alguien guardó al mismo tiempo. Intenta de nuevo.");
    if (!res.ok) throw new Error("No se pudo leer el inventario (" + res.status + ")");
    if (accept && accept.indexOf("raw") >= 0) return res.text();
    return res.json();
  }

  async function rawText(path) {
    const res = await fetch("https://raw.githubusercontent.com/jorgemazu/farmboss-inventario/main/" + path, {
      headers: {
        Authorization: "Bearer " + token(),
        Accept: "application/vnd.github.raw",
        "User-Agent": "inventario-lectura"
      }
    });
    if (!res.ok) throw new Error("No se pudo leer el inventario (" + res.status + ")");
    return (await res.text()).replace(/^\uFEFF/, "");
  }

  async function fileText(path) {
    let file = null;
    try {
      file = await gh("GET", "/contents/" + path);
    } catch (err) {
      return rawText(path);
    }
    if (file && file.content && file.encoding === "base64") return de64(file.content);
    if (file && file.download_url) {
      try {
        const bajada = await fetch(file.download_url, { headers: { Authorization: "Bearer " + token(), "User-Agent": "inventario-lectura" } });
        if (bajada.ok) return (await bajada.text()).replace(/^\uFEFF/, "");
      } catch (err) {}
    }
    if (file && file.sha) {
      try {
        return String(await gh("GET", "/git/blobs/" + file.sha, null, "application/vnd.github.raw")).replace(/^\uFEFF/, "");
      } catch (err) {}
    }
    return rawText(path);
  }

  async function putText(path, text, message) {
    let sha = "";
    let previo = "";
    const res = await fetch(REPO + "/contents/" + path, {
      headers: {
        Authorization: "Bearer " + token(),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (res.status === 401) {
      localStorage.removeItem(KEY);
      location.replace(location.pathname);
      throw new Error("La clave no sirve");
    }
    if (res.status === 200) {
      const file = await res.json();
      sha = file.sha || "";
      if (file.content && file.encoding === "base64") previo = de64(file.content);
    } else if (res.status !== 404) {
      throw new Error("No se pudo leer la orden (" + res.status + ")");
    }
    const limpio = previo.trim();
    if (limpio && !/^(OK|DONE|PROCESADO)/i.test(limpio)) {
      throw new Error("FarmBoss todavía no tomó la orden anterior");
    }
    const body = { message: message, content: a64(text) };
    if (sha) body.sha = sha;
    await gh("PUT", "/contents/" + path, body);
  }

  function hexBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function b64bytes(text) {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function raiz() {
    const p = location.pathname;
    const i = p.indexOf("/lector/");
    if (i >= 0) return p.slice(0, i + 1);
    return p.replace(/[^/]*$/, "");
  }

  async function leerPublico(force) {
    if (window.__publico && (!force || (Date.now() - (window.__publicoAt || 0) < 20000))) return window.__publico;
    const clave = pageKey();
    if (!clave) throw new Error("Este enlace no está completo");
    const res = await fetch(raiz() + "datos.enc?v=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo leer el inventario (" + res.status + ")");
    const pack = await res.json();
    const rawKey = await crypto.subtle.importKey("raw", hexBytes(clave), "AES-GCM", false, ["decrypt"]);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64bytes(pack.iv) }, rawKey, b64bytes(pack.ct));
    } catch (err) {
      throw new Error("Este enlace no está completo");
    }
    window.__publico = JSON.parse(new TextDecoder().decode(plain));
    window.__publicoAt = Date.now();
    return window.__publico;
  }

  const SERVIDORES = ["servidor1", "servidor2"];

  async function farmText(nombre, path, llave) {
    const res = await fetch("https://" + nombre + ".farmboss.stream" + path, {
      cache: "no-store",
      headers: { Authorization: "Bearer " + llave }
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  }

  function fechaLectura(row) {
    return String((row && (row.Fecha || row.fecha)) || "");
  }

  async function leerVivo(datos) {
    const llave = String((datos && datos.llave) || "");
    if (!llave) return datos;
    const vivos = [];
    for (let i = 0; i < SERVIDORES.length; i++) {
      const nombre = SERVIDORES[i];
      try {
        const maestro = JSON.parse(await farmText(nombre, "/v1/maestro", llave));
        let estado = "";
        let cola = "";
        let respuesta = "";
        let prueba = [];
        try { estado = await farmText(nombre, "/v1/estado", llave); } catch (err) {}
        try { cola = await farmText(nombre, "/v1/cola", llave); } catch (err) {}
        try { respuesta = await farmText(nombre, "/v1/respuesta", llave); } catch (err) {}
        try { prueba = JSON.parse(await farmText(nombre, "/v1/prueba", llave)); } catch (err) {}
        vivos.push({ nombre: nombre, maestro: maestro, estado: estado, cola: cola, respuesta: respuesta, prueba: prueba });
      } catch (err) {}
    }
    if (!vivos.length) return datos;
    const vistos = {};
    vivos.forEach(function (vivo) {
      const mandos = (vivo.maestro && vivo.maestro.mandos) || {};
      const lecturas = (vivo.maestro && vivo.maestro.lecturas) || {};
      Object.keys(lecturas).forEach(function (nombre) {
        const filas = lecturas[nombre];
        if (!Array.isArray(filas)) return;
        const srv = String(mandos[nombre] || vivo.nombre);
        const prev = vistos[nombre];
        const ultima = filas.length ? fechaLectura(filas[filas.length - 1]) : "";
        const anterior = prev && prev.filas.length ? fechaLectura(prev.filas[prev.filas.length - 1]) : "";
        if (prev && anterior > ultima) return;
        vistos[nombre] = { srv: srv, filas: filas };
      });
    });
    const libros = {};
    Object.keys(vistos).forEach(function (nombre) {
      const item = vistos[nombre];
      if (!libros[item.srv]) libros[item.srv] = {};
      libros[item.srv][nombre] = item.filas;
    });
    const estados = {};
    const colas = {};
    const pruebas = {};
    const respuestas = {};
    vivos.forEach(function (vivo) {
      estados[vivo.nombre] = vivo.estado;
      colas[vivo.nombre] = vivo.cola;
      pruebas[vivo.nombre] = vivo.prueba;
      respuestas[vivo.nombre] = vivo.respuesta;
    });
    return Object.assign({}, datos, { libros: libros, estados: estados, colas: colas, pruebas: pruebas, respuestas: respuestas });
  }

  async function enviarOrdenPublica(srv, quien, aviso, verbo, marca) {
    const datos = await leerPublico();
    const llave = String((datos && datos.llave) || "");
    const host = String(srv || "").trim().toLowerCase();
    if (llave && /^[a-z0-9_-]{1,40}$/.test(host)) {
      const linea = verbo + " " + quien + " @PAGINA" + marca + "\n";
      const res = await fetch("https://" + host + ".farmboss.stream/v1/orden", {
        method: "POST",
        headers: { Authorization: "Bearer " + llave, "Content-Type": "text/plain; charset=utf-8" },
        body: linea
      });
      if (!res.ok) throw new Error("No se pudo enviar la orden");
      window.__apkEstado(aviso);
      return;
    }
    const topic = String((datos && datos.buzon) || "").trim();
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(topic)) throw new Error("Todavía no se puede enviar desde la página");
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(srv)) throw new Error("Servidor no válido");
    const res = await fetch("https://ntfy.sh/" + topic, {
      method: "POST",
      body: srv + "|" + verbo + " " + quien + " @PAGINA" + marca,
      headers: { Priority: "min", Title: "orden" }
    });
    if (!res.ok) throw new Error("No se pudo enviar la orden");
    window.__apkEstado(aviso);
  }

  async function leerRespuestasPublicas(topic) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(String(topic || ""))) return;
    const since = localStorage.getItem("mu-ntfy-since") || "30m";
    const res = await fetch("https://ntfy.sh/" + topic + "/json?poll=1&since=" + encodeURIComponent(since), { cache: "no-store" });
    if (!res.ok) return;
    const text = await res.text();
    let max = 0;
    const lines = [];
    text.split(/\n/).forEach(function (row) {
      if (!row) return;
      let msg = null;
      try { msg = JSON.parse(row); } catch (err) { return; }
      if (!msg || msg.event !== "message" || !msg.message) return;
      if (/^\d{4}-\d{2}-\d{2} /.test(msg.message)) lines.push(msg.message);
      if (msg.time && msg.time > max) max = msg.time;
    });
    if (max) localStorage.setItem("mu-ntfy-since", String(max));
    if (lines.length && window.__respuesta) window.__respuesta({ pagina: lines.join("\n") });
  }

  window.Nativo = {
    cargar: function () {
      (async function () {
        if (!token()) {
          const datos = await leerVivo(await leerPublico());
          window.__datos({ cuentas: datos.cuentas, libros: datos.libros, estados: datos.estados || {}, pruebas: datos.pruebas || {} });
          return;
        }
        const cuentas = JSON.parse(await fileText("cuentas.json"));
        const servers = await gh("GET", "/contents/servidores");
        const libros = {};
        const estados = {};
        const pruebas = {};
        for (const item of servers) {
          if (!item || item.type !== "dir" || !item.name) continue;
          try { libros[item.name] = JSON.parse(await fileText("servidores/" + item.name + "/libro.json")); }
          catch (err) { libros[item.name] = {}; }
          try { estados[item.name] = await fileText("servidores/" + item.name + "/estado.txt"); }
          catch (err) { estados[item.name] = ""; }
          try { pruebas[item.name] = JSON.parse(await fileText("servidores/" + item.name + "/prueba.json")); }
          catch (err) { pruebas[item.name] = []; }
        }
        window.__datos({ cuentas: cuentas, libros: libros, estados: estados, pruebas: pruebas });
      })().catch(function (err) { window.__error(err.message); });
    },
    guardar: function (text) {
      if (!token()) { window.__error("Desde este enlace solo se ve el inventario"); return; }
      (async function () {
        const file = await gh("GET", "/contents/cuentas.json");
        await gh("PUT", "/contents/cuentas.json", {
          message: "Cuentas desde la página",
          content: a64(text),
          sha: file.sha
        });
        window.__guardado();
      })().catch(function (err) { window.__error(err.message); });
    },
    orden: function (servidor, accion, nombre, nobot) {
      const srv = String(servidor || "").trim();
      const quien = String(nombre || "").trim();
      const actualizar = accion === "actualizar";
      const activar = accion === "activar";
      const items = accion === "items";
      const verbo = items ? "ITEMS" : "FOTO";
      const marca = nobot === "1" || nobot === true || nobot === "si" ? " NOBOT" : "";
      let aviso = actualizar ? ("Actualizar enviado: " + srv) : (activar ? ("Activar enviado: " + quien) : (items ? ("Items y MUC enviado: " + quien) : (quien.indexOf(",") >= 0 ? "Fotos y conteo enviados" : ("Foto y contar enviado: " + quien))));
      if (!token()) {
        if (actualizar || activar) { window.__error("Desde este enlace solo se ve el inventario"); return; }
        enviarOrdenPublica(srv, quien, aviso, verbo, marca).catch(function (err) { window.__error(err.message); });
        return;
      }
      let linea = actualizar ? "ACTUALIZAR\n" : (activar ? ("ACTIVAR " + quien + "\n") : (verbo + " " + quien + " @PAGINA" + marca + "\n"));
      putText("servidores/" + srv + "/orden.txt", linea, linea.trim() + " " + srv)
        .then(function () { window.__apkEstado(aviso); })
        .catch(function (err) { window.__error(err.message); });
    },
    estados: function () {
      if (!token()) {
        leerPublico().then(leerVivo).then(function (datos) { window.__estados(datos.estados || {}); }).catch(function () {});
        return;
      }
      (async function () {
        const servers = await gh("GET", "/contents/servidores");
        const estados = {};
        for (const item of servers) {
          if (!item || item.type !== "dir" || !item.name) continue;
          try { estados[item.name] = await fileText("servidores/" + item.name + "/estado.txt"); }
          catch (err) { estados[item.name] = ""; }
        }
        window.__estados(estados);
      })().catch(function () {});
    },
    cola: function () {
      if (!token()) {
        leerPublico(true).then(leerVivo).then(function (datos) {
          window.__cola(datos.colas || {});
          if (datos.respuestas && window.__respuesta) window.__respuesta(datos.respuestas);
          return leerRespuestasPublicas(datos && datos.buzon);
        }).catch(function () {});
        return;
      }
      (async function () {
        const servers = await gh("GET", "/contents/servidores");
        const colas = {};
        const respuestas = {};
        for (const item of servers) {
          if (!item || item.type !== "dir" || !item.name) continue;
          try { colas[item.name] = await fileText("servidores/" + item.name + "/cola.txt"); }
          catch (err) { colas[item.name] = ""; }
          try { respuestas[item.name] = await fileText("servidores/" + item.name + "/respuesta.txt"); }
          catch (err) { respuestas[item.name] = ""; }
        }
        window.__cola(colas);
        if (window.__respuesta) window.__respuesta(respuestas);
      })().catch(function () {});
    },
    compartir: function (nombre, contenido) {
      const blob = new Blob([contenido], { type: "application/vnd.ms-excel" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = nombre || "inventario-maestro.xls";
      link.click();
    },
    revisar: function () { window.__apk(0); },
    instalar: function () { window.__apkEstado("Desde el navegador no se instala la app"); },
    salir: function () {}
  };

  window.MU_ORIGEN = "PAGINA";
  const script = document.createElement("script");
  script.src = new URL("app.js?v=127", document.currentScript.src).href;
  document.body.appendChild(script);
})();
