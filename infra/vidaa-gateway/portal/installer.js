(function () {
  'use strict';

  var APP_ID = 'playarr-tv';
  var APP_NAME = 'Playarr';
  var APP_URL = 'https://playarr.app/?platform=tv-vidaa';
  var ICON_URL = 'https://playarr.app/playarr-icon-512.png';
  var APPINFO_PATH = 'websdk/Appinfo.json';
  var APPINFO_MODE = 6;
  var button = document.getElementById('install');
  var status = document.getElementById('status');

  function show(message, failed) {
    status.textContent = message;
    status.className = failed ? 'failed' : '';
  }

  function fixedEntry() {
    return {
      Id: APP_ID,
      AppName: APP_NAME,
      Title: APP_NAME,
      URL: APP_URL,
      StartCommand: APP_URL,
      IconURL: ICON_URL,
      Icon_96: ICON_URL,
      Image: ICON_URL,
      Thumb: ICON_URL,
      Type: 'Browser',
      InstallTime: new Date().toISOString().slice(0, 10),
      RunTimes: 0,
      StoreType: 'custom',
      PreInstall: false
    };
  }

  function installWithFileFallback() {
    if (typeof window.HiUtils_createRequest !== 'function') {
      throw new Error('This television does not expose a supported installation method.');
    }

    var current = window.HiUtils_createRequest('fileRead', {
      path: APPINFO_PATH,
      mode: APPINFO_MODE
    });
    if (!current || current.ret !== true || typeof current.msg !== 'string' || current.msg.length > 2097152) {
      throw new Error('The installed app list could not be read safely. No changes were made.');
    }

    var apps = JSON.parse(current.msg);
    if (!apps || !Array.isArray(apps.AppInfo) || apps.AppInfo.length > 1000) {
      throw new Error('The installed app list has an unexpected format. No changes were made.');
    }

    var entry = fixedEntry();
    var index = -1;
    for (var position = 0; position < apps.AppInfo.length; position += 1) {
      if (apps.AppInfo[position] && apps.AppInfo[position].Id === APP_ID) {
        index = position;
        break;
      }
    }
    if (index >= 0) {
      apps.AppInfo[index] = entry;
    } else {
      apps.AppInfo.push(entry);
    }

    var result = window.HiUtils_createRequest('fileWrite', {
      path: APPINFO_PATH,
      mode: APPINFO_MODE,
      writedata: JSON.stringify(apps)
    });
    if (!result || result.ret !== true) {
      throw new Error('The television rejected the Playarr launcher update.');
    }
    show('Playarr is installed. Restart the television, then restore automatic DNS.', false);
  }

  function install() {
    button.disabled = true;
    show('Installing Playarr…', false);

    if (typeof window.Hisense_installApp === 'function') {
      try {
        var callbackReceived = false;
        window.setTimeout(function () {
          if (!callbackReceived) {
            show('The television did not confirm installation. Restart it before trying again.', true);
            button.disabled = false;
          }
        }, 15000);
        window.Hisense_installApp(
          APP_ID,
          APP_NAME,
          ICON_URL,
          ICON_URL,
          ICON_URL,
          APP_URL,
          'store',
          function (result) {
            callbackReceived = true;
            if (result === 0) {
              show('Playarr is installed. Restart the television, then restore automatic DNS.', false);
              return;
            }
            try {
              installWithFileFallback();
            } catch (error) {
              show(error.message, true);
              button.disabled = false;
            }
          }
        );
        return;
      } catch (error) {
        callbackReceived = true;
        // A present but unusable legacy API may fall back to the fixed Appinfo update below.
      }
    }

    try {
      installWithFileFallback();
    } catch (error) {
      show(error.message, true);
      button.disabled = false;
    }
  }

  button.addEventListener('click', install);
  button.focus();
}());
