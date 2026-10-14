import {createController} from './controller.js';
import {createMenuSelectionHandler} from './selection.js';
import {ORIGIN} from './config.js';
const controller = createController(chrome, ORIGIN);
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({id: 'read', title: 'Read with PasteToSpeech', contexts: ['selection']}));
});
async function showError(message) {
  await chrome.action.setBadgeText({text: '!'});
  await chrome.action.setTitle({title: message});
}
export async function readSelection(text) {
  try {
    const result = await controller.send(text);
    if (result.error) { await showError(result.error); return result; }
    await chrome.action.setBadgeText({text: ''});
    await chrome.action.setTitle({title: 'PasteToSpeech'});
    setTimeout(() => { void controller.expire(); }, 600_000);
    return result;
  } catch { await showError('Could not open PasteToSpeech. Open the extension to retry.'); }
}
export const readMenuSelection = createMenuSelectionHandler(chrome, readSelection, async error => { await showError(error); return {error}; });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  void readMenuSelection(info, tab);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || !['ready', 'accepted', 'status', 'open', 'retry'].includes(message.type)) return;
  controller.message(message, sender).then(respond, () => respond({error: 'Could not connect to PasteToSpeech. Retry from the extension.'}));
  return true;
});
chrome.tabs.onRemoved.addListener(id => { void controller.removed(id); });
