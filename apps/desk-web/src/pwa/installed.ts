// Whether the desk runs as the installed app (a home-screen app: display-mode standalone; iOS Safari also says so
// through `navigator.standalone`) rather than in a browser tab. The installed app keeps the org key on the device by
// default: iOS closes it often, and an unlock before most notifications would defeat the phone (the owner's verdict on
// mockups/desk/05-phone.html, 8).
export function isInstalledApp(): boolean {
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
