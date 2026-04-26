/**
 * Gmail Stats - Export Apps Script
 *
 * Esegui exportSentEmails() in script.google.com per generare
 * sent_emails_all_years.json sul tuo Google Drive.
 *
 * Se l'esecuzione raggiunge il limite di tempo (~6 min), rilancia
 * la stessa funzione: riprende automaticamente da dove si era fermata.
 * Per ricominciare da zero, esegui resetExport().
 */

const QUERY = 'in:sent';
const PAGE_SIZE = 100;
const TIME_LIMIT_MS = 5 * 60 * 1000;
const FILE_NAME = 'sent_emails_all_years.json';
const CHECKPOINT_NAME = '.gmail_export_checkpoint.json';

function exportSentEmails() {
  const start = Date.now();
  const props = PropertiesService.getScriptProperties();
  let offset = Number(props.getProperty('offset') || 0);
  let messages = loadCheckpoint();
  const userEmail = Session.getActiveUser().getEmail();

  Logger.log('Inizio export. Riprendo da offset ' + offset + ', ' + messages.length + ' messaggi.');

  while (true) {
    if (Date.now() - start > TIME_LIMIT_MS) {
      saveCheckpoint(messages);
      props.setProperty('offset', String(offset));
      Logger.log('Tempo limite raggiunto. Rilancia exportSentEmails per continuare. Offset: ' + offset + ', messaggi: ' + messages.length);
      return;
    }
    const threads = GmailApp.search(QUERY, offset, PAGE_SIZE);
    if (threads.length === 0) {
      saveOutput(messages, userEmail);
      deleteCheckpoint();
      props.deleteProperty('offset');
      Logger.log('Completato: ' + messages.length + ' messaggi salvati in ' + FILE_NAME + ' su Drive.');
      return;
    }
    for (const thread of threads) {
      for (const m of thread.getMessages()) {
        if (m.getFrom().indexOf(userEmail) === -1) continue;
        messages.push({
          date: m.getDate().toISOString(),
          to: parseRecipients(m.getTo())
        });
      }
    }
    offset += threads.length;
  }
}

function parseRecipients(toHeader) {
  if (!toHeader) return [];
  return toHeader.split(',').map(function (s) {
    const m = s.match(/<([^>]+)>/);
    return (m ? m[1] : s).trim();
  }).filter(Boolean);
}

function saveOutput(messages, userEmail) {
  messages.sort(function (a, b) { return a.date.localeCompare(b.date); });
  const output = {
    description: 'Email inviate da ' + userEmail,
    period: {
      from: messages.length ? messages[0].date : '',
      to: messages.length ? messages[messages.length - 1].date : ''
    },
    total_messages: messages.length,
    messages: messages
  };
  writeFile(FILE_NAME, JSON.stringify(output, null, 2));
}

function loadCheckpoint() {
  const files = DriveApp.getFilesByName(CHECKPOINT_NAME);
  if (!files.hasNext()) return [];
  return JSON.parse(files.next().getBlob().getDataAsString());
}

function saveCheckpoint(messages) {
  writeFile(CHECKPOINT_NAME, JSON.stringify(messages));
}

function deleteCheckpoint() {
  const files = DriveApp.getFilesByName(CHECKPOINT_NAME);
  while (files.hasNext()) files.next().setTrashed(true);
}

function writeFile(name, content) {
  const blob = Utilities.newBlob(content, 'application/json', name);
  const files = DriveApp.getFilesByName(name);
  while (files.hasNext()) files.next().setTrashed(true);
  DriveApp.createFile(blob);
}

function resetExport() {
  PropertiesService.getScriptProperties().deleteProperty('offset');
  deleteCheckpoint();
  Logger.log('Stato resettato.');
}
