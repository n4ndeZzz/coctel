# coctel

**Armonía en la diferencia** — producto final de la materia de diseño y cultura.

Dos personas distintas que comparten una misma sintonía. Nace de una noche en un bar de cocteles de autor: el bartender preguntó por nuestros gustos, recuerdos e historia, y nos sirvió dos cocteles distintos (uno especiado y dulce, otro refrescante) con los mismos aromas de haba tonka y vainilla.

La página no lo explica: hace unas preguntas (como en la barra), por ti y por alguien con quien compartes, y convierte las respuestas en dos fluidos que empiezan separados, se encuentran, se mezclan y terminan fluyendo juntos, unidos por un hilo ámbar-crema. Puedes capturar el momento y descargarlo como imagen.

## Cómo correrlo

Es un sitio estático (HTML, CSS y JavaScript con módulos ES, sin dependencias ni paso de build). Los módulos ES necesitan un servidor; abrir `index.html` con doble clic no funciona.

```bash
python -m http.server 8000
# luego abre http://localhost:8000
```

También sirve la extensión **Live Server** de VS Code (clic derecho en `index.html` → *Open with Live Server*).

## Publicar en GitHub Pages

1. Sube el contenido del repo a la rama `main`.
2. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. En un par de minutos queda en `https://<usuario>.github.io/<repo>/`. Todas las rutas son relativas, así que funciona desde una subcarpeta.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Pantallas: portada, conversación, reposo, simulación y vista previa. |
| `css/styles.css` | Estilos (oscuro, crema y ámbar; mobile-first). |
| `js/main.js` | Flujo, navegación, accesibilidad, captura y modo debug. |
| `js/questions.js` | Preguntas, paleta curada y codificación de respuestas para el enlace. |
| `js/profile.js` | Ficha interna: respuestas → parámetros visuales + seed. |
| `js/fluid.js` | Simulación de fluidos (stable fluids) en WebGL2/WebGL1. |
| `js/export.js` | Imagen PNG en alta resolución, descarga y enlace reproducible. |

## Detalles

- **Enlace reproducible:** las respuestas quedan codificadas en el hash (`#m=...`). Quien abra ese enlace ve nacer exactamente la misma mezcla.
- **Modo presentación:** agrega `?debug=1` a la URL para ver las dos fichas internas en JSON, la fase actual y los fps, más un botón de respuestas al azar en la portada.
- **Privacidad:** todo ocurre en el navegador. No hay backend, analítica ni envío de datos.
- Respeta `prefers-reduced-motion` (los fluidos se mueven más despacio) y ajusta la resolución según el dispositivo.

---

Juan José Hernández
