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

  // User preferences

  const defaultBorderSettings = Object.freeze({
    borderType: "momentary",
    borderColour: "#ff2f92",
    borderFontSize: "16",
  });
  const defaultSettings = Object.freeze(defaultBorderSettings);

  // Dismissal state of user interface messages

  Object.freeze({
    dismissedSidebarNotAlone: false,
  });
  const defaultDismissedUpdate = Object.freeze({
    dismissedUpdate: false,
  });
  const defaultDismissalStates = defaultDismissedUpdate;
  // hasOwnProperty is only used on browser-provided objects

  // Options

  const options = [
    {
      name: "borderType",
      kind: "radio",
    },
    {
      name: "borderColour",
      kind: "individual",
      element: document.getElementById("border-colour"),
    },
    {
      name: "borderFontSize",
      kind: "individual",
      element: document.getElementById("border-font-size"),
    },
  ];
  function restoreOptions() {
    browser.storage.sync.get(defaultSettings, function (items) {
      for (const option of options) {
        const name = option.name;
        const saved = items[name];
        switch (option.kind) {
          case "radio":
            document.getElementById(`radio-${saved}`).checked = true;
            break;

          case "individual":
            option.element.value = saved;
            break;

          default:
            console.error(`Unexpected option kind '${option.kind}'`);
        }
      }
    });
  }
  function setUpOptionHandlers() {
    for (const option of options) {
      "individual" === option.kind &&
        option.element.addEventListener("change", () => {
          browser.storage.sync.set({
            [option.name]: option.element.value,
          });
        });
    }
    for (const radio of document.querySelectorAll('input[type="radio"]')) {
      radio.addEventListener("change", function () {
        const pref = this.parentElement.parentElement.getAttribute("data-pref");
        browser.storage.sync.set({
          [pref]: this.value,
        });
      });
    }
    document.getElementById("reset-messages").onclick = resetMessages;
    document.getElementById("reset-to-defaults").onclick = resetToDefaults;
  }
  function updateResetDismissedMessagesButtonState() {
    const button = document.getElementById("reset-messages");
    const feedback = document.getElementById("reset-messages-feedback");
    browser.storage.sync.get(defaultDismissalStates, function (items) {
      for (const dismissalState in items) {
        if (true === items[dismissalState]) {
          button.dataset.someMessagesDismissed = true;
          feedback.innerText = null;
          return;
        }
      }
      button.dataset.someMessagesDismissed = false;
      feedback.innerText ||
        (feedback.innerText = browser.i18n.getMessage(
          "prefsResetMessagesNone"
        ));
    });
  }
  function resetMessages() {
    if (this.dataset.someMessagesDismissed === String(true)) {
      browser.storage.sync.set(defaultDismissalStates);
      document.getElementById("reset-messages-feedback").innerText =
        browser.i18n.getMessage("prefsResetMessagesDone");
    }
  }
  function dismissalStateChanged(thingChanged) {
    return defaultDismissalStates.hasOwnProperty(thingChanged);
  }
  function resetToDefaults() {
    browser.storage.sync.clear();
    restoreOptions();
  }

  // Entryway

  function main() {
    updateResetDismissedMessagesButtonState();
    browser.storage.onChanged.addListener(function (changes) {
      Object.keys(changes).some(dismissalStateChanged) &&
        updateResetDismissedMessagesButtonState();
    });
    translate();
    restoreOptions();
    setUpOptionHandlers();
  }
  main();
})();
