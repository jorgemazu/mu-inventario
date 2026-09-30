(function () {
  const KEY = "mu-gh-token";
  const REPO = "https://api.github.com/repos/jorgemazu/farmboss-inventario";

  function token() {
    return (localStorage.getItem(KEY) || "").trim();
  }

  function pedirClave(aviso) {
    const app = document.getElementById("app");
    app.innerHTML =
      '<header><p class="kicker">MU</p><h1>MU MASTER INVENTARIO</h1></header>' +
      '<section class="pad">' +
      '<p class="sub">Pega una vez la clave de GitHub. Queda solo en este teléfono.</p>' +
      (aviso ? '<p class="warn">' + aviso + '</p>' : '') +
      '<input id="clave" type="password" autocomplete="off" placeholder="Clave">' +
      '<button class="gold" id="entrar" type="button">Entrar</button>' +
      '</section>';
    document.getElementById("entrar").onclick = function () {
      const valor = (document.getElementById("clave").value || "").trim();
      if (!valor) return;
      localStorage.setItem(KEY, valor);
      location.replace(location.pathname);
    };
  }

  if (!token() || /clave=mal/.test(location.search)) {
    if (/clave=mal/.test(location.search)) localStorage.removeItem(KEY);
    pedirClave(/clave=mal/.test(location.search) ? "La clave no sirve." : "");
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
      location.replace(location.pathname + "?clave=mal");
      throw new Error("La clave no sirve");
    }
    if (res.status === 409) throw new Error("Alguien guardó al mismo tiempo. Intenta de nuevo.");
    if (!res.ok) throw new Error("No se pudo leer el inventario (" + res.status + ")");
    if (accept && accept.indexOf("raw") >= 0) return res.text();
    return res.json();
  }

  async function fileText(path) {
    const file = await gh("GET", "/contents/" + path);
    if (file && file.content && file.encoding === "base64") return de64(file.content);
    if (file && file.sha) return String(await gh("GET", "/git/blobs/" + file.sha, null, "application/vnd.github.raw")).replace(/^\uFEFF/, "");
    throw new Error("No se pudo leer " + path);
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
      location.replace(location.pathname + "?clave=mal");
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

  window.Nativo = {
    cargar: function () {
      (async function () {
        const cuentas = JSON.parse(await fileText("cuentas.json"));
        const servers = await gh("GET", "/contents/servidores");
        const libros = {};
        const estados = {};
        for (const item of servers) {
          if (!item || item.type !== "dir" || !item.name) continue;
          libros[item.name] = JSON.parse(await fileText("servidores/" + item.name + "/libro.json"));
          try { estados[item.name] = await fileText("servidores/" + item.name + "/estado.txt"); }
          catch (err) { estados[item.name] = ""; }
        }
        window.__datos({ cuentas: cuentas, libros: libros, estados: estados });
      })().catch(function (err) { window.__error(err.message); });
    },
    guardar: function (text) {
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
    orden: function (servidor, accion, nombre) {
      const srv = String(servidor || "").trim();
      const quien = String(nombre || "").trim();
      const actualizar = accion === "actualizar";
      const activar = accion === "activar";
      let linea = actualizar ? "ACTUALIZAR\n" : ((activar ? "ACTIVAR " : "FOTO ") + quien + "\n");
      let aviso = actualizar ? ("Actualizar enviado: " + srv) : (activar ? ("Activar enviado: " + quien) : (quien.indexOf(",") >= 0 ? "Fotos y conteo enviados" : ("Foto y contar enviado: " + quien)));
      putText("servidores/" + srv + "/orden.txt", linea, linea.trim() + " " + srv)
        .then(function () { window.__apkEstado(aviso); })
        .catch(function (err) { window.__error(err.message); });
    },
    estados: function () {
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
      (async function () {
        const servers = await gh("GET", "/contents/servidores");
        const colas = {};
        for (const item of servers) {
          if (!item || item.type !== "dir" || !item.name) continue;
          try { colas[item.name] = await fileText("servidores/" + item.name + "/cola.txt"); }
          catch (err) { colas[item.name] = ""; }
        }
        window.__cola(colas);
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

  const script = document.createElement("script");
  script.src = "app.js";
  document.body.appendChild(script);
})();
