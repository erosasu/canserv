export type CatalogPage = {
  evaluate: <T>(fn: () => Promise<T> | T) => Promise<T>;
};

type CatalogImageLoad = {
  ok: boolean;
  via?: string;
  tried?: string[];
  reason?: string;
};

/**
 * WhatsApp deja uploadProductImage en un paquete que solo se descarga al
 * abrir el catálogo. createProduct lo llama y revienta si ese paquete no
 * está cargado. Pedimos al Bootloader los componentes del catálogo antes.
 */
export async function ensureCatalogImageUpload(
  page: CatalogPage
): Promise<CatalogImageLoad> {
  return page.evaluate(async () => {
    const root: any = typeof self !== 'undefined' ? self : window;
    const whatsapp = root.WPP?.whatsapp;
    if (typeof whatsapp?.uploadProductImage === 'function') {
      return { ok: true, via: 'already' };
    }

    const req = root.require;
    if (typeof req !== 'function') {
      return { ok: false, reason: 'no-require' };
    }

    let bootloader: any = null;
    try {
      const mod = req('Bootloader');
      bootloader =
        typeof mod?.loadModules === 'function' ? mod : mod?.default || null;
    } catch {
      bootloader = null;
    }

    const names: string[] = [];
    const map = bootloader?.__debug?.componentMap;
    if (map && typeof map.keys === 'function') {
      for (const name of map.keys()) {
        const label = String(name);
        if (
          /MediaProduct|UploadProduct|ProductImage|ProductCatalog|CatalogProduct|BizCatalog/i.test(
            label
          )
        ) {
          names.push(label);
        }
      }
    }
    names.sort((a, b) => {
      const score = (label: string) => {
        if (/MediaProduct/i.test(label) && !label.includes('.react')) return 0;
        if (
          /UploadProduct|ProductImage/i.test(label) &&
          !label.includes('.react')
        )
          return 1;
        if (/Catalog/i.test(label) && !label.includes('.react')) return 2;
        if (!label.includes('.react')) return 3;
        return 4;
      };
      return score(a) - score(b);
    });

    const tried: string[] = [];
    const moduleIds = [
      'WAWebMediaProduct',
      'WAWebUploadProductImage',
      'WAWebProductMediaUpload',
    ];

    const bind = () => {
      if (!whatsapp) return false;
      if (typeof whatsapp.uploadProductImage === 'function') return true;
      for (const id of moduleIds) {
        try {
          if (!(id in req.m)) continue;
          const mod = req(id);
          const fn =
            mod?.uploadProductImage || mod?.default?.uploadProductImage;
          if (typeof fn !== 'function') continue;
          Object.defineProperty(whatsapp, 'uploadProductImage', {
            configurable: true,
            get: () => fn,
          });
          return typeof whatsapp.uploadProductImage === 'function';
        } catch {
          continue;
        }
      }
      return false;
    };

    if (bind()) return { ok: true, via: 'module', tried };

    const loadComponent = (name: string) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20000);
        try {
          bootloader.loadModules(
            [name],
            () => {
              clearTimeout(timer);
              resolve();
            },
            'WA-JS'
          );
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });

    if (bootloader && typeof bootloader.loadModules === 'function') {
      for (const name of names.slice(0, 4)) {
        tried.push(name);
        await loadComponent(name);
        if (bind()) return { ok: true, via: name, tried };
      }
    }

    try {
      const found = root.WPP?.loader?.search?.(
        (mod: any) => typeof mod?.uploadProductImage === 'function'
      );
      const fn = found?.uploadProductImage;
      if (typeof fn === 'function' && whatsapp) {
        Object.defineProperty(whatsapp, 'uploadProductImage', {
          configurable: true,
          get: () => fn,
        });
        if (typeof whatsapp.uploadProductImage === 'function') {
          return { ok: true, via: 'search', tried };
        }
      }
    } catch {
      /* el barrido es un respaldo */
    }

    return { ok: false, tried, reason: 'uploadProductImage-missing' };
  });
}
