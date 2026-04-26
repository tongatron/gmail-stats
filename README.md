# Gmail Stats

![Logo](logo.png)

`gmail-stats` è una dashboard locale per analizzare le tue email inviate. Genera un JSON dal tuo account Gmail e caricalo nella pagina `index.html` per vedere statistiche, heatmap settimanali, destinatari frequenti, domini, filtri per anno ed export CSV.

## Cosa contiene

- `index.html` — la dashboard. Aprila in un browser e carica il JSON.
- `scripts/apps_script_export.gs` — script Google Apps Script per generare il JSON senza installare nulla (consigliato).
- `scripts/export_sent_emails.mjs` — alternativa Node.js per chi preferisce la riga di comando.

## Come creare il JSON (consigliato, senza installazioni)

Bastano 4 passi nel browser:

1. Apri [script.google.com](https://script.google.com/) e clicca **Nuovo progetto**.
2. Cancella il codice di esempio in `Codice.gs` e incolla il contenuto di [`scripts/apps_script_export.gs`](scripts/apps_script_export.gs). Salva con `⌘S` (o l'icona del floppy disk).
3. Nella **barra sopra il codice** (non il pulsante "Esegui il deployment" in alto a destra) seleziona la funzione `exportSentEmails` dal menu a tendina, poi clicca **▷ Esegui**.
4. La prima volta Google chiede l'autorizzazione: scegli il tuo account → *Avanzate* → *Vai al progetto (non sicuro)* → consenti l'accesso a Gmail e Drive. L'avviso "non sicuro" compare perché lo script non è verificato da Google, ma è il tuo.
5. Al termine, sul tuo Google Drive trovi `sent_emails_all_years.json`. Scaricalo e caricalo nella dashboard `index.html` con **Apri file JSON**.

> **Caselle molto grandi**: Apps Script ha un limite di ~6 minuti per esecuzione. Se l'export non finisce in tempo, vedi un messaggio nei log e basta rilanciare `exportSentEmails`: riprende automaticamente dal checkpoint. Per ricominciare da zero esegui invece `resetExport`.

## Uso della dashboard

```bash
open index.html
```

La pagina permette di:

- caricare un file JSON
- filtrare per anno o intervallo di anni
- includere o escludere destinatari e domini
- vedere la heatmap settimanale per un anno o per il totale
- esportare in CSV i dati filtrati

## Formato JSON atteso

```json
{
  "description": "Email inviate da example@gmail.com",
  "period": {
    "from": "2006-11-08T08:22:08.000Z",
    "to": "2026-04-23T17:50:10.000Z"
  },
  "total_messages": 19030,
  "messages": [
    {
      "date": "2024-01-10T09:14:00.000Z",
      "to": ["destinatario@example.com"]
    }
  ]
}
```

---

## Opzione avanzata: export via Node.js

Per chi preferisce generare il JSON localmente da terminale invece che in cloud.

### Requisiti

- Node.js installato
- Un progetto Google Cloud con Gmail API abilitata
- Un OAuth client di tipo Desktop App

### Setup OAuth

1. Apri [Google Cloud Console](https://console.cloud.google.com/), crea o seleziona un progetto.
2. Abilita `Gmail API`.
3. In `APIs & Services` → `OAuth consent screen` completa la configurazione.
4. In `APIs & Services` → `Credentials` crea un `OAuth client ID` di tipo `Desktop app`.
5. Scarica il JSON, rinominalo `credentials.json` e mettilo nella cartella del progetto.

### Esecuzione

```bash
npm install
npm run gmail:sync
```

Alla prima esecuzione si apre il browser per il login Google. Al termine trovi `sent_emails_all_years.json` nella cartella del progetto.

Se l'export viene interrotto, rilancia lo stesso comando: riprende da `.gmail_export_checkpoint.json`.

### File sensibili (esclusi da git)

- `credentials.json`
- `token.json`
- `sent_emails.json`
- `sent_emails_all_years.json`
- `.gmail_export_checkpoint.json`
