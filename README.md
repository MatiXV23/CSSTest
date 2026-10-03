# Práctica de CSS

Cuestionario de práctica de CSS para el curso. Es un sitio **estático** (HTML, CSS y JavaScript
puros, sin frameworks, sin npm y sin paso de build), pensado para publicarse en GitHub Pages.

- Preguntas y opciones en orden aleatorio en cada intento.
- Corrección inmediata con explicación de la opción elegida y de la correcta.
- En las preguntas con código, después de responder se puede **probar en vivo**: el CSS y el HTML
  se vuelven editables, el resultado se dibuja en un iframe y un inspector muestra las medidas y
  los estilos calculados del elemento que está bajo el mouse.
- El progreso se guarda en el navegador: si recargás la página, seguís donde estabas.
- Se puede usar entero con el teclado y se adapta a celulares y al modo oscuro.

## Estructura

```
index.html               Página única con las tres pantallas (inicio, cuestionario, resultados)
css/estilos.css          Estilos (variables para modo claro/oscuro, container queries)
js/app.js                Punto de entrada: pantallas, teclado y progreso en localStorage
js/quiz.js               Lógica del cuestionario, sin DOM (mezclar, responder, puntaje)
js/editor.js             Paneles de código: resaltado de sintaxis, edición y vista en vivo
js/inspector.js          Inspector del resultado (getBoundingClientRect y getComputedStyle)
data/preguntas.json      Preguntas que lee la app (se genera, no se edita a mano)
tools/gift-a-json.mjs    Conversor del formato GIFT de Moodle al JSON
practica_css_20.gift     Banco de preguntas original
```

## Regenerar las preguntas

Las preguntas se escriben en formato GIFT (el de Moodle). Cada vez que cambies el archivo `.gift`,
regenerá el JSON con Node.js (versión 18 o más nueva), desde la raíz del proyecto:

```sh
node tools/gift-a-json.mjs
```

Por defecto lee `practica_css_20.gift` y escribe `data/preguntas.json`. También podés indicar otros
archivos: `node tools/gift-a-json.mjs otro-banco.gift data/preguntas.json`.

Qué hace el conversor:

- Toma `::Título::` como título y usa la parte del medio (`Práctica - Selectores - …`) como tema.
- `=` marca la opción correcta, `~` las incorrectas y lo que sigue a `#` es la explicación.
- Quita los escapes de GIFT (`\~ \= \# \{ \} \:`) y decodifica las entidades HTML (`&lt;`, `&gt;`).
- El código en línea (`<code>`) queda entre comillas invertidas, por ejemplo `` `a:hover` ``.
- Un bloque `<pre>` se separa en `codigo.css` y `codigo.html`. Si solo trae CSS, genera un HTML
  mínimo que lo haga visible (por ejemplo `<div class="caja">Contenido</div>` para `.caja { … }`).
- El nivel es `"media"` si la pregunta tiene código y `"básica"` si no.
- Si encuentra algo raro (una pregunta sin opción correcta, un tipo de pregunta no admitido), lo
  avisa en la consola.

## Probar localmente

Los módulos de JavaScript y `fetch` **no funcionan** si abrís `index.html` con doble clic
(dirección `file://`). Hace falta un servidor estático. Cualquiera de estos sirve:

```sh
python -m http.server 8000      # en Linux o macOS puede ser python3
# y abrí http://localhost:8000
```

```sh
npx serve
# y abrí la dirección que muestra (normalmente http://localhost:3000)
```

## Publicar en GitHub Pages

Todas las rutas del sitio son relativas, así que funciona en `https://<usuario>.github.io/<repo>/`.

**Opción A: desde una rama** (la más simple)

1. Subí el proyecto a la rama `main` del repositorio.
2. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Elegí la rama **main** y la carpeta **/ (root)**, y guardá.
4. En uno o dos minutos el sitio queda en `https://<usuario>.github.io/<repo>/`.

El archivo `.nojekyll` le indica a GitHub que no procese el sitio con Jekyll y lo publique tal cual.

**Opción B: con GitHub Actions** (ya incluida)

1. En **Settings → Pages → Build and deployment → Source** elegí **GitHub Actions**.
2. El workflow `.github/workflows/pages.yml` publica el sitio cada vez que se sube código a `main`.
   También se puede lanzar a mano desde la pestaña **Actions**.

## Para mirar en el código

Este sitio también sirve de ejemplo. Algunas cosas para revisar:

- **HTML semántico**: `main`, `section`, `article`, `figure`/`figcaption`, `dl`, `dialog` y
  `template` en lugar de `div` genéricos.
- **Accesibilidad**: las opciones son `button` reales; la corrección se anuncia con `aria-live`;
  el foco se mueve a propósito al cambiar de pantalla; los colores cumplen contraste AA.
- **Sin `innerHTML` con datos**: el texto y el código se insertan con `textContent` y nodos, así un
  ejemplo con `<script>` se muestra como texto.
- **CSS moderno**: variables para los temas, `prefers-color-scheme`, `@container` para que los
  paneles se apilen según el ancho disponible, contadores para numerar líneas.
- **Iframe aislado**: el resultado en vivo usa `sandbox="allow-same-origin"` sin `allow-scripts`.
  Los scripts del ejemplo no se ejecutan, pero la página sí puede medir sus elementos.
- **Lógica separada de la vista**: `js/quiz.js` no toca el DOM y su estado es un objeto plano que
  se guarda directo en `localStorage`.
