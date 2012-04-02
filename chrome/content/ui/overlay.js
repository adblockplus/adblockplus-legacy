/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

{
  let Cc = Components.classes;
  let Ci = Components.interfaces;
  let Cr = Components.results;
  let Cu = Components.utils;

  // Use UIReady event to initialize in Fennec (bug 531071)
  let eventName = Cu.import("chrome://adblockplus-modules/content/Utils.jsm", null).Utils.isFennec ? "UIReady" : "load";

  window.addEventListener(eventName, function()
  {
    window.removeEventListener(eventName, arguments.callee, false);

    if (!("@adblockplus.org/abp/public;1" in Cc))
    {
      // Force initialization (in Fennec we won't be initialized at this point)
      Cu.import("chrome://adblockplus-modules/content/Bootstrap.jsm", null).Bootstrap.startup();
    }

    Cu.import("chrome://adblockplus-modules/content/AppIntegration.jsm", null).AppIntegration.addWindow(window);
  }, false);
}
