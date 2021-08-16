(function () {
  "use strict";
  window.browser = window.chrome;
  /* eslint-disable indent */
  const specialPages = /^https:\/\/chrome.google.com\/webstore/;
  /* eslint-enable indent */ function isContentInjectablePage(url) {
    if (/^(https?|file):\/\//.test(url) && !specialPages.test(url)) {
      return true;
    }
    return false;
  }
  function isContentScriptablePage(url) {
    const isContentInjectable = isContentInjectablePage(url);
    const isContentScriptable =
      url.startsWith(browser.runtime.getURL("help.html")) ||
      url.startsWith(browser.runtime.getURL("options.html"));
    return isContentInjectable || isContentScriptable;
  }
  function withActiveTab(doThis) {
    browser.tabs.query(
      {
        active: true,
        currentWindow: true,
      },
      (tabs) => {
        doThis(tabs[0]);
      }
    );
  }
  function withAllTabs(doThis) {
    browser.tabs.query({}, (tabs) => {
      doThis(tabs);
    });
  }
  const contentScriptInjector = function () {
    // Inject content script manually
    withAllTabs(function (tabs) {
      for (const i in tabs) {
        isContentInjectablePage(tabs[i].url) &&
          browser.tabs.executeScript(
            tabs[i].id,
            {
              file: "content.js",
            },
            () => browser.runtime.lastError
          );
      }
    });
  };

  // User preferences

  const defaultBorderSettings = Object.freeze({
    borderType: "momentary",
    borderColour: "#ff2f92",
    borderFontSize: "16",
  });
  Object.freeze(defaultBorderSettings);

  // Dismissal state of user interface messages

  Object.freeze({
    dismissedSidebarNotAlone: false,
  });
  const defaultDismissedUpdate = Object.freeze({
    dismissedUpdate: false,
  });
  /* eslint-disable no-prototype-builtins */
  function MigrationManager(migrations) {
    function getVersion(settings) {
      if (!settings.hasOwnProperty("version")) {
        return 0;
      }
      return settings.version;
    }
    function isMigrationNeeded(startingVersion) {
      return startingVersion < Number(Object.keys(migrations).pop());
    }
    this.migrate = function (settings) {
      if (0 === Object.keys(settings).length) {
        return false;
      }
      const startingVersion = getVersion(settings);
      if (isMigrationNeeded(startingVersion)) {
        for (const key in migrations) {
          const toVersion = Number(key);
          if (toVersion > startingVersion) {
            migrations[toVersion](settings);
            settings.version = toVersion;
          }
        }
        console.log(
          `Landmarks: migrated user settings from version ${startingVersion} to version ${settings.version}`
        );
        return true;
      }
      return false;
    };
  }
  /* eslint-disable no-prototype-builtins */ const devtoolsConnections = {};
  const startupCode = [];
  let dismissedUpdate = defaultDismissedUpdate.dismissedUpdate;
  function setBrowserActionState(tabId, url) {
    isContentScriptablePage(url)
      ? browser.browserAction.enable(tabId)
      : browser.browserAction.disable(tabId);
  }
  function sendToDevToolsForTab(tabId, message) {
    devtoolsConnections.hasOwnProperty(tabId) &&
      devtoolsConnections[tabId].postMessage(message);
  }
  // If the content script hasn't started yet (e.g. on browser load, restoring
  // many tabs), ignore an error when trying to talk to it. It'll talk to us.

  // I tried avoiding sending to tabs whose status was not 'complete' but that
  // resulted in messages not being sent even when the content script was ready.
  function wrappedSendToTab(id, message) {
    browser.tabs.sendMessage(id, message, () => browser.runtime.lastError);
  }
  function updateGUIs(tabId, url) {
    if (isContentScriptablePage(url)) {
      wrappedSendToTab(tabId, {
        name: "get-landmarks",
      });
      wrappedSendToTab(tabId, {
        name: "get-toggle-state",
      });
    }
  }

  // Setting up and handling DevTools connections

  function devtoolsListenerMaker(port) {
    // DevTools connections come from the DevTools panel, but the panel is
    // inspecting a particular web page, which has a different tab ID.
    return function (message) {
      switch (message.name) {
        case "init":
          devtoolsConnections[message.tabId] = port;
          port.onDisconnect.addListener(devtoolsDisconnectMaker(message.tabId));
          sendDevToolsStateMessage(message.tabId, true);
          break;

        case "get-landmarks":
        case "get-toggle-state":
        case "focus-landmark":
        case "toggle-all-landmarks":
        case "get-mutation-info":
        case "get-page-warnings":
          // The DevTools panel can't check if it's on a scriptable
          // page, so we do that here. Other GUIs check themselves.
          browser.tabs.get(message.from, function (tab) {
            isContentScriptablePage(tab.url)
              ? browser.tabs.sendMessage(tab.id, message)
              : port.postMessage({
                  name: "landmarks",
                  data: null,
                });
          });
      }
    };
  }
  function devtoolsDisconnectMaker(tabId) {
    return function () {
      browser.tabs.get(tabId, function (tab) {
        browser.runtime.lastError || // check tab was not closed
          (isContentScriptablePage(tab.url) &&
            sendDevToolsStateMessage(tab.id, false));
      });
      delete devtoolsConnections[tabId];
    };
  }
  browser.runtime.onConnect.addListener(function (port) {
    switch (port.name) {
      case "devtools":
        port.onMessage.addListener(devtoolsListenerMaker(port));
        break;

      case "disconnect-checker":
        // Used on Chrome and Opera
        break;

      default:
        throw Error(`Unkown connection type "${port.name}".`);
    }
  });
  function sendDevToolsStateMessage(tabId, panelIsOpen) {
    browser.tabs.sendMessage(tabId, {
      name: "devtools-state",
      state: panelIsOpen ? "open" : "closed",
    });
  }

  // Sidebar handling

  // If the user has elected to use the sidebar, the pop-up is disabled, and we
  // will receive events, which we can then use to open the sidebar.

  // Opera doesn't have open().

  // These things are only referenced from within browser-conditional blocks, so
  // Terser removes them as appropriate.
  // Keyboard shortcut handling
  browser.commands.onCommand.addListener(function (command) {
    switch (command) {
      case "next-landmark":
      case "prev-landmark":
      case "main-landmark":
      case "toggle-all-landmarks":
        withActiveTab((tab) => {
          isContentScriptablePage(tab.url) &&
            browser.tabs.sendMessage(tab.id, {
              name: command,
            });
        });
    }
  });

  // Navigation and tab activation events

  // Stop the user from being able to trigger the browser action during page load.
  browser.webNavigation.onBeforeNavigate.addListener(function (details) {
    if (details.frameId > 0) {
      return;
    }
    browser.browserAction.disable(details.tabId);
    dismissedUpdate &&
      browser.browserAction.setBadgeText({
        text: "",
        tabId: details.tabId,
      });
  });
  browser.webNavigation.onCompleted.addListener(function (details) {
    if (details.frameId > 0) {
      return;
    }
    setBrowserActionState(details.tabId, details.url);
    updateGUIs(details.tabId, details.url);
  });
  // If the page uses single-page app techniques to load in new components—as
  // YouTube and GitHub do—then the landmarks can change. We assume that if the
  // structure of the page is changing so much that it is effectively a new page,
  // then the developer would've followed best practice and used the History API
  // to update the URL of the page, so that this 'new' page can be recognised as
  // such and be bookmarked by the user. Therefore we monitor for use of the
  // History API to trigger a new search for landmarks on the page.

  // Thanks: http://stackoverflow.com/a/36818991/1485308

  // Note:
  // - GitHub repo-exploring transitions: this fires two times on Firefox (with
  //   both URL fields the same) and three times on Chrome (with some URL fields
  //   being the start URL and some being the finishing URL).
  // - YouTube transitions from playing to suggested video: this only fires once,
  //   with the new URL.
  // - The original code had a fliter such that this would only fire if the URLs
  //   of the current tab and the details object matched. This seems to work very
  //   well on most pages, but I noticed at least one case where it did not
  //   (moving to a repo's Graphs page on GitHub). Seeing as this only sends a
  //   short message to the content script, I've removed the 'same URL'
  //   filtering.
  browser.webNavigation.onHistoryStateUpdated.addListener(function (details) {
    if (details.frameId > 0) {
      return;
    }
    isContentScriptablePage(details.url) && // TODO: check needed?
      wrappedSendToTab(details.tabId, {
        name: "trigger-refresh",
      });
  });
  browser.tabs.onActivated.addListener(function (activeTabInfo) {
    browser.tabs.get(activeTabInfo.tabId, function (tab) {
      updateGUIs(tab.id, tab.url);
    });
    // Note: on Firefox, if the tab hasn't started loading yet, its URL comes
    //       back as "about:blank" which makes Landmarks think it can't run on
    //       that page, and sends the null landmarks message, which appears
    //       briefly before the DOM load event causes webNavigation.onCompleted
    //       to fire and the content script is asked for and sends back the
    //       actual landmarks.
  });

  // Install and update

  function reflectUpdateDismissalState(dismissed) {
    dismissedUpdate = dismissed;
    if (dismissedUpdate) {
      browser.browserAction.setBadgeText({
        text: "",
      });
      withActiveTab((tab) => updateGUIs(tab.id, tab.url));
    } else {
      browser.browserAction.setBadgeText({
        text: browser.i18n.getMessage("badgeNew"),
      });
    }
  }
  startupCode.push(function () {
    browser.storage.sync.get(defaultDismissedUpdate, function (items) {
      reflectUpdateDismissalState(items.dismissedUpdate);
    });
  });
  browser.runtime.onInstalled.addListener(function (details) {
    if ("install" === details.reason) {
      browser.tabs.create({
        url: "help.html#!install",
      });
      browser.storage.sync.set({
        dismissedUpdate: true,
      });
    } else {
      "update" === details.reason &&
        browser.storage.sync.set({
          dismissedUpdate: false,
        });
    }
  });

  // Message handling

  function openHelpPage(openInSameTab) {
    const helpPage = dismissedUpdate
      ? browser.runtime.getURL("help.html")
      : browser.runtime.getURL("help.html") + "#!update";
    openInSameTab
      ? // Link added to Landmarks' home page should open in the same tab
        browser.tabs.update({
          url: helpPage,
        })
      : // When opened from GUIs, it should open in a new tab
        withActiveTab((tab) =>
          browser.tabs.create({
            url: helpPage,
            openerTabId: tab.id,
          })
        );
    dismissedUpdate ||
      browser.storage.sync.set({
        dismissedUpdate: true,
      });
  }
  browser.runtime.onMessage.addListener(function (message, sender) {
    switch (message.name) {
      // Content
      case "landmarks":
        dismissedUpdate &&
          browser.browserAction.setBadgeText({
            text: 0 === message.data.length ? "" : String(message.data.length),
            tabId: sender.tab.id,
          });
        sendToDevToolsForTab(sender.tab.id, message);
        break;

      case "get-devtools-state":
        sendDevToolsStateMessage(
          sender.tab.id,
          devtoolsConnections.hasOwnProperty(sender.tab.id)
        );
        break;

      // Help page
      case "get-commands":
        browser.commands.getAll(function (commands) {
          browser.tabs.sendMessage(sender.tab.id, {
            name: "populate-commands",
            commands: commands,
          });
        });
        break;

      case "open-configure-shortcuts":
        browser.tabs.update({
          /* eslint-disable indent */
          url: "chrome://extensions/configureCommands",
        });
        break;

      case "open-settings":
        browser.runtime.openOptionsPage();
        break;

      // Pop-up, sidebar and big link added to Landmarks' home page
      case "open-help":
        openHelpPage(true === message.openInSameTab);
        break;

      // Messages that need to be passed through to DevTools only
      case "toggle-state-is":
        withActiveTab((tab) => sendToDevToolsForTab(tab.id, message));
        break;

      case "mutation-info":
      case "page-warnings":
        sendToDevToolsForTab(sender.tab.id, message);
    }
  });

  // Actions when the extension starts up

  withAllTabs(function (tabs) {
    for (const i in tabs) {
      setBrowserActionState(tabs[i].id, tabs[i].url);
    }
  });
  startupCode.push(contentScriptInjector);
  browser.storage.onChanged.addListener(function (changes) {
    changes.hasOwnProperty("dismissedUpdate") &&
      // Changing _to_ false means either we've already dismissed and have
      // since reset the messages, OR we have just been updated.
      reflectUpdateDismissalState(changes.dismissedUpdate.newValue);
  });
  const migrationManager = new MigrationManager({
    1: function (settings) {
      delete settings.debugInfo;
    },
  });
  function runStartupCode() {
    for (const func of startupCode) {
      func();
    }
  }
  browser.storage.sync.get(null, function (items) {
    const changedSettings = migrationManager.migrate(items);
    changedSettings
      ? browser.storage.sync.clear(function () {
          browser.storage.sync.set(items, function () {
            runStartupCode();
          });
        })
      : runStartupCode();
  });
})();
