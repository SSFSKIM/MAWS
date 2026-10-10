// The probe options page (board #90 S1): names its extension so a tab showing it can be recognised.
const name = chrome.runtime.getManifest().name;
document.getElementById('out').textContent = `Options of ${name}`;
window.__optionsResult = { name, href: location.href };
