# CAP Album — Impaginatore

Programma per impaginare album fotografici a mano, in modo veloce. Gira dentro Google Chrome e lavora direttamente sulle cartelle del Mac: le foto e i progetti restano sul tuo disco, qui c'è solo il programma.

Versione attuale: **0.3.2** (6 ottobre 2026)

## Come si apre

**Come app (consigliato).** Apri in Google Chrome [giuseppecappellino.github.io/CAP-ALBUM](https://giuseppecappellino.github.io/CAP-ALBUM/), poi dal menu con i tre puntini scegli «Installa pagina come app…». Ottieni l'icona nel Dock; dopo la prima apertura funziona anche senza internet e si aggiorna da sola.

**Dal disco.** Scarica la repository (pulsante **Code › Download ZIP**), poi tasto destro su `index.html` › **Apri con** › **Google Chrome**.

Serve Chrome: Safari non permette di lavorare con le cartelle del Mac. Quando Chrome chiede il permesso su una cartella, rispondi «Modifica file».

Le istruzioni complete e le scorciatoie sono in [`LEGGIMI.txt`](LEGGIMI.txt).

## Cosa fa

- **Progetti**: misure in cm, pagina singola o tavola doppia, fogli, margini di sicurezza. Il progetto è un file `.album` nella cartella del servizio; le foto vengono collegate, non copiate, da qualsiasi cartella.
- **Impaginazione manuale**: trascini le foto sulla tavola e le altre si risistemano senza essere ritagliate. Vicino a un bordo di una foto la nuova entra sopra, sotto, a destra o a sinistra; al centro le due si scambiano. Mentre trascini vedi l'anteprima.
- **Bordi tra le foto** trascinabili per cambiare forma e proporzioni.
- **Ritaglio** dagli angoli, con la parte tagliata in trasparenza, zoom e raddrizza.
- **Combinazioni** alternative con ↑ ↓, pagina intera (W), dividi le pagine (D), bianco e nero.
- **Export**: una JPG per tavola a 300 dpi con profilo sRGB, più un PDF leggero come provino.
- **Più Mac**: collegando una volta il disco dei lavori come archivio, ogni Mac ritrova da solo progetti e cartelle delle foto.

## Com'è fatto

Nessuna installazione e nessuna compilazione: HTML, CSS e JavaScript.

| File | Contenuto |
| --- | --- |
| `index.html` | Pagina di avvio |
| `js/layout.js` | Motore di impaginazione |
| `js/storage.js` | Cartelle, elenco progetti, miniature |
| `js/session.js` | Progetto aperto: salvataggio, annulla, cartelle foto |
| `js/export.js` | JPG a 300 dpi con sRGB e PDF provino |
| `js/app.js` | Interfaccia |
| `css/app.css` | Aspetto e animazioni |
| `lib/` | Libreria per l'interfaccia (Preact + htm) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installazione come app e funzionamento senza internet |
| `test/` | Collaudi automatici |
