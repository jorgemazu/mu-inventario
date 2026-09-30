const https = require("https");
const crypto = require("crypto");
const fs = require("fs");

const token = process.env.FARM_TOKEN || "";
const pageKey = process.env.PAGE_KEY || "";
if (!token || !/^[0-9a-f]{64}$/i.test(pageKey)) {
  console.error("faltan datos");
  process.exit(1);
}

function api(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.github.com",
      path: "/repos/jorgemazu/farmboss-inventario" + path,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "User-Agent": "mu-inventario",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error(path + " " + res.statusCode));
        resolve(JSON.parse(text));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function textOf(file) {
  if (!file) return "";
  const content = file.content || "";
  if (!content) return "";
  return Buffer.from(content, "base64").toString("utf8").replace(/^\uFEFF/, "");
}

async function fileText(path) {
  const file = await api("/contents/" + path);
  if (!file) return "";
  if (file.content) return textOf(file);
  if (!file.sha) return "";
  const blob = await api("/git/blobs/" + file.sha);
  return textOf(blob);
}

(async () => {
  const cuentas = JSON.parse(await fileText("cuentas.json"));
  const limpias = { ...cuentas, cuentas: {} };
  for (const [numero, cuenta] of Object.entries(cuentas.cuentas || {})) {
    if (cuenta && cuenta.control) continue;
    limpias.cuentas[numero] = cuenta;
  }
  const servers = await api("/contents/servidores");
  const libros = {};
  const estados = {};
  const colas = {};
  for (const item of servers || []) {
    if (!item || item.type !== "dir" || !item.name) continue;
    const nombre = encodeURIComponent(item.name);
    const libro = await fileText("servidores/" + nombre + "/libro.json");
    if (libro) libros[item.name] = JSON.parse(libro);
    estados[item.name] = await fileText("servidores/" + nombre + "/estado.txt");
    colas[item.name] = await fileText("servidores/" + nombre + "/cola.txt");
  }
  const buzon = /^[A-Za-z0-9_-]{16,80}$/.test(process.env.NTFY_TOPIC || "") ? process.env.NTFY_TOPIC : "";
  const plain = Buffer.from(JSON.stringify({ cuentas: limpias, libros, estados, colas, buzon }));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(pageKey, "hex"), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  fs.writeFileSync("datos.enc", JSON.stringify({ iv: iv.toString("base64"), ct: ct.toString("base64") }));
  console.log("ok", plain.length, Object.keys(libros).length);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
