// Captura en alta resolución, descarga del PNG y enlace reproducible.

const LADO_LARGO = 2560;
const LADO_MINIMO = 2048;

export const nombreArchivo = (seedTexto) => `armonia-en-la-diferencia-${seedTexto}.png`;

// Renderiza el estado actual de la simulación fuera de pantalla (≥ 2048 px en
// el lado largo, con muestreo bicúbico, grano fino y viñeta del propio shader).
export async function capturar(fluido) {
  const aspecto = fluido.aspecto;
  const lado = Math.max(Math.min(LADO_LARGO, fluido.maxTextura), Math.min(LADO_MINIMO, fluido.maxTextura));
  const w = aspecto >= 1 ? lado : Math.round(lado * aspecto);
  const h = aspecto >= 1 ? Math.round(lado / aspecto) : lado;

  const { pixeles } = fluido.renderizarExportacion(w, h);

  // WebGL lee de abajo hacia arriba: se invierten las filas.
  const datos = new Uint8ClampedArray(w * h * 4);
  const fila = w * 4;
  for (let y = 0; y < h; y++) {
    datos.set(pixeles.subarray((h - 1 - y) * fila, (h - y) * fila), y * fila);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(datos, w, h), 0, 0);
  const blob = await new Promise((ok, mal) =>
    canvas.toBlob((b) => (b ? ok(b) : mal(new Error('toBlob falló'))), 'image/png'),
  );
  canvas.width = canvas.height = 0;
  return { blob, url: URL.createObjectURL(blob), w, h };
}

function esIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function descargar(captura, nombre) {
  if (esIOS()) {
    const archivo = new File([captura.blob], nombre, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try {
        await navigator.share({ files: [archivo], title: 'Armonía en la diferencia' });
        return 'compartido';
      } catch (err) {
        if (err.name === 'AbortError') return 'cancelado';
      }
    }
    window.open(captura.url, '_blank');
    return 'pestana';
  }
  const a = document.createElement('a');
  a.href = captura.url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  return 'descargado';
}

// Enlace con las respuestas codificadas en el hash: regenera la misma mezcla.
export function enlaceCompartible(codigo) {
  return `${location.origin}${location.pathname}#m=${codigo}`;
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
