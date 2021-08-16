(function () {
  "use strict";
  window.browser = window.chrome;
  browser.devtools.panels.elements.createSidebarPane(
    "Landmarks",
    function (sidebarPane) {
      sidebarPane.setPage("devtoolsPanel.html");
    }
  );
})();
