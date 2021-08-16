(function () {
  "use strict";
  window.browser = window.chrome;
  /* eslint-disable no-prototype-builtins */
  function LandmarksFinder$1(win, doc, useHeuristics) {
    // Constants
    // List of landmarks to navigate
    const regionTypes = Object.freeze([
      // Core ARIA
      "banner",
      "complementary",
      "contentinfo",
      "form", // spec says should label
      "main",
      "navigation",
      "region", // spec says must label
      "search",
      // Digital Publishing ARIA module
      "doc-acknowledgments",
      "doc-afterword",
      "doc-appendix",
      "doc-bibliography",
      "doc-chapter",
      "doc-conclusion",
      "doc-credits",
      "doc-endnotes",
      "doc-epilogue",
      "doc-errata",
      "doc-foreword",
      "doc-glossary",
      "doc-index", // via navigation
      "doc-introduction",
      "doc-pagelist", // via navigation
      "doc-part",
      "doc-preface",
      "doc-prologue",
      "doc-toc",
    ]);
    // Mapping of HTML5 elements to implicit roles
    const implicitRoles = Object.freeze({
      ASIDE: "complementary",
      FOOTER: "contentinfo",
      // depending on its ancestor elements
      FORM: "form",
      HEADER: "banner",
      // depending on its ancestor elements
      MAIN: "main",
      NAV: "navigation",
      SECTION: "region",
    });
    // Sectioning content elements
    const sectioningContentElements = Object.freeze([
      "ARTICLE",
      "ASIDE",
      "NAV",
      "SECTION",
    ]);
    // Non-<body> sectioning root elements
    const nonBodySectioningRootElements = Object.freeze([
      "BLOCKQUOTE",
      "DETAILS",
      "FIELDSET",
      "FIGURE",
      "TD",
    ]);
    // non-<body> sectioning elements and <main>
    const nonBodySectioningElementsAndMain = Object.freeze(
      sectioningContentElements.concat(nonBodySectioningRootElements, "MAIN")
    );
    // Found landmarks
    let landmarks = [];
    // Each member of this array is an object of the form:
    //   depth (int)                     -- indicates nesting of landmarks
    //   role (string)                   -- the ARIA role
    //   roleDescription (string | null) -- custom role description
    //   label (string | null)           -- associated label
    //   selector (string)               -- CSS selector path of element
    //   element (HTML*Element)          -- in-memory element
    //   guessed (bool)                  -- landmark was gathered by heuristic
    // and, in developer mode:
    //   warnings [string]               -- list of warnings about this element
    // Keeping track of landmark navigation
    let currentlySelectedIndex;
    // the landmark currently having focus/border
    let mainElementIndices = [];
    // if we find <main> or role="main" elements
    let mainIndexPointer;
    // allows us to cylce through main regions
    let foundNavigationRegion;
    // if not, we can go and guess one
    // Keep a reference to the currently-selected element in case the page
    // changes and the landmark is still there, but has moved within the list.
    let currentlySelectedElement;
    function updateSelectedAndReturnElementInfo(index) {
      // TODO: Don't need an index check, as we trust the source. Does that
      //       mean we also don't need the length check?
      if (0 === landmarks.length) {
        return;
      }
      currentlySelectedIndex = index;
      currentlySelectedElement = landmarks[index].element;
      return {
        element: currentlySelectedElement,
        role: landmarks[index].role,
        roleDescription: landmarks[index].roleDescription,
        label: landmarks[index].label,
        guessed: landmarks[index].guessed,
      };
    }
    // Finding landmarks
    // Recursive function for building list of landmarks from a root element
    function getLandmarks(element, depth, parentLandmark) {
      if (isVisuallyHidden(element) || isSemantiallyHidden(element)) {
        return;
        // Support HTML5 elements' native roles
      }
      let role = getRoleFromTagNameAndContainment(element);
      let explicitRole = false;
      // Elements with explicitly-set rolees
      if (element.getAttribute) {
        const tempRole = element.getAttribute("role");
        if (tempRole) {
          role = tempRole;
          explicitRole = true;
        }
      }
      // The element may or may not have a label
      const label = getARIAProvidedLabel(element);
      // Add the element if it should be considered a landmark
      if (role && isLandmark(role, explicitRole, label)) {
        parentLandmark && parentLandmark.contains(element) && (depth += 1);
        landmarks.push({
          depth: depth,
          role: role,
          roleDescription: getRoleDescription(element),
          label: label,
          element: element,
          selector: createSelector(element),
          guessed: false,
        });
        // Was this element selected before we were called (i.e.
        // before the page was dynamically updated)?
        currentlySelectedElement === element &&
          (currentlySelectedIndex = landmarks.length - 1);
        // There should only be one main region, but pages may be bad and
        // wrong, so catch 'em all...
        "main" === role && mainElementIndices.push(landmarks.length - 1);
        parentLandmark = element;
      }
      // One just one page I've seen an error here in Chrome (91) which seems
      // to be a bug, because only one HTMLElement was returned; not an
      // HTMLCollection. Checking for this would cause a slowdown, so
      // ignoring for now.
      for (const elementChild of element.children) {
        getLandmarks(elementChild, depth, parentLandmark);
      }
    }
    function getARIAProvidedLabel(element) {
      let label = null;
      // TODO general whitespace test?
      const idRefs = element.getAttribute("aria-labelledby");
      if (null !== idRefs && idRefs.length > 0) {
        const innerTexts = Array.from(idRefs.split(" "), (idRef) => {
          const labelElement = doc.getElementById(idRef);
          return getInnerText(labelElement);
        });
        label = innerTexts.join(" ");
      }
      null === label && (label = element.getAttribute("aria-label"));
      return label;
    }
    function isLandmark(role, explicitRole, label) {
      // <section> and <form> are only landmarks when labelled.
      // <div role="form"> is always a landmark.
      if ("region" === role || ("form" === role && !explicitRole)) {
        return null !== label;
      }
      // Is the role (which may've been explicitly set) a valid landmark type?
      return regionTypes.includes(role);
    }
    function getInnerText(element) {
      let text = null;
      if (element) {
        text = element.innerText;
        void 0 === text && (text = element.textContent);
      }
      return text;
    }
    function getRoleFromTagNameAndContainment(element) {
      const name = element.tagName;
      let role = null;
      if (name) {
        implicitRoles.hasOwnProperty(name) && (role = implicitRoles[name]);
        // <header> and <footer> elements have some containment-
        // related constraints on whether they're counted as landmarks
        ("HEADER" !== name && "FOOTER" !== name) ||
          isChildOfTopLevelSection(element) ||
          (role = null);
      }
      return role;
    }
    function getRoleDescription(element) {
      const roleDescription = element.getAttribute("aria-roledescription");
      // TODO make this a general whitespace check?
      if (/^\s*$/.test(roleDescription)) {
        return null;
      }
      return roleDescription;
    }
    function isChildOfTopLevelSection(element) {
      let ancestor = element.parentNode;
      while (null !== ancestor) {
        if (nonBodySectioningElementsAndMain.includes(ancestor.tagName)) {
          return false;
        }
        ancestor = ancestor.parentNode;
      }
      return true;
    }
    // TODO: Check if we need this at all?
    // Note: This only checks the element itself: it won't reflect if this
    //       element is contained in another that _is_ visually hidden. So far
    //       this only seems to be a problem for some OTTly-guessed landmarks,
    //       though (heuristics aren't using this function, but there's no
    //       point due to not considering the parents).
    // https://stackoverflow.com/a/56692552/1485308
    // https://stackoverflow.com/q/19669786/1485308
    function isVisuallyHidden(element) {
      const style = win.getComputedStyle(element);
      if (
        element.hasAttribute("hidden") ||
        "hidden" === style.visibility ||
        "none" === style.display
      ) {
        return true;
      }
      return false;
    }
    function isSemantiallyHidden(element) {
      if (
        "true" === element.getAttribute("aria-hidden") ||
        (element.hasAttribute("inert") &&
          "false" !== element.getAttribute("inert"))
      ) {
        return true;
      }
      return false;
    }
    function createSelector(element) {
      const reversePath = [];
      let node = element;
      while ("HTML" !== node.tagName) {
        const tag = node.tagName.toLowerCase();
        const id = node.id;
        const klass = node.classList.length > 0 ? node.classList[0] : null;
        let description;
        if (id) {
          description = "#" + id;
        } else {
          // If the element tag is not unique amongst its siblings, then
          // we'll need to include an nth-child bit on the end of the
          // selector part for this element.
          const siblingElementTagNames = Array.from(
            node.parentNode.children,
            (x) => x.tagName
          );
          const uniqueSiblingElementTagNames = [
            ...new Set(siblingElementTagNames),
          ];
          // Array API is neater
          // Include element's class if need be.
          // TODO this probably isn't needed as we have nth-child.
          description = klass ? tag + "." + klass : tag;
          if (
            siblingElementTagNames.length > uniqueSiblingElementTagNames.length
          ) {
            const siblingNumber =
              Array.prototype.indexOf.call(node.parentNode.children, node) + 1;
            description += ":nth-child(" + siblingNumber + ")";
          }
        }
        reversePath.push(description);
        if (id) {
          break;
        }
        node = node.parentNode;
      }
      return reversePath.reverse().join(" > ");
    }
    // Developer mode-specific checks
    // Heuristic checks
    function makeLandmarkEntry(guessed, role) {
      return {
        depth: 0,
        role: role,
        roleDescription: getRoleDescription(guessed),
        label: getARIAProvidedLabel(guessed),
        element: guessed,
        selector: createSelector(guessed),
        guessed: true,
      };
    }
    function addGuessed(guessed, role) {
      if (guessed && guessed.innerText) {
        if (0 === landmarks.length) {
          landmarks.push(makeLandmarkEntry(guessed, role));
          "main" === role && (mainElementIndices = [0]);
        } else {
          const insertAt = getIndexOfLandmarkAfter(guessed) ?? landmarks.length;
          landmarks.splice(insertAt, 0, makeLandmarkEntry(guessed, role));
          "main" === role && (mainElementIndices = [insertAt]);
        }
        return true;
      }
      return false;
    }
    function tryFindingMain() {
      if (0 === mainElementIndices.length) {
        for (const id of ["main", "content", "main-content"]) {
          if (addGuessed(doc.getElementById(id), "main")) {
            return;
          }
        }
        const classMains = doc.getElementsByClassName("main");
        1 === classMains.length && addGuessed(classMains[0], "main");
      }
    }
    function tryFindingNavs() {
      if (!foundNavigationRegion) {
        for (const id of ["navigation", "nav"]) {
          if (addGuessed(doc.getElementById(id), "navigation")) {
            break;
          }
        }
        for (const className of ["navigation", "nav"]) {
          for (const guessed of doc.getElementsByClassName(className)) {
            addGuessed(guessed, "navigation");
          }
        }
      }
    }
    function tryHeuristics() {
      tryFindingMain();
      tryFindingNavs();
    }
    // Support for finding next landmark from focused element
    function getIndexOfLandmarkAfter(element) {
      for (let i = 0; i < landmarks.length; i++) {
        const rels = element.compareDocumentPosition(landmarks[i].element);
        // eslint-disable-next-line no-bitwise
        if (rels & win.Node.DOCUMENT_POSITION_FOLLOWING) {
          return i;
        }
      }
      return null;
    }
    function getIndexOfLandmarkBefore(element) {
      for (let i = landmarks.length - 1; i >= 0; i--) {
        const rels = element.compareDocumentPosition(landmarks[i].element);
        // eslint-disable-next-line no-bitwise
        if (rels & win.Node.DOCUMENT_POSITION_PRECEDING) {
          return i;
        }
      }
      return null;
    }
    // Public API
    this.find = function () {
      landmarks = [];
      mainElementIndices = [];
      mainIndexPointer = -1;
      foundNavigationRegion = false;
      currentlySelectedIndex = -1;
      getLandmarks(doc.body.parentNode, 0, null);
      // supports role on <body>
      useHeuristics && tryHeuristics();
    };
    this.getNumberOfLandmarks = function () {
      return landmarks.length;
    };
    // This includes the selector, warnings, everything except the element
    this.allInfos = () =>
      landmarks.map((landmark) => {
        // eslint-disable-next-line no-unused-vars
        const { element: element, ...info } = landmark;
        return info;
      });
    this.allElementsInfos = function () {
      return landmarks.slice();
      // TODO: Need a copy?
    };
    // These all return elements and their related info
    this.getNextLandmarkElementInfo = function () {
      if (null !== doc.activeElement && doc.activeElement !== doc.body) {
        const index = getIndexOfLandmarkAfter(doc.activeElement);
        if (null !== index) {
          return updateSelectedAndReturnElementInfo(index);
        }
      }
      return updateSelectedAndReturnElementInfo(
        (currentlySelectedIndex + 1) % landmarks.length
      );
    };
    this.getPreviousLandmarkElementInfo = function () {
      if (null !== doc.activeElement && doc.activeElement !== doc.body) {
        const index = getIndexOfLandmarkBefore(doc.activeElement);
        if (null !== index) {
          return updateSelectedAndReturnElementInfo(index);
        }
      }
      return updateSelectedAndReturnElementInfo(
        currentlySelectedIndex <= 0
          ? landmarks.length - 1
          : currentlySelectedIndex - 1
      );
    };
    this.getLandmarkElementInfo = function (index) {
      return updateSelectedAndReturnElementInfo(index);
    };
    // If pages are naughty and have more than one 'main' region, we cycle
    // betwixt them.
    this.getMainElementInfo = function () {
      if (mainElementIndices.length > 0) {
        mainIndexPointer = (mainIndexPointer + 1) % mainElementIndices.length;
        const mainElementIndex = mainElementIndices[mainIndexPointer];
        return updateSelectedAndReturnElementInfo(mainElementIndex);
      }
      return null;
    };
  }
  /* eslint-disable no-prototype-builtins */ function LandmarksFinder(
    win,
    doc,
    useHeuristics
  ) {
    // Constants
    // List of landmarks to navigate
    const regionTypes = Object.freeze([
      // Core ARIA
      "banner",
      "complementary",
      "contentinfo",
      "form", // spec says should label
      "main",
      "navigation",
      "region", // spec says must label
      "search",
      // Digital Publishing ARIA module
      "doc-acknowledgments",
      "doc-afterword",
      "doc-appendix",
      "doc-bibliography",
      "doc-chapter",
      "doc-conclusion",
      "doc-credits",
      "doc-endnotes",
      "doc-epilogue",
      "doc-errata",
      "doc-foreword",
      "doc-glossary",
      "doc-index", // via navigation
      "doc-introduction",
      "doc-pagelist", // via navigation
      "doc-part",
      "doc-preface",
      "doc-prologue",
      "doc-toc",
    ]);
    // Mapping of HTML5 elements to implicit roles
    const implicitRoles = Object.freeze({
      ASIDE: "complementary",
      FOOTER: "contentinfo",
      // depending on its ancestor elements
      FORM: "form",
      HEADER: "banner",
      // depending on its ancestor elements
      MAIN: "main",
      NAV: "navigation",
      SECTION: "region",
    });
    // Sectioning content elements
    const sectioningContentElements = Object.freeze([
      "ARTICLE",
      "ASIDE",
      "NAV",
      "SECTION",
    ]);
    // Non-<body> sectioning root elements
    const nonBodySectioningRootElements = Object.freeze([
      "BLOCKQUOTE",
      "DETAILS",
      "FIELDSET",
      "FIGURE",
      "TD",
    ]);
    // non-<body> sectioning elements and <main>
    const nonBodySectioningElementsAndMain = Object.freeze(
      sectioningContentElements.concat(nonBodySectioningRootElements, "MAIN")
    );
    // Found landmarks
    let landmarks = [];
    // Each member of this array is an object of the form:
    //   depth (int)                     -- indicates nesting of landmarks
    //   role (string)                   -- the ARIA role
    //   roleDescription (string | null) -- custom role description
    //   label (string | null)           -- associated label
    //   selector (string)               -- CSS selector path of element
    //   element (HTML*Element)          -- in-memory element
    //   guessed (bool)                  -- landmark was gathered by heuristic
    // and, in developer mode:
    //   warnings [string]               -- list of warnings about this element
    let _pageWarnings = [];
    const _unlabelledRoleElements = new Map();
    let _visibleMainElements = [];
    // Keeping track of landmark navigation
    let currentlySelectedIndex;
    // the landmark currently having focus/border
    let mainElementIndices = [];
    // if we find <main> or role="main" elements
    let mainIndexPointer;
    // allows us to cylce through main regions
    let foundNavigationRegion;
    // if not, we can go and guess one
    // Keep a reference to the currently-selected element in case the page
    // changes and the landmark is still there, but has moved within the list.
    let currentlySelectedElement;
    function updateSelectedAndReturnElementInfo(index) {
      // TODO: Don't need an index check, as we trust the source. Does that
      //       mean we also don't need the length check?
      if (0 === landmarks.length) {
        return;
      }
      currentlySelectedIndex = index;
      currentlySelectedElement = landmarks[index].element;
      return {
        element: currentlySelectedElement,
        role: landmarks[index].role,
        roleDescription: landmarks[index].roleDescription,
        label: landmarks[index].label,
        guessed: landmarks[index].guessed,
      };
    }
    // Finding landmarks
    // Recursive function for building list of landmarks from a root element
    function getLandmarks(element, depth, parentLandmark) {
      if (isVisuallyHidden(element) || isSemantiallyHidden(element)) {
        return;
        // Support HTML5 elements' native roles
      }
      let role = getRoleFromTagNameAndContainment(element);
      let explicitRole = false;
      // Elements with explicitly-set rolees
      if (element.getAttribute) {
        const tempRole = element.getAttribute("role");
        if (tempRole) {
          role = tempRole;
          explicitRole = true;
        }
      }
      // The element may or may not have a label
      const label = getARIAProvidedLabel(element);
      // Add the element if it should be considered a landmark
      if (role && isLandmark(role, explicitRole, label)) {
        parentLandmark && parentLandmark.contains(element) && (depth += 1);
        landmarks.push({
          depth: depth,
          role: role,
          roleDescription: getRoleDescription(element),
          label: label,
          element: element,
          selector: createSelector(element),
          guessed: false,
        });
        landmarks[landmarks.length - 1].warnings = [];
        if (!label) {
          _unlabelledRoleElements.has(role) ||
            _unlabelledRoleElements.set(role, []);
          _unlabelledRoleElements.get(role).push(element);
        }
        "main" !== role ||
          false !== explicitRole ||
          isVisuallyHidden(element) ||
          _visibleMainElements.push(element);
        // Was this element selected before we were called (i.e.
        // before the page was dynamically updated)?
        currentlySelectedElement === element &&
          (currentlySelectedIndex = landmarks.length - 1);
        // There should only be one main region, but pages may be bad and
        // wrong, so catch 'em all...
        "main" === role && mainElementIndices.push(landmarks.length - 1);
        parentLandmark = element;
      }
      // One just one page I've seen an error here in Chrome (91) which seems
      // to be a bug, because only one HTMLElement was returned; not an
      // HTMLCollection. Checking for this would cause a slowdown, so
      // ignoring for now.
      for (const elementChild of element.children) {
        getLandmarks(elementChild, depth, parentLandmark);
      }
    }
    function getARIAProvidedLabel(element) {
      let label = null;
      // TODO general whitespace test?
      const idRefs = element.getAttribute("aria-labelledby");
      if (null !== idRefs && idRefs.length > 0) {
        const innerTexts = Array.from(idRefs.split(" "), (idRef) => {
          const labelElement = doc.getElementById(idRef);
          return getInnerText(labelElement);
        });
        label = innerTexts.join(" ");
      }
      null === label && (label = element.getAttribute("aria-label"));
      return label;
    }
    function isLandmark(role, explicitRole, label) {
      // <section> and <form> are only landmarks when labelled.
      // <div role="form"> is always a landmark.
      if ("region" === role || ("form" === role && !explicitRole)) {
        return null !== label;
      }
      // Is the role (which may've been explicitly set) a valid landmark type?
      return regionTypes.includes(role);
    }
    function getInnerText(element) {
      let text = null;
      if (element) {
        text = element.innerText;
        void 0 === text && (text = element.textContent);
      }
      return text;
    }
    function getRoleFromTagNameAndContainment(element) {
      const name = element.tagName;
      let role = null;
      if (name) {
        implicitRoles.hasOwnProperty(name) && (role = implicitRoles[name]);
        // <header> and <footer> elements have some containment-
        // related constraints on whether they're counted as landmarks
        ("HEADER" !== name && "FOOTER" !== name) ||
          isChildOfTopLevelSection(element) ||
          (role = null);
      }
      return role;
    }
    function getRoleDescription(element) {
      const roleDescription = element.getAttribute("aria-roledescription");
      // TODO make this a general whitespace check?
      if (/^\s*$/.test(roleDescription)) {
        return null;
      }
      return roleDescription;
    }
    function isChildOfTopLevelSection(element) {
      let ancestor = element.parentNode;
      while (null !== ancestor) {
        if (nonBodySectioningElementsAndMain.includes(ancestor.tagName)) {
          return false;
        }
        ancestor = ancestor.parentNode;
      }
      return true;
    }
    // TODO: Check if we need this at all?
    // Note: This only checks the element itself: it won't reflect if this
    //       element is contained in another that _is_ visually hidden. So far
    //       this only seems to be a problem for some OTTly-guessed landmarks,
    //       though (heuristics aren't using this function, but there's no
    //       point due to not considering the parents).
    // https://stackoverflow.com/a/56692552/1485308
    // https://stackoverflow.com/q/19669786/1485308
    function isVisuallyHidden(element) {
      const style = win.getComputedStyle(element);
      if (
        element.hasAttribute("hidden") ||
        "hidden" === style.visibility ||
        "none" === style.display
      ) {
        return true;
      }
      return false;
    }
    function isSemantiallyHidden(element) {
      if (
        "true" === element.getAttribute("aria-hidden") ||
        (element.hasAttribute("inert") &&
          "false" !== element.getAttribute("inert"))
      ) {
        return true;
      }
      return false;
    }
    function createSelector(element) {
      const reversePath = [];
      let node = element;
      while ("HTML" !== node.tagName) {
        const tag = node.tagName.toLowerCase();
        const id = node.id;
        const klass = node.classList.length > 0 ? node.classList[0] : null;
        let description;
        if (id) {
          description = "#" + id;
        } else {
          // If the element tag is not unique amongst its siblings, then
          // we'll need to include an nth-child bit on the end of the
          // selector part for this element.
          const siblingElementTagNames = Array.from(
            node.parentNode.children,
            (x) => x.tagName
          );
          const uniqueSiblingElementTagNames = [
            ...new Set(siblingElementTagNames),
          ];
          // Array API is neater
          // Include element's class if need be.
          // TODO this probably isn't needed as we have nth-child.
          description = klass ? tag + "." + klass : tag;
          if (
            siblingElementTagNames.length > uniqueSiblingElementTagNames.length
          ) {
            const siblingNumber =
              Array.prototype.indexOf.call(node.parentNode.children, node) + 1;
            description += ":nth-child(" + siblingNumber + ")";
          }
        }
        reversePath.push(description);
        if (id) {
          break;
        }
        node = node.parentNode;
      }
      return reversePath.reverse().join(" > ");
    }
    // Developer mode-specific checks
    function developerModeChecks() {
      const _duplicateUnlabelledWarnings = getDuplicateUnlabelledWarnings();
      0 === mainElementIndices.length && _pageWarnings.push("lintNoMain");
      mainElementIndices.length > 1 && _pageWarnings.push("lintManyMains");
      for (const landmark of landmarks) {
        _visibleMainElements.length > 1 &&
          _visibleMainElements.includes(landmark.element) &&
          landmark.warnings.push("lintManyVisibleMainElements");
        _duplicateUnlabelledWarnings.has(landmark.element) &&
          landmark.warnings.push(
            _duplicateUnlabelledWarnings.get(landmark.element)
          );
      }
    }
    function getDuplicateUnlabelledWarnings() {
      const _duplicateUnlabelledWarnings = new Map();
      for (const elements of _unlabelledRoleElements.values()) {
        if (elements.length > 1) {
          for (const element of elements) {
            _duplicateUnlabelledWarnings.set(
              element,
              "lintDuplicateUnlabelled"
            );
          }
        }
      }
      return _duplicateUnlabelledWarnings;
    }
    // Heuristic checks
    function makeLandmarkEntry(guessed, role) {
      return {
        depth: 0,
        role: role,
        roleDescription: getRoleDescription(guessed),
        label: getARIAProvidedLabel(guessed),
        element: guessed,
        selector: createSelector(guessed),
        guessed: true,
      };
    }
    function addGuessed(guessed, role) {
      if (guessed && guessed.innerText) {
        if (0 === landmarks.length) {
          landmarks.push(makeLandmarkEntry(guessed, role));
          "main" === role && (mainElementIndices = [0]);
        } else {
          const insertAt = getIndexOfLandmarkAfter(guessed) ?? landmarks.length;
          landmarks.splice(insertAt, 0, makeLandmarkEntry(guessed, role));
          "main" === role && (mainElementIndices = [insertAt]);
        }
        return true;
      }
      return false;
    }
    function tryFindingMain() {
      if (0 === mainElementIndices.length) {
        for (const id of ["main", "content", "main-content"]) {
          if (addGuessed(doc.getElementById(id), "main")) {
            return;
          }
        }
        const classMains = doc.getElementsByClassName("main");
        1 === classMains.length && addGuessed(classMains[0], "main");
      }
    }
    function tryFindingNavs() {
      if (!foundNavigationRegion) {
        for (const id of ["navigation", "nav"]) {
          if (addGuessed(doc.getElementById(id), "navigation")) {
            break;
          }
        }
        for (const className of ["navigation", "nav"]) {
          for (const guessed of doc.getElementsByClassName(className)) {
            addGuessed(guessed, "navigation");
          }
        }
      }
    }
    function tryHeuristics() {
      tryFindingMain();
      tryFindingNavs();
    }
    // Support for finding next landmark from focused element
    function getIndexOfLandmarkAfter(element) {
      for (let i = 0; i < landmarks.length; i++) {
        const rels = element.compareDocumentPosition(landmarks[i].element);
        // eslint-disable-next-line no-bitwise
        if (rels & win.Node.DOCUMENT_POSITION_FOLLOWING) {
          return i;
        }
      }
      return null;
    }
    function getIndexOfLandmarkBefore(element) {
      for (let i = landmarks.length - 1; i >= 0; i--) {
        const rels = element.compareDocumentPosition(landmarks[i].element);
        // eslint-disable-next-line no-bitwise
        if (rels & win.Node.DOCUMENT_POSITION_PRECEDING) {
          return i;
        }
      }
      return null;
    }
    // Public API
    this.find = function () {
      _pageWarnings = [];
      _unlabelledRoleElements.clear();
      _visibleMainElements = [];
      landmarks = [];
      mainElementIndices = [];
      mainIndexPointer = -1;
      foundNavigationRegion = false;
      currentlySelectedIndex = -1;
      getLandmarks(doc.body.parentNode, 0, null);
      // supports role on <body>
      developerModeChecks();
      useHeuristics && tryHeuristics();
    };
    this.getNumberOfLandmarks = function () {
      return landmarks.length;
    };
    // This includes the selector, warnings, everything except the element
    this.allInfos = () =>
      landmarks.map((landmark) => {
        // eslint-disable-next-line no-unused-vars
        const { element: element, ...info } = landmark;
        return info;
      });
    this.allElementsInfos = function () {
      return landmarks.slice();
      // TODO: Need a copy?
    };
    this.pageResults = function () {
      return _pageWarnings;
    };
    // These all return elements and their related info
    this.getNextLandmarkElementInfo = function () {
      if (null !== doc.activeElement && doc.activeElement !== doc.body) {
        const index = getIndexOfLandmarkAfter(doc.activeElement);
        if (null !== index) {
          return updateSelectedAndReturnElementInfo(index);
        }
      }
      return updateSelectedAndReturnElementInfo(
        (currentlySelectedIndex + 1) % landmarks.length
      );
    };
    this.getPreviousLandmarkElementInfo = function () {
      if (null !== doc.activeElement && doc.activeElement !== doc.body) {
        const index = getIndexOfLandmarkBefore(doc.activeElement);
        if (null !== index) {
          return updateSelectedAndReturnElementInfo(index);
        }
      }
      return updateSelectedAndReturnElementInfo(
        currentlySelectedIndex <= 0
          ? landmarks.length - 1
          : currentlySelectedIndex - 1
      );
    };
    this.getLandmarkElementInfo = function (index) {
      return updateSelectedAndReturnElementInfo(index);
    };
    // If pages are naughty and have more than one 'main' region, we cycle
    // betwixt them.
    this.getMainElementInfo = function () {
      if (mainElementIndices.length > 0) {
        mainIndexPointer = (mainIndexPointer + 1) % mainElementIndices.length;
        const mainElementIndex = mainElementIndices[mainIndexPointer];
        return updateSelectedAndReturnElementInfo(mainElementIndex);
      }
      return null;
    };
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
  function ElementFocuser(doc, borderDrawer) {
    const momentaryBorderTime = 2e3;
    let borderType = defaultBorderSettings.borderType;
    // cached for simplicity
    let managingBorders = true;
    // draw and remove borders by default
    let currentElementInfo = null;
    let borderRemovalTimer = null;

    // Options handling

    // Take a local copy of the border type option at the start (this means
    // that 'gets' of options don't need to be done asynchronously in the rest
    // of the code).
    browser.storage.sync.get(defaultBorderSettings, function (items) {
      borderType = items["borderType"];
    });
    browser.storage.onChanged.addListener(function (changes) {
      if ("borderType" in changes) {
        borderType =
          changes.borderType.newValue ?? defaultBorderSettings.borderType;
        borderTypeChange();
      }
    });

    // Public API

    // Set focus on the selected landmark element. It takes an element info
    // object, as returned by the various LandmarksFinder functions.

    // Note: this should only be called if landmarks were found. The check
    //       for this is done in the main content script, as it involves UI
    //       activity, and couples finding and focusing.
    this.focusElement = function (elementInfo) {
      managingBorders && this.clear();
      // Ensure that the element is focusable
      const originalTabindex = elementInfo.element.getAttribute("tabindex");
      (null !== originalTabindex && "0" !== originalTabindex) ||
        elementInfo.element.setAttribute("tabindex", "-1");
      elementInfo.element.scrollIntoView();
      // always go to the top of it
      elementInfo.element.focus();
      // Add the border and set a timer to remove it (if required by user)
      if (managingBorders && "none" !== borderType) {
        borderDrawer.addBorder(elementInfo);
        if ("momentary" === borderType) {
          clearTimeout(borderRemovalTimer);
          borderRemovalTimer = setTimeout(function () {
            borderDrawer.removeBorderOn(currentElementInfo.element);
          }, momentaryBorderTime);
        }
      }
      // Restore tabindex value
      null === originalTabindex
        ? elementInfo.element.removeAttribute("tabindex")
        : "0" === originalTabindex &&
          elementInfo.element.setAttribute("tabindex", "0");
      currentElementInfo = elementInfo;
    };
    // By default, this object will ask for borders to be drawn and removed
    // according to user preferences (and reflect changes in preferences). If
    // it shouldn't (i.e. because all borders are being shown, and managed by
    // other code) then this can be turned off - though it will still manage
    // element focusing.
    this.manageBorders = function (canManageBorders) {
      managingBorders = canManageBorders;
      canManageBorders
        ? "persistent" === borderType &&
          // When we stop showing all landmarks at once, ensure the last
          // single one is put back if it was permanent.
          borderDrawer.addBorder(currentElementInfo)
        : clearTimeout(borderRemovalTimer);
    };
    this.isManagingBorders = function () {
      return managingBorders;
    };
    this.clear = function () {
      currentElementInfo && resetEverything();
    };
    // When the document is changed, the currently-focused element may have
    // been removed, or at least changed size/position.
    // Note: this doesn't call the border drawer to refresh all borders, as
    //       this object is mainly concerned with just the current one, but
    //       after a mutation, any borders that are drawn should be refreshed.
    this.refreshFocusedElement = function () {
      currentElementInfo &&
        (doc.body.contains(currentElementInfo.element) || resetEverything());
    };

    // Private API

    // Used internally when we know we have a currently selected element
    function resetEverything() {
      clearTimeout(borderRemovalTimer);
      borderDrawer.removeBorderOn(currentElementInfo.element);
      currentElementInfo = null;
    }
    // Should a border be added/removed?
    function borderTypeChange() {
      currentElementInfo &&
        managingBorders &&
        ("persistent" === borderType
          ? borderDrawer.addBorder(currentElementInfo)
          : borderDrawer.removeBorderOn(currentElementInfo.element));
    }
  }
  function PauseHandler(pauseTimeHook) {
    // Constants
    const minPause = 500;
    const maxPause = 6e4;
    const multiplier = 1.5;
    const decrement = minPause;
    const decreaseEvery = 2 * minPause;

    // State

    let pause = minPause;
    let lastEvent = Date.now();
    let scheduledTaskTimeout = null;
    let decreasePauseTimeout = null;
    let haveIncreasedPauseAndScheduledTask = false;
    pauseTimeHook(pause);

    // Private API

    function increasePause() {
      stopDecreasingPause();
      pause = Math.floor(pause * multiplier);
      pause >= maxPause && (pause = maxPause);
      pauseTimeHook(pause);
    }
    function decreasePause() {
      decreasePauseTimeout = setTimeout(_decreasePause, decreaseEvery);
    }
    function _decreasePause() {
      pause = Math.floor(pause - decrement);
      if (pause <= minPause) {
        pause = minPause;
        decreasePauseTimeout = null;
      } else {
        decreasePause();
      }
      pauseTimeHook(pause);
    }
    function ceaseTimeout(timeout) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }
    function stopDecreasingPause() {
      ceaseTimeout(decreasePauseTimeout);
    }
    function cancelScheduledTask() {
      ceaseTimeout(scheduledTaskTimeout);
    }

    // Public API

    // TODO: would this be more efficient if tasks specified at init?
    this.run = function (ignoreCheck, guardedTask, scheduledTask) {
      if (ignoreCheck()) {
        return;
      }
      const now = Date.now();
      if (now > lastEvent + pause) {
        guardedTask();
        lastEvent = now;
      } else if (!haveIncreasedPauseAndScheduledTask) {
        increasePause();
        scheduledTaskTimeout = setTimeout(() => {
          scheduledTask();
          decreasePause();
          haveIncreasedPauseAndScheduledTask = false;
        }, pause);
        haveIncreasedPauseAndScheduledTask = true;
      }
    };
    this.isPaused = function () {
      return pause > minPause;
    };
    this.reset = function () {
      cancelScheduledTask();
      stopDecreasingPause();
      pause = minPause;
    };
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
  function BorderDrawer(win, doc, contrastChecker) {
    const borderWidthPx = 4;
    const borderedElements = new Map();
    let borderColour = defaultBorderSettings.borderColour;
    // cached locally
    let borderFontSize = defaultBorderSettings.borderFontSize;
    // cached locally
    let labelFontColour = null;
    // computed based on border colour
    let madeDOMChanges = false;

    // Window resize handling

    function resizeHandler() {
      for (const [element, related] of borderedElements) {
        doc.body.contains(element)
          ? sizeBorderAndLabel(element, related.border, related.label)
          : removeBorderAndDelete(element);
      }
    }
    win.addEventListener("resize", resizeHandler);

    // Options handling

    // Take a local copy of relevant options at the start (this means that
    // 'gets' of options don't need to be done asynchronously in the rest of
    // the code). This also computes the initial label font colour (as it
    // depends on the border colour, which forms the label's background).
    browser.storage.sync.get(defaultBorderSettings, function (items) {
      borderColour = items["borderColour"];
      borderFontSize = items["borderFontSize"];
      updateLabelFontColour();
    });
    browser.storage.onChanged.addListener(function (changes) {
      let needUpdate = false;
      if ("borderColour" in changes) {
        borderColour =
          changes.borderColour.newValue ?? defaultBorderSettings.borderColour;
        needUpdate = true;
      }
      if ("borderFontSize" in changes) {
        borderFontSize =
          changes.borderFontSize.newValue ??
          defaultBorderSettings.borderFontSize;
        needUpdate = true;
      }
      if (needUpdate) {
        updateLabelFontColour();
        redrawBordersAndLabels();
      }
    });

    // Public API

    // Add the landmark border and label for an element. Takes an element info
    // object, as returned by the various LandmarksFinder functions.

    // Note: we assume that if an element already exists and we try to add it
    //       again (as may happen if the page changes whilst we're displaying
    //       all elements, and try to add any new ones) that the existing
    //       elements' labels won't have changed.
    this.addBorder = function (elementInfo) {
      borderedElements.has(elementInfo.element) ||
        drawBorderAndLabel(
          elementInfo.element,
          landmarkName(elementInfo),
          borderColour,
          labelFontColour, // computed as a result of settings
          borderFontSize,
          elementInfo.guessed
        );
    };
    // Add the landmark border and label for several elements, and remove any
    // borders associated with elements that currently have borders but aren't
    // in this set. Takes an array of element info objects, as detailed above.
    this.replaceCurrentBordersWithElements = function (elementInfoList) {
      const elementsToAdd = elementInfoList.map((info) => info.element);
      for (const elementWithBorder of borderedElements.keys()) {
        elementsToAdd.includes(elementWithBorder) ||
          this.removeBorderOn(elementWithBorder);
      }
      for (const elementInfo of elementInfoList) {
        this.addBorder(elementInfo);
      }
    };
    this.removeBorderOn = function (element) {
      borderedElements.has(element) && removeBorderAndDelete(element);
    };
    this.removeAllBorders = function () {
      for (const element of borderedElements.keys()) {
        removeBorderAndDelete(element);
      }
    };
    // Did we just make changes to a border? If so, report this, so that the
    // mutation observer can ignore it.
    this.hasMadeDOMChanges = function () {
      const didChanges = madeDOMChanges;
      madeDOMChanges = false;
      return didChanges;
    };
    // In case it's detected that an element may've moved due to mutations
    this.refreshBorders = function () {
      resizeHandler();
    };

    // Private API

    // Create an element on the page to act as a border for the element to be
    // highlighted, and a label for it; position and style them appropriately
    function drawBorderAndLabel(
      element,
      label,
      colour,
      fontColour,
      fontSize,
      guessed
    ) {
      const zIndex = 1e7;
      const labelContent = doc.createTextNode(label);
      const borderDiv = doc.createElement("div");
      const style = guessed ? "dashed" : "solid";
      borderDiv.style.border = borderWidthPx + "px " + style + " " + colour;
      borderDiv.style.boxSizing = "border-box";
      borderDiv.style.margin = "0";
      borderDiv.style.padding = "0";
      // Pass events through - https://stackoverflow.com/a/6441884/1485308
      borderDiv.style.pointerEvents = "none";
      borderDiv.style.position = "absolute";
      borderDiv.style.zIndex = zIndex;
      const labelDiv = doc.createElement("div");
      labelDiv.style.backgroundColor = colour;
      labelDiv.style.border = "none";
      labelDiv.style.boxSizing = "border-box";
      labelDiv.style.color = fontColour;
      labelDiv.style.display = "inline-block";
      labelDiv.style.fontFamily = "sans-serif";
      labelDiv.style.fontSize = fontSize + "px";
      labelDiv.style.fontWeight = "bold";
      labelDiv.style.margin = "0";
      labelDiv.style.paddingBottom = "0.25em";
      labelDiv.style.paddingLeft = "0.75em";
      labelDiv.style.paddingRight = "0.75em";
      labelDiv.style.paddingTop = "0.25em";
      labelDiv.style.position = "absolute";
      labelDiv.style.whiteSpace = "nowrap";
      labelDiv.style.zIndex = zIndex;
      labelDiv.appendChild(labelContent);
      doc.body.appendChild(borderDiv);
      doc.body.appendChild(labelDiv);
      madeDOMChanges = true;
      // seems to be covered by sizeBorderAndLabel()
      sizeBorderAndLabel(element, borderDiv, labelDiv);
      borderedElements.set(element, {
        border: borderDiv,
        label: labelDiv,
        guessed: guessed,
      });
    }
    // Given an element on the page and elements acting as the border and
    // label, size the border, and position the label, appropriately for the
    // element
    function sizeBorderAndLabel(element, border, label) {
      const elementBounds = element.getBoundingClientRect();
      const elementTopEdgeStyle = win.scrollY + elementBounds.top + "px";
      const elementLeftEdgeStyle = win.scrollX + elementBounds.left + "px";
      const elementRightEdgeStyle =
        doc.documentElement.clientWidth -
        (win.scrollX + elementBounds.right) +
        "px";
      border.style.left = elementLeftEdgeStyle;
      border.style.top = elementTopEdgeStyle;
      border.style.width = elementBounds.width + "px";
      border.style.height = elementBounds.height + "px";
      // Try aligning the right edge of the label to the right edge of the
      // border.

      // If the label would go off-screen left, align the left edge of the
      // label to the left edge of the border.
      label.style.removeProperty("left");
      // in case this was set before
      label.style.top = elementTopEdgeStyle;
      label.style.right = elementRightEdgeStyle;
      // Is part of the label off-screen?
      const labelBounds = label.getBoundingClientRect();
      if (labelBounds.left < 0) {
        label.style.removeProperty("right");
        label.style.left = elementLeftEdgeStyle;
      }
      madeDOMChanges = true;
      // seems to be in the right place
    }
    function removeBorderAndDelete(element) {
      removeBorderAndLabelFor(element);
      borderedElements.delete(element);
    }
    // Remove known-existing DOM nodes for the border and label
    // Note: does not remove the record of the element, so as to avoid an
    //       infinite loop when redrawing borders.
    //       TODO fix this with .keys()?
    function removeBorderAndLabelFor(element) {
      const related = borderedElements.get(element);
      related.border.remove();
      related.label.remove();
      madeDOMChanges = true;
    }
    // Work out if the label font colour should be black or white
    function updateLabelFontColour() {
      labelFontColour = contrastChecker.foregroundTextColour(
        borderColour,
        borderFontSize,
        true
      );
      // the font is always bold
    }
    function redrawBordersAndLabels() {
      for (const [element, related] of borderedElements) {
        const labelText = related.label.innerText;
        removeBorderAndLabelFor(element);
        drawBorderAndLabel(
          element,
          labelText,
          borderColour,
          labelFontColour, // computed as a result of settings
          borderFontSize,
          related.guessed
        );
      }
    }
  }
  function ContrastChecker() {
    const channelStringPositions = {
      r: 1,
      g: 3,
      b: 5,
    };

    // Public API

    this.contrastRatio = function (hex1, hex2) {
      const l1 = luminance(transmogrify(sRGB(hexToRGB(hex1))));
      const l2 = luminance(transmogrify(sRGB(hexToRGB(hex2))));
      if (l1 > l2) {
        return contrast(l1, l2);
      }
      return contrast(l2, l1);
    };
    this.foregroundTextColour = function (backgroundColour, fontSize, bold) {
      const contrastWhite = this.contrastRatio("#ffffff", backgroundColour);
      const threshold =
        fontSize >= 18 || (fontSize >= 14 && true === bold) ? 3 : 4.5;
      if (contrastWhite >= threshold) {
        return "white";
      }
      return "black";
    };

    // Private API

    function hexToRGB(hex) {
      const rgb = {};
      for (const channel in channelStringPositions) {
        const chanHex = hex.substr(channelStringPositions[channel], 2);
        rgb[channel] = parseInt("0x" + chanHex);
      }
      return rgb;
    }
    function sRGB(rgb) {
      return {
        r: rgb.r / 255,
        g: rgb.g / 255,
        b: rgb.b / 255,
      };
    }
    function transmogrify(sRGB) {
      const transmogrified = {};
      for (const channel in sRGB) {
        sRGB[channel] <= 0.03928
          ? (transmogrified[channel] = sRGB[channel] / 12.92)
          : (transmogrified[channel] =
              ((sRGB[channel] + 0.055) / 1.055) ** 2.4);
      }
      return transmogrified;
    }
    function luminance(transmogrified) {
      return (
        0.2126 * transmogrified.r +
        0.7152 * transmogrified.g +
        0.0722 * transmogrified.b
      );
    }
    function contrast(lighter, darker) {
      return (lighter + 0.05) / (darker + 0.05);
    }
  }
  // TODO: make this like the mutation observer—disconnect when DevTools isn't
  //       open? (Would need to manage expectations in that case.)
  function MutationStatsReporter() {
    let totalMutations = 0;
    let checkedMutations = 0;
    let mutationScans = 0;
    let nonMutationScans = 0;
    let pauseTime = null;
    let lastScanDuration = null;
    let quiet = true;

    // Public API

    this.reset = function () {
      totalMutations = 0;
      checkedMutations = 0;
      mutationScans = 0;
      nonMutationScans = 0;
      pauseTime = null;
      lastScanDuration = null;
    };
    this.beQuiet = function () {
      quiet = true;
    };
    this.beVerbose = function () {
      quiet = false;
      _sendAllUpdates();
    };
    this.incrementTotalMutations = function () {
      totalMutations += 1;
    };
    this.incrementCheckedMutations = function () {
      checkedMutations += 1;
    };
    this.incrementMutationScans = function () {
      mutationScans += 1;
    };
    this.incrementNonMutationScans = function () {
      nonMutationScans += 1;
      quiet || _sendNonMutationScansUpdate();
    };
    this.setPauseTime = function (time) {
      pauseTime = time;
      quiet || _sendPauseTimeUpdate();
    };
    this.setLastScanDuration = function (duration) {
      lastScanDuration = Math.round(duration);
      // Chrome is precise
      quiet || _sendDurationUpdate();
    };
    // Only these two public send methods are exposed because the mutation info
    // update consists of three things that are sent after each mutation, check
    // and possible scan. Also quite high-traffic perhaps, so cutting down on
    // the times this info is sent is important.
    this.sendMutationUpdate = function () {
      quiet || _sendMutationUpdate();
    };
    this.sendAllUpdates = function () {
      quiet || _sendAllUpdates();
    };

    // Private API

    function _sendMutationUpdate() {
      browser.runtime.sendMessage({
        name: "mutation-info",
        data: {
          mutations: totalMutations,
          checks: checkedMutations,
          mutationScans: mutationScans,
        },
      });
    }
    function _sendNonMutationScansUpdate() {
      browser.runtime.sendMessage({
        name: "mutation-info",
        data: {
          nonMutationScans: nonMutationScans,
        },
      });
    }
    function _sendPauseTimeUpdate() {
      browser.runtime.sendMessage({
        name: "mutation-info",
        data: {
          pause: pauseTime,
        },
      });
    }
    function _sendDurationUpdate() {
      browser.runtime.sendMessage({
        name: "mutation-info",
        data: {
          duration: lastScanDuration,
        },
      });
    }
    function _sendAllUpdates() {
      _sendMutationUpdate();
      _sendNonMutationScansUpdate();
      _sendPauseTimeUpdate();
      _sendDurationUpdate();
    }
  }
  const landmarksFinderStandard = new LandmarksFinder$1(window, document, true);
  const landmarksFinderDeveloper = new LandmarksFinder(window, document, true);
  const contrastChecker = new ContrastChecker();
  const borderDrawer = new BorderDrawer(window, document, contrastChecker);
  const elementFocuser = new ElementFocuser(document, borderDrawer);
  const msr = new MutationStatsReporter();
  const pauseHandler = new PauseHandler(msr.setPauseTime);
  const noop = () => {};
  const observerReconnectionGrace = 2e3;
  // wait after page becomes visible again
  let observerReconnectionScanTimer = null;
  let observer = null;
  let landmarksFinder = landmarksFinderStandard;
  // just in case
  let haveScannedForLandmarks = false;

  // Extension message management

  function messageHandler(message) {
    switch (message.name) {
      case "get-landmarks":
        // A GUI is requesting the list of landmarks on the page
        doUpdateOutdatedResults() || sendLandmarks();
        break;

      case "focus-landmark":
        // Triggered by activating an item in a GUI, or indirectly via one
        // of the keyboard shortcuts (if landmarks are present)
        doUpdateOutdatedResults();
        guiCheckFocusElement(() =>
          landmarksFinder.getLandmarkElementInfo(message.index)
        );
        break;

      case "next-landmark":
        // Triggered by keyboard shortcut
        doUpdateOutdatedResults();
        guiCheckFocusElement(landmarksFinder.getNextLandmarkElementInfo);
        break;

      case "prev-landmark":
        // Triggered by keyboard shortcut
        doUpdateOutdatedResults();
        guiCheckFocusElement(landmarksFinder.getPreviousLandmarkElementInfo);
        break;

      case "main-landmark": {
        // Triggered by keyboard shortcut
        doUpdateOutdatedResults();
        const mainElementInfo = landmarksFinder.getMainElementInfo();
        mainElementInfo
          ? elementFocuser.focusElement(mainElementInfo)
          : alert(browser.i18n.getMessage("noMainLandmarkFound"));
        break;
      }

      case "toggle-all-landmarks":
        // Triggered by keyboard shortcut
        doUpdateOutdatedResults();
        if (guiCheckThereAreLandmarks()) {
          if (elementFocuser.isManagingBorders()) {
            elementFocuser.manageBorders(false);
            borderDrawer.replaceCurrentBordersWithElements(
              landmarksFinder.allElementsInfos()
            );
          } else {
            borderDrawer.removeAllBorders();
            elementFocuser.manageBorders(true);
          }
        }

      // eslint-disable-this-line no-fallthrough
      case "get-toggle-state":
        browser.runtime.sendMessage({
          name: "toggle-state-is",
          data: elementFocuser.isManagingBorders() ? "selected" : "all",
        });
        break;

      case "trigger-refresh":
        // On sites that use single-page style techniques to transition
        // (such as YouTube and GitHub) we monitor in the background script
        // for when the History API is used to update the URL of the page
        // (indicating that its content has changed substantially). When
        // this happens, we should treat it as a new page, and fetch
        // landmarks again when asked.
        msr.reset();
        pauseHandler.reset();
        elementFocuser.clear();
        borderDrawer.removeAllBorders();
        findLandmarksAndSend(
          // TODO: this willl send the non-mutation message twice
          msr.incrementNonMutationScans,
          msr.sendAllUpdates
        );
        // haveScannedForLandmarks will be set to true now anyway
        break;

      case "devtools-state":
        if ("open" === message.state) {
          landmarksFinder = landmarksFinderDeveloper;
          msr.beVerbose();
        } else {
          if ("closed" !== message.state) {
            throw Error(`Invalid DevTools state "${message.state}".`);
          }
          landmarksFinder = landmarksFinderStandard;
          msr.beQuiet();
        }
        document.hidden || findLandmarks(noop, noop);
        break;

      case "get-page-warnings":
        browser.runtime.sendMessage({
          name: "page-warnings",
          data: landmarksFinder.pageResults(),
        });
    }
  }
  function doUpdateOutdatedResults() {
    let outOfDate = false;
    if (null === observerReconnectionScanTimer || haveScannedForLandmarks) {
      pauseHandler.isPaused() && (outOfDate = true);
    } else {
      cancelObserverReconnectionScan();
      observeMutations();
      outOfDate = true;
    }
    if (true === outOfDate) {
      findLandmarksAndSend(msr.incrementNonMutationScans, noop);
      // it already calls the send function
      return true;
    }
    return false;
  }
  function guiCheckThereAreLandmarks() {
    if (0 === landmarksFinder.getNumberOfLandmarks()) {
      alert(browser.i18n.getMessage("noLandmarksFound"));
      return false;
    }
    return true;
  }
  function guiCheckFocusElement(callbackReturningElementInfo) {
    guiCheckThereAreLandmarks() &&
      elementFocuser.focusElement(callbackReturningElementInfo());
  }

  // Finding landmarks

  function sendLandmarks() {
    browser.runtime.sendMessage({
      name: "landmarks",
      data: landmarksFinder.allInfos(),
    });
  }
  function findLandmarks(counterIncrementFunction, updateSendFunction) {
    const start = performance.now();
    landmarksFinder.find();
    haveScannedForLandmarks || (haveScannedForLandmarks = true);
    msr.setLastScanDuration(performance.now() - start);
    counterIncrementFunction();
    updateSendFunction();
    elementFocuser.refreshFocusedElement();
    borderDrawer.refreshBorders();
    elementFocuser.isManagingBorders() ||
      borderDrawer.replaceCurrentBordersWithElements(
        landmarksFinder.allElementsInfos()
      );
  }
  function findLandmarksAndSend(counterIncrementFunction, updateSendFunction) {
    findLandmarks(counterIncrementFunction, updateSendFunction);
    sendLandmarks();
  }

  // Bootstrapping and mutation observer setup

  function shouldRefreshLandmarkss(mutations) {
    for (const mutation of mutations) {
      if ("childList" !== mutation.type) {
        // Attribute change
        if ("style" === mutation.attributeName) {
          if (
            /display|visibility/.test(mutation.target.getAttribute("style"))
          ) {
            return true;
          }
          continue;
        }
        // TODO: things that could be checked:
        //  * If it's a class change, check if it affects visiblity.
        //  * If it's a relevant change to the role attribute.
        //  * If it's a relevant change to aria-labelledby.
        //  * If it's a relevant change to aria-label.
        // For now, assume that any change is relevant, becuse it
        // could be.
        return true;
      }
      // Structural change
      for (const nodes of [mutation.addedNodes, mutation.removedNodes]) {
        for (const node of nodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return true;
          }
        }
      }
    }
    return false;
  }
  function createMutationObserver() {
    observer = new MutationObserver(function (mutations) {
      msr.incrementTotalMutations();
      // Guard against being innundated by mutation events
      // (which happens in e.g. Google Docs)
      pauseHandler.run(
        // Ignore border-drawing mutations
        borderDrawer.hasMadeDOMChanges,
        // Guarded task
        function () {
          msr.incrementCheckedMutations();
          shouldRefreshLandmarkss(mutations) &&
            findLandmarksAndSend(msr.incrementMutationScans, noop);
        },
        // Scheduled task
        function () {
          findLandmarksAndSend(
            msr.incrementMutationScans,
            msr.sendMutationUpdate
          );
        }
      );
      msr.sendMutationUpdate();
    });
  }
  function observeMutations() {
    observer.observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "role",
        "aria-labelledby",
        "aria-label",
      ],
    });
  }
  function cancelObserverReconnectionScan() {
    if (observerReconnectionScanTimer) {
      clearTimeout(observerReconnectionScanTimer);
      observerReconnectionScanTimer = null;
    }
  }
  function reflectPageVisibility() {
    if (document.hidden) {
      cancelObserverReconnectionScan();
      observer.disconnect();
    } else {
      observerReconnectionScanTimer = setTimeout(function () {
        findLandmarksAndSend(msr.incrementNonMutationScans, noop);
        // it will send anyway
        observeMutations();
        observerReconnectionScanTimer = null;
      }, observerReconnectionGrace);
    }
  }
  function bootstrap() {
    browser.runtime.onMessage.addListener(messageHandler);
    browser.runtime
      .connect({
        name: "disconnect-checker",
      })
      .onDisconnect.addListener(function () {
        console.log(
          "Landmarks: content script disconnected due to extension unload/reload."
        );
        observer.disconnect();
        document.removeEventListener(
          "visibilitychange",
          reflectPageVisibility,
          false
        );
      });
    createMutationObserver();
    // Requesting the DevTools' state will eventually cause the correct scanner
    // to be set, and the document to be scanned, if visible.
    browser.runtime.sendMessage({
      name: "get-devtools-state",
    });
    document.addEventListener("visibilitychange", reflectPageVisibility, false);
  }
  bootstrap();
})();
