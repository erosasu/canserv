export type CatalogPage = {
  evaluate: <T>(fn: () => Promise<T> | T) => Promise<T>;
};

type CatalogImageLoad = {
  ok: boolean;
  via?: string;
  tried?: string[];
  reason?: string;
};

// Texto plano a propósito. page.evaluate envía la función con toString(),
// y tsx le inyecta el helper __name, que no existe dentro de WhatsApp Web.
const BROWSER_SCRIPT = `
var root = typeof self !== 'undefined' ? self : window;
var whatsapp = root.WPP && root.WPP.whatsapp;
if (whatsapp && typeof whatsapp.uploadProductImage === 'function') {
  return { ok: true, via: 'already' };
}
var req = root.require;
if (typeof req !== 'function') {
  return { ok: false, reason: 'no-require' };
}
var bootloader = null;
try {
  var mod = req('Bootloader');
  bootloader = typeof mod.loadModules === 'function' ? mod : (mod && mod.default) || null;
} catch (e) {
  bootloader = null;
}
var names = [];
var map = bootloader && bootloader.__debug && bootloader.__debug.componentMap;
if (map && typeof map.keys === 'function') {
  var keys = map.keys();
  var key = keys.next();
  while (!key.done) {
    var label = String(key.value);
    if (/MediaProduct|UploadProduct|ProductImage|ProductCatalog|CatalogProduct|BizCatalog/i.test(label)) {
      names.push(label);
    }
    key = keys.next();
  }
}
names.sort(function (a, b) {
  function score(label) {
    if (/MediaProduct/i.test(label) && label.indexOf('.react') === -1) return 0;
    if (/UploadProduct|ProductImage/i.test(label) && label.indexOf('.react') === -1) return 1;
    if (/Catalog/i.test(label) && label.indexOf('.react') === -1) return 2;
    if (label.indexOf('.react') === -1) return 3;
    return 4;
  }
  return score(a) - score(b);
});
var tried = [];
var moduleIds = ['WAWebMediaProduct', 'WAWebUploadProductImage', 'WAWebProductMediaUpload'];
function bind() {
  if (!whatsapp) return false;
  if (typeof whatsapp.uploadProductImage === 'function') return true;
  for (var i = 0; i < moduleIds.length; i++) {
    var id = moduleIds[i];
    try {
      if (!(id in req.m)) continue;
      var loaded = req(id);
      var fn = (loaded && loaded.uploadProductImage) || (loaded && loaded.default && loaded.default.uploadProductImage);
      if (typeof fn !== 'function') continue;
      Object.defineProperty(whatsapp, 'uploadProductImage', {
        configurable: true,
        get: function () { return fn; }
      });
      return typeof whatsapp.uploadProductImage === 'function';
    } catch (err) {}
  }
  return false;
}
if (bind()) return { ok: true, via: 'module', tried: tried };
function loadComponent(name) {
  return new Promise(function (resolve) {
    var timer = setTimeout(resolve, 20000);
    try {
      bootloader.loadModules([name], function () {
        clearTimeout(timer);
        resolve();
      }, 'WA-JS');
    } catch (err) {
      clearTimeout(timer);
      resolve();
    }
  });
}
if (bootloader && typeof bootloader.loadModules === 'function') {
  var limit = names.slice(0, 4);
  for (var n = 0; n < limit.length; n++) {
    tried.push(limit[n]);
    await loadComponent(limit[n]);
    if (bind()) return { ok: true, via: limit[n], tried: tried };
  }
}
try {
  var found = root.WPP && root.WPP.loader && root.WPP.loader.search && root.WPP.loader.search(function (item) {
    return item && typeof item.uploadProductImage === 'function';
  });
  var foundFn = found && found.uploadProductImage;
  if (typeof foundFn === 'function' && whatsapp) {
    Object.defineProperty(whatsapp, 'uploadProductImage', {
      configurable: true,
      get: function () { return foundFn; }
    });
    if (typeof whatsapp.uploadProductImage === 'function') {
      return { ok: true, via: 'search', tried: tried };
    }
  }
} catch (err) {}
return { ok: false, tried: tried, reason: 'uploadProductImage-missing' };
`;

/**
 * WhatsApp deja uploadProductImage en un paquete que solo se descarga al
 * abrir el catálogo. createProduct lo llama y revienta si ese paquete no
 * está cargado. Pedimos al Bootloader los componentes del catálogo antes.
 */
export async function ensureCatalogImageUpload(
  page: CatalogPage
): Promise<CatalogImageLoad> {
  const runInPage = new Function(
    `return (async function () {\n${BROWSER_SCRIPT}\n})();`
  ) as () => Promise<CatalogImageLoad>;
  return page.evaluate(runInPage);
}
