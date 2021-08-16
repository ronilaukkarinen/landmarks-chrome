(function () {
  "use strict";
  window.browser = window.chrome;
  // http://tumble.jeremyhubert.com/post/7076881720
  // HT http://stackoverflow.com/questions/25467009/
  function translate() {
    for (const element of document.querySelectorAll("[data-message]")) {
      element.appendChild(
        document.createTextNode(
          browser.i18n.getMessage(element.dataset.message)
        )
      );
    }
  }
  function landmarkName(landmark) {
    const roleName = landmark.roleDescription
      ? landmark.roleDescription
      : processRole(landmark.role);
    const label = landmark.label
      ? landmark.label + " (" + roleName + ")"
      : roleName;
    return landmark.guessed
      ? label + " (" + browser.i18n.getMessage("guessed") + ")"
      : label;
  }
  // Fetch the user-friendly name for a role
  function processRole(role) {
    const capRole = (base) => base.charAt(0).toUpperCase() + base.slice(1);
    return browser.i18n.getMessage(
      "role" +
        (role.startsWith("doc-") ? capRole(role.slice(4)) : capRole(role))
    );
  }

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
  const defaultDismissalStates = defaultDismissedUpdate;
  /* eslint-disable indent */ const specialPages =
    /^https:\/\/chrome.google.com\/webstore/;
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
  // hasOwnProperty is only used on browser-provided objects
  const _updateNote = {
    dismissedUpdate: {
      id: "note-update",
      cta: function () {
        browser.runtime.sendMessage({
          name: "open-help",
        });
        window.close();
      },
    },
  };
  const notes = _updateNote;
  // Creating a landmarks tree in response to info from content script
  // Handle incoming landmarks message response
  // If we got some landmarks from the page, make the tree of them. If there was
  // an error, let the user know.
  function handleLandmarksMessage(data) {
    const display = document.getElementById("landmarks");
    const showAllContainer = document.getElementById("show-all-label");
    removeChildNodes(display);
    // Content script would normally send back an array of landmarks
    if (Array.isArray(data)) {
      if (0 === data.length) {
        addText(display, browser.i18n.getMessage("noLandmarksFound"));
        showAllContainer.style.display = "none";
      } else {
        makeLandmarksTree(data, display);
        showAllContainer.style.display = null;
      }
    } else {
      addText(display, browser.i18n.getMessage("forbiddenPage"));
      showAllContainer.style.display = "none";
    }
  }
  // Go through the landmarks identified for the page and create an HTML
  // nested list to mirror the structure of those landmarks
  function makeLandmarksTree(landmarks, container) {
    let previousDepth = 0;
    const root = document.createElement("ul");
    // start of tree
    let base = root;
    // anchor for sub-trees
    let previousItem = null;
    // last item to be created
    landmarks.forEach(function (landmark, index) {
      const depthChange = landmark.depth - previousDepth;
      const absDepthChange = Math.abs(depthChange);
      function whenDepthIncreases() {
        base = document.createElement("ul");
        previousItem.appendChild(base);
      }
      function whenDepthDecreases() {
        // The parent of base is an <li>, the grandparent is the <ul>
        base = base.parentElement.parentElement;
      }
      // If the depth has changed, insert/step back the appropriate number of
      // levels
      if (absDepthChange > 0) {
        const operation =
          depthChange > 0 ? whenDepthIncreases : whenDepthDecreases;
        for (let i = 0; i < absDepthChange; i++) {
          operation();
        }
      }
      // If nesting hasn't changed, stick with the current base
      // Create the <li> for this landmark
      const item = document.createElement("li");
      const button = makeButton(function () {
        send({
          name: "focus-landmark",
          index: index,
        });
      }, landmarkName(landmark));
      item.appendChild(button);
      base.appendChild(item);
      // add to current base
      // Housekeeping
      previousDepth = landmark.depth;
      previousItem = item;
    });
    container.appendChild(root);
  }
  // Remove all nodes contained within a node
  function removeChildNodes(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }
  // Append text paragraph to the given element
  function addText(element, message) {
    const newPara = document.createElement("p");
    const newParaText = document.createTextNode(message);
    newPara.appendChild(newParaText);
    element.appendChild(newPara);
  }
  function makeButton(onClick, text, cssClass, context) {
    const button = document.createElement("button");
    if (cssClass && context) {
      button.className = cssClass;
      button.setAttribute("aria-label", text + " " + context);
    } else {
      button.appendChild(document.createTextNode(text));
    }
    button.addEventListener("click", onClick);
    return button;
  }

  // Showing page warnings in DevTools

  // Note wrangling
  function showNote(id) {
    document.getElementById(id).hidden = false;
  }
  function hideNote(id) {
    document.getElementById(id).hidden = true;
  }
  function showOrHideNote(note, dismissed) {
    note.showOrHide
      ? note.showOrHide(dismissed)
      : dismissed
      ? hideNote(note.id)
      : showNote(note.id);
  }
  // Sidebar-specific: handle the user changing their UI preference (the sidebar
  // may be open, so the note needs to be shown/hidden in real-time).
  function setupNotes() {
    for (const [dismissalSetting, note] of Object.entries(notes)) {
      const ctaId = `${note.id}-cta`;
      const dismissId = `${note.id}-dismiss`;
      document.getElementById(ctaId).addEventListener("click", note.cta);
      document.getElementById(dismissId).addEventListener("click", function () {
        browser.storage.sync.set({
          [dismissalSetting]: true,
        });
      });
    }
    browser.storage.onChanged.addListener(function (changes) {
      for (const dismissalState in defaultDismissalStates) {
        changes.hasOwnProperty(dismissalState) &&
          showOrHideNote(
            notes[dismissalState],
            changes[dismissalState].newValue
          );
      }
    });
    browser.storage.sync.get(defaultDismissalStates, function (items) {
      for (const dismissalState in defaultDismissalStates) {
        notes.hasOwnProperty(dismissalState) &&
          showOrHideNote(notes[dismissalState], items[dismissalState]);
      }
    });
  }

  // Management

  function makeEventHandlers(linkName) {
    const link = document.getElementById(linkName);
    const core = () => {
      browser.runtime.sendMessage({
        name: `open-${linkName}`,
      });
      window.close();
    };
    link.addEventListener("click", core);
    link.addEventListener("keydown", function (event) {
      "Enter" === event.key && core();
    });
  }
  // TODO: this leaves an anonymous code block in the devtools script
  function send(message) {
    withActiveTab((tab) => browser.tabs.sendMessage(tab.id, message));
  }
  function messageHandlerCore(message) {
    "landmarks" === message.name
      ? handleLandmarksMessage(message.data)
      : "toggle-state-is" === message.name &&
        handleToggleStateMessage(message.data);
  }
  function handleToggleStateMessage(state) {
    const box = document.getElementById("show-all");
    switch (state) {
      case "selected":
        box.checked = false;
        break;

      case "all":
        box.checked = true;
        break;

      default:
        throw Error(`Unexpected toggle state "${state}" given.`);
    }
  }
  function startupPopupOrSidebar() {
    makeEventHandlers("help");
    makeEventHandlers("settings");
    // The message could be coming from any content script or other GUI, so
    // it needs to be filtered. (The background script filters out messages
    // for the DevTools panel.)
    browser.runtime.onMessage.addListener(function (message, sender) {
      withActiveTab((tab) => {
        const activeTabId = tab.id;
        (sender.tab && sender.tab.id !== activeTabId) ||
          messageHandlerCore(message);
      });
    });
    // Most GUIs can check that they are running on a content-scriptable
    // page (DevTools doesn't have access to browser.tabs).
    withActiveTab((tab) =>
      browser.tabs.get(tab.id, function (tab) {
        if (!isContentScriptablePage(tab.url)) {
          handleLandmarksMessage(null);
          return;
        }
        browser.tabs.sendMessage(tab.id, {
          name: "get-landmarks",
        });
        browser.tabs.sendMessage(tab.id, {
          name: "get-toggle-state",
        });
      })
    );
    document.getElementById("version").innerText =
      browser.runtime.getManifest().version;
    setupNotes();
  }
  function main() {
    startupPopupOrSidebar();
    document.getElementById("show-all").addEventListener("change", function () {
      send({
        name: "toggle-all-landmarks",
      });
    });
    translate();
  }
  main();
})();
