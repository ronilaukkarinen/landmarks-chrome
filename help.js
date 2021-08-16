(function () {
  "use strict";
  // TODO localise fully
  let allShortcutsAreSet;
  const shortcutTableRows = [
    {
      element: "tr",
      contains: [
        {
          element: "th",
          content: "Action",
        },
        {
          element: "th",
          content: "Keyboard shortcut",
        },
      ],
    },
  ];
  function makeHTML(structure, root) {
    let newElement;
    for (const key in structure) {
      switch (key) {
        case "element":
          newElement = document.createElement(structure[key]);
          root.appendChild(newElement);
          break;

        case "class":
          newElement.classList.add(structure[key]);
          break;

        case "tabindex":
          newElement.setAttribute("tabindex", String(structure[key]));
          break;

        case "text":
          root.appendChild(document.createTextNode(structure[key]));
          break;

        case "content":
          newElement.appendChild(document.createTextNode(structure[key]));
          break;

        case "listen":
          for (const eventHandler of structure[key]) {
            newElement.addEventListener(
              eventHandler.event,
              eventHandler.handler
            );
          }
          break;

        case "contains":
          for (const contained of structure[key]) {
            makeHTML(contained, newElement || root);
          }
          break;

        default:
          throw Error(`Unexpected structure key "${key}" encountered.`);
      }
    }
    return root;
  }
  function addCommandRowAndReportIfMissing(command) {
    // Work out the command's friendly name
    const action =
      "_execute_browser_action" === command.name
        ? "Show pop-up"
        : command.description;
    // Work out the command's shortcut
    let shortcutCellElement;
    if (command.shortcut) {
      shortcutCellElement = {
        element: "td",
        contains: [
          {
            element: "kbd",
            content: command.shortcut,
          },
        ],
      };
    } else {
      shortcutCellElement = {
        element: "td",
        class: "missing-shortcut",
        contains: [
          {
            text: "Not set up",
          },
        ],
      };
      allShortcutsAreSet = false;
    }
    shortcutTableRows.push({
      element: "tr",
      contains: [
        {
          element: "td",
          content: action,
        },
        shortcutCellElement,
      ],
    });
  }
  function handlePopulateCommandsMessage(message, id) {
    // Chrome allows only four keyboard shortcuts to be specified in the
    // manifest; Firefox allows many.
    // The extra ones for Firefox are patched in via its specific manifest file
    // when the manifest is merged.
    // The commands are in the manifest in the opposite order to that which
    // seems most logical, and need to be reversed to pop out in the right
    // order on the splash page. This is because the merging in of the extra
    // keyboard shortcuts means that the commands with added keyboard shortucts
    // in Firefox are bumped to the top of the commands object.
    // What is a bit odd is that, on Chrome, it appears the reversal is not
    // needed.
    allShortcutsAreSet = true;
    const commandsInOrder = message.commands;
    for (const command of commandsInOrder) {
      addCommandRowAndReportIfMissing(command);
    }
    makeHTML(
      {
        element: "table",
        contains: shortcutTableRows,
      },
      document.getElementById(id)
    );
    return allShortcutsAreSet;
  }
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
  function messageHandler(message) {
    if ("populate-commands" !== message.name) {
      return;
    }
    const allShortcutsAreSet = handlePopulateCommandsMessage(
      message,
      "keyboard-shortcuts-table"
    );
    document.getElementById("warning-shortcuts").hidden = allShortcutsAreSet;
    allShortcutsAreSet ||
      document
        .getElementById("section-keyboard-shortcuts-heading")
        .classList.add("missing-shortcut");
  }
  function includeVersionNumber() {
    document.getElementById("version").innerText =
      browser.runtime.getManifest().version;
  }
  function reflectInstallOrUpdate() {
    // Move the appropriate section to the top
    const fragment = window.location.hash.substr(2);
    let sectionToMove = null;
    switch (fragment) {
      case "install":
        sectionToMove = document.getElementById("section-features");
        break;

      case "update":
        sectionToMove = document.getElementById("section-new");
    }
    sectionToMove &&
      document.getElementById("placeholder").appendChild(sectionToMove);
  }
  function main() {
    translate();
    // to refer to the "go to main" command; main and nav regions
    browser.runtime.onMessage.addListener(messageHandler);
    browser.runtime.sendMessage({
      name: "get-commands",
    });
    document.getElementById("keyboard-shortcuts-instructions-firefox").remove();
    document
      .getElementById("open-browser-shortcuts-settings")
      .addEventListener("click", () =>
        browser.runtime.sendMessage({
          name: "open-configure-shortcuts",
        })
      );
    includeVersionNumber();
    reflectInstallOrUpdate();
  }
  main();
})();
