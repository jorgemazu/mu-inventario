const https = require("https");
const crypto = require("crypto");
const fs = require("fs");

const pageKey = process.env.PAGE_KEY || "";
const githubToken = process.env.FARM_TOKEN || "";
if (!/^[0-9a-f]{64}$/i.test(pageKey) || !githubToken) {
  console.error("faltan datos");
  process.exit(1);
}

let apiKey = "";
const SERVIDORES = ["servidor1", "servidor2"];

function githubFile(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/repos/jorgemazu/farmboss-inventario/contents/" + path,
        headers: {
          Authorization: "Bearer " + githubToken,
          Accept: "application/vnd.github.raw",
          "User-Agent": "mu-inventario",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) return reject(new Error("clave " + res.statusCode));
          resolve(text.trim());
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function pedir(nombre, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: nombre + ".farmboss.stream",
        path,
        headers: { Authorization: "Bearer " + apiKey, "User-Agent": "mu-inventario" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) return reject(new Error(nombre + " " + path + " " + res.statusCode));
          resolve(text);
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error(nombre + " timeout")));
    req.end();
  });
}

function fechaDe(row) {
  return String((row && (row.Fecha || row.fecha)) || "");
}

(async () => {
  apiKey = process.env.FARM_API || (await githubFile("programa/remote.token"));
  if (!apiKey) throw new Error("sin clave");
  const vivos = [];
  for (const nombre of SERVIDORES) {
    try {
      const maestro = JSON.parse(await pedir(nombre, "/v1/maestro"));
      const estado = await pedir(nombre, "/v1/estado").catch(() => "");
      const cola = await pedir(nombre, "/v1/cola").catch(() => "");
      const respuesta = await pedir(nombre, "/v1/respuesta").catch(() => "");
      let prueba = [];
      try {
        prueba = JSON.parse(await pedir(nombre, "/v1/prueba"));
      } catch (err) {
        prueba = [];
      }
      vivos.push({ nombre, maestro, estado, cola, respuesta, prueba });
    } catch (err) {
      console.error(nombre, err.message);
    }
  }
  if (!vivos.length) throw new Error("ningun servidor");
  vivos.sort((a, b) => String(b.maestro.cuando || "").localeCompare(String(a.maestro.cuando || "")));
  const cuentasRaw = vivos[0].maestro.cuentas || { cuentas: {} };
  const limpias = { ...cuentasRaw, cuentas: {} };
  for (const [numero, cuenta] of Object.entries(cuentasRaw.cuentas || {})) {
    if (cuenta && cuenta.control) continue;
    limpias.cuentas[numero] = cuenta;
  }
  const vistos = {};
  for (const vivo of vivos) {
    const mandos = vivo.maestro.mandos || {};
    const lecturas = vivo.maestro.lecturas || {};
    for (const [nombre, filas] of Object.entries(lecturas)) {
      if (!Array.isArray(filas)) continue;
      const srv = String(mandos[nombre] || vivo.nombre);
      const prev = vistos[nombre];
      if (prev && fechaDe(prev.filas[prev.filas.length - 1]) > fechaDe(filas[filas.length - 1])) continue;
      vistos[nombre] = { srv, filas };
    }
  }
  const libros = {};
  for (const [nombre, item] of Object.entries(vistos)) {
    if (!libros[item.srv]) libros[item.srv] = {};
    libros[item.srv][nombre] = item.filas;
  }
  const estados = {};
  const colas = {};
  const pruebas = {};
  const respuestas = {};
  for (const vivo of vivos) {
    estados[vivo.nombre] = vivo.estado;
    colas[vivo.nombre] = vivo.cola;
    pruebas[vivo.nombre] = vivo.prueba;
    respuestas[vivo.nombre] = vivo.respuesta;
  }
  const plain = Buffer.from(JSON.stringify({ cuentas: limpias, libros, estados, colas, pruebas, respuestas, llave: apiKey }));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(pageKey, "hex"), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  fs.writeFileSync("datos.enc", JSON.stringify({ iv: iv.toString("base64"), ct: ct.toString("base64") }));
  console.log("ok", plain.length, Object.keys(libros).length);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
