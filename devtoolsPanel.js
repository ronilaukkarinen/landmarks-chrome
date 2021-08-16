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
  Object.freeze({
    dismissedUpdate: false,
  });
  let port = null;

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
      addInspectButton(item, landmark);
      // TODO: come back to this check; can we make it not needed?
      // When the content script first starts, it assumes that DevTools
      // aren't open. The background script will request a GUI update and
      // whilst unlikely, this might happen before the content script has
      // learnt that DevTools are open.
      landmark.hasOwnProperty("warnings") &&
        landmark.warnings.length > 0 &&
        addElementWarnings(item, landmark, landmark.warnings);
      base.appendChild(item);
      // add to current base
      // Housekeeping
      previousDepth = landmark.depth;
      previousItem = item;
    });
    container.appendChild(root);
  }
  function addInspectButton(root, landmark) {
    const inspectButton = makeButton(
      function () {
        const inspectorCall =
          "inspect(document.querySelector('" + landmark.selector + "'))";
        browser.devtools.inspectedWindow.eval(inspectorCall);
      },
      browser.i18n.getMessage("inspectButtonName"),
      "examine",
      landmarkName(landmark)
    );
    inspectButton.title = landmark.selector;
    root.appendChild(inspectButton);
  }
  function addElementWarnings(root, landmark, array) {
    const details = document.createElement("details");
    details.className = "tooltip";
    const summary = document.createElement("summary");
    summary.setAttribute("class", "lint-warning");
    summary.setAttribute(
      "aria-label",
      browser.i18n.getMessage("lintWarningPrefix") + " " + landmark.role
    );
    details.appendChild(summary);
    makeWarnings(details, array);
    root.appendChild(details);
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

  function handlePageWarningsMessage(warnings) {
    const container = document.getElementById("page-warnings-container");
    if (0 === warnings.length) {
      container.hidden = true;
    } else {
      const root = document.getElementById("page-warnings");
      removeChildNodes(root);
      makeWarnings(root, warnings);
      container.hidden = false;
    }
  }
  function makeWarnings(root, warningKeys) {
    if (warningKeys.length > 1) {
      const list = document.createElement("ul");
      for (const warningKey of warningKeys) {
        const item = document.createElement("li");
        const para = document.createElement("p");
        para.appendChild(
          document.createTextNode(browser.i18n.getMessage(warningKey))
        );
        item.appendChild(para);
        list.appendChild(item);
      }
      root.appendChild(list);
    } else {
      const para = document.createElement("p");
      para.appendChild(
        document.createTextNode(browser.i18n.getMessage(warningKeys[0]))
      );
      root.appendChild(para);
    }
  }

  // Note wrangling

  // TODO: this leaves an anonymous code block in the devtools script
  function send(message) {
    {
      const messageWithTabId = Object.assign({}, message, {
        from: browser.devtools.inspectedWindow.tabId,
      });
      port.postMessage(messageWithTabId);
    }
  }
  function messageHandlerCore(message) {
    if ("landmarks" === message.name) {
      handleLandmarksMessage(message.data);
      send({
        name: "get-page-warnings",
      });
    } else {
      "toggle-state-is" === message.name
        ? handleToggleStateMessage(message.data)
        : "mutation-info" === message.name
        ? handleMutationMessage(message.data)
        : "page-warnings" === message.name &&
          handlePageWarningsMessage(message.data);
    }
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
  function handleMutationMessage(data) {
    for (const key in data) {
      document.getElementById(key).textContent = data[key];
    }
  }
  function reflectDevToolsTheme(themeName) {
    document.documentElement.classList = `theme-${themeName}`;
  }

  // Start-up

  // Note: Firefox doesn't use 'devToolsConnectionError' but if it is not
  //       mentioned here, the build will not pass the unused messages check.
  //       Keeping it in the GUI HTML but hiding it is hacky, as the browser
  //       really isn't using it, but at least it keeps all the code here, rather
  //       than putting some separately in the build script.
  function startupDevTools() {
    reflectDevToolsTheme(browser.devtools.panels.themeName);
    port = browser.runtime.connect({
      name: "devtools",
    });
    // DevTools page doesn't get reloaded when the extension does
    port.onDisconnect.addListener(function () {
      document.getElementById("connection-error").hidden = false;
    });
    port.onMessage.addListener(messageHandlerCore);
    port.postMessage({
      name: "init",
      tabId: browser.devtools.inspectedWindow.tabId,
    });
    // The checking for if the page is scriptable is done at the other end.
    send({
      name: "get-landmarks",
    });
    send({
      name: "get-toggle-state",
    });
    send({
      name: "get-mutation-info",
    });
  }
  function main() {
    startupDevTools();
    document.getElementById("show-all").addEventListener("change", function () {
      send({
        name: "toggle-all-landmarks",
      });
    });
    translate();
  }
  main();
})();
